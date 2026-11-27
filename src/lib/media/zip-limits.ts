/** Plafonds du téléchargement en archive, partagés entre la route (serveur) et l'interface. */
export const ZIP_MAX_FILES = 500;
export const ZIP_MAX_BYTES = 2 * 1024 * 1024 * 1024;
/** Médias cochés au plus pour une archive (limite des identifiants de la route, BATCH_MAX_IDS). */
export const ZIP_MAX_SELECTION = 200;
/** Quota de débit affiché : 3 archives par 10 minutes (RATE_LIMITS.mediaZip). */
export const ZIP_RATE_COUNT = 3;
export const ZIP_RATE_MINUTES = 10;
