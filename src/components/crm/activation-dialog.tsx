"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Folder } from "lucide-react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { refreshCrmStatus } from "@/lib/crm/use-crm-status";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { getCrmAction } from "@/lib/crm/actions";
import { CRM_ROLES, type CrmActivateBodyV2, type CrmRole } from "@/lib/crm/fields";
import type { ActivationPreview } from "@/lib/crm/preview";
import { useOrganization } from "@/lib/org/organization-context";
import { buildOrgUrl } from "@/lib/org/org-url";
import { cn } from "@/lib/utils";
import { ActivationProgress } from "./activation-progress";
import { ActivationUndoToast } from "./activation-undo-toast";
import { saveActivationHandoff } from "./activation-handoff";
import { ActivationRecap } from "./activation-recap";
import { ActivationRoleTile, ActivationTileSkeleton, addedColumns } from "./activation-role-tile";
import {
  collisionOf,
  initialState,
  invalidRoles,
  isSpaceSelectorDisabled,
  missingBases,
  takenBy,
  toRequestBody,
  type ActivationState,
  type RoleMode,
} from "./activation-state";
import { CrmActionButton } from "./crm-states";

export interface ActivationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}

type Load = { state: "loading" } | { state: "error" } | { state: "ready"; preview: ActivationPreview };

const selectCls =
  "h-8 w-full rounded-md border border-border bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-55";

/** Premier mode utilisable avec sa base : garde la base courante si elle convient encore. */
function withMode(state: ActivationState, preview: ActivationPreview, role: CrmRole, mode: RoleMode): ActivationState {
  const next: ActivationState = { ...state, roles: { ...state.roles, [role]: { mode, databaseId: null } } };
  if (mode !== "create") {
    const status = mode === "connect" ? "compatible" : "almost";
    const free = preview.roles[role].candidates.filter((c) => c.status === status && takenBy(c.databaseId, role, next) === null);
    const collided = collisionOf(role, preview, state.spaceId)?.databaseId;
    next.roles[role] = { mode, databaseId: (free.find((c) => c.databaseId === collided) ?? free[0])?.databaseId ?? null };
  }
  return next;
}

export function ActivationDialog({ open, onOpenChange, onDone }: ActivationDialogProps) {
  const t = useTranslations("crm");
  const router = useRouter();
  const { org } = useOrganization();
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [state, setState] = useState<ActivationState | null>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const bodyRef = useRef<HTMLDivElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [notices, setNotices] = useState<Partial<Record<CrmRole, string>>>({});
  const submittingRef = useRef(false);
  const [switching, setSwitching] = useState(false);

  const currentSlug = org?.slug ?? "";

  const analyze = useCallback(async () => {
    setLoad({ state: "loading" });
    setState(null);
    try {
      const res = await fetch("/api/crm/activate/preview");
      if (!res.ok) throw new Error("preview");
      const preview = (await res.json()) as ActivationPreview;
      setState(initialState(preview, currentSlug || preview.orgs?.[0]?.slug || ""));
      setLoad({ state: "ready", preview });
    } catch {
      setLoad({ state: "error" });
    }
  }, [currentSlug]);

  useEffect(() => {
    if (!open) return;
    setStep(1);
    setSubmitError(null);
    setNotices({});
    setSwitching(false);
    void analyze();
  }, [open, analyze]);

  // Si la navigation vers l'autre organisation n'aboutit pas (retour, blocage), la modale se débloque :
  // pageshow couvre le retour depuis le cache de navigation, le délai couvre une navigation qui n'a jamais démarré.
  useEffect(() => {
    if (!switching) return;
    const reset = () => setSwitching(false);
    window.addEventListener("pageshow", reset);
    const timer = window.setTimeout(reset, 15000);
    return () => {
      window.removeEventListener("pageshow", reset);
      window.clearTimeout(timer);
    };
  }, [switching]);

  function close() {
    if (!submitting && !switching) onOpenChange(false);
  }

  async function undo() {
    try {
      const res = await fetch("/api/crm/deactivate", { method: "POST" });
      if (!res.ok) throw new Error("deactivate");
      toast.success(t("activation.toast.undone"));
      refreshCrmStatus();
      onDone();
    } catch {
      toast.error(t("activation.deactivateError"));
    }
  }

  /** Bascule un rôle vers la base existante du même nom (collision connue côté client). */
  function adoptCollision(s: ActivationState, role: CrmRole, pv: ActivationPreview): ActivationState | null {
    const collision = collisionOf(role, pv, s.spaceId);
    const cand = pv.roles[role].candidates.find((c) => c.databaseId === collision?.databaseId);
    if (!collision || !cand || cand.status === "none" || takenBy(cand.databaseId, role, s) !== null) return null;
    return { ...s, roles: { ...s.roles, [role]: { mode: cand.status === "compatible" ? "connect" : "complete", databaseId: cand.databaseId } } };
  }

  function fail(message: string) {
    // Une seule annonce : le bloc role="alert" de la modale (toujours ouverte quand une erreur survient).
    setSubmitError(message);
  }

  /** Base du même nom dans l'espace cible, connue par les candidats de l'aperçu (hors collisions de l'espace suggéré). */
  function adoptByName(s: ActivationState, role: CrmRole, pv: ActivationPreview): ActivationState | null {
    const name = t(`template.databases.${role}`);
    const cand = pv.roles[role].candidates.find(
      (c) => c.name === name && c.spaceId === s.spaceId && c.status !== "none" && takenBy(c.databaseId, role, s) === null,
    );
    if (!cand) return null;
    return { ...s, roles: { ...s.roles, [role]: { mode: cand.status === "compatible" ? "connect" : "complete", databaseId: cand.databaseId } } };
  }

  function onNameCollision(role: CrmRole | undefined) {
    if (!role || !CRM_ROLES.includes(role) || !state || !preview) {
      fail(t("activation.errors.generic"));
      return;
    }
    // Le message de collision s'affiche sur la tuile du rôle, à l'étape Analyse.
    setStep(1);
    const adopted = adoptCollision(state, role, preview) ?? adoptByName(state, role, preview);
    if (adopted) {
      const message = t("activation.errors.nameCollision", { role: t(`roles.${role}.label`) });
      setState(adopted);
      setNotices((n) => ({ ...n, [role]: message }));
      return;
    }
    // Aucune base connue côté client : Créer est interdit pour ce rôle jusqu'à un changement d'espace.
    const name = t(`template.databases.${role}`);
    const message = t("activation.tile.collisionBlocked", { name });
    setState({ ...state, blockedCreate: { ...state.blockedCreate, [role]: name } });
    setNotices((n) => ({ ...n, [role]: message }));
  }

  async function submit(body: CrmActivateBodyV2) {
    let res: Response;
    try {
      res = await fetch("/api/crm/activate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      fail(t("activation.errors.generic"));
      return;
    }
    const data = (await res.json().catch(() => ({}))) as { automationsCreated?: string[]; automationsSkipped?: string[]; statusOptionsAdded?: string[]; reactivated?: boolean; code?: string; role?: CrmRole };
    if (!res.ok) {
      if (res.status === 409 && data.code === "name_collision") onNameCollision(data.role);
      else if (res.status === 404) fail(t("activation.errors.notFound"));
      else if (res.status === 403) fail(t("activation.errors.forbidden"));
      else if (res.status === 400 && data.code === "space_quota") fail(t("activation.errors.quota"));
      else fail(t("activation.errors.generic"));
      return;
    }
    saveActivationHandoff({ created: data.automationsCreated, skipped: data.automationsSkipped, statusOptionsAdded: data.statusOptionsAdded });
    const created = !!state && CRM_ROLES.some((r) => state.roles[r].mode !== "connect");
    const message = t(
      data.reactivated ? "activation.toast.reactivated" : created ? "activation.toast.activatedCompleted" : "activation.toast.activated",
      { org: orgName },
    );
    const undoAction = getCrmAction("activation.undo");
    const undoLabel = t(undoAction.labelKey);
    const undoTip = t("activation.toast.undoTip");
    const undoAria = t("activation.toast.undoAria", { message });
    toast.custom(
      (id) => (
      <ActivationUndoToast
        message={message}
        label={undoLabel}
        tip={undoTip}
        ariaLabel={undoAria}
        onUndo={() => {
          toast.dismiss(id);
          void undo();
        }}
      />
      ),
      { duration: 10000 },
    );
    onOpenChange(false);
    refreshCrmStatus();
    onDone();
    router.push("/crm/raccordement");
  }

  async function confirm() {
    if (!state || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setSubmitError(null);
    setNotices({});
    try {
      let body: CrmActivateBodyV2;
      try {
        body = toRequestBody(state);
      } catch {
        fail(t("activation.errors.generic"));
        return;
      }
      await submit(body);
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const preview = load.state === "ready" ? load.preview : null;
  const ready = !!preview && !!state;
  const roleLabels = (roles: CrmRole[]) => roles.map((r) => t(`roles.${r}.label`)).join(", ");

  const steps = useMemo(() => {
    if (!state || !preview) return [];
    const list: string[] = [];
    const created = CRM_ROLES.filter((r) => state.roles[r].mode === "create").length;
    const cols = CRM_ROLES.reduce((n, r) => n + addedColumns(r, state, preview, t).length, 0);
    if (state.spaceId === "create" && created > 0) list.push(t("activation.progress.createSpace", { name: t("template.space") }));
    if (created > 0) list.push(t("activation.progress.createDatabases", { count: created }));
    if (cols > 0) list.push(t("activation.progress.addColumns", { count: cols }));
    list.push(t("activation.progress.connectRoles"));
    return list;
  }, [state, preview, t]);

  const confirmBlock = useMemo(() => {
    if (!state || !preview) return undefined;
    const missing = missingBases(state);
    if (missing.length) return t("activation.confirmMissingTip", { roles: roleLabels(missing) });
    const invalid = invalidRoles(state, preview);
    if (invalid.length) return t("activation.confirmInvalidTip", { roles: roleLabels(invalid) });
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, preview, t]);

  function goTo(next: 1 | 2) {
    setStep(next);
    setSubmitError(null);
    // Le bouton cliqué disparaît avec l'étape : le focus passe à la zone de contenu.
    window.setTimeout(() => bodyRef.current?.focus(), 0);
  }

  function setMode(role: CrmRole, mode: RoleMode) {
    setState((s) => (s && preview ? withMode(s, preview, role, mode) : s));
  }

  function pick(role: CrmRole, databaseId: string) {
    setState((s) => (s ? { ...s, roles: { ...s.roles, [role]: { ...s.roles[role], databaseId } } } : s));
  }

  function adopt(role: CrmRole) {
    if (!state || !preview) return;
    const collision = collisionOf(role, preview, state.spaceId);
    const adopted = adoptCollision(state, role, preview);
    if (!collision || !adopted) return;
    setState(adopted);
    toast.success(t("activation.tile.adoptedToast", { name: collision.name }));
  }

  function changeSpace(value: string) {
    if (!state || !preview) return;
    setState({ ...state, spaceId: value === "create" ? "create" : value, blockedCreate: undefined });
    setNotices({});
    const name = value === "create" ? t("template.space") : preview.spaces.find((s) => s.id === value)?.name ?? "";
    toast.success(t(value === "create" ? "activation.space.changedNewToast" : "activation.space.changedToast", { name }));
  }

  function changeOrg(slug: string) {
    if (!slug || slug === state?.orgSlug || switching) return;
    setState((s) => (s ? { ...s, blockedCreate: undefined } : s));
    setNotices({});
    setSwitching(true);
    window.location.href = `${buildOrgUrl(slug)}/admin/modules?activer-crm=1`;
  }

  const orgs = useMemo(() => {
    const list = preview?.orgs ?? [];
    return org && !list.some((o) => o.slug === org.slug) ? [{ slug: org.slug, name: org.name }, ...list] : list;
  }, [preview, org]);
  const orgName = orgs.find((o) => o.slug === state?.orgSlug)?.name ?? org?.name ?? "";
  const spaceName =
    !state || state.spaceId === "create"
      ? t("template.space")
      : preview?.spaces.find((s) => s.id === state.spaceId)?.name ?? "";
  const orgAction = getCrmAction("activation.switchOrg");
  const OrgIcon = orgAction.icon;
  const recap = step === 2;
  const orgDisabled = !ready || switching || submitting || recap || orgs.length < 2;
  const orgTip = switching
    ? t("activation.org.switching")
    : recap
      ? t("activation.org.lockedRecapTip")
      : ready && orgs.length < 2
      ? t("activation.org.none")
      : t(orgAction.tipKey as string);
  const spaceDisabled = !ready || submitting || recap || (!!state && isSpaceSelectorDisabled(state));
  const spaceTip = !ready ? t("activation.space.pendingTip") : recap ? t("activation.space.recapTip") : spaceDisabled && !submitting ? t("activation.space.disabledTip") : t("activation.space.tip");
  const anyCreate = !!state && !isSpaceSelectorDisabled(state);

  const counts = { connect: 0, complete: 0, create: 0 };
  if (state) for (const r of CRM_ROLES) counts[state.roles[r].mode]++;
  const nextAction = getCrmAction("activation.next");
  const backAction = getCrmAction("activation.back");
  const nextBlock = switching
    ? t("activation.org.switching")
    : load.state === "loading"
      ? t("activation.nextPendingTip")
      : load.state === "error"
        ? t("activation.nextErrorTip")
        : confirmBlock;
  const stepItems = [
    { n: 1, label: t("activation.stepAnalysis") },
    { n: 2, label: t("activation.stepSummary") },
  ] as const;

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent showCloseButton={false} aria-describedby={undefined} className="max-h-[calc(100vh-2rem)] overflow-hidden sm:max-w-5xl">
        <DialogHeader className="flex-row flex-wrap items-center gap-x-3 gap-y-1">
          <DialogTitle>{t("activation.title")}</DialogTitle>
          <ol aria-label={t("activation.stepsAria")} className="m-0 flex list-none items-center gap-2 p-0 text-xs text-muted-foreground">
            {stepItems.map((item, i) => {
              const current = step === item.n;
              const done = step > item.n;
              return (
                <li key={item.n} className="contents">
                  {i > 0 && <ChevronRight className="size-3.5" aria-hidden="true" />}
                  <span
                    aria-current={current ? "step" : undefined}
                    className={cn("inline-flex items-center gap-1.5", current && "font-semibold text-foreground")}
                  >
                    <span
                      aria-hidden="true"
                      className={cn(
                        "inline-flex size-5 items-center justify-center rounded-full border border-border text-[11px] font-bold",
                        current && "border-primary bg-primary text-primary-foreground",
                        done && "border-transparent bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-300",
                      )}
                    >
                      {done ? <Check className="size-3" /> : item.n}
                    </span>
                    {item.label}
                    {done && <span className="sr-only">{t("activation.stepDone")}</span>}
                  </span>
                </li>
              );
            })}
          </ol>
        </DialogHeader>

        <div
          ref={bodyRef}
          tabIndex={-1}
          role="region"
          aria-label={t(step === 1 ? "activation.stepAnalysis" : "activation.stepSummary")}
          className="-mx-4 max-h-[calc(100vh-12rem)] space-y-3 overflow-auto px-4 outline-none"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="crm-activation-org" className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <OrgIcon className="size-3.5" aria-hidden="true" />
                {t(orgAction.labelKey)}
              </label>
              <Tip label={orgTip}>
                <span tabIndex={orgDisabled ? 0 : undefined} className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <select
                    id="crm-activation-org"
                    data-action="activation.switchOrg"
                    aria-label={t(orgAction.labelKey)}
                    value={state?.orgSlug ?? ""}
                    disabled={orgDisabled}
                    onChange={(e) => changeOrg(e.target.value)}
                    className={selectCls}
                  >
                    {orgs.map((o) => (
                      <option key={o.slug} value={o.slug}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                </span>
              </Tip>
              <span className="min-h-4 text-[11px] text-muted-foreground" aria-live="polite">
                {switching ? t("activation.org.switching") : t("activation.org.note")}
              </span>
            </div>
            <div className="flex min-w-0 flex-col gap-1">
              <label htmlFor="crm-activation-space" className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <Folder className="size-3.5" aria-hidden="true" />
                {t("activation.space.label")}
              </label>
              <Tip label={spaceTip}>
                <span tabIndex={spaceDisabled ? 0 : undefined} className="block rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <select
                    id="crm-activation-space"
                    aria-label={t("activation.space.label")}
                    value={state?.spaceId ?? "create"}
                    disabled={spaceDisabled}
                    onChange={(e) => changeSpace(e.target.value)}
                    className={selectCls}
                  >
                    <option value="create">{t("activation.space.createOption", { name: t("template.space") })}</option>
                    {(preview?.spaces ?? []).map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.id === preview?.suggestedSpaceId ? t("activation.space.existingOption", { name: s.name }) : s.name}
                      </option>
                    ))}
                  </select>
                </span>
              </Tip>
              <span className="min-h-4 text-[11px] text-muted-foreground">
                {ready && anyCreate
                  ? state?.spaceId === "create"
                    ? t("activation.space.noteNew", { name: t("template.space"), org: orgName })
                    : t("activation.space.noteEditable")
                  : ""}
              </span>
            </div>
          </div>

          {load.state === "loading" && (
            <div role="status" aria-label={t("activation.analyzing")} className="grid gap-3 md:grid-cols-3">
              {CRM_ROLES.map((r) => (
                <ActivationTileSkeleton key={r} role={r} />
              ))}
            </div>
          )}

          {load.state === "error" && (
            <div role="alert" className="flex min-h-[300px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border p-4 text-center">
              <AlertTriangle className="size-6 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-semibold">{t("activation.errors.analysis", { org: orgName || currentSlug })}</p>
              <p className="text-xs text-muted-foreground">{t("activation.errors.analysisDetail")}</p>
              <CrmActionButton
                actionId="retry"
                label={t("activation.retry")}
                tip={t("activation.retryTip")}
                ariaLabel={t("activation.retry")}
                onClick={() => void analyze()}
              />
            </div>
          )}

          {preview && state && step === 1 && (
            <fieldset disabled={submitting || switching} className="m-0 grid min-w-0 gap-3 border-0 p-0 md:grid-cols-3">
              {CRM_ROLES.map((role) => (
                <ActivationRoleTile
                  key={role}
                  role={role}
                  state={state}
                  preview={preview}
                  spaceName={spaceName}
                  onMode={setMode}
                  onPick={pick}
                  onAdopt={adopt}
                  notice={notices[role]}
                />
              ))}
            </fieldset>
          )}

          {preview && state && step === 2 && (
            <>
              {submitting && <ActivationProgress steps={steps} />}
              {submitError && (
                <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-300 bg-red-50 px-3 py-2 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <p className="min-w-0">
                    <b>{t("activation.errors.createFailed")}</b> {submitError}
                  </p>
                </div>
              )}
              <section aria-label={t("activation.recap.title")} className="space-y-2 rounded-xl border border-border p-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold">{t("activation.recap.title")}</h3>
                  <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                    {t("activation.recap.rolesSummary", counts)}
                  </span>
                </div>
                <ActivationRecap state={state} preview={preview} orgName={orgName} spaceName={spaceName} />
              </section>
            </>
          )}
        </div>

        <DialogFooter>
          {step === 1 ? (
            <>
              <CrmActionButton
                actionId="cancelActivation"
                label={t(getCrmAction("cancelActivation").labelKey)}
                tip={t("activation.cancelTip")}
                ariaLabel={t("activation.closeAria")}
                onClick={close}
                disabledReason={submitting ? t("activation.progress.closeBlocked") : switching ? t("activation.org.switching") : undefined}
              />
              <CrmActionButton
                actionId="activation.next"
                label={t(nextAction.labelKey)}
                tip={t(nextAction.tipKey as string)}
                ariaLabel={t(nextAction.labelKey)}
                onClick={() => goTo(2)}
                disabledReason={nextBlock}
              />
            </>
          ) : (
            <>
              <CrmActionButton
                actionId="activation.back"
                label={t(backAction.labelKey)}
                tip={t(backAction.tipKey as string)}
                ariaLabel={t(backAction.labelKey)}
                onClick={() => goTo(1)}
                disabledReason={submitting ? t("activation.progress.backBlocked") : switching ? t("activation.org.switching") : undefined}
              />
              <CrmActionButton
                actionId="activation.confirm"
                label={
                  submitting
                    ? t("activation.confirming")
                    : submitError
                      ? t("activation.errors.retry")
                      : t(getCrmAction("activation.confirm").labelKey)
                }
                tip={submitError ? t("activation.errors.retryTip") : t(getCrmAction("activation.confirm").tipKey as string)}
                ariaLabel={submitError && !submitting ? t("activation.errors.retry") : t("activation.confirm")}
                onClick={() => void confirm()}
                disabledReason={submitting ? t("activation.confirming") : switching ? t("activation.org.switching") : confirmBlock}
              />
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
