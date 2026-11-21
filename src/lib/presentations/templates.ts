/**
 * Lib serveur des modèles de présentation (lot 3bis).
 *
 * Un modèle est une ligne `presentations` marquée `is_template`, rattachée à
 * une organisation et sans espace ; sa charge utile vit en S3 sous
 * `presentations/<id>.json`. Ce module ne connaît ni route ni session : les
 * gardes d'accès sont dans `template-access.ts`.
 *
 * Garde-fou S3 : seulement `uploadFile` et `getFileJson`. Rien n'est jamais
 * supprimé ici (retirer un modèle, c'est le masquer).
 *
 * Titre et description des modèles semés : le serveur n'a pas de locale, il
 * stocke le titre français du document ; l'interface traduit via `fileTitleKey`
 * tant que `templateOrigin = 'lorIAx'`.
 */
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { presentations, type Presentation } from "@/lib/db/schema-presentations";
import { getFileJson, uploadFile } from "@/lib/storage/s3";
import { countSlides, createEmptyDeck, type Deck } from "./deck";
import { LORIAX_TEMPLATES, getLorIAxTemplate } from "./templates/index";
import { presentationKey, writeVersionedDeck } from "./versioned-write";

// `@/lib/presentations/templates` désigne ce fichier (il l'emporte sur le
// dossier du même nom) : on y réexporte donc le catalogue livré.
export { LORIAX_TEMPLATES, getLorIAxTemplate } from "./templates/index";
export type { LorIAxTemplate, LorIAxTemplateSeedKey } from "./templates/index";

const LORIAX_ORIGIN = "lorIAx";

/** Copie d'un document avec identité et date neuves, titre éventuellement remplacé. */
function freshCopy(deck: Deck, title?: string): Deck {
  return {
    ...structuredClone(deck),
    docId: randomUUID(),
    modified: new Date().toISOString(),
    ...(title !== undefined ? { title } : {}),
  } as Deck;
}

async function putDeck(id: string, deck: Deck): Promise<void> {
  await uploadFile(presentationKey(id), Buffer.from(JSON.stringify(deck)), "application/json");
}

/**
 * Sème les modèles LorIAx d'une organisation. Idempotent et sûr sous
 * concurrence (index unique + ON CONFLICT DO NOTHING) : seules les lignes
 * réellement insérées reçoivent leur objet S3, ligne avant objet. Un échec S3
 * est journalisé, jamais fatal : la lecture se replie sur le dépôt.
 */
export async function ensureSeededTemplates(orgId: string, createdBy: string): Promise<void> {
  const inserted = await db
    .insert(presentations)
    .values(
      LORIAX_TEMPLATES.map((t) => ({
        title: t.deck.title ?? t.seedKey,
        organizationId: orgId,
        isTemplate: true,
        templateOrigin: LORIAX_ORIGIN,
        templateSeedKey: t.seedKey,
        createdBy,
        slideCount: countSlides(t.deck),
      }))
    )
    .onConflictDoNothing()
    .returning();

  for (const row of inserted) {
    const template = getLorIAxTemplate(row.templateSeedKey ?? "");
    if (!template) continue;
    try {
      await putDeck(row.id, freshCopy(template.deck));
    } catch (err) {
      console.error("[presentations/templates] Semis S3 ignoré :", row.id, err);
    }
  }
}

/** Modèles d'une organisation, les masqués seulement sur demande (vue admin). */
export async function listTemplates(
  orgId: string,
  { includeHidden, seededOnly = false }: { includeHidden: boolean; seededOnly?: boolean }
): Promise<Presentation[]> {
  const conditions = [eq(presentations.organizationId, orgId), eq(presentations.isTemplate, true)];
  if (!includeHidden) conditions.push(isNull(presentations.templateHiddenAt));
  // Non-membre : les 4 modèles LorIAx seulement, jamais ceux de l'organisation.
  if (seededOnly) conditions.push(isNotNull(presentations.templateSeedKey));
  return db
    .select()
    .from(presentations)
    .where(and(...conditions))
    .orderBy(desc(presentations.createdAt));
}

/** Lit la charge utile d'un modèle, avec repli sur le dépôt puis sur un document vide. */
export async function readTemplateDeck(template: {
  id: string;
  templateSeedKey: string | null;
}): Promise<Deck> {
  const stored = await getFileJson<Deck>(presentationKey(template.id));
  if (stored) return stored;
  const fallback = template.templateSeedKey ? getLorIAxTemplate(template.templateSeedKey) : undefined;
  return fallback ? fallback.deck : createEmptyDeck("Nouvelle présentation");
}

/**
 * Duplique la charge utile d'un modèle vers `newId` (jamais sous la clé du
 * modèle). Le document écrit porte un `docId` neuf, le titre donné et la date
 * courante.
 */
export async function cloneTemplatePayload(
  template: { id: string; templateSeedKey: string | null },
  newId: string,
  newTitle: string
): Promise<{ deck: Deck; slideCount: number }> {
  const deck = freshCopy(await readTemplateDeck(template), newTitle);
  await putDeck(newId, deck);
  return { deck, slideCount: countSlides(deck) };
}

/** La source n'a aucun objet S3 : rien de réel à copier (la route rend 409). */
export class SourceDeckMissingError extends Error {
  constructor(id: string) {
    super(`Aucune charge utile enregistrée pour la présentation ${id}`);
    this.name = "SourceDeckMissingError";
  }
}

/**
 * Enregistre une présentation comme modèle d'organisation : nouvelle ligne,
 * charge utile dupliquée, source jamais modifiée.
 */
export async function copyPresentationAsTemplate(
  source: { id: string },
  orgId: string,
  { name, description, createdBy }: { name: string; description?: string; createdBy: string }
): Promise<Presentation> {
  const stored = await getFileJson<Deck>(presentationKey(source.id));
  if (!stored) throw new SourceDeckMissingError(source.id);
  const deck = freshCopy(stored, name);

  const [created] = await db
    .insert(presentations)
    .values({
      title: name,
      organizationId: orgId,
      isTemplate: true,
      templateDescription: description ?? null,
      createdBy,
      slideCount: countSlides(deck),
    })
    .returning();

  try {
    await putDeck(created.id, deck);
  } catch (err) {
    // Ligne sans objet : on la masque pour qu'aucun membre n'ouvre un modèle
    // vide (jamais de suppression). L'admin la voit encore (badge « Masqué »).
    try {
      await db
        .update(presentations)
        .set({ templateHiddenAt: new Date() })
        .where(eq(presentations.id, created.id));
    } catch (hideErr) {
      console.error("[presentations/templates] Masquage de compensation impossible :", hideErr);
    }
    throw err;
  }
  return created;
}

export type ResetTemplateResult =
  | { status: "ok"; presentation: Presentation }
  | { status: "not-found" }
  | { status: "not-resettable" }
  | { status: "conflict"; currentVersion: number | null }
  | { status: "storage-error" };

/**
 * Remet un modèle d'origine LorIAx à la version du dépôt, par le chemin
 * d'écriture versionné du PUT (version incrémentée, révision archivée), et le
 * démasque. Tout autre modèle : `not-resettable` (422 côté route).
 */
export async function resetTemplate(
  template: Pick<Presentation, "id" | "version" | "organizationId" | "templateOrigin" | "templateSeedKey">,
  orgId: string
): Promise<ResetTemplateResult> {
  if (template.organizationId !== orgId) return { status: "not-found" };
  const source =
    template.templateOrigin === LORIAX_ORIGIN && template.templateSeedKey
      ? getLorIAxTemplate(template.templateSeedKey)
      : undefined;
  if (!source) return { status: "not-resettable" };

  const deck = freshCopy(source.deck);
  const result = await writeVersionedDeck(
    template,
    deck,
    JSON.stringify(deck),
    template.version,
    undefined,
    { templateHiddenAt: null }
  );
  return result;
}
