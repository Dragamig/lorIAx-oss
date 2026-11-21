"use client";

import {
  AlertTriangle,
  Briefcase,
  Check,
  Database,
  FilePlus2,
  Link2,
  Lock,
  MessageCircle,
  Plus,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { Skeleton } from "@/components/ui/skeleton";
import { getCrmAction } from "@/lib/crm/actions";
import type { Candidate } from "@/lib/crm/connection";
import { CRM_FIELDS, type CrmRole } from "@/lib/crm/fields";
import type { ActivationPreview } from "@/lib/crm/preview";
import { cn } from "@/lib/utils";
import { CrmActionButton } from "./crm-states";
import { availableModes, collisionOf, takenBy, type ActivationState, type RoleMode } from "./activation-state";

/** Classe unique des trois tuiles : même largeur, même hauteur, pied de hauteur fixe. */
export const TILE_CLASS =
  "flex h-[440px] min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-background";

const ROLE_ICONS: Record<CrmRole, LucideIcon> = { contacts: Users, dossiers: Briefcase, interactions: MessageCircle };
const MODE_ICONS: Record<RoleMode, LucideIcon> = { connect: Link2, complete: Wrench, create: FilePlus2 };
const MODES: RoleMode[] = ["connect", "complete", "create"];

const STATUS_KEYS = ["new", "qualify", "quoteSent", "waitingClient", "atManufacturer", "sampleInProgress", "won", "lost", "dropped"];
const TYPE_KEYS = ["call", "mail", "meeting", "note"];

/** Relations jumelées du modèle : `a` porte la relation requise, `b` reçoit la colonne inverse. */
export const RELATION_PAIRS = [
  { a: "dossiers", b: "contacts", fieldKey: "contact", inverseKey: "contactDossiers" },
  { a: "interactions", b: "dossiers", fieldKey: "dossier", inverseKey: "dossierInteractions" },
] as const satisfies readonly { a: CrmRole; b: CrmRole; fieldKey: string; inverseKey: string }[];
export type RelationPair = (typeof RELATION_PAIRS)[number];

export interface AddedColumn {
  key: string;
  name: string;
  type: string;
  required: boolean;
  target?: CrmRole;
  options?: string[];
  inverse?: boolean;
  /** Colonne existante de mauvais type, laissée telle quelle : la colonne neuve est ajoutée à côté. */
  beside?: { name: string; type: string };
}

type Translate = (key: string, values?: Record<string, string | number>) => string;

export function candidateOf(role: CrmRole, state: ActivationState, preview: ActivationPreview): Candidate | null {
  const { mode, databaseId } = state.roles[role];
  if (mode === "create" || !databaseId) return null;
  return preview.roles[role].candidates.find((c) => c.databaseId === databaseId) ?? null;
}

/** Une relation est créée côté `a` (relation requise) et côté `b` (colonne inverse) selon les choix. */
export function relationSides(pair: RelationPair, state: ActivationState, preview: ActivationPreview) {
  const a = state.roles[pair.a];
  const b = state.roles[pair.b];
  const ca = candidateOf(pair.a, state, preview);
  const cb = candidateOf(pair.b, state, preview);
  const aNew = a.mode === "create" || (a.mode === "complete" && !!ca?.missing.some((m) => m.fieldKey === pair.fieldKey));
  const bNew =
    b.mode === "create" ||
    a.mode === "create" ||
    !cb?.columns.some((c) => c.type === "relation" && c.targetDatabaseId === a.databaseId);
  return { aNew, bNew };
}

function optionsOf(role: CrmRole, key: string, t: Translate): string[] | undefined {
  if (role === "dossiers" && key === "statut") return STATUS_KEYS.map((k) => t(`template.statusOptions.${k}`));
  if (role === "interactions" && key === "type") return TYPE_KEYS.map((k) => t(`template.typeOptions.${k}`));
  return undefined;
}

/** Colonnes ajoutées pour un rôle : toutes en création, les manquantes en complétion, l'inverse au besoin. */
export function addedColumns(role: CrmRole, state: ActivationState, preview: ActivationPreview, t: Translate): AddedColumn[] {
  const mode = state.roles[role].mode;
  const out: AddedColumn[] = [];
  const defOf = (key: string) => CRM_FIELDS[role].find((f) => f.key === key);
  if (mode === "create") {
    for (const f of CRM_FIELDS[role]) {
      out.push({
        key: f.key,
        name: t(`fields.${role}.${f.key}`),
        type: f.types[0],
        required: f.required,
        target: f.relationTargetRole,
        options: optionsOf(role, f.key, t),
      });
    }
  } else if (mode === "complete") {
    const cand = candidateOf(role, state, preview);
    for (const m of cand?.missing ?? []) {
      const def = defOf(m.fieldKey);
      const existing = m.cause === "wrong_type" ? cand?.columns.find((c) => c.name === m.existingName) : undefined;
      out.push({
        key: m.fieldKey,
        name: m.name,
        type: m.type,
        required: !!def?.required,
        target: def?.relationTargetRole,
        options: optionsOf(role, m.fieldKey, t),
        beside: m.existingName ? { name: m.existingName, type: existing?.type ?? "" } : undefined,
      });
    }
  }
  for (const pair of RELATION_PAIRS) {
    if (pair.b === role && relationSides(pair, state, preview).bNew) {
      out.push({
        key: `inverse-${pair.inverseKey}`,
        name: t(`template.inverseNames.${pair.inverseKey}`),
        type: "relation",
        required: false,
        target: pair.a,
        inverse: true,
      });
    }
  }
  return out;
}

const tagBase = "inline-flex min-h-[18px] shrink-0 items-center rounded border px-1.5 text-[11px] whitespace-nowrap";
const tagTone = {
  plain: "border-border text-muted-foreground",
  ok: "border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
  warn: "border-transparent bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300",
  new: "border-transparent bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300",
};
export function Tag({ tone = "plain", className, children }: { tone?: keyof typeof tagTone; className?: string; children: React.ReactNode }) {
  return <span className={cn(tagBase, tagTone[tone], className)}>{children}</span>;
}

function SectionHead({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <div className="mt-2 mb-1 flex items-center gap-1.5 text-[11px] font-bold tracking-wide text-muted-foreground uppercase first:mt-0.5">
      <Icon className="size-3.5" aria-hidden="true" />
      {children}
    </div>
  );
}

function Notice({
  icon: Icon,
  tone,
  children,
  alert,
}: {
  icon: LucideIcon;
  tone?: "warn";
  children: React.ReactNode;
  alert?: boolean;
}) {
  return (
    <div
      role={alert ? "alert" : undefined}
      className={cn(
        "mt-1.5 flex items-start gap-1.5 rounded-md px-2 py-1.5 text-xs leading-snug",
        tone === "warn" ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300" : "bg-muted text-foreground",
      )}
    >
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function ColumnRow({ col }: { col: AddedColumn }) {
  const t = useTranslations("crm");
  const typeLabel = col.target
    ? t("activation.tile.relationTo", { type: t("types.relation"), target: t(`roles.${col.target}.label`) })
    : t(`types.${col.type}`);
  const tags = (
    <>
      <Tag>{typeLabel}</Tag>
      {col.required && <Tag tone="warn">{t("activation.tile.required")}</Tag>}
      {col.inverse && <Tag tone="new">{t("activation.tile.inverse")}</Tag>}
    </>
  );
  const rowCls = "flex min-h-7 flex-col justify-center rounded-md px-1.5 py-0.5 text-[13px] odd:bg-muted/60 outline-none focus-visible:ring-2 focus-visible:ring-ring";
  const head = (
    <div className="flex min-h-6 items-center gap-1.5">
      <span className="min-w-0 flex-1 truncate">{col.name}</span>
      {tags}
    </div>
  );
  if (col.options) {
    const all = col.options.join(", ");
    return (
      <Tip label={t("activation.tile.optionsTip", { options: all })}>
        <div tabIndex={0} aria-label={t("activation.tile.columnAria", { name: col.name, type: typeLabel, options: all })} className={rowCls}>
          {head}
          <div className="truncate text-[11px] text-muted-foreground">{all}</div>
        </div>
      </Tip>
    );
  }
  if (col.beside) {
    const type = t(`types.${col.beside.type}`);
    return (
      <Tip label={t("activation.recap.besideTip", { name: col.beside.name, type })}>
        <div
          tabIndex={0}
          aria-label={t("activation.recap.besideAria", { column: col.name, name: col.beside.name, type })}
          className={rowCls}
        >
          {head}
          <div className="truncate text-[11px] text-muted-foreground">{t("activation.recap.beside", { name: col.beside.name, type })}</div>
        </div>
      </Tip>
    );
  }
  return <div className={rowCls}>{head}</div>;
}

function ModeButton({
  role,
  mode,
  pressed,
  availability,
  onClick,
}: {
  role: CrmRole;
  mode: RoleMode;
  pressed: boolean;
  availability: { ok: boolean; reason?: string; reasonValues?: Record<string, string> };
  onClick: () => void;
}) {
  const t = useTranslations("crm");
  const Icon = MODE_ICONS[mode];
  const roleLabel = t(`roles.${role}.label`);
  const modeLabel = t(`activation.mode.${mode}`);
  const reason = availability.ok ? undefined : t(availability.reason as string, availability.reasonValues);
  return (
    <Tip label={reason ?? t(`activation.mode.${mode}Tip`)}>
      <button
        type="button"
        data-action="activation.setMode"
        data-mode={mode}
        aria-pressed={pressed}
        aria-disabled={availability.ok ? undefined : true}
        aria-label={
          availability.ok
            ? t("activation.mode.optionAria", { mode: modeLabel, role: roleLabel })
            : t("activation.mode.unavailableAria", { mode: modeLabel, role: roleLabel, reason: reason as string })
        }
        onClick={availability.ok ? onClick : undefined}
        className="inline-flex h-7 min-w-6 flex-1 items-center justify-center gap-1 rounded-md px-1 text-xs font-semibold whitespace-nowrap text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-[0_0_0_1px_var(--border)]"
      >
        <Icon className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{modeLabel}</span>
      </button>
    </Tip>
  );
}

function BaseList({
  role,
  mode,
  state,
  preview,
  onPick,
}: {
  role: CrmRole;
  mode: "connect" | "complete";
  state: ActivationState;
  preview: ActivationPreview;
  onPick: (id: string) => void;
}) {
  const t = useTranslations("crm");
  const pickAction = getCrmAction("activation.pickBase");
  const PickIcon = pickAction.icon;
  const status = mode === "connect" ? "compatible" : "almost";
  const list = preview.roles[role].candidates.filter((c) => c.status === status);
  const roleLabel = t(`roles.${role}.label`);
  if (list.length === 0) return <p className="px-1 text-xs text-muted-foreground">{t("activation.tile.noCandidate")}</p>;
  return (
    <div role="group" aria-label={t(`activation.tile.${mode}GroupAria`, { role: roleLabel })} className="flex flex-col gap-1">
      {list.map((c) => {
        const by = takenBy(c.databaseId, role, state);
        const on = state.roles[role].databaseId === c.databaseId;
        const score = String(Math.round((c.score / CRM_FIELDS[role].length) * 100));
        const byLabel = by ? t(`roles.${by}.label`) : "";
        return (
          <Tip
            key={c.databaseId}
            label={by ? t("activation.tile.takenTip", { role: byLabel }) : t(pickAction.tipKey as string, { name: c.name })}
          >
            <button
              type="button"
              data-action="activation.pickBase"
              aria-pressed={on}
              aria-disabled={by ? true : undefined}
              aria-label={
                by
                  ? t("activation.tile.candidateTakenAria", { name: c.name, space: c.spaceName, score, role: byLabel })
                  : t("activation.tile.candidateAria", { name: c.name, space: c.spaceName, score })
              }
              onClick={by ? undefined : () => onPick(c.databaseId)}
              className="group flex h-[42px] w-full items-center gap-2 rounded-lg border border-border bg-background px-2 text-left text-[13px] outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-ring aria-pressed:bg-accent aria-disabled:cursor-not-allowed aria-disabled:opacity-55 aria-disabled:hover:bg-background"
            >
              {on ? <Check className="size-3.5 shrink-0" aria-hidden="true" /> : <PickIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                <b className="block truncate font-semibold">{c.name}</b>
                <span className="block truncate text-[11px] text-muted-foreground group-aria-pressed:text-foreground">
                  {by ? t("activation.tile.candidateSubTaken", { space: c.spaceName, role: byLabel }) : c.spaceName}
                </span>
              </span>
              <Tag tone={Number(score) >= 90 ? "ok" : "plain"} className="group-aria-pressed:text-foreground">{t("activation.tile.score", { score })}</Tag>
            </button>
          </Tip>
        );
      })}
    </div>
  );
}

function Relations({ role, state, preview }: { role: CrmRole; state: ActivationState; preview: ActivationPreview }) {
  const t = useTranslations("crm");
  const pairs = RELATION_PAIRS.filter((p) => p.a === role || p.b === role);
  if (pairs.length === 0) return null;
  const tag = (isNew: boolean) => <Tag tone={isNew ? "new" : "ok"}>{t(isNew ? "activation.tile.relationCreated" : "activation.tile.relationExisting")}</Tag>;
  return (
    <>
      <SectionHead icon={Link2}>{t("activation.tile.relations")}</SectionHead>
      {pairs.map((p) => {
        const s = relationSides(p, state, preview);
        const left = `${t(`roles.${p.a}.label`)}.${t(`fields.${p.a}.${p.fieldKey}`)}`;
        const right = `${t(`roles.${p.b}.label`)}.${t(`template.inverseNames.${p.inverseKey}`)}`;
        return (
          <div key={p.fieldKey} className="mb-1 flex flex-col gap-0.5 rounded-md border border-border px-1.5 py-1 text-xs">
            <div className="flex min-h-5 items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate">{left}</span>
              {tag(s.aNew)}
            </div>
            <div className="flex min-h-5 items-center gap-1.5">
              <span className="min-w-0 flex-1 truncate">{right}</span>
              {tag(s.bNew)}
            </div>
          </div>
        );
      })}
    </>
  );
}

export interface ActivationRoleTileProps {
  role: CrmRole;
  state: ActivationState;
  preview: ActivationPreview;
  spaceName: string;
  onMode: (role: CrmRole, mode: RoleMode) => void;
  onPick: (role: CrmRole, databaseId: string) => void;
  onAdopt: (role: CrmRole) => void;
  /** Message du serveur à afficher sous la tuile (409 : nom déjà pris). */
  notice?: string;
}

export function ActivationRoleTile({ role, state, preview, spaceName, onMode, onPick, onAdopt, notice }: ActivationRoleTileProps) {
  const t = useTranslations("crm");
  const RoleIcon = ROLE_ICONS[role];
  const roleLabel = t(`roles.${role}.label`);
  const mode = state.roles[role].mode;
  const modes = availableModes(role, state, preview);
  const added = addedColumns(role, state, preview, t);
  const collision = mode === "create" ? collisionOf(role, preview, state.spaceId) : null;
  const adoptTarget = collision ? preview.roles[role].candidates.find((c) => c.databaseId === collision.databaseId) : undefined;
  const canAdopt = !!adoptTarget && adoptTarget.status !== "none" && takenBy(adoptTarget.databaseId, role, state) === null;
  const cand = candidateOf(role, state, preview);
  const hasWrongType = !!cand?.missing.some((m) => m.cause === "wrong_type");
  const baseName = t(`template.databases.${role}`);
  const newSpace = state.spaceId === "create";

  return (
    <section aria-label={roleLabel} data-testid={`activation-role-${role}`} className={TILE_CLASS}>
      <div className="flex h-[54px] flex-none items-center gap-2.5 border-b border-border px-3">
        <span className="flex size-7 flex-none items-center justify-center rounded-lg bg-sky-100 text-sky-900 dark:bg-sky-950 dark:text-sky-300">
          <RoleIcon className="size-4" aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block truncate text-sm">{roleLabel}</b>
          <span className="block truncate text-xs text-muted-foreground">{t(`roles.${role}.description`)}</span>
        </span>
      </div>
      <div
        role="group"
        aria-label={t(getCrmAction("activation.setMode").labelKey, { role: roleLabel })}
        className="mx-2.5 mt-2 flex h-[34px] flex-none items-center gap-0.5 rounded-lg border border-border bg-muted p-0.5"
      >
        {MODES.map((m) => (
          <ModeButton key={m} role={role} mode={m} pressed={mode === m} availability={modes[m]} onClick={() => onMode(role, m)} />
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-2.5 pt-2 pb-2.5">
        {mode === "connect" && (
          <>
            <SectionHead icon={Database}>{t("activation.tile.compatibleBases")}</SectionHead>
            <BaseList role={role} mode="connect" state={state} preview={preview} onPick={(id) => onPick(role, id)} />
            {added.length > 0 ? (
              <>
                <SectionHead icon={Plus}>{t("activation.tile.inverseAdded")}</SectionHead>
                {added.map((c) => <ColumnRow key={c.key} col={c} />)}
              </>
            ) : (
              <Notice icon={Check}>{t("activation.tile.noColumnAdded")}</Notice>
            )}
          </>
        )}
        {mode === "complete" && (
          <>
            <SectionHead icon={Database}>{t("activation.tile.almostBases")}</SectionHead>
            <BaseList role={role} mode="complete" state={state} preview={preview} onPick={(id) => onPick(role, id)} />
            <SectionHead icon={Plus}>{t("activation.tile.columnsAdded", { count: added.length })}</SectionHead>
            {added.map((c) => <ColumnRow key={c.key} col={c} />)}
            <Notice icon={Lock}>
              {t(hasWrongType ? "activation.tile.untouchedNeverConverted" : "activation.tile.untouched")}
            </Notice>
          </>
        )}
        {mode === "create" && (
          <>
            <Notice icon={FilePlus2}>
              {t(newSpace ? "activation.tile.createdInNew" : "activation.tile.createdIn", { name: baseName, space: spaceName })}
            </Notice>
            {collision && (
              <Notice icon={AlertTriangle} tone="warn" alert>
                <div>{t("activation.tile.collision", { name: collision.name, space: spaceName })}</div>
                {canAdopt && (
                  <CrmActionButton
                    actionId="activation.adopt"
                    label={t(getCrmAction("activation.adopt").labelKey)}
                    tip={t(getCrmAction("activation.adopt").tipKey as string, { name: collision.name })}
                    ariaLabel={t(getCrmAction("activation.adopt").labelKey)}
                    onClick={() => onAdopt(role)}
                    className="mt-1"
                  />
                )}
              </Notice>
            )}
            <SectionHead icon={Plus}>{t("activation.tile.baseColumns", { count: added.length })}</SectionHead>
            {added.map((c) => <ColumnRow key={c.key} col={c} />)}
          </>
        )}
        <Relations role={role} state={state} preview={preview} />
        {notice && (
          <Notice icon={AlertTriangle} tone="warn" alert>
            {notice}
          </Notice>
        )}
      </div>
    </section>
  );
}

export function ActivationTileSkeleton({ role }: { role: CrmRole }) {
  const t = useTranslations("crm");
  return (
    <section aria-busy="true" aria-label={t("activation.tile.loadingAria", { role: t(`roles.${role}.label`) })} className={TILE_CLASS}>
      <div className="flex h-[54px] flex-none items-center gap-2.5 border-b border-border px-3">
        <Skeleton className="size-7" />
        <Skeleton className="h-3.5 w-28" />
      </div>
      <div className="space-y-2 p-2.5">
        <Skeleton className="h-8" />
        <Skeleton className="h-[42px]" />
        <Skeleton className="h-[42px]" />
        <Skeleton className="h-6" />
        <Skeleton className="h-6" />
        <Skeleton className="h-6" />
      </div>
    </section>
  );
}

