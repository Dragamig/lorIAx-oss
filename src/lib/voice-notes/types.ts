/** Statuts d'une note vocale, alignés sur l'enum Postgres `voice_note_status`. */
export type VoiceNoteStatus =
  | "recording"
  | "transcribing"
  | "review"
  | "validated"
  | "failed";

/** Les deux traitements IA proposés, relançables et indépendants. */
export type VoiceNoteProcessKind = "summary" | "cleanup";

/** Type d'usage IA correspondant à chaque traitement. */
export const PROCESS_USAGE_TYPE: Record<
  VoiceNoteProcessKind,
  "voice_note_summary" | "voice_note_cleanup"
> = {
  summary: "voice_note_summary",
  cleanup: "voice_note_cleanup",
};

/**
 * Codes d'erreur persistés dans `voice_notes.error_code`, pour que l'interface
 * affiche le bon message sans réinterpréter un texte libre.
 */
export const VOICE_NOTE_ERROR_CODES = {
  /** Aucun moteur de transcription configuré sur l'instance. */
  noTranscriptionEngine: "no_transcription_engine",
  /** Le moteur a répondu en erreur ou n'a rien rendu. */
  transcriptionFailed: "transcription_failed",
  /** Transcription terminée mais texte vide. */
  emptyTranscript: "empty_transcript",
  /** Fichier audio introuvable au moment de la relance. */
  audioMissing: "audio_missing",
  /** Transcription restée en cours trop longtemps : processus de fond perdu. */
  transcriptionStalled: "transcription_stalled",
  /** Le traitement IA a échoué. */
  aiFailed: "ai_failed",
  /** Traitement IA resté en cours trop longtemps : processus de fond perdu. */
  aiStalled: "ai_stalled",
  /**
   * Le modèle a rendu la main sans écrire un seul mot. Pas une panne : la
   * requête a abouti, elle n'a simplement rien produit d'exploitable.
   */
  aiEmptyOutput: "ai_empty_output",
  /**
   * Le modèle a consommé tout son budget de jetons sans écrire de texte. Cas
   * typique d'un modèle à raisonnement dont la réflexion interne épuise le
   * plafond : c'est le choix du modèle pour cet usage qui est en cause, pas
   * une indisponibilité du service.
   */
  aiEmptyTokenLimit: "ai_empty_token_limit",
} as const;

export type VoiceNoteErrorCode =
  (typeof VOICE_NOTE_ERROR_CODES)[keyof typeof VOICE_NOTE_ERROR_CODES];

/**
 * Représentation renvoyée par l'API : ce que le bloc a besoin de connaître.
 * Ne contient jamais `audioPath` (chemin serveur), seulement `hasAudio`.
 */
export interface VoiceNoteView {
  id: string;
  documentId: string;
  status: VoiceNoteStatus;
  durationSeconds: number | null;
  transcript: string | null;
  transcriptValidatedAt: string | null;
  summary: string | null;
  cleanedText: string | null;
  /** true si le transcript a été corrigé depuis la génération de la synthèse. */
  summaryStale: boolean;
  /** true si le transcript a été corrigé depuis la mise au propre. */
  cleanedStale: boolean;
  /**
   * Traitement IA en cours, s'il y en a un. Le bloc s'en sert pour afficher
   * l'attente et continuer à sonder, y compris après réouverture du document :
   * l'état vit en base, pas dans la page.
   */
  processingKind: VoiceNoteProcessKind | null;
  hasAudio: boolean;
  /**
   * Faux quand aucun moteur de transcription n'est configuré sur l'instance.
   * Absent des réponses qui suivent une action déjà engagée : seules les deux
   * entrées du bloc (création et lecture) portent l'information, pour ne pas
   * interroger la configuration à chaque sérialisation.
   */
  transcriptionAvailable?: boolean;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
}
