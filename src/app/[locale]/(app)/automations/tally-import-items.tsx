"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Eye, Loader2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FOCUS_CLS, StatusPill, StepInspector, TipButton, type TraceStepView } from "./debug-shared";
import { stepTitle } from "./debug-history";
import type { TallyImportView } from "./tally-import-parts";

type Outcome = "created" | "completed" | "ignored" | "error" | "unknown";
type Filter = "all" | Outcome;

interface ItemView {
  submissionId: string;
  name: string | null;
  email: string | null;
  outcome: Outcome;
  filledColumns: string[];
  errorMessage: string | null;
  runId: string | null;
  hasTrace: boolean;
}
interface ItemsPage {
  items: ItemView[];
  counts: Record<Filter, number>;
  total: number;
  offset: number;
  hasMore: boolean;
}

const LABEL: Record<Outcome, { real: string; sim: string; cls: string }> = {
  created: { real: "Créé", sim: "À créer", cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  completed: { real: "Complété", sim: "À compléter", cls: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300" },
  ignored: { real: "Ignoré", sim: "Ignoré", cls: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300" },
  error: { real: "Erreur", sim: "Erreur", cls: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  unknown: { real: "Inconnu", sim: "Inconnu", cls: "bg-neutral-200 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300" },
};
const FILTERS: [Filter, string][] = [
  ["all", "Toutes"],
  ["created", "Créés"],
  ["completed", "Complétés"],
  ["ignored", "Ignorés"],
  ["error", "Erreurs"],
];

/** Liste par réponse d'un import terminé, filtrable, avec accès à la trace de chaque réponse. */
export function TallyItemsList({
  imp,
  automation,
}: {
  imp: TallyImportView;
  automation: { id: string; databaseId?: string | null };
}) {
  const real = imp.mode === "real";
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState<ItemsPage | null>(null);
  const [items, setItems] = useState<ItemView[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [trace, setTrace] = useState<ItemView | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (offset: number) => {
      const my = ++seq.current;
      setLoading(true);
      setFailed(false);
      try {
        const qs = new URLSearchParams({ offset: String(offset), limit: "200" });
        if (filter !== "all") qs.set("outcome", filter);
        const res = await fetch(`/api/integrations/tally/imports/${imp.id}/items?${qs}`);
        if (!res.ok) throw new Error("http");
        const data = (await res.json()) as ItemsPage;
        if (my !== seq.current) return;
        setPage(data);
        setItems((prev) => (offset === 0 ? data.items : [...prev, ...data.items]));
      } catch {
        if (my === seq.current) setFailed(true);
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [imp.id, filter]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  const counts = page?.counts;
  return (
    <section aria-label="Détail par réponse" className="space-y-2">
      <div role="group" aria-label="Filtrer les réponses" className="flex flex-wrap gap-1.5">
        {FILTERS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={filter === k}
            onClick={() => setFilter(k)}
            className={`min-h-6 rounded-full border px-2.5 text-[11px] font-medium ${FOCUS_CLS} ${
              filter === k
                ? "border-blue-600 bg-blue-50 text-blue-800 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-200"
                : "border-neutral-300 text-neutral-700 hover:bg-neutral-100 dark:border-neutral-700 dark:text-neutral-300 dark:hover:bg-neutral-800"
            }`}
          >
            {label} {counts ? counts[k] : ""}
          </button>
        ))}
      </div>

      {failed ? (
        <p role="alert" className="text-xs text-red-700 dark:text-red-300">
          Impossible de charger le détail des réponses.
        </p>
      ) : loading && items.length === 0 ? (
        <div role="status" aria-busy="true" aria-label="Chargement des réponses" className="space-y-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-9 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-md border border-dashed border-neutral-300 p-3 text-xs text-neutral-600 dark:border-neutral-700 dark:text-neutral-400">
          {filter === "all" ? "Aucun détail conservé pour cet import." : "Aucune réponse dans ce filtre."}
        </p>
      ) : (
        <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {items.map((it) => {
            const who = it.name ?? it.email ?? it.submissionId;
            const noTrace = real ? !it.runId : !it.hasTrace;
            return (
              <li key={it.submissionId} className="flex flex-wrap items-center gap-2 px-2 py-1.5 text-xs">
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${LABEL[it.outcome].cls}`}>
                  {real ? LABEL[it.outcome].real : LABEL[it.outcome].sim}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{who}</span>
                  {it.name && it.email && <span className="block truncate text-[11px] text-neutral-600 dark:text-neutral-400">{it.email}</span>}
                  {it.errorMessage && <span className="block text-[11px] text-red-700 dark:text-red-300">{it.errorMessage}</span>}
                </span>
                {it.filledColumns.length > 0 && (
                  <span className="flex flex-wrap gap-1">
                    {it.filledColumns.map((c) => (
                      <span key={c} className="rounded-full bg-violet-100 px-1.5 text-[10px] font-medium text-violet-800 dark:bg-violet-950 dark:text-violet-300">
                        + {c}
                      </span>
                    ))}
                  </span>
                )}
                <TipButton
                  label="Trace"
                  tip={`Trace de la réponse ${it.submissionId}`}
                  icon={<Eye className="size-3.5" />}
                  onClick={() => setTrace(it)}
                  disabled={noTrace}
                  disabledReason={real ? "Aucune exécution liée à cette réponse" : "Trace non conservée pour cette réponse"}
                  align="right"
                />
              </li>
            );
          })}
        </ul>
      )}

      {page?.hasMore && (
        <TipButton
          label={loading ? "Chargement…" : "Afficher les suivantes"}
          tip="Charger les 200 réponses suivantes"
          icon={loading ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
          onClick={() => void load(items.length)}
          disabled={loading}
          disabledReason="Chargement en cours"
        />
      )}

      <TraceDialog item={trace} imp={imp} automation={automation} onClose={() => setTrace(null)} />
    </section>
  );
}

function TraceDialog({
  item,
  imp,
  automation,
  onClose,
}: {
  item: ItemView | null;
  imp: TallyImportView;
  automation: { id: string; databaseId?: string | null };
  onClose: () => void;
}) {
  const real = imp.mode === "real";
  const [steps, setSteps] = useState<TraceStepView[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    if (!item) return;
    let alive = true;
    setSteps(null);
    setError(null);
    setIdx(0);
    (async () => {
      try {
        const base = automation.databaseId
          ? `/api/databases/${automation.databaseId}/automations/${automation.id}`
          : `/api/automations/${automation.id}`;
        const url = real
          ? `${base}/runs/${item.runId}`
          : `/api/integrations/tally/imports/${imp.id}/items/${encodeURIComponent(item.submissionId)}/trace`;
        const res = await fetch(url);
        if (!res.ok) throw new Error(String(res.status));
        const body = (await res.json()) as { steps?: TraceStepView[] | null; traceTruncated?: boolean };
        if (!alive) return;
        setSteps(body.steps ?? []);
        setTruncated(!!body.traceTruncated);
      } catch (e) {
        if (alive) {
          setError(
            e instanceof Error && e.message === "404"
              ? "Cette exécution n'existe plus (supprimée ou rejouée)."
              : "Impossible de charger la trace."
          );
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [item, imp.id, real, automation.id, automation.databaseId]);

  const step = steps?.[idx];
  const who = item ? (item.name ?? item.email ?? item.submissionId) : "";
  return (
    <Dialog open={!!item} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Trace de la réponse {who}
            {!real && (
              <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                Simulé
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="font-mono text-[11px]">{item?.submissionId}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-xs text-red-700 dark:text-red-300">
            {error}
          </p>
        ) : !steps ? (
          <div role="status" aria-busy="true" aria-label="Chargement de la trace" className="space-y-2">
            <div className="h-6 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
            <div className="h-24 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
          </div>
        ) : steps.length === 0 ? (
          <p className="text-xs italic text-neutral-600 dark:text-neutral-400">Aucune trace par étape pour cette réponse.</p>
        ) : (
          <>
            <ol className="space-y-0.5" aria-label="Étapes">
              {steps.map((s, i) => (
                <li key={`${s.nodeId}-${i}`}>
                  <button
                    type="button"
                    onClick={() => setIdx(i)}
                    aria-current={i === idx ? "true" : undefined}
                    className={`flex min-h-7 w-full items-center gap-2 rounded px-2 text-left text-xs ${FOCUS_CLS} ${
                      i === idx ? "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" : "hover:bg-neutral-100 dark:hover:bg-neutral-800"
                    }`}
                  >
                    <span className="w-3 text-[10px] text-neutral-500">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{stepTitle(s)}</span>
                    <StatusPill status={s.status} durationMs={s.durationMs} />
                  </button>
                </li>
              ))}
            </ol>
            {truncated && (
              <p className="text-[11px] text-amber-700 dark:text-amber-300">
                Trace allégée : les entrées et sorties des étapes n&apos;ont pas été conservées.
              </p>
            )}
            {step && (
              <div className="border-t border-neutral-200 pt-3 dark:border-neutral-800">
                <StepInspector
                  title={stepTitle(step)}
                  step={step}
                  index={idx + 1}
                  databaseId={automation.databaseId ?? undefined}
                  mode={real ? "real" : "simulate"}
                />
              </div>
            )}
          </>
        )}
        <DialogFooter>
          <TipButton label="Fermer" tip="Fermer (Échap)" icon={<X className="size-3.5" />} onClick={onClose} variant="primary" />
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
