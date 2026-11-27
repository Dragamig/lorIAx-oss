/**
 * Déclare au serveur les médias d'un contenu qu'il ne sait pas lire (design, tableau blanc).
 * Rend `true` si le serveur a accepté ; ne lève jamais (la sauvegarde du contenu ne doit pas en dépendre).
 */
export async function putExplicitUsages(input: {
  targetType: "design" | "whiteboard";
  targetId: string;
  documentId?: string | null;
  spaceId: string | null;
  mediaIds: string[];
}): Promise<boolean> {
  try {
    const res = await fetch("/api/media/usages/explicit", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...input, documentId: input.documentId ?? null }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
