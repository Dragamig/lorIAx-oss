/** Plafonds de coût de l'indexation IA des médias : source unique. */
export const MAX_EXTRACT_BYTES = 52_428_800; // 50 Mo de fichier source à extraire
export const MAX_TEXT_CHARS = 200_000; // texte retenu par média
export const MAX_CHUNKS = 200; // blocs embarqués par média
export const MAX_PDF_PAGES = 300;
export const MAX_SHEET_CELLS = 20_000;
export const MAX_SHEET_COUNT = 10;
export const MAX_UNZIPPED_BYTES = 104_857_600; // garde anti zip-bomb (archives bureautiques)
export const MAX_TRANSCRIBE_SECONDS = 3600;
export const MAX_TRANSCRIBE_BYTES = 524_288_000;
/** Plafonds par organisation et par jour (comptés sur `media_texts.indexed_at`). */
export const ORG_DAILY_MEDIA_MAX = 300;
export const ORG_DAILY_TRANSCRIBE_MINUTES = 120;
/** Nouvelles tentatives : 3 essais, attente croissante (10 min, 1 h, 6 h), puis `failed`. */
export const MAX_ATTEMPTS = 3;
export const RETRY_DELAYS_MS = [600_000, 3_600_000, 21_600_000] as const;
/** Archives bureautiques (hostiles par nature) : bornes par entrée et en nombre. */
export const MAX_ZIP_ENTRIES = 2_000;
export const MAX_ZIP_ENTRY_BYTES = 20_971_520; // 20 Mo décompressés par entrée lue
