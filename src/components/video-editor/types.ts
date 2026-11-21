export type TransitionType =
  | "fade"
  | "fadeblack"
  | "wipeleft"
  | "wiperight"
  | "slideleft"
  | "slideright";

export const TRANSITION_TYPES: TransitionType[] = [
  "fade",
  "fadeblack",
  "wipeleft",
  "wiperight",
  "slideleft",
  "slideright",
];

export const TRANSITION_LABELS: Record<TransitionType, string> = {
  fade: "Fondu enchaîné",
  fadeblack: "Fondu au noir",
  wipeleft: "Balayage gauche",
  wiperight: "Balayage droite",
  slideleft: "Glissement gauche",
  slideright: "Glissement droite",
};

export interface MediaClip {
  id: string;
  sourceKey: string;      // Clé S3 du fichier source (repli des projets anciens)
  /** Média de la médiathèque ; prime sur `sourceKey` au rendu quand il est présent. */
  mediaId?: string;
  sourceName: string;     // Nom affiché
  durationMs: number;     // Durée totale du fichier source
  startMs: number;        // Position sur la timeline
  endMs: number;          // Position de fin sur la timeline
  trimStartMs: number;    // Début du trim dans le fichier source
  trimEndMs: number;      // Fin du trim dans le fichier source
  volume: number;         // 0.0 à 1.0
  /** Transition vers le clip SUIVANT (piste vidéo uniquement). */
  transitionAfter?: { type: TransitionType; durationMs: number };
  /** Fondu d'entrée (piste audio uniquement). */
  fadeInMs?: number;
  /** Fondu de sortie (piste audio uniquement). */
  fadeOutMs?: number;
}

export type TextKind = "title" | "subtitle" | "credits";
export type TextPosition = "top" | "center" | "bottom";

export interface TextClip {
  id: string;
  text: string;
  startMs: number;
  endMs: number;
  kind?: TextKind;          // défaut: "subtitle"
  position?: TextPosition;  // défaut selon kind
  fontFamily?: "sans" | "serif"; // défaut: "sans"
  fontSizePct?: number;     // % de la hauteur vidéo, défaut selon kind
  color?: string;           // hex, défaut "#ffffff"
  bgEnabled?: boolean;      // bandeau semi-transparent, défaut selon kind
  fadeMs?: number;          // fondu entrée/sortie, défaut 300
}

/** Alias rétro-compat — les anciens sous-titres sont des TextClip sans `kind`. */
export type SubtitleClip = TextClip;

export interface VideoTrack {
  type: "video";
  id: string;
  name: string;
  clips: MediaClip[];
}

export interface AudioTrack {
  type: "audio";
  id: string;
  name: string;
  clips: MediaClip[];
}

export interface SubtitleTrack {
  type: "subtitle";
  id: string;
  name: string;
  clips: TextClip[];
}

export type Track = VideoTrack | AudioTrack | SubtitleTrack;

export interface TimelineData {
  tracks: Track[];
  durationMs: number;
}

export const EMPTY_TIMELINE: TimelineData = {
  tracks: [
    { type: "video", id: "video-1", name: "Vidéo 1", clips: [] },
    { type: "audio", id: "audio-1", name: "Audio 1", clips: [] },
    { type: "subtitle", id: "subtitles", name: "Textes", clips: [] },
  ],
  durationMs: 0,
};
