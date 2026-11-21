/** Limites de téléversement, sans dépendance serveur : partagées avec le client. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
export const VIDEO_MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** Limite applicable à un fichier : 200 Mo pour la vidéo, 50 Mo sinon. */
export function maxUploadBytesFor(file: { type: string }): number {
  return file.type.startsWith("video/") ? VIDEO_MAX_UPLOAD_BYTES : MAX_UPLOAD_BYTES;
}
