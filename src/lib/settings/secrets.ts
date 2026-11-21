/**
 * Secrets et cloisonnement des réglages d'instance (`system_settings`).
 *
 * Ce module porte la logique métier partagée par les routes qui écrivent dans
 * `system_settings` : quelles clés relèvent de l'administration d'instance,
 * quels champs portent un secret, comment ces secrets sont masqués en lecture
 * et préservés en écriture. Il vit sous `src/lib/` et non dans un `route.ts` :
 * deux routes qui s'importent l'une l'autre couplent inutilement le graphe de
 * build, et ces constantes ne sont pas des détails de transport.
 */
import { isPlainObject } from "@/lib/settings/merge";

/**
 * Clés d'INFRASTRUCTURE : elles configurent des services partagés par toute
 * l'instance, donc par tous les tenants à la fois.
 *
 * Audit du 2026-08-19, constat AZ-08 : ces clés étaient lisibles et
 * modifiables par tout `globalRole=admin`, y compris l'administrateur d'une
 * seule organisation. Remplacer le relais SMTP de l'instance suffisait alors à
 * détourner les courriels de TOUS les tenants, liens de réinitialisation de
 * mot de passe compris. Le rôle `admin` administre une organisation, il
 * n'administre pas la machine : ces clés sont réservées à `super_admin`, en
 * lecture comme en écriture (même frontière que `canCrossOrgBoundary`).
 *
 * Critère d'appartenance, revu au lot 6 : « porte un identifiant ou un relais »
 * était trop étroit. Une clé relève de l'infrastructure dès qu'elle est de
 * PORTEE INSTANCE au sens fort, c'est-à-dire qu'elle désigne ou oriente un
 * service partagé traitant les données de tous les tenants, ou qu'elle règle
 * l'authentification de l'instance. Le seul fait d'être stockée une fois pour
 * toute l'instance ne suffit pas : `general`, `rolePermissions`, `ai_global`,
 * `ai_alerts`, `automations`, `collab`, `meeting_rooms_enabled`,
 * `help_assistant_enabled`, `rerank` le sont aussi et restent ouvertes au rôle
 * `admin`, faute de quoi l'administration d'une organisation n'aurait plus
 * aucun réglage à sa main. Ces clés-là n'orientent aucun flux de données hors
 * de l'instance, et leurs interrupteurs de module sont déjà réservés à
 * /api/admin/modules/[id].
 *
 * Toute autre route qui touche `system_settings` doit REUTILISER cette liste
 * plutôt qu'en recopier une variante, sinon elle rouvre une porte dérobée sur
 * le correctif (cas de /api/admin/ai/settings, qui rendait et écrivait
 * `whisper` et `ollama` à tout `globalRole=admin`).
 */
export const INFRASTRUCTURE_KEYS = new Set<string>([
  "auth", // politique d'inscription et rôle par défaut de l'instance
  "smtp", // relais de messagerie de l'instance (forme historique)
  "email", // relais de messagerie de l'instance (SMTP ou Resend)
  "ldap", // annuaire d'entreprise et compte de service de lecture
  "livekit", // serveur média et son couple clé/secret
  "whisper", // service de transcription auto-hébergé
  "ollama", // service d'inférence auto-hébergé
  "voxtral", // service de transcription auto-hébergé, même nature que whisper
  // Sélecteur du moteur de transcription (`engine`) et vocabulaire métier
  // partagé (`vocabulary`) de TOUTE l'instance : `getTranscriptionEngine` et
  // `getTranscriptionVocabulary` (src/lib/meet/transcribe.ts) lisent cette
  // ligne unique sans aucune notion d'organisation. Protéger l'adresse de
  // `whisper` et de `voxtral` sans protéger le commutateur qui désigne l'un ou
  // l'autre laissait la porte ouverte : un administrateur d'organisation
  // basculait le moteur de tous les tenants, donc l'ensemble des audios de
  // l'instance, vers le service de son choix.
  "transcription",
  "backup_s3", // dépôt des sauvegardes de l'instance entière
  "backup_schedule", // planification de ces sauvegardes
]);

/**
 * Sentinelle rendue à la place d'un secret réellement stocké.
 *
 * ASVS V4.3 : un secret ne se relit jamais par l'API. La lecture ne rend donc
 * que la présence du secret, jamais sa valeur. Les caractères choisis sont
 * reconnus par `isBlankOrMasked`, ce qui ferme le piège de l'aller-retour
 * décrit sur `SECRET_FIELDS`.
 */
export const MASKED_SECRET = "••••••••";

/**
 * Champs porteurs d'un secret, par clé de réglage.
 *
 * Ils sont masqués en lecture ET protégés en écriture : le formulaire
 * d'administration relit les réglages puis les réécrit tels quels, si bien
 * qu'un premier enregistrement remplacerait le secret réel par la sentinelle
 * si l'écriture l'acceptait. Chaque champ est donc traité individuellement :
 * valeur vide ou masquée reçue, on conserve la valeur déjà en base.
 *
 * `SENSITIVE_FIELDS` (côté route) en est le sous-ensemble chiffré au repos.
 * Les champs LiveKit, eux, sont stockés en clair mais restent des secrets :
 * ils doivent être masqués et préservés au même titre.
 */
export const SECRET_FIELDS: Record<string, string[]> = {
  ldap: ["ldapBindPassword"],
  email: ["smtpPassword", "resendApiKey"],
  smtp: ["smtpPassword"],
  backup_s3: ["s3BackupSecretKey"],
  livekit: ["livekitApiKey", "livekitApiSecret"],
};

/**
 * Clés jumelles décrivant la MEME configuration sous deux formes.
 *
 * Le relais de messagerie existe sous deux clés : `smtp`, forme héritée, et
 * `email`, forme actuelle. L'écran des courriels LIT en repli sur `smtp` quand
 * `email` n'existe pas encore, mais il ECRIT toujours sous `email`. Sans ce
 * repli, la préservation cherchait le mot de passe sous la seule clé écrite,
 * ne le trouvait pas, et créait une ligne `email` SANS mot de passe : le
 * fournisseur de courriel privilégiant `email` dès qu'elle existe, l'instance
 * perdait son relais, liens de réinitialisation compris, et le secret n'était
 * plus récupérable depuis l'interface.
 *
 * Principe posé ici une fois pour toutes : une valeur masquée ou vide ne doit
 * JAMAIS pouvoir remplacer un secret existant, quelle que soit la clé sous
 * laquelle ce secret est rangé.
 */
export const LEGACY_SECRET_ALIASES: Record<string, string> = {
  email: "smtp",
  smtp: "email",
};

/** Chaîne vide ou composée uniquement de caractères de masquage (••••, ****). */
export function isBlankOrMasked(value: string): boolean {
  return /^[\s*•·●⋅]*$/.test(value);
}

/**
 * Remplace les secrets d'une valeur de réglage par la sentinelle de masquage.
 * Un champ absent ou vide reste absent ou vide : l'écran doit pouvoir
 * distinguer « secret configuré » de « secret jamais renseigné ».
 */
export function maskSecrets(key: string, value: unknown): unknown {
  const fields = SECRET_FIELDS[key];
  if (!fields || !isPlainObject(value)) return value;

  const masked: Record<string, unknown> = { ...value };
  for (const field of fields) {
    const current = masked[field];
    if (typeof current === "string" && current.length > 0) {
      masked[field] = MASKED_SECRET;
    }
  }
  return masked;
}

/** Valeur non vide d'un champ dans un objet de réglage, sinon `undefined`. */
function storedSecret(source: unknown, field: string): string | undefined {
  if (!isPlainObject(source)) return undefined;
  const value = source[field];
  if (typeof value !== "string" || value.length === 0) return undefined;
  if (isBlankOrMasked(value)) return undefined;
  return value;
}

/**
 * Passe de préservation des secrets, à jouer AVANT le chiffrement au repos.
 *
 * Pour chaque champ secret de la clé écrite, une valeur reçue qui n'est pas une
 * chaîne réellement renseignée (chaîne vide, sentinelle de masquage, `null`, ou
 * toute autre forme) ne remplace jamais le secret déjà stocké : on reprend la
 * valeur de la clé elle-même, à défaut celle de sa clé jumelle (voir
 * `LEGACY_SECRET_ALIASES`), et seulement si aucune des deux ne porte de secret
 * on retire le champ.
 *
 * @param key clé de réglage écrite (`email`, `ldap`, ...)
 * @param processedValue valeur déjà fusionnée avec l'existant, non chiffrée
 * @param receivedValue valeur brute reçue du client, avant fusion
 * @param existingByKey lignes `system_settings` déjà en base, par clé
 */
export function preserveExistingSecrets(
  key: string,
  processedValue: unknown,
  receivedValue: unknown,
  existingByKey: Map<string, unknown>
): unknown {
  const secretKeys = SECRET_FIELDS[key];
  if (!secretKeys || !isPlainObject(processedValue)) return processedValue;

  const preserved: Record<string, unknown> = { ...processedValue };
  const base = existingByKey.get(key) ?? null;
  const aliasKey = LEGACY_SECRET_ALIASES[key];
  const alias = aliasKey ? existingByKey.get(aliasKey) ?? null : null;
  const received = isPlainObject(receivedValue) ? receivedValue : {};

  for (const field of secretKeys) {
    const receivedField = field in received ? received[field] : undefined;
    // Seule une CHAINE réellement renseignée vaut rotation du secret. Tout le
    // reste (champ absent, chaîne vide, sentinelle de masquage, null, nombre,
    // booléen, objet) est traité comme « pas de rotation » : `null` supprimait
    // le champ à la fusion (cf. `mergeSettingValue`), donc un client négligent
    // effaçait le secret sans le savoir. L'invariant vaut pour toutes les
    // formes, pas seulement pour les chaînes.
    //
    // Le champ ABSENT du corps reçu passe par la même reprise, et non par un
    // court-circuit : la fusion a bien conservé la valeur rangée sous la clé
    // écrite, mais elle ignore tout de la clé JUMELLE. Court-circuiter ici
    // neutralisait donc exactement le repli ajouté pour ne pas perdre un secret
    // rangé sous la forme héritée : l'écran des courriels écrit `email` sans
    // jamais renvoyer `smtpPassword`, et le mot de passe rangé sous `smtp`
    // n'était alors repris nulle part.
    if (typeof receivedField === "string" && !isBlankOrMasked(receivedField)) {
      continue;
    }

    const kept = storedSecret(base, field) ?? storedSecret(alias, field);
    if (kept !== undefined) preserved[field] = kept;
    else if (isPlainObject(base) && field in base) preserved[field] = base[field];
    else delete preserved[field];
  }

  return preserved;
}
