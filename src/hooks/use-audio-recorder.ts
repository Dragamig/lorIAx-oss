"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Encapsulation de MediaRecorder : etat, duree, niveau sonore, commandes.
 * Ne connait rien du domaine metier (notes vocales, API, TipTap) : le hook est
 * testable seul et reutilisable par n'importe quel bloc qui capte du micro.
 *
 * Garantie importante : le flux micro est relache a l'arret ET au demontage,
 * sinon la pastille d'enregistrement du navigateur reste allumee.
 */

export type AudioRecorderStatus =
  | "idle"
  | "requesting"
  | "recording"
  | "paused"
  | "stopped"
  | "denied"
  | "unsupported"
  | "error";

export interface AudioRecording {
  blob: Blob;
  mimeType: string;
  durationSeconds: number;
}

export interface UseAudioRecorderResult {
  status: AudioRecorderStatus;
  /** Duree cumulee en secondes, pauses exclues. */
  durationSeconds: number;
  /** Niveau sonore instantane, borne entre 0 et 1. */
  level: number;
  /** Message pret a afficher, ou null. */
  error: string | null;
  isRecording: boolean;
  isPaused: boolean;
  start: () => Promise<void>;
  pause: () => void;
  resume: () => void;
  /** Termine et rend l'enregistrement, ou null si rien n'a ete capte. */
  stop: () => Promise<AudioRecording | null>;
  /** Repart de zero sans toucher au micro (deja relache). */
  reset: () => void;
}

const PREFERRED_MIME_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

/** Intervalle de rafraichissement du compteur de duree, en millisecondes. */
const TICK_MS = 200;
/** Cadence maximale de mise a jour du niveau sonore, en millisecondes. */
const LEVEL_THROTTLE_MS = 80;
/**
 * Delai de garde a l'arret, en millisecondes. `onstop` peut ne jamais venir
 * (recorder tombe, implementation defaillante) : sans ce garde-fou, l'attente
 * ne se resout pas et le micro n'est jamais relache, donc la pastille
 * d'enregistrement du navigateur reste allumee. Deux secondes couvrent
 * largement la livraison du dernier segment (decoupe a une seconde).
 */
const STOP_TIMEOUT_MS = 2000;

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const candidate of PREFERRED_MIME_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported?.(candidate)) return candidate;
    } catch {
      /* isTypeSupported peut lever selon les implementations */
    }
  }
  return "";
}

function isRecordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

export function useAudioRecorder(): UseAudioRecorderResult {
  const [status, setStatus] = useState<AudioRecorderStatus>("idle");
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastLevelAtRef = useRef(0);

  // Duree : on cumule les segments actifs pour ignorer le temps de pause.
  const elapsedBeforePauseRef = useRef(0);
  const segmentStartedAtRef = useRef(0);

  const stopLevelMeter = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    const context = audioContextRef.current;
    audioContextRef.current = null;
    if (context && context.state !== "closed") {
      void context.close().catch(() => {});
    }
    setLevel(0);
  }, []);

  const stopTicker = useCallback(() => {
    if (tickRef.current !== null) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }, []);

  /** Coupe le micro pour de bon : pistes arretees, analyseur ferme, timer stoppe. */
  const releaseStream = useCallback(() => {
    stopLevelMeter();
    stopTicker();
    const stream = streamRef.current;
    streamRef.current = null;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {
          /* piste deja fermee */
        }
      }
    }
  }, [stopLevelMeter, stopTicker]);

  const startLevelMeter = useCallback((stream: MediaStream) => {
    const AudioContextCtor =
      typeof window !== "undefined"
        ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext)
        : undefined;
    if (!AudioContextCtor) return;

    let context: AudioContext;
    try {
      context = new AudioContextCtor();
    } catch {
      return;
    }
    audioContextRef.current = context;

    let analyser: AnalyserNode;
    try {
      const source = context.createMediaStreamSource(stream);
      analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
    } catch {
      void context.close().catch(() => {});
      audioContextRef.current = null;
      return;
    }

    const samples = new Uint8Array(analyser.fftSize);

    const loop = () => {
      if (audioContextRef.current !== context) return;
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i += 1) {
        const centred = (samples[i] - 128) / 128;
        sum += centred * centred;
      }
      const rms = Math.sqrt(sum / samples.length);
      const now = Date.now();
      if (now - lastLevelAtRef.current >= LEVEL_THROTTLE_MS) {
        lastLevelAtRef.current = now;
        // Compression douce : un signal de parole normal remplit la jauge.
        setLevel(Math.min(1, rms * 3.2));
      }
      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const startTicker = useCallback(() => {
    stopTicker();
    tickRef.current = setInterval(() => {
      const active =
        segmentStartedAtRef.current > 0
          ? (Date.now() - segmentStartedAtRef.current) / 1000
          : 0;
      setDurationSeconds(
        Math.floor(elapsedBeforePauseRef.current + active)
      );
    }, TICK_MS);
  }, [stopTicker]);

  const start = useCallback(async () => {
    if (!isRecordingSupported()) {
      setStatus("unsupported");
      setError("Ce navigateur ne sait pas enregistrer le micro.");
      return;
    }
    setError(null);
    setStatus("requesting");

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (cause) {
      const name = (cause as { name?: string } | null)?.name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setStatus("denied");
        setError("Micro refusé.");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setStatus("denied");
        setError("Aucun micro détecté.");
      } else {
        setStatus("error");
        setError("Le micro n'a pas pu démarrer.");
      }
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    elapsedBeforePauseRef.current = 0;
    segmentStartedAtRef.current = Date.now();
    setDurationSeconds(0);

    const mimeType = pickMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
    } catch {
      releaseStream();
      setStatus("error");
      setError("Le micro n'a pas pu démarrer.");
      return;
    }

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorderRef.current = recorder;

    try {
      recorder.start(1000);
    } catch {
      releaseStream();
      recorderRef.current = null;
      setStatus("error");
      setError("Le micro n'a pas pu démarrer.");
      return;
    }

    startLevelMeter(stream);
    startTicker();
    setStatus("recording");
  }, [releaseStream, startLevelMeter, startTicker]);

  const pause = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "recording") return;
    try {
      recorder.pause();
    } catch {
      return;
    }
    if (segmentStartedAtRef.current > 0) {
      elapsedBeforePauseRef.current +=
        (Date.now() - segmentStartedAtRef.current) / 1000;
      segmentStartedAtRef.current = 0;
    }
    stopTicker();
    setDurationSeconds(Math.floor(elapsedBeforePauseRef.current));
    setLevel(0);
    setStatus("paused");
  }, [stopTicker]);

  const resume = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state !== "paused") return;
    try {
      recorder.resume();
    } catch {
      return;
    }
    segmentStartedAtRef.current = Date.now();
    startTicker();
    setStatus("recording");
  }, [startTicker]);

  const stop = useCallback(async () => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") {
      releaseStream();
      recorderRef.current = null;
      setStatus("stopped");
      return null;
    }

    if (segmentStartedAtRef.current > 0) {
      elapsedBeforePauseRef.current +=
        (Date.now() - segmentStartedAtRef.current) / 1000;
      segmentStartedAtRef.current = 0;
    }
    const total = Math.max(0, Math.round(elapsedBeforePauseRef.current));

    // L'attente est bornee : `onstop`, ou le delai de garde, ou un arret qui
    // leve. Dans les trois cas on rejoint la liberation du micro plus bas.
    let guard: ReturnType<typeof setTimeout> | null = null;
    const finished = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
      guard = setTimeout(resolve, STOP_TIMEOUT_MS);
    });

    let stopThrew = false;
    try {
      recorder.stop();
    } catch {
      // Le recorder peut deja etre tombe : `onstop` ne viendra pas, inutile
      // d'attendre le delai de garde.
      stopThrew = true;
    }
    if (!stopThrew) await finished;
    if (guard !== null) clearTimeout(guard);

    // Le micro est libere avant de rendre la main : la pastille du navigateur
    // doit s'eteindre des que l'utilisateur clique sur « Terminer ».
    releaseStream();
    recorderRef.current = null;

    const chunks = chunksRef.current;
    chunksRef.current = [];
    setDurationSeconds(total);
    setStatus("stopped");

    if (chunks.length === 0) return null;
    const mimeType = chunks[0]?.type || recorder.mimeType || "audio/webm";
    return {
      blob: new Blob(chunks, { type: mimeType }),
      mimeType,
      durationSeconds: total,
    };
  }, [releaseStream]);

  const reset = useCallback(() => {
    releaseStream();
    recorderRef.current = null;
    chunksRef.current = [];
    elapsedBeforePauseRef.current = 0;
    segmentStartedAtRef.current = 0;
    setDurationSeconds(0);
    setLevel(0);
    setError(null);
    setStatus("idle");
  }, [releaseStream]);

  // Demontage : on coupe tout, meme au milieu d'un enregistrement.
  useEffect(() => {
    return () => {
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") {
        try {
          recorder.stop();
        } catch {
          /* rien a faire */
        }
      }
      recorderRef.current = null;
      releaseStream();
    };
  }, [releaseStream]);

  return {
    status,
    durationSeconds,
    level,
    error,
    isRecording: status === "recording",
    isPaused: status === "paused",
    start,
    pause,
    resume,
    stop,
    reset,
  };
}
