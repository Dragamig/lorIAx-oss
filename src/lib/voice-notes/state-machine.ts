import type { VoiceNoteProcessKind, VoiceNoteStatus } from "./types";

/**
 * Machine à états de la note vocale.
 *
 * Invariant central : aucun chemin ne mène à un traitement IA sans passer par
 * `validated`, c'est à dire sans validation humaine explicite du transcript.
 * Le garde-fou vit ici, côté serveur, pas seulement dans l'interface.
 *
 * L'audio n'est effacé qu'à la validation : tant que la note est en `failed`,
 * le fichier reste disponible pour une relance sans réenregistrement.
 */
const TRANSITIONS: Record<VoiceNoteStatus, readonly VoiceNoteStatus[]> = {
  // Note créée, en attente d'audio.
  recording: ["transcribing", "failed"],
  // Audio reçu, moteur en cours.
  transcribing: ["review", "failed"],
  // Transcript disponible, relecture humaine. Un nouvel audio relance le cycle.
  review: ["validated", "transcribing", "failed"],
  // Transcript validé : seule une reprise explicite ramène en relecture.
  validated: ["review"],
  // Transcription échouée : relance possible depuis l'audio conservé.
  failed: ["transcribing"],
};

/**
 * Délai au delà duquel une note restée en `transcribing` est tenue pour perdue.
 *
 * Seul le processus de fond fait sortir de `transcribing`. S'il disparaît
 * (redéploiement du conteneur, plantage, mémoire saturée), plus personne
 * n'écrit le statut suivant et la note devient inutilisable : relance, nouvel
 * audio, correction et validation sont tous refusés. Passé ce délai, on traite
 * donc l'attente comme un échec récupérable.
 *
 * 15 minutes : très au dessus de la latence d'un moteur de transcription sur un
 * fichier au plafond accepté (quelques minutes au pire), et assez court pour
 * qu'un utilisateur bloqué retrouve la main dans la même séance de travail.
 */
export const TRANSCRIPTION_STALL_MS = 15 * 60 * 1000;

/**
 * Vrai si la note attend depuis trop longtemps la fin de sa transcription.
 * `updatedAt` fait référence : rien d'autre n'écrit la note pendant ce temps.
 */
export function isTranscriptionStalled(
  status: VoiceNoteStatus,
  updatedAt: Date,
  now: Date = new Date()
): boolean {
  if (status !== "transcribing") return false;
  return now.getTime() - updatedAt.getTime() >= TRANSCRIPTION_STALL_MS;
}

/**
 * Délai au delà duquel un traitement IA en cours est tenu pour perdu.
 *
 * Même raisonnement que pour la transcription : la génération tourne en tâche
 * de fond, et si le processus disparaît (redéploiement, plantage), plus
 * personne n'efface le marqueur. La note resterait alors indéfiniment « en
 * cours », traitements bloqués. Passé ce délai, l'attente devient un échec
 * récupérable, donc relançable.
 *
 * 10 minutes : très au dessus de la génération la plus longue (un transcript au
 * plafond de 120 000 caractères), et assez court pour rendre la main dans la
 * même séance de travail.
 */
export const PROCESS_STALL_MS = 10 * 60 * 1000;

/**
 * Vrai si un traitement IA attend depuis trop longtemps. Sans traitement
 * engagé, il n'y a rien à requalifier. Une date de départ absente alors qu'un
 * traitement est marqué signale une écriture incomplète : on la traite comme
 * un traitement perdu, plutôt que de laisser la note bloquée pour toujours.
 */
export function isProcessingStalled(
  processingKind: VoiceNoteProcessKind | string | null,
  processingStartedAt: Date | null,
  now: Date = new Date()
): boolean {
  if (!processingKind) return false;
  if (!processingStartedAt) return true;
  return now.getTime() - processingStartedAt.getTime() >= PROCESS_STALL_MS;
}

/** Erreur de transition, traduite en 409 par les routes. */
export class VoiceNoteTransitionError extends Error {
  readonly from: VoiceNoteStatus;
  readonly to: VoiceNoteStatus;

  constructor(from: VoiceNoteStatus, to: VoiceNoteStatus) {
    super(`Transition interdite : ${from} vers ${to}`);
    this.name = "VoiceNoteTransitionError";
    this.from = from;
    this.to = to;
  }
}

export function canTransition(
  from: VoiceNoteStatus,
  to: VoiceNoteStatus
): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(
  from: VoiceNoteStatus,
  to: VoiceNoteStatus
): void {
  if (!canTransition(from, to)) throw new VoiceNoteTransitionError(from, to);
}

/** Un audio ne peut être reçu que hors transcription en cours et hors note validée. */
export function canAcceptAudio(status: VoiceNoteStatus): boolean {
  return canTransition(status, "transcribing");
}

/**
 * Le transcript est corrigeable en relecture. Après validation, il faut une
 * reprise explicite, qui ramène la note en `review` et exige une revalidation.
 */
export function canEditTranscript(
  status: VoiceNoteStatus,
  options: { reopen?: boolean } = {}
): boolean {
  if (status === "review") return true;
  return status === "validated" && options.reopen === true;
}

export function canValidate(status: VoiceNoteStatus): boolean {
  return canTransition(status, "validated");
}

/**
 * Garde-fou non négociable : un traitement IA n'est possible que sur une note
 * validée. Aucun autre statut, y compris `review`, n'y donne accès.
 */
export function canProcess(status: VoiceNoteStatus): boolean {
  return status === "validated";
}

/** La relance de transcription part de l'audio conservé, donc d'un échec. */
export function canRetryTranscription(status: VoiceNoteStatus): boolean {
  return status === "failed";
}

/** Statut cible après une correction de transcript. */
export function statusAfterTranscriptEdit(
  status: VoiceNoteStatus
): VoiceNoteStatus {
  return status === "validated" ? "review" : status;
}
