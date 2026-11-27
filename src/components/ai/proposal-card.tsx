"use client";

import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  Eye,
  EyeOff,
  GitMerge,
  Info,
  ListChecks,
  Loader2,
  Lock,
  PlusSquare,
  RefreshCw,
  Trash2,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Hint } from "@/components/ui/hint";
import type { ProposalPayload } from "@/lib/ai/proposals/types";
import type { ApplyBody } from "@/lib/ai/proposals/apply";
import { useProposal, type ProposalState } from "./use-proposal";

const BADGES: Record<ProposalState, { label: string; icon: LucideIcon; cls: string }> = {
  loading: { label: "Chargement", icon: Loader2, cls: "bg-muted text-muted-foreground" },
  pending: { label: "En attente", icon: Info, cls: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300" },
  applying: { label: "Application en cours", icon: Loader2, cls: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300" },
  applied: { label: "Appliquée", icon: Check, cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300" },
  stale: { label: "Base modifiée", icon: AlertTriangle, cls: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300" },
  failed: { label: "Échec", icon: AlertTriangle, cls: "bg-destructive/10 text-destructive" },
  dismissed: { label: "Ignorée", icon: X, cls: "bg-muted text-muted-foreground" },
  expired: { label: "Expirée", icon: CalendarClock, cls: "bg-muted text-muted-foreground" },
  undone: { label: "Annulée", icon: Undo2, cls: "bg-muted text-muted-foreground" },
  error: { label: "Erreur", icon: AlertTriangle, cls: "bg-destructive/10 text-destructive" },
};

const TYPE_ICON: Record<ProposalPayload["type"], LucideIcon> = {
  merge_duplicates: GitMerge,
  update_rows: ListChecks,
  delete_rows: Trash2,
  create_rows: PlusSquare,
};

const BTN =
  "inline-flex h-8 min-w-8 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY = `${BTN} border-transparent bg-primary text-primary-foreground hover:bg-primary/90`;
const BTN_OUTLINE = `${BTN} border-border bg-background hover:bg-muted`;

function fmt(value: unknown): string {
  if (value === null || value === undefined || value === "") return "vide";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "valeur complexe";
    }
  }
  return String(value);
}

function ActionButton(props: {
  label: string;
  icon: LucideIcon;
  tip: string;
  onClick?: () => void;
  primary?: boolean;
  disabled?: boolean;
  spin?: boolean;
  /** Libellé accessible complet (par défaut le libellé visible). */
  aria?: string;
}) {
  const Icon = props.icon;
  return (
    <Hint label={props.tip} disabled={props.disabled} side="top" align={props.primary ? "end" : "center"}>
      <button
        type="button"
        className={`${props.primary ? BTN_PRIMARY : BTN_OUTLINE} ${props.disabled ? "pointer-events-none cursor-not-allowed opacity-50" : ""}`}
        aria-disabled={props.disabled ? true : undefined}
        tabIndex={props.disabled ? -1 : undefined}
        aria-label={props.aria ?? props.label}
        onClick={props.disabled ? undefined : props.onClick}
      >
        <Icon className={`size-4 ${props.spin ? "animate-spin" : ""}`} aria-hidden="true" />
        {props.label}
      </button>
    </Hint>
  );
}

function Notice({ tone, icon: Icon, role, children }: { tone: "ok" | "warn" | "error" | "muted" | "busy"; icon: LucideIcon; role?: "status" | "alert"; children: ReactNode }) {
  const cls = {
    ok: "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/10 dark:text-emerald-200",
    warn: "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200",
    error: "bg-destructive/10 text-destructive",
    muted: "bg-muted text-muted-foreground",
    busy: "bg-amber-50 text-amber-900 dark:bg-amber-500/10 dark:text-amber-200",
  }[tone];
  return (
    <div role={role} className={`flex items-start gap-2 rounded-md px-3 py-2 text-sm ${cls}`}>
      <Icon className={`mt-0.5 size-4 shrink-0 ${tone === "busy" ? "animate-spin" : ""}`} aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function proposalTitle(payload: ProposalPayload): string {
  const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
  switch (payload.type) {
    case "merge_duplicates":
      return `Fusionner ${plural(payload.groups.filter((g) => !g.excluded).length, "groupe", "groupes")} de doublons`;
    case "update_rows":
      return `Modifier ${plural(payload.changes.length, "ligne", "lignes")}`;
    case "delete_rows":
      return `Supprimer ${plural(payload.rows.length, "ligne", "lignes")}`;
    case "create_rows":
      return `Créer ${plural(payload.rows.length, "ligne", "lignes")}`;
  }
}

function Stat({ value, label, warn }: { value: ReactNode; label: string; warn?: boolean }) {
  return (
    <div className={`min-h-14 min-w-0 rounded-lg px-3 py-2 ${warn ? "bg-amber-50 dark:bg-amber-500/10" : "bg-muted"}`}>
      <dd className="truncate text-base font-semibold">{value}</dd>
      <dt className={`truncate text-xs ${warn ? "text-amber-900 dark:text-amber-300" : "text-muted-foreground"}`}>{label}</dt>
    </div>
  );
}

function rowName(labels: Record<string, string>, id: string): string {
  return labels[id] ?? id.slice(0, 8);
}

function MergeDetail({
  payload,
  choices,
  onChoose,
  locked,
  columnNames,
  rowLabels,
}: {
  columnNames: Record<string, string>;
  rowLabels: Record<string, string>;
  payload: Extract<ProposalPayload, { type: "merge_duplicates" }>;
  choices: Record<string, Record<string, string>>;
  onChoose: (groupId: string, columnId: string, rowId: string, valueLabel: string) => void;
  locked: boolean;
}) {
  const groups = payload.groups.filter((g) => !g.excluded);
  return (
    <div className="max-h-72 overflow-auto border-t border-border">
      <table className="w-full table-fixed text-left text-xs">
        <caption className="sr-only">Détail de la fusion, groupe par groupe</caption>
        <thead className="sticky top-0 bg-muted text-muted-foreground">
          <tr>
            <th scope="col" className="w-8 px-2 py-1.5">#</th>
            <th scope="col" className="w-[30%] px-2 py-1.5">Clé ({payload.keyColumnIds.map((c) => columnNames[c] ?? c).join(", ")})</th>
            <th scope="col" className="w-[22%] px-2 py-1.5">Ligne conservée</th>
            <th scope="col" className="w-[18%] px-2 py-1.5">Lignes fusionnées</th>
            <th scope="col" className="px-2 py-1.5">Conflits de valeurs</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g, i) => (
            <tr key={g.groupId} className="border-t border-border align-top">
              <td className="px-2 py-1.5 text-muted-foreground">{i + 1}</td>
              <td className="truncate px-2 py-1.5">{rowLabels[g.keepRowId] ?? g.groupId}</td>
              <td className="truncate px-2 py-1.5 text-emerald-700 dark:text-emerald-300">{rowName(rowLabels, g.keepRowId)}</td>
              <td className="truncate px-2 py-1.5 text-muted-foreground line-through">
                {g.removeRowIds.map((r) => rowName(rowLabels, r)).join(", ")}
              </td>
              <td className="px-2 py-1.5">
                {g.conflicts.length === 0 ? (
                  <span className="text-muted-foreground">Aucun</span>
                ) : (
                  g.conflicts.map((c) => {
                    const current = choices[g.groupId]?.[c.columnId] ?? c.chosenFrom;
                    return (
                      <label key={c.columnId} className="mb-1 block">
                        <span className="block truncate text-muted-foreground">{columnNames[c.columnId] ?? c.columnId}</span>
                        <select
                          className="h-7 w-full truncate rounded-md border border-border bg-background px-1"
                          aria-label={`Valeur retenue pour ${columnNames[c.columnId] ?? c.columnId}, groupe ${i + 1}`}
                          value={current}
                          disabled={locked}
                          onChange={(e) => {
                            const cand = c.candidates.find((k) => k.rowId === e.target.value);
                            onChoose(g.groupId, c.columnId, e.target.value, fmt(cand?.value));
                          }}
                        >
                          {c.candidates.map((cand) => (
                            <option key={cand.rowId} value={cand.rowId}>
                              {fmt(cand.value)} {cand.rowId === g.keepRowId ? "(ligne conservée)" : "(ligne fusionnée)"}
                            </option>
                          ))}
                        </select>
                      </label>
                    );
                  })
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SimpleDetail({ payload, rowLabels }: {
  rowLabels: Record<string, string>; payload: Exclude<ProposalPayload, { type: "merge_duplicates" }> }) {
  const items: string[] =
    payload.type === "update_rows"
      ? payload.changes.map((c) => `${rowName(rowLabels, c.rowId)} : ${Object.keys(c.after).length} cellule(s) modifiée(s)`)
      : payload.type === "delete_rows"
        ? payload.rows.map((r) => `${rowName(rowLabels, r.id)} : ligne supprimée`)
        : payload.rows.map((r, i) => `Ligne ${i + 1} : ${Object.keys(r.cells).length} cellule(s)`);
  return (
    <ul className="max-h-72 space-y-0.5 overflow-auto border-t border-border px-3 py-2 text-xs">
      {items.map((t, i) => (
        <li key={i} className="truncate">{t}</li>
      ))}
    </ul>
  );
}

/** Carte de proposition du fil de chat : l'état fait foi côté serveur (voir `useProposal`). */
export function ProposalCard({ proposalId, fullWidth = false }: { proposalId: string; fullWidth?: boolean }) {
  const { proposal, state, message, busy, apply, dismiss, undo, recompute, refresh } = useProposal(proposalId);
  const [open, setOpen] = useState(false);
  const [choices, setChoices] = useState<Record<string, Record<string, string>>>({});

  // Un recalcul crée une nouvelle proposition : les choix de conflits de l'ancienne ne s'y appliquent plus.
  const [choicesFor, setChoicesFor] = useState<string | null>(null);
  if (proposal && choicesFor !== proposal.id) {
    setChoicesFor(proposal.id);
    if (choicesFor !== null) setChoices({});
  }

  const badge = BADGES[state];
  const BadgeIcon = badge.icon;
  const payload = proposal?.payload ?? null;
  const TypeIcon = payload ? TYPE_ICON[payload.type] : Info;
  const isMerge = payload?.type === "merge_duplicates";
  const muted = state === "dismissed" || state === "expired" || state === "undone";
  const locked = state !== "pending" && state !== "stale";

  function buildBody(): ApplyBody | undefined {
    if (payload?.type !== "merge_duplicates") return undefined;
    const overrides: Record<string, Record<string, string>> = {};
    for (const g of payload.groups) {
      for (const c of g.conflicts) {
        const chosen = choices[g.groupId]?.[c.columnId];
        if (chosen !== undefined && chosen !== c.chosenFrom) {
          (overrides[g.groupId] ??= {})[c.columnId] = chosen;
        }
      }
    }
    return Object.keys(overrides).length > 0 ? { overrides } : undefined;
  }

  function choose(groupId: string, columnId: string, rowId: string, valueLabel: string) {
    setChoices((prev) => ({ ...prev, [groupId]: { ...prev[groupId], [columnId]: rowId } }));
    toast.success(`Valeur retenue : ${valueLabel}`);
  }

  if (state === "loading") {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-label="Chargement de la proposition"
        className={`h-40 w-full ${fullWidth ? "" : "max-w-2xl"} animate-pulse rounded-lg border border-border bg-card p-4`}
      >
        <div className="h-4 w-1/2 rounded bg-muted" />
        <div className="mt-4 h-12 rounded bg-muted" />
      </div>
    );
  }

  if (state === "error" || !proposal || !payload) {
    return (
      <div className={`w-full ${fullWidth ? "" : "max-w-2xl"} space-y-3 rounded-lg border border-border bg-card p-4`} aria-live="polite">
        <Notice tone="error" icon={AlertTriangle} role="alert">
          Proposition illisible ou introuvable. Rien n&apos;a été modifié.
        </Notice>
        <div className="flex justify-end">
          <ActionButton label="Réessayer" icon={RefreshCw} tip="Relire la proposition" onClick={() => void refresh()} />
        </div>
      </div>
    );
  }

  const repat = isMerge
    ? payload.groups.filter((g) => !g.excluded).reduce(
        (a, g) => ({ rel: a.rel + g.repatriation.relationCells, att: a.att + g.repatriation.attachments }),
        { rel: 0, att: 0 },
      )
    : { rel: 0, att: 0 };
  const secondStat =
    payload.type === "update_rows"
      ? { value: payload.changes.reduce((n, c) => n + Object.keys(c.after).length, 0), label: "cellules modifiées" }
      : payload.type === "create_rows"
        ? { value: payload.rows.reduce((n, r) => n + Object.keys(r.cells).length, 0), label: "cellules à écrire" }
        : payload.type === "delete_rows"
          ? { value: proposal.rowCount, label: "lignes supprimées" }
          : { value: proposal.rowCount, label: "lignes à retirer" };
  const undoLabel = isMerge ? "Annuler la fusion" : "Annuler les modifications";

  let notice: ReactNode = null;
  if (state === "applying") {
    notice = (
      <Notice tone="busy" icon={Loader2} role="status">
        Application en cours, veuillez patienter.
      </Notice>
    );
  } else if (state === "applied") {
    notice = (
      <Notice tone="ok" icon={Check} role="status">
        Proposition appliquée sur la base {proposal.databaseName}. L&apos;opération peut être annulée.
      </Notice>
    );
  } else if (state === "undone") {
    notice = (
      <Notice tone="muted" icon={Undo2} role="status">
        Opération annulée, les lignes d&apos;origine sont restaurées.
      </Notice>
    );
  } else if (state === "stale") {
    notice = (
      <Notice tone="warn" icon={AlertTriangle} role="alert">
        Base modifiée depuis la proposition. Rien n&apos;a été modifié : recalculez-la sur les données actuelles.
      </Notice>
    );
  } else if (state === "expired") {
    notice = (
      <Notice tone="muted" icon={CalendarClock}>
        Proposition expirée, rien n&apos;a été modifié. Demandez à l&apos;assistant d&apos;en refaire une.
      </Notice>
    );
  } else if (state === "failed") {
    notice = (
      <Notice tone="error" icon={AlertTriangle} role="alert">
        L&apos;application a échoué{message ? ` : ${message}` : ""}.
      </Notice>
    );
  } else if (state === "dismissed") {
    notice = (
      <Notice tone="muted" icon={X}>
        Proposition ignorée, aucune ligne modifiée.
      </Notice>
    );
  } else if (!proposal.canApply) {
    notice = (
      <Notice tone="muted" icon={Lock}>
        Vous pouvez consulter cette proposition. Modifier la base demande le droit d&apos;édition.
      </Notice>
    );
  }

  const detailLabel = open ? "Masquer le détail" : "Voir le détail";
  const detailTip = open ? "Replier le détail de la proposition" : "Déplier le détail de la proposition";
  const applyDisabled = busy || !proposal.canApply;
  const applyTip = !proposal.canApply
    ? "Droit d'édition requis sur cette base"
    : busy
      ? "Action en cours, veuillez patienter"
      : "Appliquer la proposition (annulable)";

  return (
    <section
      aria-live="polite"
      aria-label={`Proposition : ${proposal.summary}`}
      data-state={state}
      className={`w-full ${fullWidth ? "" : "max-w-2xl"} overflow-hidden rounded-lg border border-border bg-card text-card-foreground ${muted ? "opacity-60" : ""}`}
    >
      <header className="flex h-12 items-center gap-2 border-b border-border px-3">
        <TypeIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold" title={proposal.summary}>
          {proposalTitle(payload)}
        </h3>
        <span className={`inline-flex h-6 shrink-0 items-center gap-1 rounded-full px-2 text-xs font-semibold ${badge.cls}`}>
          <BadgeIcon className={`size-3.5 ${state === "applying" ? "animate-spin" : ""}`} aria-hidden="true" />
          {badge.label}
        </span>
      </header>

      <div className="space-y-2 p-3">
        <p className="truncate text-xs text-muted-foreground">Base : {proposal.databaseName || "inconnue"}</p>
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Stat
            value={isMerge ? payload.groups.filter((g) => !g.excluded).length : proposal.rowCount}
            label={isMerge ? "groupes de doublons" : "lignes concernées"}
          />
          <Stat value={secondStat.value} label={secondStat.label} />
          <Stat value={proposal.conflictCount} label="conflits de valeurs" warn={proposal.conflictCount > 0} />
        </dl>
        {isMerge && proposal.conflictCount > 0 ? (
          <p className="text-xs text-muted-foreground">
            Les conflits sont pré-tranchés (valeur de la ligne conservée). Modifiez-les dans le détail si besoin : ils ne bloquent jamais l&apos;application.
          </p>
        ) : null}
        {isMerge && (repat.rel > 0 || repat.att > 0) ? (
          <p className="text-xs text-muted-foreground">
            Relations et pièces jointes rapatriées : {repat.rel} relation(s), {repat.att} pièce(s) jointe(s) sur les lignes conservées.
          </p>
        ) : null}
        {notice}
      </div>

      {open ? (
        isMerge ? (
          <MergeDetail columnNames={proposal.columnNames} rowLabels={proposal.rowLabels} payload={payload} choices={choices} onChoose={choose} locked={locked} />
        ) : (
          <SimpleDetail rowLabels={proposal.rowLabels} payload={payload as Exclude<ProposalPayload, { type: "merge_duplicates" }>} />
        )
      ) : null}

      <footer className="flex h-12 items-center gap-2 border-t border-border px-3">
        <ActionButton
          label={detailLabel}
          icon={open ? EyeOff : Eye}
          tip={detailTip}
          aria={open ? "Masquer le détail de la proposition" : "Voir le détail de la proposition"}
          onClick={() => setOpen((o) => !o)}
        />
        <span className="flex-1" />
        {state === "applied" ? (
          <ActionButton
            label={undoLabel}
            icon={Undo2}
            tip="Restaurer les lignes et les valeurs d'origine"
            disabled={busy}
            onClick={() => void undo()}
          />
        ) : null}
        {state === "stale" ? (
          <>
            <ActionButton label="Ignorer" icon={X} tip="Ignorer la proposition, la base reste inchangée" disabled={busy} onClick={() => void dismiss()} />
            <ActionButton label="Recalculer" icon={RefreshCw} tip="Relire la base et recalculer la proposition" primary disabled={busy} onClick={() => void recompute()} />
          </>
        ) : null}
        {state === "failed" ? (
          <>
            <ActionButton
              label="Ignorer"
              icon={X}
              tip="Ignorer la proposition, la base reste inchangée"
              aria="Ignorer la proposition échouée"
              disabled={busy}
              onClick={() => void dismiss()}
            />
            {payload.type !== "create_rows" ? (
              <ActionButton
                label="Recalculer"
                icon={RefreshCw}
                tip="Relire la base et recalculer la proposition"
                aria="Recalculer la proposition échouée"
                primary
                disabled={busy}
                onClick={() => void recompute()}
              />
            ) : null}
          </>
        ) : null}
        {state === "pending" || state === "applying" ? (
          <>
            <ActionButton
              label="Ignorer"
              icon={X}
              tip={state === "applying" ? "Impossible pendant l'application" : "Ignorer la proposition, la base reste inchangée"}
              disabled={busy || state === "applying"}
              onClick={() => void dismiss()}
            />
            <ActionButton
              label={state === "applying" ? "Application..." : "Appliquer"}
              aria={proposal.canApply ? undefined : "Appliquer, indisponible : droit d'édition requis"}
              icon={state === "applying" ? Loader2 : isMerge ? GitMerge : Check}
              spin={state === "applying"}
              tip={state === "applying" ? "Application en cours, veuillez patienter" : applyTip}
              primary
              disabled={applyDisabled || state === "applying"}
              onClick={() => void apply(buildBody())}
            />
          </>
        ) : null}
      </footer>
    </section>
  );
}
