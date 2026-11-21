"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import {
  AlertCircle,
  Check,
  Download,
  FileText,
  GripHorizontal,
  ListTodo,
  Loader2,
  Mic,
  MicOff,
  Pause,
  Pencil,
  Play,
  Square,
  Timer,
  Trash2,
} from "lucide-react";
import { Link } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCurrentUser } from "@/hooks/use-session";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import { extractVoiceNoteActions } from "@/lib/voice-notes/extract-actions";
import { VoiceNoteAccordions } from "./voice-note-accordions";
import { VoiceNoteActionsDialog } from "./voice-note-actions-dialog";
import { VoiceNoteDropZone } from "./voice-note-drop-zone";
import { VoiceNoteLevel } from "./voice-note-level";
import { VoiceNoteStatusPill } from "./voice-note-status-pill";
import {
  AUDIO_INPUT_ACCEPT,
  VoiceNoteApiError,
  createVoiceNote,
  fetchVoiceNote,
  isAcceptableAudioFile,
  isOutputStale,
  isTranscriptionUnavailableCode,
  processVoiceNote,
  retryVoiceNote,
  saveVoiceNoteTranscript,
  uploadVoiceNoteAudio,
  validateVoiceNote,
  voiceNoteAudioUrl,
  type VoiceNoteProcessKind,
  type VoiceNoteState,
} from "./voice-note-api";
import {
  formatClock,
  formatConvertedDate,
  formatDuration,
  formatNoteTitle,
  formatShortTime,
} from "./voice-note-format";

/** Cadence d'interrogation de l'API pendant un traitement, en millisecondes. */
const POLL_MS = 3000;
/** Délai avant enregistrement d'une correction du transcript, en millisecondes. */
const TRANSCRIPT_SAVE_DEBOUNCE_MS = 900;

type Screen =
  | "loading"
  | "unavailable"
  | "idle"
  | "micDenied"
  | "fileRejected"
  | "recording"
  | "transcribing"
  | "review"
  | "validated"
  | "reported"
  | "failed";

/**
 * Message d'échec, choisi sur le code d'erreur du serveur. Un texte unique
 * ferait dire « le service n'a pas répondu » à des situations qui n'ont rien à
 * voir, comme une transcription interrompue en cours de route.
 */
function failureMessage(errorCode: string | null, hasAudio: boolean): string {
  switch (errorCode) {
    case "transcription_stalled":
      return hasAudio
        ? "La transcription a été interrompue avant d'aboutir, sans doute par un redémarrage du service. Votre enregistrement est intact : relancez-la."
        : "La transcription a été interrompue avant d'aboutir, et l'enregistrement n'a pas été conservé.";
    case "empty_transcript":
      return "La transcription n'a restitué aucun texte. L'enregistrement est peut-être silencieux ou trop court.";
    case "audio_missing":
      return "L'enregistrement n'a pas été retrouvé sur le serveur. Il faut le refaire.";
    default:
      return "Le service de transcription n'a pas répondu. Réessayez dans quelques minutes.";
  }
}

/**
 * Message d'échec d'un traitement IA, quand il y en a un à dire. Distinct des
 * échecs de transcription : ici rien n'est perdu, la note reste validée et le
 * traitement est relançable d'un clic.
 *
 * Une sortie vide a son propre message : relancer à l'identique redonnerait le
 * même résultat, c'est le modèle réglé pour ce traitement qu'il faut changer.
 */
function processFailureMessage(
  errorCode: string | null,
  isAdmin: boolean
): ReactNode {
  switch (errorCode) {
    case "ai_failed":
      return "Le traitement n'a pas abouti. Vous pouvez le relancer.";
    case "ai_stalled":
      return "Le traitement a été interrompu avant d'aboutir. Vous pouvez le relancer.";
    case "ai_empty_token_limit":
      return (
        <span>
          Le traitement s&apos;est arrêté avant d&apos;écrire la moindre ligne :
          le modèle réglé pour ce traitement atteint sa limite de longueur sans
          rien rendre.{" "}
          {isAdmin ? (
            <>
              Choisissez-en un autre dans{" "}
              <Link
                href="/admin/ai/providers"
                className="font-semibold underline underline-offset-2"
              >
                Administration, IA
              </Link>
              , puis relancez.
            </>
          ) : (
            <>Demandez à un administrateur d&apos;en régler un autre.</>
          )}
        </span>
      );
    case "ai_empty_output":
      return (
        <span>
          Le traitement s&apos;est terminé sans produire de texte. Relancez-le ;
          si cela recommence,{" "}
          {isAdmin ? (
            <>
              changez le modèle de ce traitement dans{" "}
              <Link
                href="/admin/ai/providers"
                className="font-semibold underline underline-offset-2"
              >
                Administration, IA
              </Link>
              .
            </>
          ) : (
            <>demandez à un administrateur de changer le modèle utilisé.</>
          )}
        </span>
      );
    default:
      return null;
  }
}

/** Intitulé de l'attente, selon le traitement en cours. */
function processingLabelFor(kind: VoiceNoteProcessKind | null): string | null {
  if (kind === "summary") return "Synthèse en cours";
  if (kind === "cleanup") return "Mise au propre en cours";
  return null;
}

/**
 * Bloc « Note vocale » : barre d'état pilotée par le statut serveur, et
 * accordéons repliés par défaut. Le bloc ne porte aucun état metier en propre,
 * il relit toujours l'API au montage : fermer le document pendant un traitement
 * ne perd rien.
 */
export function VoiceNoteBlockView({
  node,
  updateAttributes,
  deleteNode,
  selected,
  editor,
  getPos,
}: NodeViewProps) {
  const voiceNoteId: string = node.attrs.voiceNoteId ?? "";
  const isEditable = editor.isEditable;
  const user = useCurrentUser();
  const isAdmin =
    user?.globalRole === "admin" || user?.globalRole === "super_admin";

  const recorder = useAudioRecorder();
  const [state, setState] = useState<VoiceNoteState | null>(null);
  const [loading, setLoading] = useState(true);
  const [unavailable, setUnavailable] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const [fileRejected, setFileRejected] = useState(false);
  const [uploading, setUploading] = useState(false);
  // Traitement demandé mais pas encore confirmé par le serveur : le temps de
  // l'aller-retour, l'attente vient d'ici. Ensuite, c'est la note qui la porte.
  const [pendingKind, setPendingKind] = useState<VoiceNoteProcessKind | null>(
    null
  );
  const [validating, setValidating] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [correctionResumed, setCorrectionResumed] = useState(false);
  const [transcriptDraft, setTranscriptDraft] = useState("");
  const [playing, setPlaying] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionsDialogOpen, setActionsDialogOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);
  const transcriptTouchedRef = useRef(false);
  // Copie immédiate du brouillon, lisible depuis une réponse réseau tardive :
  // l'état React d'une closure fermée il y a une seconde ne dit plus ce que
  // l'utilisateur a sous les yeux.
  const transcriptDraftRef = useRef("");

  /** Écrit le brouillon et sa copie d'un seul geste, pour qu'ils ne divergent jamais. */
  const setDraft = useCallback((value: string) => {
    transcriptDraftRef.current = value;
    setTranscriptDraft(value);
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const applyState = useCallback(
    (next: VoiceNoteState | null) => {
      if (!next || !mountedRef.current) return;
      setState(next);
      // La correction en cours de frappe prime sur la valeur serveur : on ne
      // rembobine jamais le texte sous les doigts de l'utilisateur. Et même
      // hors frappe, on ne réécrit le champ que si le texte diffère vraiment :
      // réaffecter la même valeur à un champ contrôlé renvoie le curseur à la
      // fin, ce qui donne l'impression qu'il saute tout seul.
      const serverTranscript = next.transcript ?? "";
      if (
        !transcriptTouchedRef.current &&
        serverTranscript !== transcriptDraftRef.current
      ) {
        setDraft(serverTranscript);
      }
      // Le serveur ne renseigne ce champ que sur les réponses qui décident de
      // l'écran initial : quand il le fait, il fait autorité dans les deux sens,
      // sinon un moteur activé entre temps laisserait le bloc désactivé.
      if (typeof next.transcriptionAvailable === "boolean") {
        setUnavailable(!next.transcriptionAvailable);
      }
      if (isTranscriptionUnavailableCode(next.errorCode)) setUnavailable(true);
    },
    [setDraft]
  );

  const handleApiError = useCallback(
    (
      cause: unknown,
      fallbackMessage = "L'opération n'a pas abouti. Réessayez dans un instant."
    ) => {
      if (!mountedRef.current) return;
      if (cause instanceof VoiceNoteApiError) {
        if (cause.meansTranscriptionUnavailable) {
          setUnavailable(true);
          return;
        }
        if (cause.meansFileRejected) {
          setFileRejected(true);
          return;
        }
      }
      setActionError(fallbackMessage);
    },
    []
  );

  // Montage : la note est créée si le bloc est neuf, relue sinon.
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (voiceNoteId) {
        try {
          const next = await fetchVoiceNote(voiceNoteId);
          if (!cancelled) applyState(next);
        } catch (cause) {
          if (!cancelled) handleApiError(cause);
        } finally {
          if (!cancelled) setLoading(false);
        }
        return;
      }

      if (!isEditable) {
        setLoading(false);
        return;
      }

      const documentId =
        typeof window !== "undefined" ? (window.__loriax_docId ?? "") : "";
      if (!documentId) {
        setLoading(false);
        return;
      }

      try {
        const next = await createVoiceNote(documentId);
        if (cancelled) return;
        applyState(next);
        updateAttributes({ voiceNoteId: next.id });
      } catch (cause) {
        if (!cancelled) handleApiError(cause);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void bootstrap();
    return () => {
      cancelled = true;
    };
    // `updateAttributes` change d'identité à chaque rendu de TipTap : l'inclure
    // relancerait la création en boucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceNoteId, isEditable, applyState, handleApiError]);

  const noteId = state?.id ?? voiceNoteId;

  const refresh = useCallback(async () => {
    if (!noteId) return null;
    try {
      const next = await fetchVoiceNote(noteId);
      applyState(next);
      // La liaison est rétablie : le message de coupure n'a plus lieu d'être.
      // Sans cet effacement, un incident passager laisserait son avertissement
      // affiché jusqu'à la prochaine action.
      if (mountedRef.current) setActionError(null);
      return next;
    } catch (cause) {
      // Une interrogation périodique qui échoue en silence fige le bloc sur
      // « transcription en cours » ou « traitement en cours » : l'avancement ne
      // progresse plus et rien ne l'explique. On le dit, sans parler d'une
      // opération que l'utilisateur n'a pas demandée.
      handleApiError(
        cause,
        "La liaison avec le serveur est interrompue : l'avancement affiché n'est peut-être plus à jour."
      );
      return null;
    }
  }, [noteId, applyState, handleApiError]);

  // Traitement en cours : le serveur fait autorité, il le sait encore après un
  // rechargement de la page. L'état local ne couvre que l'aller-retour initial.
  const busyKind: VoiceNoteProcessKind | null =
    state?.processingKind ?? pendingKind;

  // Interrogation périodique tant qu'un travail tourne côté serveur. La sortie
  // de l'attente vient toujours de la note relue, jamais d'une supposition.
  const isWorking = state?.status === "transcribing" || busyKind !== null;
  useEffect(() => {
    if (!isWorking) return;
    const timer = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [isWorking, refresh]);

  // ----- actions -----------------------------------------------------------

  const sendAudio = useCallback(
    async (blob: Blob, fileName: string, durationSeconds?: number) => {
      if (!noteId) return;
      setUploading(true);
      setActionError(null);
      try {
        const next = await uploadVoiceNoteAudio(
          noteId,
          blob,
          fileName,
          durationSeconds
        );
        if (next) applyState(next);
        else await refresh();
      } catch (cause) {
        handleApiError(cause);
      } finally {
        if (mountedRef.current) setUploading(false);
      }
    },
    [noteId, applyState, refresh, handleApiError]
  );

  const handleStartRecording = useCallback(async () => {
    setMicDenied(false);
    setFileRejected(false);
    setActionError(null);
    await recorder.start();
  }, [recorder]);

  useEffect(() => {
    if (recorder.status === "denied" || recorder.status === "unsupported") {
      setMicDenied(true);
    }
  }, [recorder.status]);

  const handleFinishRecording = useCallback(async () => {
    const recording = await recorder.stop();
    recorder.reset();
    if (!recording) {
      setActionError("Aucun son n'a été capté. Réessayez.");
      return;
    }
    const extension = recording.mimeType.includes("mp4") ? "m4a" : "webm";
    await sendAudio(
      recording.blob,
      `note-vocale.${extension}`,
      recording.durationSeconds
    );
  }, [recorder, sendAudio]);

  const handleFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      setActionError(null);
      if (!isAcceptableAudioFile(file)) {
        setFileRejected(true);
        return;
      }
      setFileRejected(false);
      await sendAudio(file, file.name);
    },
    [sendAudio]
  );

  const handleTranscriptChange = useCallback(
    (value: string) => {
      transcriptTouchedRef.current = true;
      setDraft(value);
      if (!noteId) return;
      const resumeCorrection = state?.status === "validated";
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        void saveVoiceNoteTranscript(noteId, value, resumeCorrection)
          .then((next) => {
            // Le champ ne redevient « non touché » qu'une fois la réponse
            // revenue, et seulement si rien n'a été tapé entre temps. Lever le
            // drapeau avant l'aller-retour rendait la réponse maîtresse du
            // champ : elle porte le texte d'il y a une seconde, l'appliquer
            // effaçait les caractères tapés depuis et renvoyait le curseur à la
            // fin. Imperceptible en local, systématique en production.
            if (transcriptDraftRef.current === value) {
              transcriptTouchedRef.current = false;
            }
            if (next) applyState(next);
          })
          .catch(handleApiError);
      }, TRANSCRIPT_SAVE_DEBOUNCE_MS);
    },
    [noteId, state?.status, applyState, handleApiError, setDraft]
  );

  const handleValidate = useCallback(async () => {
    if (!noteId) return;
    setConfirmOpen(false);
    setValidating(true);
    setActionError(null);
    try {
      // Une correction encore en attente part avant la validation, sinon elle
      // serait perdue au moment où le transcript est figé.
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
        await saveVoiceNoteTranscript(noteId, transcriptDraft);
        // Même règle qu'à l'enregistrement différé : le drapeau ne retombe
        // qu'une fois la correction réellement partie, et si rien n'a bougé.
        if (transcriptDraftRef.current === transcriptDraft) {
          transcriptTouchedRef.current = false;
        }
      }
      const next = await validateVoiceNote(noteId);
      if (next) applyState(next);
      else await refresh();
      setCorrectionResumed(false);
      setPlaying(false);
    } catch (cause) {
      handleApiError(cause);
    } finally {
      if (mountedRef.current) setValidating(false);
    }
  }, [noteId, transcriptDraft, applyState, refresh, handleApiError]);

  const handleProcess = useCallback(
    async (kind: VoiceNoteProcessKind) => {
      if (!noteId || busyKind) return;
      setPendingKind(kind);
      setActionError(null);
      try {
        // La route rend la main tout de suite : la réponse dit que le
        // traitement est engagé, pas qu'il est fini. La suite arrive par
        // l'interrogation périodique.
        const next = await processVoiceNote(noteId, kind);
        if (next) applyState(next);
      } catch (cause) {
        handleApiError(cause);
      } finally {
        if (mountedRef.current) setPendingKind(null);
      }
    },
    [noteId, busyKind, applyState, handleApiError]
  );

  const handleRetry = useCallback(async () => {
    if (!noteId) return;
    setActionError(null);
    try {
      const next = await retryVoiceNote(noteId);
      if (next) applyState(next);
      else await refresh();
    } catch (cause) {
      handleApiError(cause);
    }
  }, [noteId, applyState, refresh, handleApiError]);

  // Actions repérées dans la synthèse, prêtes à devenir des tâches. Aucune
  // conversion automatique : ce n'est qu'une condition d'affichage du bouton,
  // la création réelle attend la revue de l'utilisateur dans la boîte de
  // dialogue.
  const voiceNoteActions = useMemo(
    () => extractVoiceNoteActions(state?.summary ?? null),
    [state?.summary]
  );
  const actionsConvertedAt: string | null = node.attrs.actionsConvertedAt ?? null;
  const canConvertActions =
    isEditable && Boolean(state?.summary) && voiceNoteActions.length > 0;

  const handleConvertActions = useCallback(
    (titles: string[]) => {
      setActionsDialogOpen(false);
      if (titles.length === 0) return;
      // `getPos` peut être indéfini si le node view est démonté entre-temps :
      // sans position, on ne sait plus où insérer les tâches.
      const pos = typeof getPos === "function" ? getPos() : undefined;
      if (pos === undefined) return;
      const insertAt = pos + node.nodeSize;
      editor
        .chain()
        .focus()
        .insertContentAt(insertAt, {
          type: "taskList",
          content: titles.map((title) => ({
            type: "taskItem",
            attrs: { checked: false },
            content: [
              {
                type: "paragraph",
                content: [{ type: "text", text: title }],
              },
            ],
          })),
        })
        .run();
      // La synchronisation des tâches part toute seule au prochain
      // débounce de l'éditeur : aucun appel réseau à faire ici.
      updateAttributes({ actionsConvertedAt: new Date().toISOString() });
    },
    [editor, getPos, node, updateAttributes]
  );

  // ----- écran courant -----------------------------------------------------

  const screen: Screen = useMemo(() => {
    if (unavailable) return "unavailable";
    if (recorder.isRecording || recorder.isPaused) return "recording";
    if (uploading) return "transcribing";
    if (loading && !state) return "loading";
    if (state) {
      if (state.status === "transcribing") return "transcribing";
      if (state.status === "review") return "review";
      if (state.status === "failed") return "failed";
      if (state.status === "validated") {
        return state.summary || state.cleanedText ? "reported" : "validated";
      }
    }
    if (fileRejected) return "fileRejected";
    if (micDenied) return "micDenied";
    return "idle";
  }, [
    unavailable,
    recorder.isRecording,
    recorder.isPaused,
    uploading,
    loading,
    state,
    fileRejected,
    micDenied,
  ]);

  const duration = state?.durationSeconds ?? null;
  const summaryStale = state ? isOutputStale(state, "summary") : false;
  const cleanedStale = state ? isOutputStale(state, "cleanup") : false;
  // L'adresse de l'audio n'existe que si le serveur déclare l'avoir encore :
  // proposer une réécoute ou un téléchargement sans fichier mènerait à une
  // erreur au clic. Le serveur renseigne toujours `hasAudio`.
  const audioUrl =
    noteId && state?.hasAudio === true ? voiceNoteAudioUrl(noteId) : "";
  const processingLabel = processingLabelFor(busyKind);
  // Un échec de traitement ne se dit qu'une fois l'attente terminée, sinon la
  // relance en cours afficherait l'erreur de la tentative précédente.
  const processFailure = busyKind
    ? null
    : processFailureMessage(state?.errorCode ?? null, isAdmin);

  // ----- rendu -------------------------------------------------------------

  let icon: ReactNode = <Mic className="h-[18px] w-[18px]" aria-hidden="true" />;
  let iconLive = false;
  let title: ReactNode = "Note vocale";
  let subtitle: ReactNode = "Enregistrez, ou déposez un fichier audio.";
  let actions: ReactNode = null;
  let below: ReactNode = null;
  let showLevel = false;

  if (screen === "loading") {
    subtitle = "Préparation de la note.";
    actions = (
      <Loader2
        className="h-4 w-4 animate-spin text-muted-foreground"
        aria-hidden="true"
      />
    );
  } else if (screen === "unavailable") {
    subtitle = "Indisponible pour le moment.";
    actions = (
      <Button size="sm" disabled className="flex-1 sm:flex-none">
        Enregistrer
      </Button>
    );
    below = (
      <div className="flex items-start gap-2.5 rounded-lg bg-blue-500/10 px-3 py-2.5 text-[13px] text-blue-800 dark:text-blue-200">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          <strong className="block font-semibold">
            Aucun moteur de transcription n&apos;est activé.
          </strong>
          {/* Le lien d'administration n'est montré qu'aux administrateurs : on
              n'envoie jamais quelqu'un vers une page qui lui est interdite. */}
          {isAdmin ? (
            <>
              Activez Whisper ou Voxtral dans{" "}
              <Link
                href="/admin/transcription"
                className="font-semibold underline underline-offset-2"
              >
                Administration, Transcription
              </Link>{" "}
              pour utiliser les notes vocales.
            </>
          ) : (
            <>
              Demandez à un administrateur de l&apos;activer pour utiliser les notes
              vocales.
            </>
          )}
        </span>
      </div>
    );
  } else if (screen === "micDenied") {
    icon = <MicOff className="h-[18px] w-[18px]" aria-hidden="true" />;
    title = "Micro indisponible";
    subtitle =
      "Autorisez le micro dans les réglages du navigateur, puis réessayez.";
    actions = (
      <Button
        size="sm"
        variant="outline"
        onClick={handleStartRecording}
        className="flex-1 sm:flex-none"
      >
        Réessayer
      </Button>
    );
    below = (
      <VoiceNoteDropZone
        onFile={handleFile}
        label="Vous pouvez aussi"
        actionLabel="déposer un fichier audio"
        disabled={!isEditable}
      />
    );
  } else if (screen === "fileRejected") {
    icon = <AlertCircle className="h-[18px] w-[18px]" aria-hidden="true" />;
    title = "Ce fichier ne peut pas être transcrit";
    subtitle =
      "Formats acceptés : mp3, m4a, ogg, wav, webm. Taille maximale : 50 Mo, soit plus d'une heure d'enregistrement.";
    actions = (
      <Button
        size="sm"
        variant="outline"
        onClick={() => fileInputRef.current?.click()}
        className="flex-1 sm:flex-none"
      >
        Choisir un autre fichier
      </Button>
    );
  } else if (screen === "recording") {
    iconLive = true;
    const paused = recorder.isPaused;
    title = (
      <VoiceNoteStatusPill tone="recording" withDot dotStill={paused}>
        {paused ? "En pause" : "Enregistrement"}
      </VoiceNoteStatusPill>
    );
    subtitle = (
      <span className="tabular-nums">{formatClock(recorder.durationSeconds)}</span>
    );
    showLevel = true;
    actions = (
      <>
        <Button
          size="sm"
          variant="outline"
          onClick={paused ? recorder.resume : recorder.pause}
          className="flex-1 sm:flex-none"
        >
          {paused ? (
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
          ) : (
            <Pause className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {paused ? "Reprendre" : "Pause"}
        </Button>
        <Button size="sm" onClick={handleFinishRecording} className="flex-1 sm:flex-none">
          <Square className="h-3.5 w-3.5" aria-hidden="true" />
          Terminer
        </Button>
      </>
    );
  } else if (screen === "transcribing") {
    icon = <Timer className="h-[18px] w-[18px]" aria-hidden="true" />;
    title = <VoiceNoteStatusPill tone="work">Transcription en cours</VoiceNoteStatusPill>;
    subtitle = `${
      duration !== null ? `Note de ${formatDuration(duration)}. ` : ""
    }Vous pouvez fermer le document, le traitement continue.`;
    actions = (
      <Loader2
        className="h-4 w-4 animate-spin text-muted-foreground"
        aria-hidden="true"
      />
    );
  } else if (screen === "review") {
    icon = <Pencil className="h-[18px] w-[18px]" aria-hidden="true" />;
    title = <VoiceNoteStatusPill tone="review">À valider</VoiceNoteStatusPill>;
    subtitle = "Relisez la transcription avant de lancer un compte rendu.";
    actions = (
      <>
        {/* Pas d'audio conservé, pas de réécoute : le bouton mènerait à une
            erreur. Le cas existe, la transcription peut avoir abouti alors que
            le fichier a disparu du disque temporaire. */}
        {audioUrl && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setPlaying((previous) => !previous)}
            className="flex-1 sm:flex-none"
          >
            <Play className="h-3.5 w-3.5" aria-hidden="true" />
            Réécouter
          </Button>
        )}
        {/* Seul geste engageant du bloc : il efface l'audio, il est donc isolé,
            distinct visuellement, et passe par une confirmation. */}
        <Button
          size="sm"
          onClick={() => setConfirmOpen(true)}
          disabled={validating || !isEditable}
          className="flex-1 bg-emerald-600 text-white hover:bg-emerald-700 sm:flex-none"
        >
          {validating ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          Valider le transcript
        </Button>
      </>
    );
    below =
      playing && audioUrl ? (
        <audio src={audioUrl} controls autoPlay className="w-full" />
      ) : null;
  } else if (screen === "validated") {
    icon = <Check className="h-[18px] w-[18px]" aria-hidden="true" />;
    title = <VoiceNoteStatusPill tone="done">Transcript validé</VoiceNoteStatusPill>;
    subtitle = "Audio effacé. Le texte reste modifiable si besoin.";
    // Le traitement tourne côté serveur : on le dit, et on rassure sur la
    // fermeture du document, comme pour la transcription.
    if (processingLabel) {
      icon = <Timer className="h-[18px] w-[18px]" aria-hidden="true" />;
      title = <VoiceNoteStatusPill tone="work">{processingLabel}</VoiceNoteStatusPill>;
      subtitle = "Vous pouvez fermer le document, le traitement continue.";
    }
    actions = (
      <>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setCorrectionResumed(true)}
          disabled={correctionResumed || !isEditable}
          className="flex-1 sm:flex-none"
        >
          Reprendre la correction
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleProcess("cleanup")}
          disabled={busyKind !== null}
          className="flex-1 sm:flex-none"
        >
          {busyKind === "cleanup" && (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          )}
          Remettre au propre
        </Button>
        <Button
          size="sm"
          onClick={() => handleProcess("summary")}
          disabled={busyKind !== null}
          className="flex-1 sm:flex-none"
        >
          {busyKind === "summary" && (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          )}
          Synthétiser
        </Button>
      </>
    );
  } else if (screen === "reported") {
    icon = <FileText className="h-[18px] w-[18px]" aria-hidden="true" />;
    title = formatNoteTitle(state?.createdAt);
    const generatedAt = formatShortTime(state?.updatedAt);
    subtitle = [
      duration !== null ? formatDuration(duration) : null,
      generatedAt ? `compte rendu généré à ${generatedAt}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    if (processingLabel) {
      icon = <Timer className="h-[18px] w-[18px]" aria-hidden="true" />;
      title = <VoiceNoteStatusPill tone="work">{processingLabel}</VoiceNoteStatusPill>;
      subtitle = "Vous pouvez fermer le document, le traitement continue.";
    }
    actions = (
      <Button
        size="sm"
        variant="ghost"
        onClick={() => setCorrectionResumed(true)}
        disabled={correctionResumed || !isEditable}
        className="flex-1 sm:flex-none"
      >
        Reprendre la correction
      </Button>
    );
  } else if (screen === "failed") {
    const hasAudio = state?.hasAudio === true;
    icon = <AlertCircle className="h-[18px] w-[18px]" aria-hidden="true" />;
    title = "La transcription n'a pas abouti";
    if (!hasAudio) {
      subtitle = "L'enregistrement n'est plus disponible.";
    } else {
      subtitle =
        duration !== null
          ? `Votre enregistrement de ${formatDuration(duration)} est conservé.`
          : "Votre enregistrement est conservé.";
    }
    actions = (
      <>
        {audioUrl && (
          <Button
            size="sm"
            variant="outline"
            className="flex-1 sm:flex-none"
            // Rendu en lien de téléchargement : Base UI exige nativeButton={false}
            // quand l'élément rendu n'est pas un <button> natif.
            nativeButton={false}
            render={<a href={audioUrl} download />}
          >
            <Download className="h-3.5 w-3.5" aria-hidden="true" />
            Télécharger l&apos;audio
          </Button>
        )}
        {/* Sans audio conservé, la relance serait refusée par le serveur : on
            propose alors le seul geste qui aboutit, un nouvel enregistrement. */}
        {hasAudio ? (
          <Button size="sm" onClick={handleRetry} className="flex-1 sm:flex-none">
            Relancer la transcription
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={handleStartRecording}
            disabled={!isEditable}
            className="flex-1 sm:flex-none"
          >
            <Mic className="h-3.5 w-3.5" aria-hidden="true" />
            Enregistrer à nouveau
          </Button>
        )}
      </>
    );
    below = (
      <div className="flex items-start gap-2.5 rounded-lg bg-destructive/10 px-3 py-2.5 text-[13px] text-destructive">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>{failureMessage(state?.errorCode ?? null, hasAudio)}</span>
      </div>
    );
  } else {
    actions = (
      <Button
        size="sm"
        onClick={handleStartRecording}
        disabled={!isEditable}
        className="flex-1 sm:flex-none"
      >
        <Mic className="h-3.5 w-3.5" aria-hidden="true" />
        Enregistrer
      </Button>
    );
    below = (
      <VoiceNoteDropZone
        onFile={handleFile}
        label="Déposez un fichier audio ici, ou"
        actionLabel="parcourez vos fichiers"
        disabled={!isEditable}
      />
    );
  }

  const showAccordions =
    screen === "review" || screen === "validated" || screen === "reported";
  const transcriptEditable = screen === "review" || correctionResumed;
  // Une sortie déjà produite reste visible quel que soit l'écran : reprendre la
  // correction du transcript ne la détruit pas, elle la marque comme
  // antérieure. La faire disparaître donnerait à croire qu'elle est perdue.
  const showOutputs =
    Boolean(state?.summary) || Boolean(state?.cleanedText) || busyKind !== null;
  // La relance passe par le serveur, qui exige une note validée : pendant une
  // reprise de correction, on annonce la condition au lieu de proposer un
  // bouton qui serait refusé.
  const canRelaunch = state?.status === "validated";

  const convertedDate = formatConvertedDate(actionsConvertedAt);
  const convertActionsButton = canConvertActions ? (
    <div className="flex flex-col items-start gap-1">
      <Button
        size="sm"
        variant="outline"
        onClick={() => setActionsDialogOpen(true)}
      >
        <ListTodo className="h-3.5 w-3.5" aria-hidden="true" />
        {actionsConvertedAt ? "Reconvertir en tâches" : "Convertir en tâches"}
      </Button>
      {actionsConvertedAt && (
        <span className="text-xs text-muted-foreground">
          Actions déjà converties en tâches
          {convertedDate ? ` le ${convertedDate}` : ""}.
        </span>
      )}
    </div>
  ) : null;

  return (
    <NodeViewWrapper
      className={`voice-note-wrapper my-4 ${selected ? "is-selected" : ""}`}
    >
      {/* Le node est un atome : son contenu ne fait pas partie du texte du
          document. `contentEditable={false}` le dit à ProseMirror, comme le
          fait déjà le bloc graphique, pour qu'il laisse la sélection tranquille
          à l'intérieur du bloc. */}
      <div
        className="group rounded-xl border border-border/60 bg-card p-3.5 shadow-sm transition-colors"
        contentEditable={false}
      >
        {isEditable && (
          <div className="mb-2 flex items-center justify-between opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
            <span
              className="flex cursor-grab items-center text-muted-foreground"
              data-drag-handle
            >
              <GripHorizontal className="h-4 w-4" aria-hidden="true" />
            </span>
            <button
              type="button"
              onClick={deleteNode}
              className="rounded p-1 text-destructive transition-colors hover:bg-destructive/10"
              aria-label="Supprimer la note vocale"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border ${
              iconLive
                ? "border-destructive bg-destructive text-destructive-foreground"
                : "border-border/60 bg-muted/50 text-foreground"
            }`}
            aria-hidden="true"
          >
            {icon}
          </span>

          {/* Sur téléphone, ce conteneur s'efface (`contents`) : l'état reste au
              premier rang à côté de l'icône, le texte descend au deuxième rang
              et les boutons occupent le troisième, en pleine largeur. */}
          <div className="contents sm:flex sm:min-w-0 sm:flex-1 sm:flex-col sm:gap-0.5">
            <div className="min-w-0 flex-1 text-sm font-semibold sm:flex-none">
              {title}
            </div>
            <div className="order-3 basis-full text-[13px] text-muted-foreground sm:order-none sm:basis-auto">
              {subtitle}
            </div>
          </div>

          {showLevel && (
            <div className="hidden sm:flex sm:flex-1">
              <VoiceNoteLevel level={recorder.level} frozen={recorder.isPaused} />
            </div>
          )}

          <div className="order-4 flex basis-full flex-wrap items-center gap-2 sm:order-none sm:basis-auto">
            {actions}
          </div>
        </div>

        {below && <div className="mt-3">{below}</div>}

        {(actionError || processFailure) && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
            {actionError ?? processFailure}
          </p>
        )}

        {showAccordions && state && (
          <VoiceNoteAccordions
            transcript={transcriptDraft}
            transcriptEditable={transcriptEditable && isEditable}
            onTranscriptChange={handleTranscriptChange}
            durationSeconds={duration}
            showOutputs={showOutputs}
            canRelaunch={canRelaunch}
            summary={state.summary}
            cleanedText={state.cleanedText}
            summaryStale={summaryStale}
            cleanedStale={cleanedStale}
            // Seul l'écran de relecture ouvre une section : ailleurs les trois
            // accordéons restent repliés, le bloc doit rester discret.
            openByDefault={screen === "review" ? "transcript" : "none"}
            onRelaunch={handleProcess}
            busyKind={busyKind}
            summaryExtra={convertActionsButton}
          />
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept={AUDIO_INPUT_ACCEPT}
          className="hidden"
          onChange={(event) => {
            void handleFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Valider le transcript ?</DialogTitle>
            <DialogDescription>
              La validation fige la transcription et efface définitivement
              l&apos;enregistrement audio. Le texte reste modifiable, mais vous ne
              pourrez plus réécouter la note.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Annuler</DialogClose>
            <Button
              onClick={handleValidate}
              className="bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Valider et effacer l&apos;audio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <VoiceNoteActionsDialog
        actions={voiceNoteActions}
        open={actionsDialogOpen}
        onOpenChange={setActionsDialogOpen}
        onConfirm={handleConvertActions}
      />
    </NodeViewWrapper>
  );
}
