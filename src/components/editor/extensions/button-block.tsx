"use client";

import { useState, useEffect, useCallback } from "react";
import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/core";
import { Zap, Settings2, Trash2, Check, Loader2, AlertCircle, X, Plus } from "lucide-react";
import { stopMouse } from "../utils/stop-mouse";

interface DatabaseOption {
  id: string;
  name: string;
}

interface AutomationOption {
  id: string;
  name: string;
  enabled: boolean;
}

type ClickState = "idle" | "loading" | "success" | "error";
type ButtonMode = "database" | "workflow";

function getSpaceId(): string {
  return typeof window !== "undefined" ? window.__loriax_spaceId ?? "" : "";
}

function getDocId(): string {
  return typeof window !== "undefined" ? window.__loriax_docId ?? "" : "";
}

export function ButtonBlockView({ node, updateAttributes, deleteNode, editor }: NodeViewProps) {
  const mode: ButtonMode = node.attrs.mode === "workflow" ? "workflow" : "database";
  const databaseId: string | null = node.attrs.databaseId ?? null;
  const automationId: string | null = node.attrs.automationId ?? null;
  const automationName: string = node.attrs.automationName ?? "";
  const label: string = node.attrs.label ?? "";
  const editable = editor?.isEditable ?? false;
  const isWorkflow = mode === "workflow";

  const configured = isWorkflow ? !!automationId : !!databaseId && !!automationId;

  // ── Config (mode édition) ──────────────────────────────────────────────────
  const [configOpen, setConfigOpen] = useState(!configured && editable);
  const [databases, setDatabases] = useState<DatabaseOption[]>([]);
  const [automations, setAutomations] = useState<AutomationOption[]>([]);
  const [loadingDbs, setLoadingDbs] = useState(false);
  const [loadingAutos, setLoadingAutos] = useState(false);

  // Charge les bases du space à l'ouverture du popover (mode base uniquement).
  useEffect(() => {
    if (!configOpen || isWorkflow) return;
    const spaceId = getSpaceId();
    if (!spaceId) return;
    setLoadingDbs(true);
    fetch(`/api/databases?spaceId=${encodeURIComponent(spaceId)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: DatabaseOption[]) => setDatabases(Array.isArray(rows) ? rows : []))
      .catch(() => setDatabases([]))
      .finally(() => setLoadingDbs(false));
  }, [configOpen, isWorkflow]);

  // Charge les cibles : automations de la base (mode base) OU workflows
  // autonomes de l'espace (mode workflow).
  useEffect(() => {
    if (!configOpen) return;
    if (isWorkflow) {
      const spaceId = getSpaceId();
      if (!spaceId) return;
      setLoadingAutos(true);
      fetch(`/api/automations?spaceId=${encodeURIComponent(spaceId)}`)
        .then((r) => (r.ok ? r.json() : []))
        .then((rows: AutomationOption[]) => setAutomations(Array.isArray(rows) ? rows : []))
        .catch(() => setAutomations([]))
        .finally(() => setLoadingAutos(false));
      return;
    }
    if (!databaseId) return;
    setLoadingAutos(true);
    fetch(`/api/databases/${databaseId}/automations`)
      .then((r) => (r.ok ? r.json() : []))
      .then((rows: AutomationOption[]) => setAutomations(Array.isArray(rows) ? rows : []))
      .catch(() => setAutomations([]))
      .finally(() => setLoadingAutos(false));
  }, [configOpen, isWorkflow, databaseId]);

  // Bascule de mode : réinitialise la cible choisie (base/automation/workflow).
  const selectMode = useCallback(
    (next: ButtonMode) => {
      updateAttributes({
        mode: next,
        databaseId: null,
        automationId: null,
        automationName: "",
      });
    },
    [updateAttributes]
  );

  const selectDatabase = useCallback(
    (id: string) => {
      // Changer de base invalide l'automation choisie précédemment.
      updateAttributes({ databaseId: id, automationId: null, automationName: "" });
    },
    [updateAttributes]
  );

  const selectAutomation = useCallback(
    (auto: AutomationOption) => {
      updateAttributes({ automationId: auto.id, automationName: auto.name });
    },
    [updateAttributes]
  );

  // ── Exécution (clic) ───────────────────────────────────────────────────────
  const [clickState, setClickState] = useState<ClickState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  const trigger = useCallback(async () => {
    if (!automationId || clickState === "loading") return;
    if (!isWorkflow && !databaseId) return;
    setClickState("loading");
    setErrorMsg("");
    try {
      // Mode workflow autonome : route /api/automations avec le documentId
      // courant (interpolable côté serveur). Mode base : route base-liée.
      const res = isWorkflow
        ? await fetch(`/api/automations/${automationId}/trigger`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(getDocId() ? { documentId: getDocId() } : {}),
          })
        : await fetch(
            `/api/databases/${databaseId}/automations/${automationId}/trigger`,
            { method: "POST" }
          );
      if (res.ok) {
        setClickState("success");
        setTimeout(() => setClickState("idle"), 2000);
      } else {
        const data = await res.json().catch(() => ({}));
        setErrorMsg(
          typeof data?.error === "string"
            ? data.error
            : res.status === 429
              ? "Limite de fréquence atteinte, réessayez plus tard"
              : "Échec du déclenchement"
        );
        setClickState("error");
        setTimeout(() => setClickState("idle"), 3500);
      }
    } catch {
      setErrorMsg("Erreur réseau");
      setClickState("error");
      setTimeout(() => setClickState("idle"), 3500);
    }
  }, [isWorkflow, databaseId, automationId, clickState]);

  const displayLabel = label || automationName || "Déclencher";

  // ── Rendu : popover de config ──────────────────────────────────────────────
  if (editable && configOpen) {
    return (
      <NodeViewWrapper
        className="automation-button-block my-2 rounded-lg border bg-card p-3"
        data-type="automation-button"
      >
        <div className="mb-2 flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-sm font-medium">
            <Zap className="h-4 w-4 text-amber-500" /> Bouton d&apos;automatisation
          </span>
          <div className="flex items-center gap-0.5">
            {configured && (
              <button
                onClick={() => setConfigOpen(false)}
                className="rounded p-1 text-muted-foreground hover:bg-accent"
                aria-label="Terminer la configuration"
                title="Terminer"
              >
                <Check className="h-4 w-4 text-emerald-600" />
              </button>
            )}
            <button
              onClick={() => deleteNode()}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive"
              aria-label="Supprimer le bloc"
              title="Supprimer"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Type de déclencheur
            <select
              value={mode}
              onChange={(e) => selectMode(e.target.value as ButtonMode)}
              onMouseDown={stopMouse}
              className="rounded border bg-background px-2 py-1.5 text-sm outline-none"
            >
              <option value="database">Automatisation d&apos;une base</option>
              <option value="workflow">Workflow autonome</option>
            </select>
          </label>

          {!isWorkflow && (
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Base
              <select
                value={databaseId ?? ""}
                onChange={(e) => selectDatabase(e.target.value)}
                onMouseDown={stopMouse}
                disabled={loadingDbs}
                className="rounded border bg-background px-2 py-1.5 text-sm outline-none"
              >
                <option value="">{loadingDbs ? "Chargement..." : "Choisir une base"}</option>
                {databases.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            {isWorkflow ? "Workflow" : "Automatisation"}
            <select
              value={automationId ?? ""}
              onChange={(e) => {
                const auto = automations.find((a) => a.id === e.target.value);
                if (auto) selectAutomation(auto);
              }}
              onMouseDown={stopMouse}
              disabled={(!isWorkflow && !databaseId) || loadingAutos}
              className="rounded border bg-background px-2 py-1.5 text-sm outline-none disabled:opacity-50"
            >
              <option value="">
                {!isWorkflow && !databaseId
                  ? "Choisir une base d'abord"
                  : loadingAutos
                    ? "Chargement..."
                    : automations.length === 0
                      ? isWorkflow
                        ? "Aucun workflow autonome"
                        : "Aucune automatisation"
                      : isWorkflow
                        ? "Choisir un workflow"
                        : "Choisir une automatisation"}
              </option>
              {automations.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {a.enabled ? "" : " (désactivé)"}
                </option>
              ))}
            </select>
          </label>

          {isWorkflow && (
            <a
              href={`/automations?spaceId=${encodeURIComponent(getSpaceId())}`}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
            >
              <Plus className="h-3 w-3" /> Créer ou modifier un workflow dans le builder
            </a>
          )}

          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Libellé du bouton (optionnel)
            <input
              value={label}
              onChange={(e) => updateAttributes({ label: e.target.value })}
              onMouseDown={stopMouse}
              placeholder={automationName || "Déclencher"}
              className="rounded border bg-background px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground/50"
            />
          </label>
        </div>
      </NodeViewWrapper>
    );
  }

  // ── Rendu : bouton ─────────────────────────────────────────────────────────
  return (
    <NodeViewWrapper
      className="automation-button-block my-2 inline-flex max-w-full items-center gap-2"
      data-type="automation-button"
    >
      <button
        onClick={trigger}
        disabled={!configured || clickState === "loading"}
        className={
          "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed " +
          (clickState === "success"
            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200"
            : clickState === "error"
              ? "bg-destructive/15 text-destructive"
              : "bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-50")
        }
        title={configured ? undefined : "Bouton non configuré"}
      >
        {clickState === "loading" ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : clickState === "success" ? (
          <Check className="h-4 w-4" />
        ) : clickState === "error" ? (
          <AlertCircle className="h-4 w-4" />
        ) : (
          <Zap className="h-4 w-4" />
        )}
        {clickState === "success" ? "Déclenché" : displayLabel}
      </button>

      {clickState === "error" && errorMsg && (
        <span className="inline-flex items-center gap-1 text-xs text-destructive">
          <X className="h-3 w-3" /> {errorMsg}
        </span>
      )}

      {editable && (
        <button
          onClick={() => setConfigOpen(true)}
          className="rounded p-1 text-muted-foreground hover:bg-accent"
          aria-label="Configurer le bouton"
          title="Configurer"
        >
          <Settings2 className="h-4 w-4" />
        </button>
      )}
    </NodeViewWrapper>
  );
}
