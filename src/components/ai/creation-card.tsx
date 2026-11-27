"use client";

import { useId, useState, type ReactElement } from "react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Check,
  FileText,
  Folder,
  Info,
  Loader2,
  Lock,
  Pencil,
  Presentation,
  Table2,
  Undo2,
  X,
  ExternalLink,
  type LucideIcon,
} from "lucide-react";
import { Hint } from "@/components/ui/hint";
import type { CreationOverrides } from "@/lib/ai/creation/schemas";
import type { CreationView } from "@/lib/ai/creation-view-types";
import { useCreationProposal, type CreationState } from "./use-creation-proposal";
import { OutlinePreview, SlidesPreview, SpreadsheetPreview } from "./creation-previews";

const KIND_ICON: Record<CreationView["kind"], LucideIcon> = {
  spreadsheet: Table2,
  document: FileText,
  presentation: Presentation,
};

const BADGE: Record<CreationState, { icon: LucideIcon; cls: string }> = {
  loading: { icon: Loader2, cls: "bg-muted text-muted-foreground" },
  pending: { icon: Info, cls: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300" },
  applying: { icon: Loader2, cls: "bg-amber-100 text-amber-900 dark:bg-amber-500/15 dark:text-amber-300" },
  applied: { icon: Check, cls: "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-300" },
  dismissed: { icon: X, cls: "bg-muted text-muted-foreground" },
  denied: { icon: X, cls: "bg-muted text-muted-foreground" },
  undone: { icon: Undo2, cls: "bg-muted text-muted-foreground" },
  failed: { icon: AlertTriangle, cls: "bg-destructive/10 text-destructive" },
  expired: { icon: X, cls: "bg-muted text-muted-foreground" },
  error: { icon: AlertTriangle, cls: "bg-destructive/10 text-destructive" },
};

const BTN =
  "inline-flex h-8 min-w-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";
const BTN_PRIMARY = `${BTN} border-transparent bg-primary text-primary-foreground hover:bg-primary/90`;
const BTN_OUTLINE = `${BTN} border-border bg-background hover:bg-muted`;
const BTN_GHOST = `${BTN} border-transparent hover:bg-muted`;
const FIELD =
  "min-h-8 w-full rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

function CardButton({
  label,
  tip,
  ariaLabel,
  icon: Icon,
  className,
  disabled,
  expanded,
  onClick,
}: {
  label: string;
  tip: string;
  ariaLabel?: string;
  icon: LucideIcon;
  className: string;
  disabled?: boolean;
  expanded?: boolean;
  onClick: () => void;
}): ReactElement {
  return (
    <Hint label={tip} disabled={disabled}>
      <button
        type="button"
        className={className}
        aria-label={ariaLabel ?? tip}
        aria-expanded={expanded}
        disabled={disabled}
        onClick={onClick}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        {label}
      </button>
    </Hint>
  );
}

function lines(s: string): string[] {
  return s.split("\n").map((l) => l.trim()).filter(Boolean);
}

/** Carte de proposition de création du fil de chat : l'état fait foi côté serveur (voir `useCreationProposal`). */
export function CreationCard({ proposalId }: { proposalId: string }) {
  const t = useTranslations("chat.creation");
  const { creation, state, message, busy, apply, dismiss, restore, undo, refresh } = useCreationProposal(proposalId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ title: string; spaceId: string; columns: string; outline: string; slides: string } | null>(null);
  const uid = useId();

  const wrap = "w-full max-w-2xl";

  if (state === "loading") {
    return (
      <div role="status" aria-live="polite" aria-label={t("loading")} className={`h-40 ${wrap} animate-pulse rounded-xl border border-border bg-card p-4`}>
        <div className="h-4 w-1/2 rounded bg-muted" />
        <div className="mt-4 h-12 rounded bg-muted" />
      </div>
    );
  }

  if (state === "error" || !creation) {
    return (
      <div className={`${wrap} space-y-3 rounded-xl border border-border bg-card p-4`} aria-live="polite">
        <div role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{t("loadError")}</span>
        </div>
        <div className="flex justify-end">
          <CardButton label={t("retry")} tip={t("retryTip")} icon={Info} className={BTN_OUTLINE} onClick={() => void refresh()} />
        </div>
      </div>
    );
  }

  const { preview } = creation;
  const KindIcon = KIND_ICON[creation.kind];
  const badge = BADGE[state];
  const BadgeIcon = badge.icon;
  const kindLabel = t(`kind.${creation.kind}`);
  const d = draft ?? {
    title: creation.title,
    spaceId: creation.spaceId,
    columns: preview.kind === "spreadsheet" ? preview.columns.map((c) => c.name).join(", ") : "",
    outline: preview.kind === "document" ? preview.outline.map((o) => o.heading).join("\n") : "",
    slides: preview.kind === "presentation" ? preview.slides.map((s) => s.title).join("\n") : "",
  };
  const set = (patch: Partial<typeof d>) => setDraft({ ...d, ...patch });

  const spaceChanged = d.spaceId !== creation.spaceId && creation.editableSpaces.some((s) => s.id === d.spaceId);
  const spaceName = creation.editableSpaces.find((s) => s.id === d.spaceId)?.name ?? creation.spaceName;
  const denied = state === "denied";
  // Refusée : un autre espace éditeur choisi dans le panneau lève le blocage.
  const createDisabled = busy || (denied && !spaceChanged);
  const locked = state !== "pending" && state !== "denied";
  const muted = state === "dismissed" || state === "undone" || state === "expired";

  function buildOverrides(): CreationOverrides | undefined {
    const o: CreationOverrides = {};
    const title = d.title.trim();
    if (title && title !== creation!.title) o.title = title;
    if (spaceChanged) o.spaceId = d.spaceId;
    if (preview.kind === "spreadsheet") {
      const cols = d.columns.split(",").map((c) => c.trim()).filter(Boolean);
      if (cols.join("\u0000") !== preview.columns.map((c) => c.name).join("\u0000") && cols.length > 0) {
        o.columns = cols.map((name, i) => ({ name, ...(preview.columns[i]?.type ? { type: preview.columns[i].type } : {}) }));
      }
    }
    if (preview.kind === "document") {
      const ls = lines(d.outline);
      if (ls.join("\u0000") !== preview.outline.map((x) => x.heading).join("\u0000") && ls.length > 0) {
        o.outline = ls.map((heading, i) => ({ heading, level: preview.outline[i]?.level ?? 2 }));
      }
    }
    if (preview.kind === "presentation") {
      const ls = lines(d.slides);
      if (ls.join("\u0000") !== preview.slides.map((x) => x.title).join("\u0000") && ls.length > 0) {
        o.slideTitles = ls;
      }
    }
    return Object.keys(o).length > 0 ? o : undefined;
  }

  const createTip = createDisabled
    ? busy
      ? t("createBusy")
      : t("deniedTip", { name: creation.spaceName })
    : t("createTip", { kind: kindLabel });

  return (
    <article
      aria-label={t(`cardLabel.${creation.kind}`)}
      data-state={state}
      className={`${wrap} overflow-hidden rounded-xl border border-border bg-card ${muted ? "opacity-80" : ""}`}
    >
      <header className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
        <KindIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate font-semibold">{creation.title}</span>
        <span
          className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${badge.cls}`}
          aria-live="polite"
        >
          <BadgeIcon className={`h-3.5 w-3.5 ${state === "applying" ? "animate-spin" : ""}`} aria-hidden="true" />
          {t(`status.${state}`)}
        </span>
      </header>

      <div className="space-y-2.5 px-3.5 py-3">
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <Folder className="h-3.5 w-3.5" aria-hidden="true" />
            {t("space", { name: creation.spaceName })}
          </span>
          {preview.kind === "spreadsheet" && (
            <>
              <span>{t("sheetCount")}</span>
              <span>{t("columnCount", { count: String(preview.columns.length) })}</span>
              <span>{t("rowCount", { count: String(preview.rowCount) })}</span>
            </>
          )}
          {preview.kind === "document" && (
            <>
              <span>{t("visibility.label", { value: t(`visibility.${preview.visibility}`) })}</span>
              <span>{t("sectionCount", { count: String(preview.outline.length) })}</span>
            </>
          )}
          {preview.kind === "presentation" && <span>{t("slideCount", { count: String(preview.slides.length) })}</span>}
        </div>

        {preview.kind === "spreadsheet" && <SpreadsheetPreview preview={preview} />}
        {preview.kind === "document" && <OutlinePreview preview={preview} />}
        {preview.kind === "presentation" && <SlidesPreview preview={preview} />}

        {denied && (
          <div role="status" className="flex items-start gap-2 rounded-lg bg-amber-100 px-3 py-2 text-[13px] text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">
            <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{message ? t("refusedNotice", { message }) : t("deniedNotice", { name: creation.spaceName })}</span>
          </div>
        )}
        {state === "failed" && message && (
          <div role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{message}</span>
          </div>
        )}
      </div>

      {editing && !locked && (
        <div className="flex flex-col gap-2.5 border-t border-dashed border-border px-3.5 py-3">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <div>
              <label htmlFor={`${uid}-title`} className="text-xs font-semibold text-muted-foreground">{t("edit_form.title")}</label>
              <input id={`${uid}-title`} className={FIELD} value={d.title} maxLength={200} onChange={(e) => set({ title: e.target.value })} />
            </div>
            <div>
              <label htmlFor={`${uid}-space`} className="text-xs font-semibold text-muted-foreground">{t("edit_form.space")}</label>
              <select id={`${uid}-space`} className={FIELD} value={d.spaceId} onChange={(e) => set({ spaceId: e.target.value })}>
                {!creation.editableSpaces.some((s) => s.id === creation.spaceId) && (
                  <option value={creation.spaceId} disabled>{creation.spaceName}</option>
                )}
                {creation.editableSpaces.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
          </div>
          {preview.kind === "spreadsheet" && (
            <div>
              <label htmlFor={`${uid}-cols`} className="text-xs font-semibold text-muted-foreground">{t("edit_form.columns")}</label>
              <input id={`${uid}-cols`} className={FIELD} value={d.columns} onChange={(e) => set({ columns: e.target.value })} />
            </div>
          )}
          {preview.kind === "document" && (
            <div>
              <label htmlFor={`${uid}-outline`} className="text-xs font-semibold text-muted-foreground">{t("edit_form.outline")}</label>
              <textarea id={`${uid}-outline`} className={FIELD} rows={4} value={d.outline} onChange={(e) => set({ outline: e.target.value })} />
            </div>
          )}
          {preview.kind === "presentation" && (
            <div>
              <label htmlFor={`${uid}-slides`} className="text-xs font-semibold text-muted-foreground">{t("edit_form.slides")}</label>
              <textarea id={`${uid}-slides`} className={FIELD} rows={4} value={d.slides} onChange={(e) => set({ slides: e.target.value })} />
            </div>
          )}
        </div>
      )}

      <footer className="flex flex-wrap items-center gap-2 border-t border-border bg-muted px-3.5 py-2.5">
        {(state === "pending" || state === "denied" || state === "applying") && (
          <>
            <CardButton
              label={t("create")}
              tip={createTip}
              ariaLabel={createDisabled && !busy ? t("createDisabledLabel") : undefined}
              icon={state === "applying" ? Loader2 : Check}
              className={BTN_PRIMARY}
              disabled={createDisabled}
              onClick={() => void apply(buildOverrides())}
            />
            <CardButton
              label={denied ? t("changeSpace") : t("edit")}
              tip={denied ? t("changeSpaceTip") : t("editTip")}
              icon={denied ? Folder : Pencil}
              className={BTN_OUTLINE}
              disabled={busy}
              expanded={editing}
              onClick={() => setEditing((v) => !v)}
            />
            <CardButton
              label={t("dismiss")}
              tip={t("dismissTip")}
              icon={X}
              className={BTN_GHOST}
              disabled={busy}
              onClick={() => void dismiss()}
            />
          </>
        )}
        {state === "dismissed" && (
          <CardButton
            label={t("restore")}
            tip={t("restoreTip")}
            icon={Undo2}
            className={BTN_OUTLINE}
            disabled={busy}
            onClick={() => void restore()}
          />
        )}
        {state === "applied" && (
          <>
            <span className="inline-flex items-center gap-2 text-[13px]">
              <Check className="h-4 w-4 text-emerald-700 dark:text-emerald-400" aria-hidden="true" />
              {t("createdIn", { name: spaceName })}
              {creation.result && (
                <Hint label={t(`open.${creation.kind}`)}>
                  <a
                    href={creation.result.href}
                    aria-label={t(`open.${creation.kind}`)}
                    className="inline-flex min-h-6 items-center gap-1 font-semibold text-blue-700 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:text-blue-300"
                  >
                    <ExternalLink className="h-4 w-4" aria-hidden="true" />
                    {t(`open.${creation.kind}`)}
                  </a>
                </Hint>
              )}
            </span>
            <span className="flex-1" />
            <CardButton
              label={t("undoCreation")}
              tip={t("undoCreationTip")}
              icon={Undo2}
              className={BTN_GHOST}
              disabled={busy}
              onClick={() => void undo()}
            />
          </>
        )}
      </footer>
    </article>
  );
}
