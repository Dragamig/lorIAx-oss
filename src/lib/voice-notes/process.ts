import { generateText } from "ai";
import {
  getLanguageModelForUsageInOrg,
  type ProviderOrgScope,
} from "@/lib/ai/provider-resolver";
import { orgIdForVoiceNote } from "@/lib/ai/org-scope";
import { logAIUsage } from "@/lib/ai/usage-logger";
import { resolvePrompt, interpolatePrompt } from "@/lib/ai/prompt-resolver";
import { getBuiltinPromptsByUsageType } from "@/lib/ai/builtin-prompts";
import logger from "@/lib/logger";
import { updateVoiceNote } from "./store";
import { transcriptFingerprint } from "./fingerprint";
import {
  PROCESS_USAGE_TYPE,
  VOICE_NOTE_ERROR_CODES,
  type VoiceNoteProcessKind,
} from "./types";
import type { VoiceNote } from "@/lib/db/schema";

const log = logger.child({ module: "voice-notes-process" });

/** Au delà, on refuse plutôt que de tronquer silencieusement le propos. */
export const MAX_TRANSCRIPT_CHARS = 120_000;

export interface VoiceNotePrompt {
  system: string;
  user: string;
  versionId?: string;
}

/**
 * Construit le couple (prompt système, prompt utilisateur) d'un traitement.
 * Le prompt vient de `ai_prompts` s'il est configuré, sinon du prompt natif.
 * Fonction pure côté rendu : testée sans base via l'argument `resolved`.
 */
export function buildVoiceNotePrompt(
  kind: VoiceNoteProcessKind,
  transcript: string,
  resolved?: {
    systemPrompt: string;
    userPromptTemplate: string | null;
    versionId: string;
  } | null
): VoiceNotePrompt {
  const usageType = PROCESS_USAGE_TYPE[kind];
  const builtin = getBuiltinPromptsByUsageType(usageType)[0];
  const system = resolved?.systemPrompt ?? builtin?.systemPrompt ?? "";
  const template =
    resolved?.userPromptTemplate ??
    builtin?.userPromptTemplate ??
    "{{transcription}}";

  return {
    system,
    user: interpolatePrompt(template, { transcription: transcript }),
    versionId: resolved?.versionId,
  };
}

/**
 * Budget de sortie : une synthèse raccourcit, une mise au propre conserve.
 *
 * Les planchers sont volontairement hauts et ne suivent plus la longueur du
 * transcript d'aussi près. Un modèle à raisonnement dépense d'abord des jetons
 * en réflexion interne, avant d'écrire le premier mot de sa réponse : indexer
 * le plafond sur une note courte lui laissait un budget que la seule réflexion
 * épuisait, et la génération s'arrêtait sur un texte vide (incident du
 * 2026-08-17 : transcript de 238 caractères, plafond calculé à 200 jetons,
 * `tokens_out` égal au plafond, `outputLength` nul).
 *
 * Plancher de 2 000 jetons pour une synthèse, 4 000 pour une mise au propre :
 * de quoi couvrir la réflexion et la réponse d'une note d'une minute. Les
 * plafonds hauts restent indexés sur l'entrée, un transcript long ayant
 * réellement besoin de plus de place, surtout en mise au propre où le texte
 * rendu est de la longueur de l'original.
 */
export function maxOutputTokensFor(
  kind: VoiceNoteProcessKind,
  transcript: string
): number {
  if (kind === "summary") {
    return Math.min(4000, Math.max(2000, Math.round(transcript.length / 3)));
  }
  return Math.min(16000, Math.max(4000, Math.round(transcript.length / 1.5)));
}

/**
 * Échec d'un traitement portant un code exploitable par l'interface. Sert à
 * distinguer une panne d'un défaut de configuration du modèle.
 */
export class VoiceNoteProcessError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "VoiceNoteProcessError";
    this.code = code;
  }
}

/**
 * Qualifie une sortie vide. Un modèle qui s'arrête sur `length`, ou dont les
 * jetons produits atteignent le plafond demandé, a dépensé tout son budget
 * ailleurs que dans sa réponse : c'est le réglage du modèle pour cet usage
 * qu'il faut revoir, pas le service qu'il faut attendre. Toute autre sortie
 * vide reste un aléa, relançable tel quel.
 */
export function emptyOutputCode(input: {
  finishReason?: string;
  outputTokens?: number;
  maxOutputTokens: number;
}): string {
  const { finishReason, outputTokens, maxOutputTokens } = input;
  const hitCap =
    finishReason === "length" ||
    (typeof outputTokens === "number" && outputTokens >= maxOutputTokens);
  return hitCap
    ? VOICE_NOTE_ERROR_CODES.aiEmptyTokenLimit
    : VOICE_NOTE_ERROR_CODES.aiEmptyOutput;
}

/**
 * Exécute un traitement IA sur un transcript validé et journalise la
 * consommation avec l'identifiant de l'utilisateur, systématiquement : sans
 * lui, l'usage n'est rattaché à personne (défaut du résumé de réunion actuel).
 */
export async function runVoiceNoteProcess(input: {
  kind: VoiceNoteProcessKind;
  transcript: string;
  userId: string;
  /**
   * Portée d'organisation de la sélection du fournisseur (cloisonnement AZ-06,
   * lot 6). Obligatoire : le transcript part chez un fournisseur d'IA, et
   * l'appelant est le seul à savoir de quelle organisation il relève. `null`
   * signifie « portée instance seule ».
   */
  organizationId: ProviderOrgScope;
}): Promise<string> {
  const { kind, transcript, userId, organizationId } = input;
  const usageType = PROCESS_USAGE_TYPE[kind];

  const { languageModel, providerId, model } =
    await getLanguageModelForUsageInOrg(usageType, organizationId);
  const resolved = await resolvePrompt(usageType);
  const prompt = buildVoiceNotePrompt(kind, transcript, resolved);

  const maxOutputTokens = maxOutputTokensFor(kind, transcript);
  const startedAt = Date.now();
  try {
    const { text, usage, finishReason } = await generateText({
      model: languageModel,
      system: prompt.system,
      prompt: prompt.user,
      maxOutputTokens,
    });

    const latencyMs = Date.now() - startedAt;
    const output = text.trim();

    // Une sortie vide n'est jamais un succès. Journalisée en réussite, elle
    // rendait la panne invisible : l'appel apparaissait normal dans le suivi
    // d'usage, et la note restait sans compte rendu sans que rien ne le dise.
    if (output === "") {
      const code = emptyOutputCode({
        finishReason,
        outputTokens: usage?.outputTokens,
        maxOutputTokens,
      });
      logAIUsage({
        userId,
        providerId: providerId || "unknown",
        model,
        usageType,
        tokensIn: usage?.inputTokens,
        tokensOut: usage?.outputTokens,
        latencyMs,
        status: "error",
        errorMessage: `${code} (finishReason=${finishReason}, maxOutputTokens=${maxOutputTokens})`,
        promptVersionId: prompt.versionId,
      });
      log.error(
        { kind, latencyMs, code, finishReason, maxOutputTokens, tokensOut: usage?.outputTokens },
        "Traitement de note vocale sans texte produit"
      );
      throw new VoiceNoteProcessError(code, "Le traitement n'a produit aucun texte");
    }

    logAIUsage({
      userId,
      providerId: providerId || "unknown",
      model,
      usageType,
      tokensIn: usage?.inputTokens,
      tokensOut: usage?.outputTokens,
      latencyMs,
      status: "success",
      promptVersionId: prompt.versionId,
    });

    log.info({ kind, latencyMs, outputLength: output.length }, "Traitement de note vocale terminé");
    return output;
  } catch (err) {
    // La sortie vide est déjà journalisée avec son code : la re-journaliser
    // compterait deux appels pour une seule requête au modèle.
    if (err instanceof VoiceNoteProcessError) throw err;
    logAIUsage({
      userId,
      providerId: providerId || "unknown",
      model,
      usageType,
      latencyMs: Date.now() - startedAt,
      status: "error",
      errorMessage: String(err).slice(0, 500),
      promptVersionId: prompt.versionId,
    });
    throw err;
  }
}

/**
 * Exécute un traitement puis enregistre son résultat, marqueur d'attente
 * effacé dans tous les cas.
 *
 * Lancée en tâche de fond par la route `process` : le client suit l'avancement
 * via `GET /api/voice-notes/[id]`. Une génération dure des dizaines de secondes,
 * parfois davantage ; la garder dans la requête HTTP la ferait couper par le
 * proxy alors que le travail continue côté serveur, et le résultat semblerait
 * perdu. L'empreinte du transcript ayant servi accompagne la sortie : une
 * correction ultérieure la marquera comme antérieure au lieu de la détruire.
 */
export async function runVoiceNoteProcessJob(input: {
  noteId: string;
  kind: VoiceNoteProcessKind;
  transcript: string;
  userId: string;
}): Promise<void> {
  const { noteId, kind, transcript, userId } = input;

  // La note vocale mène à son document, le document à son espace, l'espace à
  // son organisation : le job de fond n'a pas de requête HTTP dont hériter,
  // mais il a l'objet traité. Indérivable → portée instance seule.
  const organizationId = await orgIdForVoiceNote(noteId);

  let output: string;
  try {
    output = await runVoiceNoteProcess({ kind, transcript, userId, organizationId });
  } catch (err) {
    // Le code porté par l'échec survit jusqu'au bloc : une sortie vide n'a pas
    // le même remède qu'une panne du service, et le message doit le dire.
    const errorCode =
      err instanceof VoiceNoteProcessError
        ? err.code
        : VOICE_NOTE_ERROR_CODES.aiFailed;
    log.error({ noteId, kind, errorCode, err: String(err) }, "Traitement IA échoué");
    await updateVoiceNote(noteId, {
      processingKind: null,
      processingStartedAt: null,
      errorCode,
    });
    return;
  }

  const hash = transcriptFingerprint(transcript);
  await updateVoiceNote(noteId, {
    ...(kind === "summary"
      ? { summary: output, summaryTranscriptHash: hash }
      : { cleanedText: output, cleanedTranscriptHash: hash }),
    processingKind: null,
    processingStartedAt: null,
    errorCode: null,
  });
}

/**
 * Marque le traitement comme engagé, puis lance la génération en tâche de fond.
 * Le marqueur est écrit avant tout travail : une réouverture du document, ou
 * une autre fenêtre, voit immédiatement qu'un traitement est en cours.
 */
export async function startVoiceNoteProcess(input: {
  noteId: string;
  kind: VoiceNoteProcessKind;
  transcript: string;
  userId: string;
}): Promise<VoiceNote> {
  const note = await updateVoiceNote(input.noteId, {
    processingKind: input.kind,
    processingStartedAt: new Date(),
    errorCode: null,
  });

  void runVoiceNoteProcessJob(input).catch((err) => {
    log.error(
      { noteId: input.noteId, err: String(err) },
      "Pipeline de traitement de note vocale interrompu"
    );
  });

  return note;
}
