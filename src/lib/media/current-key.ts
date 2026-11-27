/**
 * Un média peut changer de fichier (remplacement, restauration) entre la
 * résolution de sa clé de stockage et la lecture de l'objet. Si la lecture
 * échoue, la clé est résolue de nouveau : seule une clé différente justifie
 * un second essai, sinon l'erreur d'origine est relancée.
 */
export async function withCurrentKey<T>(
  resolve: () => Promise<string>,
  read: (key: string) => Promise<T>
): Promise<T> {
  const key = await resolve();
  try {
    return await read(key);
  } catch (err) {
    let next: string;
    try {
      next = await resolve();
    } catch {
      throw err;
    }
    if (next === key) throw err;
    return read(next);
  }
}
