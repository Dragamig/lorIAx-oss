/**
 * Dérivation de la portée d'organisation des chemins d'IA différés
 * (audit AZ-06, lot 6).
 *
 * `provider-resolver.ts` exige désormais une portée EXPLICITE. Un appelant en
 * contexte HTTP la tient de `getRequestOrgId`. Un chemin différé (automatisation
 * exécutée en tâche de fond, compte rendu de réunion, traitement d'une note
 * vocale) n'a pas de requête sous la main : sa portée est celle de l'objet
 * qu'il traite, et se remonte jusqu'à l'espace, seule table qui porte
 * `organization_id` en NOT NULL.
 *
 * Toutes ces fonctions sont fermées par défaut : objet introuvable, colonne
 * nulle ou lecture en erreur ne rendent JAMAIS « toutes les organisations ».
 * Elles rendent la portée de repli, et il n'en existe qu'une dans le produit :
 * {@link porteeSansOrganisation}, c'est-à-dire `instanceProviderScope`.
 *
 * Ce point était l'incohérence corrigée le 2026-08-20 : ce module rendait un
 * `null` sec là où `rerank.ts` et les chemins d'embeddings passaient déjà par
 * `instanceProviderScope`. Le même `null` valait donc « l'organisation unique
 * de l'instance » d'un côté et « rien » de l'autre. Sur une instance à une
 * seule organisation, cas majoritaire de l'auto-hébergement, la migration 0014
 * ayant rattaché tous les fournisseurs préexistants à l'organisation `default`,
 * un `null` sec ne trouvait aucun fournisseur et retombait SILENCIEUSEMENT sur
 * les variables d'environnement : une automatisation sans espace ni base
 * rattachée, ou une réunion sans espace, perdait la configuration d'IA de
 * l'instance. Il n'y a désormais qu'une seule façon de répondre à « quelle
 * portée quand je n'ai pas d'organisation », et elle est nommée.
 *
 * Le repli reste sans emprunt possible : `instanceProviderScope` ne désigne
 * une organisation que lorsqu'elle est UNIQUE et active. Dès qu'il y a
 * plusieurs tenants, il rend `null`, la sélection se limite aux fournisseurs
 * de portée instance, et aucun fournisseur de tenant n'est atteignable.
 *
 * Les lectures sont volontairement faites table par table, sans jointure : la
 * chaîne note vocale → document → espace se lit aussi bien ainsi, et chaque
 * maillon manquant se traite au même endroit que les autres.
 */
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { documents, media, spaces, userDatabases } from "@/lib/db/schema";
import { voiceNotes } from "@/lib/db/schema-voice-notes";
import logger from "@/lib/logger";
import {
  instanceProviderScope,
  type ProviderOrgScope,
} from "@/lib/ai/provider-resolver";

/**
 * LA réponse unique à « quelle portée quand je n'ai pas d'organisation ».
 *
 * Toute sortie de ce module qui n'a pas su dériver une organisation passe par
 * ici, et par ici seulement : il ne doit jamais y avoir deux traitements du
 * même « je ne sais pas ». Voir l'en-tête du module pour la régression que
 * cette unification a fermée.
 */
function porteeSansOrganisation(): Promise<ProviderOrgScope> {
  return instanceProviderScope();
}

/** Journalise un échec de dérivation sans jamais le propager. */
function replier(objet: string, err: unknown): Promise<ProviderOrgScope> {
  logger.warn(
    { err, objet },
    "Portée d'organisation indérivable, repli sur la portée d'instance",
  );
  return porteeSansOrganisation();
}

/** Organisation propriétaire d'un espace. */
export async function orgIdForSpace(
  spaceId: string | null | undefined,
): Promise<ProviderOrgScope> {
  if (!spaceId) return porteeSansOrganisation();
  try {
    const [row] = await db
      .select({ organizationId: spaces.organizationId })
      .from(spaces)
      .where(eq(spaces.id, spaceId))
      .limit(1);
    return row?.organizationId ?? porteeSansOrganisation();
  } catch (err) {
    return replier("space", err);
  }
}

/** Organisation d'un document, via son espace. */
export async function orgIdForDocument(
  documentId: string | null | undefined,
): Promise<ProviderOrgScope> {
  if (!documentId) return porteeSansOrganisation();
  try {
    const [row] = await db
      .select({ spaceId: documents.spaceId })
      .from(documents)
      .where(eq(documents.id, documentId))
      .limit(1);
    return orgIdForSpace(row?.spaceId);
  } catch (err) {
    return replier("document", err);
  }
}

/** Organisation d'une note vocale, via son document puis son espace. */
export async function orgIdForVoiceNote(
  noteId: string | null | undefined,
): Promise<ProviderOrgScope> {
  if (!noteId) return porteeSansOrganisation();
  try {
    const [row] = await db
      .select({ documentId: voiceNotes.documentId })
      .from(voiceNotes)
      .where(eq(voiceNotes.id, noteId))
      .limit(1);
    return orgIdForDocument(row?.documentId);
  } catch (err) {
    return replier("voice_note", err);
  }
}

/**
 * Organisation d'une automatisation.
 *
 * `user_database_automations` ne porte pas d'`organization_id` : son invariant
 * applicatif est « `databaseId` OU `spaceId` non nul ». Applicatif, et lui
 * seul : les deux colonnes sont nullables et aucune contrainte `check` ne les
 * lie (cf. `schema.ts`, table `user_database_automations`). Une ligne avec les
 * deux colonnes nulles est donc représentable, d'où le repli nommé plus bas
 * plutôt qu'un `null` sec. Un workflow autonome
 * pointe directement son espace ; une automatisation base-liée passe par sa
 * base, elle-même rattachée à un espace. On préfère `spaceId` quand les deux
 * sont renseignés : c'est le lien direct, il ne dépend d'aucune lecture
 * supplémentaire.
 */
export async function orgIdForAutomation(automation: {
  spaceId?: string | null;
  databaseId?: string | null;
}): Promise<ProviderOrgScope> {
  if (automation.spaceId) return orgIdForSpace(automation.spaceId);
  if (!automation.databaseId) return porteeSansOrganisation();
  try {
    const [row] = await db
      .select({ spaceId: userDatabases.spaceId })
      .from(userDatabases)
      .where(eq(userDatabases.id, automation.databaseId))
      .limit(1);
    return orgIdForSpace(row?.spaceId);
  } catch (err) {
    return replier("automation", err);
  }
}

/**
 * Organisation propriétaire d'un média (colonne `media.organization_id`, NOT NULL).
 *
 * Contrairement aux autres fonctions de ce module, FERMÉE sans repli : un média
 * introuvable ou une lecture en erreur rendent `null`, jamais la portée
 * d'instance. L'indexation IA d'un média qu'on ne sait pas rattacher à une
 * organisation ne doit pas partir sur le fournisseur d'un autre périmètre.
 */
export async function orgIdForMedia(mediaId: string | null | undefined): Promise<string | null> {
  if (!mediaId) return null;
  try {
    const [row] = await db
      .select({ organizationId: media.organizationId })
      .from(media)
      .where(eq(media.id, mediaId))
      .limit(1);
    return row?.organizationId ?? null;
  } catch (err) {
    logger.warn({ err, objet: "media" }, "Organisation du média indérivable, accès refusé");
    return null;
  }
}
