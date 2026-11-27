/**
 * Enregistre l'export d'un design (PNG) dans la médiathèque, origine `studio`.
 * Un contenu identique déjà présent n'est pas recréé : le serveur répond `duplicate: true`.
 */
export async function saveExportToLibrary(
  blob: Blob,
  opts: { name: string; spaceId: string | null },
): Promise<{ id: string; duplicate: boolean }> {
  const fd = new FormData();
  fd.append("file", new File([blob], `${opts.name}.png`, { type: blob.type || "image/png" }));
  fd.append("name", opts.name);
  fd.append("kind", "design-export");
  if (opts.spaceId) fd.append("spaceId", opts.spaceId);
  const res = await fetch("/api/studio/images", { method: "POST", body: fd });
  if (!res.ok) throw new Error(`saveExportToLibrary: ${res.status}`);
  const body = (await res.json()) as { id?: string; duplicate?: boolean };
  if (!body.id) throw new Error("saveExportToLibrary: réponse sans id");
  return { id: body.id, duplicate: body.duplicate === true };
}
