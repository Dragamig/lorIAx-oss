"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, History, Loader2, RefreshCw, RotateCw } from "lucide-react";
import { ACTION_LABELS } from "./automation-labels";
import {
  SOURCE_LABEL,
  StatusPill,
  StepInspector,
  TipButton,
  formatDate,
  formatDuration,
  runStatusToStep,
  type RunDetail,
  type RunSummary,
  type TraceStepView,
} from "./debug-shared";

export function stepTitle(step: TraceStepView): string {
  if (step.kind === "trigger") return "Déclencheur";
  if (step.kind === "condition") return "Condition";
  return ACTION_LABELS[step.actionType ?? ""] ?? step.actionType ?? "Action";
}

const REPLAY_TIP =
  "Relance l'exécution réelle avec ses données d'origine. La nouvelle exécution remplace cette entrée.";

/** Historique des exécutions : liste, détail par étape, rejeu qui remplace l'entrée. */
export function RunHistory({
  endpoint,
  canReplay,
  refreshKey,
  databaseId,
}: {
  endpoint: string;
  /** Base de l'automatisme, pour nommer les colonnes dans l'inspecteur. */
  databaseId?: string;
  canReplay: boolean;
  /** Incrémenté par le parent après un test réel pour recharger la liste. */
  refreshKey?: number;
}) {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<RunDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [stepIdx, setStepIdx] = useState(0);
  const [replayingId, setReplayingId] = useState<string | null>(null);

  const loadSeq = useRef(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${endpoint}/runs`);
      if (!res.ok) throw new Error("http");
      const data = await res.json();
      setRuns(Array.isArray(data) ? data : []);
    } catch {
      setError("Impossible de charger l'historique.");
      setRuns(null);
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const loadDetail = useCallback(
    async (id: string) => {
      const seq = ++loadSeq.current;
      setSelectedId(id);
      setStepIdx(0);
      setDetail(null);
      setDetailError(null);
      setDetailLoading(true);
      try {
        const res = await fetch(`${endpoint}/runs/${id}`);
        if (!res.ok) throw new Error("http");
        const body = (await res.json()) as RunDetail;
        if (seq === loadSeq.current) setDetail(body);
      } catch {
        if (seq === loadSeq.current) setDetailError("Impossible de charger le détail de cette exécution.");
      } finally {
        if (seq === loadSeq.current) setDetailLoading(false);
      }
    },
    [endpoint]
  );

  async function replay(run: RunSummary) {
    setReplayingId(run.id);
    try {
      const res = await fetch(`${endpoint}/runs/${run.id}/replay`, { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(j?.error ?? "Rejeu impossible");
        return;
      }
      const created = j as RunDetail;
      const { steps: _steps, payload: _payload, ...summary } = created as RunDetail & { payload?: unknown };
      void _steps;
      void _payload;
      setRuns((rs) => (rs ?? []).map((r) => (r.id === run.id ? summary : r)));
      // Le POST renvoie le run complet : on l'affiche sans second aller-retour.
      loadSeq.current += 1;
      setSelectedId(created.id);
      setStepIdx(0);
      setDetailError(null);
      setDetailLoading(false);
      setDetail({ ...summary, steps: created.steps ?? [] });
      toast.success("Exécution rejouée : l'ancienne entrée est remplacée");
    } catch {
      toast.error("Erreur réseau pendant le rejeu");
    } finally {
      setReplayingId(null);
    }
  }

  const steps = detail?.steps ?? null;
  const step = steps?.[stepIdx];

  return (
    <div className="min-h-[60vh]">
      <div className="min-w-0 p-4">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold">Exécutions</h3>
          <TipButton
            label="Actualiser"
            tip="Recharger la liste des exécutions"
            icon={<RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />}
            onClick={() => void load()}
            disabled={loading}
            disabledReason="Chargement en cours"
            align="right"
          />
        </div>

        {loading && !runs ? (
          <ul className="space-y-1" aria-busy="true" aria-label="Chargement de l'historique">
            {[0, 1, 2].map((i) => (
              <li key={i} className="h-11 animate-pulse rounded border border-neutral-200 bg-neutral-100 dark:border-neutral-800 dark:bg-neutral-900" />
            ))}
          </ul>
        ) : error ? (
          <div role="alert" className="flex items-center gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">{error}</span>
            <TipButton label="Réessayer" icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />} onClick={() => void load()} align="right" />
          </div>
        ) : !runs || runs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 dark:border-neutral-700">
            <History className="mx-auto mb-2 h-5 w-5" aria-hidden />
            Aucune exécution enregistrée.
          </div>
        ) : (
          <ul className="rounded-lg border border-neutral-200 dark:border-neutral-800" aria-live="polite">
            {runs.map((run) => {
              const replaying = replayingId === run.id;
              return (
                <li
                  key={run.id}
                  className={`flex flex-wrap items-center gap-2 border-b border-neutral-200 px-3 py-1.5 last:border-b-0 dark:border-neutral-800 ${
                    selectedId === run.id ? "bg-blue-50 dark:bg-blue-950/30" : ""
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void loadDetail(run.id)}
                    aria-label={`Voir le détail de l'exécution du ${formatDate(run.triggeredAt)}`}
                    className="flex min-h-8 min-w-0 flex-1 items-center gap-3 rounded text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <span className="font-mono">{formatDate(run.triggeredAt)}</span>
                    <span className="text-neutral-500">{SOURCE_LABEL[run.source ?? "trigger"] ?? run.source}</span>
                    <span className="ml-auto">
                      {replaying ? (
                        <span className="inline-flex min-h-6 items-center gap-1 rounded-full bg-amber-100 px-2 text-[11px] font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
                          Rejeu en cours
                        </span>
                      ) : (
                        <StatusPill status={runStatusToStep(run.status)} />
                      )}
                    </span>
                    <span className="w-14 text-right font-mono text-neutral-500">{formatDuration(run.durationMs)}</span>
                  </button>
                  {canReplay && (
                    <TipButton
                      label="Rejouer"
                      tip={REPLAY_TIP}
                      icon={<RotateCw className={`h-3.5 w-3.5 ${replaying ? "animate-spin" : ""}`} aria-hidden />}
                      onClick={() => void replay(run)}
                      disabled={replayingId !== null}
                      disabledReason="Un rejeu est déjà en cours"
                      align="right"
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <aside className="border-t border-neutral-200 p-4 dark:border-neutral-800" aria-label="Détail de l'exécution">
        {!selectedId ? (
          <p className="text-xs italic text-neutral-400">Sélectionnez une exécution pour voir ses étapes.</p>
        ) : detailLoading ? (
          <div className="space-y-2" aria-busy="true">
            <div className="h-5 w-40 animate-pulse rounded bg-neutral-100 dark:bg-neutral-900" />
            <div className="h-24 animate-pulse rounded bg-neutral-100 dark:bg-neutral-900" />
          </div>
        ) : detailError ? (
          <p role="alert" className="text-xs text-red-700 dark:text-red-300">{detailError}</p>
        ) : detail ? (
          <div>
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="font-mono text-xs font-semibold">{formatDate(detail.triggeredAt)}</span>
              <StatusPill status={runStatusToStep(detail.status)} durationMs={detail.durationMs} />
              <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                {SOURCE_LABEL[detail.source ?? "trigger"] ?? detail.source}
              </span>
            </div>
            {!steps || steps.length === 0 ? (
              <p className="text-xs italic text-neutral-500">
                {detail.errorMessage ?? "Cette exécution n'a pas de trace par étape."}
              </p>
            ) : (
              <>
                <ol className="mb-3 space-y-0.5" aria-label="Étapes">
                  {steps.map((s, i) => (
                    <li key={`${s.nodeId}-${i}`}>
                      <button
                        type="button"
                        onClick={() => setStepIdx(i)}
                        aria-current={i === stepIdx ? "true" : undefined}
                        className={`flex min-h-7 w-full items-center gap-2 rounded px-2 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                          i === stepIdx ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                        }`}
                      >
                        <span className="w-3 text-[10px] text-neutral-400">{i + 1}</span>
                        <span className="min-w-0 flex-1 truncate">{stepTitle(s)}</span>
                        <StatusPill status={s.status} durationMs={s.durationMs} />
                      </button>
                    </li>
                  ))}
                </ol>
                {detail.traceTruncated && (
                  <p className="mb-2 text-[11px] text-amber-700 dark:text-amber-300">
                    Trace tronquée : certaines étapes n&apos;ont plus leurs entrées et sorties.
                  </p>
                )}
                {step && (
                  <div className="border-t border-neutral-200 pt-3 dark:border-neutral-800">
                    <StepInspector
                      title={stepTitle(step)}
                      step={step}
                      index={stepIdx + 1}
                      databaseId={databaseId}
                      mode={detail.source === "test" || detail.source === "replay" || detail.source === "trigger" ? "real" : undefined}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
