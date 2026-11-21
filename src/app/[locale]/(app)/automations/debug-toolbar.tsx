"use client";

import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ChevronDown, Loader2, Play, X, Zap } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TipButton } from "./debug-shared";

export type SampleKind = "lastReceived" | "row" | "values";
export type TestSample =
  | { kind: "lastReceived" }
  | { kind: "row"; rowId: string }
  | { kind: "values"; cells?: Record<string, unknown>; body?: unknown };

type SampleRow = { id: string; label: string };
const EMPTY_ROWS: SampleRow[] = [];

export interface SampleState {
  kind: SampleKind;
  setKind: (k: SampleKind) => void;
  rowId: string;
  setRowId: (id: string) => void;
  valuesText: string;
  setValuesText: (t: string) => void;
  rows: SampleRow[];
  rowsLoading: boolean;
  /** Échantillon prêt à envoyer, ou null. */
  sample: TestSample | null;
  /** Pourquoi aucun échantillon n'est utilisable. */
  reason?: string;
  summary: string;
  hasDatabase: boolean;
  hasWebhook: boolean;
  lastReceivedAt?: string;
}

/** État du sélecteur d'échantillon : dernier corps reçu, ligne de la base, ou valeurs saisies. */
export function useTestSample({
  databaseId,
  triggerType,
  lastReceivedAt,
}: {
  databaseId?: string;
  triggerType: string;
  lastReceivedAt?: string;
}): SampleState {
  const hasWebhook = triggerType === "webhook_inbound";
  const hasDatabase = !!databaseId;
  const hasLast = hasWebhook && !!lastReceivedAt;
  const [picked, setPicked] = useState<SampleKind | null>(null);
  const [rowId, setRowId] = useState("");
  const [valuesText, setValuesText] = useState("{}");
  const [loadedRows, setLoadedRows] = useState<{ databaseId: string; rows: SampleRow[] } | null>(null);
  const rows = loadedRows && loadedRows.databaseId === databaseId ? loadedRows.rows : EMPTY_ROWS;
  const rowsLoading = hasDatabase && loadedRows?.databaseId !== databaseId;

  const auto: SampleKind = hasLast ? "lastReceived" : hasDatabase ? "row" : "values";
  let kind = picked ?? auto;
  if (kind === "lastReceived" && !hasLast) kind = auto;
  if (kind === "row" && !hasDatabase) kind = auto;

  useEffect(() => {
    if (!databaseId) return;
    let active = true;
    fetch(`/api/databases/${databaseId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!active) return;
        const list = (data?.rows ?? []) as Array<{ id: string; cells?: Record<string, unknown> }>;
        setLoadedRows({
          databaseId,
          rows: list.slice(0, 300).map((row) => {
            const first = Object.values(row.cells ?? {}).find((v) => typeof v === "string" && v);
            return { id: row.id, label: (first as string) || row.id.slice(0, 8) };
          }),
        });
      })
      .catch(() => {
        if (active) setLoadedRows({ databaseId, rows: [] });
      });
    return () => {
      active = false;
    };
  }, [databaseId]);

  const parsed = useMemo(() => {
    try {
      const v = JSON.parse(valuesText);
      return v && typeof v === "object" ? { ok: true as const, value: v as unknown } : { ok: false as const };
    } catch {
      return { ok: false as const };
    }
  }, [valuesText]);

  let sample: TestSample | null = null;
  let reason: string | undefined;
  let summary = "";
  if (kind === "lastReceived") {
    sample = { kind: "lastReceived" };
    summary = `Dernier corps reçu à ${new Date(lastReceivedAt as string).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
  } else if (kind === "row") {
    const r = rows.find((x) => x.id === rowId);
    summary = r ? `Ligne : ${r.label}` : "Choisir une ligne";
    if (rowId) sample = { kind: "row", rowId };
    else reason = rowsLoading ? "Chargement des lignes de la base" : rows.length === 0 ? "Aucune ligne dans la base : saisissez des valeurs" : "Choisissez une ligne comme échantillon";
  } else {
    summary = "Valeurs saisies";
    if (!parsed.ok) reason = "Les valeurs saisies ne sont pas un objet JSON valide";
    else sample = hasWebhook ? { kind: "values", body: parsed.value } : { kind: "values", cells: parsed.value as Record<string, unknown> };
  }

  return {
    kind: kind,
    setKind: setPicked,
    rowId,
    setRowId,
    valuesText,
    setValuesText,
    rows,
    rowsLoading,
    sample,
    reason,
    summary,
    hasDatabase,
    hasWebhook,
    lastReceivedAt,
  };
}

function SamplePicker({ s }: { s: SampleState }) {
  const [search, setSearch] = useState("");
  const filtered = s.rows.filter((r) => r.label.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 50);
  const jsonValid = (() => {
    try {
      return typeof JSON.parse(s.valuesText) === "object";
    } catch {
      return false;
    }
  })();
  const option = (kind: SampleKind, label: string, disabled?: boolean, why?: string) => (
    <label
      key={kind}
      title={disabled ? why : undefined}
      className={`flex min-h-7 items-center gap-2 rounded px-2 text-xs ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:bg-neutral-100 dark:hover:bg-neutral-800"}`}
    >
      <input
        type="radio"
        name="sample-kind"
        checked={s.kind === kind}
        disabled={disabled}
        onChange={() => s.setKind(kind)}
        className="h-4 w-4 accent-blue-600"
      />
      <span>{label}</span>
      {disabled && why && <span className="ml-auto text-[10px] text-neutral-400">{why}</span>}
    </label>
  );
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Échantillon du déclencheur : ${s.summary}`}
        className="inline-flex min-h-7 max-w-64 items-center gap-1.5 rounded border border-neutral-300 bg-white px-2 text-xs hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
      >
        <span className="text-neutral-500">Échantillon</span>
        <span className="truncate font-medium">{s.summary}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" aria-hidden />
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2">
        <div role="radiogroup" aria-label="Type d'échantillon" className="space-y-0.5">
          {s.hasWebhook &&
            option(
              "lastReceived",
              s.lastReceivedAt
                ? `Dernier corps reçu (${new Date(s.lastReceivedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })})`
                : "Dernier corps reçu",
              !s.lastReceivedAt,
              "aucun corps reçu"
            )}
          {s.hasDatabase && option("row", "Une ligne de la base")}
          {option("values", "Saisir des valeurs")}
        </div>
        {s.kind === "row" && (
          <div className="space-y-1 border-t border-neutral-200 pt-2 dark:border-neutral-800">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Rechercher une ligne"
              aria-label="Rechercher une ligne"
              className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
            />
            <ul className="max-h-48 overflow-auto" role="listbox" aria-label="Lignes de la base">
              {s.rowsLoading ? (
                <li className="px-2 py-1.5 text-xs text-neutral-500">Chargement…</li>
              ) : filtered.length === 0 ? (
                <li className="px-2 py-1.5 text-xs italic text-neutral-400">Aucune ligne ne correspond.</li>
              ) : (
                filtered.map((r) => (
                  <li key={r.id} role="option" aria-selected={r.id === s.rowId}>
                    <button
                      type="button"
                      onClick={() => s.setRowId(r.id)}
                      className={`flex min-h-7 w-full items-center rounded px-2 text-left text-xs hover:bg-neutral-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:hover:bg-neutral-800 ${
                        r.id === s.rowId ? "bg-blue-50 font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300" : ""
                      }`}
                    >
                      <span className="truncate">{r.label}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
        {s.kind === "values" && (
          <div className="space-y-1 border-t border-neutral-200 pt-2 dark:border-neutral-800">
            <label className="block text-[11px] text-neutral-500" htmlFor="sample-json">
              {s.hasWebhook ? "Corps du webhook (JSON)" : "Valeurs des cellules (JSON, clé = identifiant de colonne)"}
            </label>
            <textarea
              id="sample-json"
              value={s.valuesText}
              onChange={(e) => s.setValuesText(e.target.value)}
              rows={6}
              spellCheck={false}
              aria-invalid={!jsonValid}
              className={`w-full rounded border bg-white px-2 py-1.5 font-mono text-xs dark:bg-neutral-900 ${
                jsonValid ? "border-neutral-300 dark:border-neutral-700" : "border-red-400"
              }`}
            />
            {!jsonValid && <p className="text-[11px] text-red-600 dark:text-red-400">JSON invalide.</p>}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Barre de test : lancer le scénario, choisir l'échantillon, basculer en exécution réelle. */
export function TestToolbar({
  sample,
  running,
  disabledReason,
  realMode,
  onRealModeChange,
  onRun,
}: {
  sample: SampleState;
  running: boolean;
  /** Raison pour laquelle le test est impossible (échantillon, modifications non enregistrées). */
  disabledReason?: string;
  realMode: boolean;
  onRealModeChange: (v: boolean) => void;
  onRun: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
      <TipButton
        label={running ? "Test en cours" : "Tester le scénario"}
        tip="Exécuter toutes les étapes sur l'échantillon"
        variant="primary"
        icon={running ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
        onClick={onRun}
        disabled={running || !!disabledReason}
        disabledReason={running ? "Un test est déjà en cours" : disabledReason}
      />
      <SamplePicker s={sample} />
      <div className="ml-auto flex items-center gap-2">
        <span className="group/tip relative inline-flex">
          <button
            type="button"
            role="switch"
            aria-checked={realMode}
            aria-label="Exécuter réellement"
            onClick={() => (realMode ? onRealModeChange(false) : setConfirmOpen(true))}
            className={`inline-flex min-h-7 items-center gap-2 rounded border px-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
              realMode
                ? "border-red-400 text-red-700 dark:text-red-300"
                : "border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-900"
            }`}
          >
            <span
              aria-hidden
              className={`relative h-3.5 w-6 rounded-full transition-colors ${realMode ? "bg-red-500" : "bg-neutral-300 dark:bg-neutral-600"}`}
            >
              <span className={`absolute top-0.5 h-2.5 w-2.5 rounded-full bg-white transition-all ${realMode ? "left-3" : "left-0.5"}`} />
            </span>
            <Zap className="h-3.5 w-3.5" aria-hidden />
            Exécuter réellement
          </button>
          <Tooltip>
            {realMode ? "Mode réel actif : les écritures sont effectuées" : "Par défaut le test est simulé : aucune écriture"}
          </Tooltip>
        </span>
      </div>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-red-600" aria-hidden />
              Exécuter réellement
            </DialogTitle>
            <DialogDescription>
              Les étapes vont écrire dans les bases, créer des tâches et des documents, envoyer des e-mails et appeler
              le fournisseur IA et les services externes. Ces écritures ne sont pas annulées à la fin du test.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              <X className="h-3.5 w-3.5" aria-hidden />
              Annuler
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmOpen(false);
                onRealModeChange(true);
                toast.warning("Mode réel activé : les prochains tests écrivent vraiment");
              }}
            >
              <Zap className="h-3.5 w-3.5" aria-hidden />
              Activer le mode réel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export function RealModeBanner({ onRevert }: { onRevert: () => void }) {
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-2 border-b border-red-400 bg-red-100 px-4 py-1.5 text-xs font-medium text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
    >
      <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="flex-1">Mode réel actif : les tests écrivent dans les bases, créent des tâches et appellent le fournisseur IA.</span>
      <TipButton
        label="Repasser en simulé"
        tip="Les prochains tests ne feront plus aucune écriture"
        icon={<X className="h-3.5 w-3.5" aria-hidden />}
        align="right"
        onClick={() => {
          onRevert();
          toast.success("Retour au mode simulé");
        }}
      />
    </div>
  );
}
