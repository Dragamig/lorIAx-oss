/**
 * Écriture versionnée d'une présentation : concurrence optimiste, ligne avant
 * objet S3, révision nommée par la version qu'elle contient (N+1).
 *
 * Partagée par le PUT d'une présentation et la réinitialisation d'un modèle.
 * La purge des anciennes révisions n'est PAS ici (elle supprime des objets S3 et
 * reste cantonnée à la route autorisée par le garde-fou de suppression).
 */
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { presentations, type Presentation } from "@/lib/db/schema-presentations";
import { uploadFile } from "@/lib/storage/s3";
import { countSlides, type Deck } from "./deck";

export const presentationKey = (id: string) => `presentations/${id}.json`;
export const revisionPrefix = (id: string) => `presentations/${id}/`;
export const revisionKey = (id: string, version: number) =>
  `${revisionPrefix(id)}v${version}.json`;

export type VersionedWriteResult =
  | { status: "ok"; presentation: Presentation }
  | { status: "conflict"; currentVersion: number | null }
  | { status: "storage-error" };

export async function writeVersionedDeck(
  row: { id: string; version: number } & Partial<Presentation>,
  deck: Deck,
  serialized: string,
  expectedVersion: number,
  title?: string,
  extraSet: Partial<Presentation> = {}
): Promise<VersionedWriteResult> {
  if (row.version !== expectedVersion) {
    return { status: "conflict", currentVersion: row.version };
  }
  const id = row.id;
  const written: Partial<Presentation> = {
    slideCount: countSlides(deck),
    updatedAt: new Date(),
    ...(title !== undefined ? { title } : {}),
    ...extraSet,
  };
  const [updated] = await db
    .update(presentations)
    .set({
      version: row.version + 1,
      ...written,
    })
    .where(and(eq(presentations.id, id), eq(presentations.version, expectedVersion)))
    .returning();

  if (!updated) {
    const [current] = await db
      .select()
      .from(presentations)
      .where(eq(presentations.id, id))
      .limit(1);
    return { status: "conflict", currentVersion: current ? current.version : null };
  }

  try {
    await uploadFile(revisionKey(id, expectedVersion + 1), Buffer.from(serialized), "application/json");
    await uploadFile(presentationKey(id), Buffer.from(serialized), "application/json");
  } catch (err) {
    console.error("[presentations/versioned-write] Erreur S3 :", err);
    // Compensation : sans elle la ligne reste à N+1 alors que l'objet courant
    // est encore à N, et le client (qui garde `expectedVersion = N`) prend un
    // 409 définitif sur son prochain enregistrement. Conditionnée à la version
    // N+1 : si un autre écrivain est passé entre-temps, on ne touche à rien.
    // Tous les champs écrits sont restaurés (titre, nombre de diapos, date,
    // champs de extraSet comme templateHiddenAt), pas seulement la version.
    const restore: Record<string, unknown> = { version: expectedVersion };
    for (const key of Object.keys(written) as (keyof Presentation)[]) {
      restore[key] = row[key] === undefined ? null : row[key];
    }
    try {
      await db
        .update(presentations)
        .set(restore)
        .where(and(eq(presentations.id, id), eq(presentations.version, expectedVersion + 1)));
    } catch (rollbackErr) {
      console.error("[presentations/versioned-write] Compensation de version en échec :", rollbackErr);
    }
    return { status: "storage-error" };
  }
  return { status: "ok", presentation: updated };
}
