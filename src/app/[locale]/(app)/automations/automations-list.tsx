"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { useTranslations } from "next-intl";
import { Switch } from "@/components/ui/switch";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { TallyFormButton } from "@/components/crm/tally/tally-form-button";
import { TallyReceptionDialog } from "@/components/crm/tally/tally-reception-dialog";
import { tallyFormMissing } from "@/lib/automations/tally-activation-guard";
import { ExternalLink, History, MoreHorizontal, Pencil, Plus, Workflow } from "lucide-react";

import type { AutomationGraph } from "@/lib/automations/automation-graph";
import { TemplateSelector } from "./template-selector";
import { PlaceholderField, type PlaceholderGroup } from "./placeholder-field";
import { AutomationStepCanvas } from "./automation-step-canvas";
import { RunHistory } from "./debug-history";
import { Tooltip, SELECTED_CLS, FOCUS_CLS } from "./debug-shared";
import { RealModeBanner } from "./debug-toolbar";
import { USER_PLACEHOLDER_GROUP, cellsToOptions, useAutomationColumns } from "./automation-shared";
import { MANAGE_AUTOMATIONS_REQUIRED } from "./automation-access";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type TriggerType =
  | "row_created"
  | "row_updated"
  | "row_deleted"
  | "cron"
  | "date_reached"
  | "value_changed"
  // Déclencheur manuel (workflow autonome — bouton dans un document).
  | "manual"
  // Déclencheur webhook entrant (Spec 1 — câblage UI dans un lot ultérieur).
  | "webhook_inbound"
  // Un média est ajouté à la médiathèque (écran de configuration dans un lot ultérieur).
  | "media_uploaded";
type ActionType =
  | "webhook"
  | "notify_user"
  | "create_row"
  | "update_row"
  | "find_row"
  | "send_email"
  | "ai"
  // Actions « workflow » découplées de la base.
  | "create_document"
  | "create_task"
  // Génère un design depuis un template (Spec 2). Câblage UI : tâches suivantes.
  | "create_design";

const TRIGGERS: { value: TriggerType; label: string }[] = [
  { value: "row_created", label: "Ligne créée" },
  { value: "row_updated", label: "Ligne modifiée" },
  { value: "row_deleted", label: "Ligne supprimée" },
  { value: "cron", label: "Planifié (cron)" },
  { value: "date_reached", label: "Date atteinte" },
  { value: "value_changed", label: "Changement de valeur" },
  { value: "webhook_inbound", label: "Webhook entrant" },
];

// Déclencheurs proposés à la création d'un workflow autonome (portée espace,
// pas de base) — cf. Task 8 (AUTONOMOUS_TRIGGER_TYPES du canevas).
const AUTONOMOUS_TRIGGERS: { value: TriggerType; label: string }[] = [
  { value: "manual", label: "Manuel (bouton)" },
  { value: "webhook_inbound", label: "Webhook entrant" },
  { value: "media_uploaded", label: "Média ajouté" },
];

type AutomationKind = "base" | "autonomous";

const BASE_ACTIONS: { value: ActionType; label: string; tag?: string }[] = [
  { value: "webhook", label: "Webhook" },
  { value: "send_email", label: "Envoyer un email" },
  { value: "ai", label: "IA + génération de document" },
  { value: "notify_user", label: "Notification utilisateur" },
  { value: "create_row", label: "Créer une ligne", tag: "backlog" },
  { value: "update_row", label: "Modifier une ligne", tag: "backlog" },
];

// Actions compatibles workflow autonome (cf. /api/automations — les actions
// base-liées create_row/update_row y sont rejetées).
const AUTONOMOUS_ACTIONS: { value: ActionType; label: string; tag?: string }[] = [
  { value: "create_document", label: "Créer un document" },
  { value: "create_design", label: "Générer un design" },
  { value: "create_task", label: "Créer une tâche" },
  { value: "send_email", label: "Envoyer un email" },
  { value: "ai", label: "IA + génération de document" },
  { value: "webhook", label: "Webhook" },
];

interface AutomationItem {
  id: string;
  kind: AutomationKind;
  databaseId: string | null;
  databaseName: string | null;
  name: string;
  triggerType: TriggerType;
  triggerConfig: Record<string, unknown>;
  actionType: ActionType;
  actionConfig: Record<string, unknown>;
  graph: AutomationGraph | null;
  triggerLabel: string;
  actionLabel: string;
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
}

/** Automatisme de réception Tally d'une base : webhook entrant déclarant la clé `tallyFormId`. */
function isTallyReception(item: AutomationItem): boolean {
  return (
    item.triggerType === "webhook_inbound" &&
    !!item.databaseId &&
    Object.prototype.hasOwnProperty.call(item.triggerConfig ?? {}, "tallyFormId")
  );
}

interface BaseRef {
  id: string;
  name: string;
}

interface FormState {
  kind: AutomationKind;
  databaseId: string;
  name: string;
  triggerType: TriggerType;
  actionType: ActionType;
  webhookUrl: string;
  emailTo: string;
  emailSubject: string;
  emailBody: string;
  aiPrompt: string;
  aiSystemPrompt: string;
  aiFormat: "none" | "pdf" | "docx";
  aiTitle: string;
  // Champs dédiés aux actions de workflow autonome.
  docTitle: string;
  docClassification: "" | "public" | "internal" | "confidential" | "secret";
  docTemplateId: string;
  taskTitle: string;
  taskAssigneeId: string;
  taskDueAt: string;
  taskDocumentId: string;
  actionConfigJson: string;
  enabled: boolean;
}

function emptyForm(kind: AutomationKind, defaultBaseId: string): FormState {
  return {
    kind,
    databaseId: defaultBaseId,
    name: "",
    triggerType: kind === "autonomous" ? "manual" : "row_created",
    actionType: kind === "autonomous" ? "create_document" : "webhook",
    webhookUrl: "",
    emailTo: "",
    emailSubject: "",
    emailBody: "",
    aiPrompt: "",
    aiSystemPrompt: "",
    aiFormat: "none",
    aiTitle: "",
    docTitle: "",
    docClassification: "",
    docTemplateId: "",
    taskTitle: "",
    taskAssigneeId: "",
    taskDueAt: "",
    taskDocumentId: "",
    actionConfigJson: "{}",
    enabled: true,
  };
}

function pickString(obj: Record<string, unknown>, key: string): string {
  const v = obj[key];
  return typeof v === "string" ? v : "";
}

function fromItem(item: AutomationItem): FormState {
  const action = item.actionConfig ?? {};
  const classif = pickString(action, "classification");
  return {
    kind: item.kind,
    databaseId: item.databaseId ?? "",
    name: item.name,
    triggerType: item.triggerType,
    actionType: item.actionType,
    webhookUrl: item.actionType === "webhook" ? pickString(action, "url") : "",
    emailTo: item.actionType === "send_email" ? pickString(action, "to") : "",
    emailSubject: item.actionType === "send_email" ? pickString(action, "subject") : "",
    emailBody:
      item.actionType === "send_email"
        ? pickString(action, "html") || pickString(action, "text")
        : "",
    aiPrompt: item.actionType === "ai" ? pickString(action, "prompt") : "",
    aiSystemPrompt: item.actionType === "ai" ? pickString(action, "systemPrompt") : "",
    aiFormat:
      item.actionType === "ai" &&
      (action.format === "pdf" || action.format === "docx")
        ? action.format
        : "none",
    aiTitle: item.actionType === "ai" ? pickString(action, "title") : "",
    docTitle: item.actionType === "create_document" ? pickString(action, "title") : "",
    docClassification:
      item.actionType === "create_document" &&
      (classif === "public" ||
        classif === "internal" ||
        classif === "confidential" ||
        classif === "secret")
        ? classif
        : "",
    docTemplateId:
      item.actionType === "create_document" ? pickString(action, "templateId") : "",
    taskTitle: item.actionType === "create_task" ? pickString(action, "title") : "",
    taskAssigneeId:
      item.actionType === "create_task" ? pickString(action, "assigneeId") : "",
    taskDueAt: item.actionType === "create_task" ? pickString(action, "dueAt") : "",
    taskDocumentId:
      item.actionType === "create_task" ? pickString(action, "documentId") : "",
    actionConfigJson: JSON.stringify(item.actionConfig ?? {}, null, 2),
    enabled: item.enabled,
  };
}

export function AutomationsList({
  items,
  bases,
  currentSpaceId,
  canManage,
}: {
  items: AutomationItem[];
  bases: BaseRef[];
  currentSpaceId: string;
  /**
   * Droit de créer, modifier, activer, supprimer, tester et rejouer : calculé
   * côté serveur par `canManageSpaceAutomations` (mêmes gardes que l'API).
   * Sans lui, l'écran reste consultable (liste, enchaînement, historique).
   */
  canManage: boolean;
}) {
  const router = useRouter();
  const tCrm = useTranslations("crm");
  const tTally = useTranslations("crm.tally");
  const [tallyDialogId, setTallyDialogId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  const defaultKind: AutomationKind = bases.length > 0 ? "base" : "autonomous";
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AutomationItem | null>(null);
  const [form, setForm] = useState<FormState>(() =>
    emptyForm(defaultKind, bases[0]?.id ?? "")
  );
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [confirmDelete, setConfirmDelete] = useState<AutomationItem | null>(null);
  // Vue maître-détail façon Airtable : automatisation sélectionnée dans la
  // colonne de gauche, éditée dans le canevas central/droit.
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [realMode, setRealMode] = useState(false);

  // Colonnes de la base ciblée : sert à proposer les vraies variables
  // « Cellule : <nom> » (insère {{cells.<id>}}) au lieu de codes tapés à la main.
  const dbColumns = useAutomationColumns(
    dialogOpen && form.kind === "base" ? form.databaseId : undefined
  );

  // Variables disponibles selon le contexte (base-lié vs workflow autonome).
  const placeholderGroups: PlaceholderGroup[] = useMemo(() => {
    const groups: PlaceholderGroup[] = [USER_PLACEHOLDER_GROUP];
    if (form.kind === "base") {
      groups.push({
        group: "Ligne déclencheuse",
        options: [
          { label: "ID de la ligne", value: "{{rowId}}" },
          { label: "ID de la base", value: "{{databaseId}}" },
          { label: "Événement", value: "{{event}}" },
        ],
      });
      if (dbColumns.length > 0) {
        groups.push({ group: "Cellules", options: cellsToOptions(dbColumns) });
      }
    } else {
      groups.push({
        group: "Contexte",
        options: [
          { label: "ID de l'espace", value: "{{space.id}}" },
          { label: "ID du document", value: "{{doc.id}}" },
        ],
      });
    }
    return groups;
  }, [form.kind, dbColumns]);

  // Endpoints CRUD selon le type : autonome → /api/automations,
  // base-lié → /api/databases/{databaseId}/automations.
  function itemEndpoint(item: AutomationItem): string {
    return item.kind === "autonomous"
      ? `/api/automations/${item.id}`
      : `/api/databases/${item.databaseId}/automations/${item.id}`;
  }

  function openCreate(kind: AutomationKind = defaultKind) {
    if (!canManage) return;
    if (kind === "base" && bases.length === 0) {
      toast.error("Créez d'abord une base dans cet espace.");
      return;
    }
    setEditing(null);
    setForm(emptyForm(kind, bases[0]?.id ?? ""));
    setFormError(null);
    setDialogOpen(true);
  }

  function openEdit(item: AutomationItem) {
    if (!canManage) return;
    setEditing(item);
    setForm(fromItem(item));
    setFormError(null);
    setDialogOpen(true);
  }

  async function toggle(item: AutomationItem) {
    if (!canManage) return;
    if (!item.enabled && tallyFormMissing(item.triggerType, item.triggerConfig)) {
      toast.error(tTally("list.switchBlocked"));
      return;
    }
    setBusy(item.id);
    try {
      const res = await fetch(itemEndpoint(item), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !item.enabled }),
      });
      if (res.ok) {
        toast.success(item.enabled ? "Désactivée" : "Activée");
        router.refresh();
      } else {
        const data = await res.json().catch(() => null);
        toast.error(data?.code === "tally_form_required" ? tCrm("errors.tallyFormRequired") : "Action impossible");
      }
    } finally {
      setBusy(null);
    }
  }

  async function remove(item: AutomationItem) {
    setBusy(item.id);
    try {
      const res = await fetch(itemEndpoint(item), { method: "DELETE" });
      if (res.ok) {
        toast.success("Automatisation supprimée");
        setConfirmDelete(null);
        router.refresh();
      } else {
        const j = await res.json().catch(() => ({}));
        toast.error(j?.error ?? "Suppression impossible");
      }
    } finally {
      setBusy(null);
    }
  }

  function parseJsonOrError(label: string, raw: string): Record<string, unknown> | null {
    const trimmed = raw.trim();
    if (trimmed === "") return {};
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setFormError(`${label} doit être un objet JSON.`);
        return null;
      }
      return parsed as Record<string, unknown>;
    } catch {
      setFormError(`${label} : JSON invalide.`);
      return null;
    }
  }

  // Création : coquille minimale (nom + portée + déclencheur initial). Le
  // builder (AutomationStepCanvas) devient le point d'entrée pour tout le
  // reste — actions, config détaillée du déclencheur — juste après.
  async function createShell() {
    setSaving(true);
    try {
      const res =
        form.kind === "autonomous"
          ? await fetch(`/api/automations`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                spaceId: currentSpaceId,
                name: form.name.trim(),
                triggerType: form.triggerType,
                actionType: "create_document",
                actionConfig: { title: "Nouveau document" },
                // Coquille : le déclencheur/l'action ne sont pas encore
                // configurés (ex. cron sans triggerConfig) — jamais activée
                // à la création, sinon l'executor peut l'exécuter avec un
                // repli par défaut avant que l'utilisateur ait fini de la
                // construire dans le canevas. Activation via le toggle
                // Actif/Inactif une fois la config terminée.
                enabled: false,
              }),
            })
          : await fetch(`/api/databases/${form.databaseId}/automations`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name: form.name.trim(),
                triggerType: form.triggerType,
                actionType: "notify_user",
                actionConfig: { userId: "{{user.id}}", title: "Notification" },
                // Idem : coquille toujours créée désactivée.
                enabled: false,
              }),
            });
      if (res.ok) {
        const created = await res.json();
        toast.success(form.kind === "autonomous" ? "Workflow créé" : "Automatisation créée");
        setDialogOpen(false);
        setShowHistory(false);
        // Ouvre immédiatement le canevas sur l'automatisation créée : c'est
        // là que le déclencheur et les actions se configurent réellement.
        setSelectedListId(created.id);
        router.refresh();
      } else {
        const j = await res.json().catch(() => ({}));
        setFormError(j?.error ?? "Création impossible.");
      }
    } finally {
      setSaving(false);
    }
  }

  async function save() {
    setFormError(null);
    if (!form.name.trim()) {
      setFormError("Le nom est requis.");
      return;
    }
    if (form.kind === "base" && !form.databaseId) {
      setFormError("Sélectionnez une base.");
      return;
    }

    if (!editing) {
      await createShell();
      return;
    }

    // Édition : la config du déclencheur (cron/date/colonne/webhook) et des
    // actions se règle en priorité dans le panneau no-code du canevas
    // (AutomationStepCanvas) ; ce formulaire ne couvre plus que les réglages
    // qui n'y sont pas encore câblés (config détaillée de l'action).
    let actionConfig: Record<string, unknown>;
    if (form.actionType === "webhook") {
      if (!form.webhookUrl.trim()) {
        setFormError("URL du webhook requise.");
        return;
      }
      const extra = parseJsonOrError("Config additionnelle", form.actionConfigJson);
      if (extra === null) return;
      actionConfig = { ...extra, url: form.webhookUrl.trim() };
    } else if (form.actionType === "send_email") {
      const to = form.emailTo.trim();
      const subject = form.emailSubject.trim();
      const body = form.emailBody;
      if (!to) {
        setFormError("Destinataire requis.");
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to) && !to.includes("{{")) {
        setFormError("Adresse email invalide (les placeholders {{...}} sont autorisés).");
        return;
      }
      if (!subject) {
        setFormError("Objet requis.");
        return;
      }
      if (!body.trim()) {
        setFormError("Corps de l'email requis.");
        return;
      }
      actionConfig = { to, subject, html: body };
    } else if (form.actionType === "ai") {
      const prompt = form.aiPrompt.trim();
      if (!prompt) {
        setFormError("Le prompt IA est requis.");
        return;
      }
      actionConfig = { prompt, format: form.aiFormat };
      const systemPrompt = form.aiSystemPrompt.trim();
      if (systemPrompt) actionConfig.systemPrompt = systemPrompt;
      const title = form.aiTitle.trim();
      if (title) actionConfig.title = title;
    } else if (form.actionType === "create_document") {
      const title = form.docTitle.trim();
      if (!title) {
        setFormError("Le titre du document est requis.");
        return;
      }
      actionConfig = { title };
      if (form.docClassification) actionConfig.classification = form.docClassification;
      if (form.docTemplateId.trim()) actionConfig.templateId = form.docTemplateId.trim();
    } else if (form.actionType === "create_task") {
      const title = form.taskTitle.trim();
      if (!title) {
        setFormError("Le titre de la tâche est requis.");
        return;
      }
      actionConfig = { title };
      if (form.taskAssigneeId.trim()) actionConfig.assigneeId = form.taskAssigneeId.trim();
      if (form.taskDueAt.trim()) actionConfig.dueAt = form.taskDueAt.trim();
      if (form.taskDocumentId.trim()) actionConfig.documentId = form.taskDocumentId.trim();
    } else {
      const parsed = parseJsonOrError("Config de l'action", form.actionConfigJson);
      if (parsed === null) return;
      actionConfig = parsed;
    }

    // PATCH : on ne peut changer ni la base ni les types (limitation API) —
    // ces changements se font désormais dans le canevas (déclencheur) ou en
    // recréant l'automatisation (action).
    if (editing.kind === "base" && editing.databaseId !== form.databaseId) {
      setFormError("Changer la base n'est pas pris en charge — recréez l'automatisation.");
      return;
    }
    if (editing.actionType !== form.actionType) {
      setFormError(
        "Changer le type d'action n'est pas pris en charge — recréez l'automatisation."
      );
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(itemEndpoint(editing), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name.trim(),
          actionConfig,
          enabled: form.enabled,
        }),
      });
      if (res.ok) {
        toast.success("Automatisation mise à jour");
        setDialogOpen(false);
        router.refresh();
      } else {
        const j = await res.json().catch(() => ({}));
        setFormError(j?.error ?? "Mise à jour impossible.");
      }
    } finally {
      setSaving(false);
    }
  }

  const q = filter.trim().toLowerCase();
  const visible = items.filter(
    (i) =>
      q === "" ||
      i.name.toLowerCase().includes(q) ||
      (i.databaseName?.toLowerCase().includes(q) ?? false)
  );

  const selected = items.find((i) => i.id === selectedListId) ?? null;

  // Le mode réel n'est jamais conservé : retour au simulé à chaque changement d'automatisme.
  useEffect(() => {
    setRealMode(false);
  }, [selectedListId]);

  // Groupement de la liste par type de déclencheur (façon Airtable).
  const groupedVisible = (() => {
    const map = new Map<string, AutomationItem[]>();
    for (const it of visible) {
      const key = it.triggerLabel || "Autre déclencheur";
      const arr = map.get(key);
      if (arr) arr.push(it);
      else map.set(key, [it]);
    }
    return Array.from(map.entries());
  })();

  return (
    <div className="flex gap-4 min-h-[75vh]">
      {/* Colonne gauche — liste des automatisations (façon Airtable) */}
      <div className="w-80 shrink-0 space-y-3 overflow-y-auto">
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filtrer par nom ou par base…"
          aria-label="Filtrer les automatisations"
          className="flex-1 min-w-[200px] rounded border border-neutral-300 bg-white px-3 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Nouvelle
                </button>
              }
            />
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => openCreate("autonomous")}>
                <Workflow className="mr-2 h-3.5 w-3.5" />
                Workflow autonome
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => openCreate("base")}
                disabled={bases.length === 0}
              >
                <ExternalLink className="mr-2 h-3.5 w-3.5" />
                Automatisation de base
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Tip label={MANAGE_AUTOMATIONS_REQUIRED}>
            <button
              type="button"
              aria-disabled="true"
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded bg-neutral-900 px-3 py-1.5 text-sm text-white opacity-50 dark:bg-neutral-100 dark:text-neutral-900"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Nouvelle
            </button>
          </Tip>
        )}
      </div>

      {items.length === 0 ? (
        <p className="rounded border border-dashed border-neutral-300 p-6 text-center text-sm italic text-neutral-400 dark:border-neutral-700">
          Aucune automatisation pour l&apos;instant.
          {canManage && " Cliquez sur « Nouvelle » pour créer un workflow autonome ou une automatisation de base."}
        </p>
      ) : (
        <div className="space-y-3">
          {groupedVisible.map(([groupLabel, groupItems]) => (
          <div key={groupLabel}>
            <div className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
              {groupLabel}
            </div>
            <ul className="divide-y divide-neutral-200 rounded border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
          {groupItems.map((item) => (
            <li
              key={item.id}
              onClick={() => { setSelectedListId(item.id); setShowHistory(false); }}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setSelectedListId(item.id);
                  setShowHistory(false);
                }
              }}
              tabIndex={0}
              aria-current={selectedListId === item.id ? "true" : undefined}
              className={`flex cursor-pointer flex-wrap items-center gap-3 border border-transparent px-3 py-2 text-sm ${FOCUS_CLS} ${
                selectedListId === item.id
                  ? SELECTED_CLS
                  : "hover:bg-neutral-50 dark:hover:bg-neutral-900"
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-start gap-2">
                  <span title={item.name} className="font-medium line-clamp-2 break-words">{item.name}</span>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                      item.enabled
                        ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                        : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                    }`}
                  >
                    {item.enabled ? "Active" : "Inactive"}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-neutral-500">
                  {item.kind === "autonomous" || !item.databaseId ? (
                    <span className="inline-flex items-center gap-1 text-neutral-500">
                      <Workflow className="h-3 w-3" />
                      Workflow autonome
                    </span>
                  ) : (
                    <Link
                      href={`/bases/${item.databaseId}?spaceId=${encodeURIComponent(currentSpaceId)}`}
                      className="inline-flex items-center gap-1 hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {item.databaseName}
                    </Link>
                  )}
                  <span>•</span>
                  <span>
                    {item.triggerLabel} → {item.actionLabel}
                  </span>
                  {isTallyReception(item) && (
                    <>
                      <span>•</span>
                      <span className={tallyFormMissing(item.triggerType, item.triggerConfig) ? "font-medium text-amber-800 dark:text-amber-300" : undefined}>
                        {tallyFormMissing(item.triggerType, item.triggerConfig)
                          ? tTally("list.subtitleNone")
                          : tTally("list.subtitleId", { id: String(item.triggerConfig.tallyFormId) })}
                      </span>
                    </>
                  )}
                  {item.lastRunAt && (
                    <>
                      <span>•</span>
                      <span>
                        Dernier run :{" "}
                        {new Date(item.lastRunAt).toLocaleString("fr-FR", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                        {item.lastRunStatus && (
                          <span
                            className={`ml-1 ${
                              item.lastRunStatus === "success"
                                ? "text-green-600 dark:text-green-400"
                                : item.lastRunStatus === "partial"
                                  ? "text-amber-700 dark:text-amber-400"
                                  : "text-red-600 dark:text-red-400"
                            }`}
                          >
                            ({item.lastRunStatus === "success" ? "Succès" : item.lastRunStatus === "partial" ? "Partiel" : "Erreur"})
                          </span>
                        )}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {canManage && (
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <button
                        type="button"
                        aria-label="Options de l'automatisation"
                        disabled={busy === item.id}
                        className="rounded p-1 text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 disabled:opacity-50 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    }
                  />
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => openEdit(item)}>
                      Éditer…
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={() => toggle(item)}>
                      {item.enabled ? "Désactiver" : "Activer"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setConfirmDelete(item)}
                      className="text-red-600 focus:bg-red-50 focus:text-red-700 dark:text-red-400 dark:focus:bg-red-950"
                    >
                      Supprimer…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </li>
          ))}
            </ul>
          </div>
          ))}
          {visible.length === 0 && (
            <p className="px-1 py-2 text-xs italic text-neutral-400">
              Aucune automatisation ne correspond à « {filter} ».
            </p>
          )}
        </div>
      )}
      </div>

      {/* Colonne droite — canevas de l'automatisation sélectionnée */}
      <div className="flex-1 min-w-0 rounded border border-neutral-200 dark:border-neutral-800">
        {selected ? (
          <div className="flex h-full flex-col">
            {/* Bandeau supérieur façon Airtable */}
            <div className="flex flex-wrap items-center gap-2 border-b border-neutral-200 px-4 py-2 dark:border-neutral-800">
              <span className="font-medium truncate">{selected.name}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wide ${
                  selected.enabled
                    ? "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
                    : "bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                }`}
              >
                {selected.enabled ? "Activée" : "Désactivée"}
              </span>
              <span className="text-xs text-neutral-500">
                {selected.kind === "autonomous" || !selected.databaseId
                  ? "Workflow autonome (bouton)"
                  : selected.databaseName}
              </span>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  <div role="tablist" aria-label="Vue de l'automatisation" className="inline-flex rounded-md border border-neutral-200 p-0.5 dark:border-neutral-800">
                    {([
                      ["editor", "Éditeur", Pencil, canManage ? "Modifier et tester le scénario" : "Consulter le scénario"],
                      ["history", "Historique", History, "Exécutions passées, détail par étape et rejeu"],
                    ] as const).map(([k, label, TabIcon, tip]) => (
                      <span key={k} className="group/tip relative inline-flex">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={(k === "history") === showHistory}
                          onClick={() => setShowHistory(k === "history")}
                          className={`inline-flex min-h-7 items-center gap-1.5 rounded px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                            (k === "history") === showHistory
                              ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900"
                              : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                          }`}
                        >
                          <TabIcon className="h-3.5 w-3.5" aria-hidden />
                          {label}
                        </button>
                        <Tooltip>{tip}</Tooltip>
                      </span>
                    ))}
                  </div>
                  {isTallyReception(selected) && (
                    <TallyFormButton
                      formMissing={tallyFormMissing(selected.triggerType, selected.triggerConfig)}
                      disabledReason={canManage ? undefined : MANAGE_AUTOMATIONS_REQUIRED}
                      onClick={() => setTallyDialogId(selected.id)}
                    />
                  )}
                  <span className="relative inline-flex items-center gap-1.5 text-xs">
                    <Tip
                      label={
                        !canManage
                          ? MANAGE_AUTOMATIONS_REQUIRED
                          : !selected.enabled && tallyFormMissing(selected.triggerType, selected.triggerConfig)
                            ? tTally("list.switchBlocked")
                            : busy === selected.id
                              ? "Changement en cours"
                              : selected.enabled
                                ? "Désactiver l'automatisme"
                                : "Activer l'automatisme"
                      }
                    >
                      <Switch
                        size="sm"
                        checked={selected.enabled}
                        disabled={!canManage || busy === selected.id}
                        aria-disabled={!selected.enabled && tallyFormMissing(selected.triggerType, selected.triggerConfig) ? true : undefined}
                        className={!selected.enabled && tallyFormMissing(selected.triggerType, selected.triggerConfig) ? "opacity-50" : undefined}
                        onCheckedChange={() => toggle(selected)}
                        aria-label={selected.enabled ? "Désactiver l'automatisme" : "Activer l'automatisme"}
                      />
                    </Tip>
                    <span aria-hidden>{selected.enabled ? "Activé" : "Désactivé"}</span>
                  </span>
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => openEdit(selected)}
                      className="rounded border border-neutral-300 px-2 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                    >
                      Réglages…
                    </button>
                  ) : (
                    <Tip label={MANAGE_AUTOMATIONS_REQUIRED}>
                      <button
                        type="button"
                        aria-disabled="true"
                        className="cursor-not-allowed rounded border border-neutral-300 px-2 py-1 text-xs opacity-50 dark:border-neutral-700"
                      >
                        Réglages…
                      </button>
                    </Tip>
                  )}
                </div>
            </div>
            {/* Historique des exécutions, ou canevas déclencheur → actions */}
            {realMode && <RealModeBanner onRevert={() => setRealMode(false)} />}
            {showHistory ? (
              <RunHistory
                key={selected.id}
                endpoint={itemEndpoint(selected)}
                canReplay={canManage}
                refreshKey={historyKey}
                databaseId={selected.databaseId ?? undefined}
              />
            ) : (
              <div className="min-h-[60vh] flex-1">
                <AutomationStepCanvas
                  key={selected.id}
                  automation={{
                    id: selected.id,
                    databaseId: selected.databaseId ?? "",
                    spaceId: currentSpaceId,
                    name: selected.name,
                    triggerType: selected.triggerType,
                    triggerLabel: selected.triggerLabel,
                    triggerConfig: (selected.triggerConfig ?? {}) as Record<string, unknown>,
                    actionType: selected.actionType,
                    actionConfig: selected.actionConfig,
                    graph: selected.graph,
                    enabled: selected.enabled,
                  }}
                  onOpenHistory={() => setShowHistory(true)}
                  readOnly={!canManage}
                  onSaved={() => router.refresh()}
                  realMode={realMode}
                  onRealModeChange={setRealMode}
                  onRealRun={() => setHistoryKey((k) => k + 1)}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full min-h-[60vh] items-center justify-center p-8 text-center text-sm text-neutral-400">
            Sélectionnez une automatisation à gauche pour voir et éditer son
            enchaînement (déclencheur → actions).
          </div>
        )}
      </div>

      {/* Modal création / édition */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editing ? "Modifier l'automatisation" : "Nouvelle automatisation"}
            </DialogTitle>
            <DialogDescription>
              {editing
                ? "Modifiez le nom, l'état ou la config de l'action. Le déclencheur et l'enchaînement des actions se règlent dans le canevas."
                : "Nom, portée et déclencheur initial : les actions se configurent juste après, dans le canevas."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 text-sm">
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                Nom
              </span>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ex. Notifier Slack à la création"
                className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
              />
            </label>

            {form.kind === "autonomous" ? (
              <p className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/40">
                <Workflow className="mr-1 inline h-3 w-3" />
                Workflow autonome : déclenché manuellement depuis un bouton dans un
                document, indépendamment des bases de données.
              </p>
            ) : (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                  Base
                </span>
                <select
                  value={form.databaseId}
                  onChange={(e) => setForm({ ...form, databaseId: e.target.value })}
                  disabled={!!editing}
                  className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {bases.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {!editing && (
              // Création : seul le déclencheur initial se choisit ici — les
              // actions se configurent dans le canevas, ouvert juste après.
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                  Déclencheur initial
                </span>
                <select
                  value={form.triggerType}
                  onChange={(e) =>
                    setForm({ ...form, triggerType: e.target.value as TriggerType })
                  }
                  className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {(form.kind === "autonomous" ? AUTONOMOUS_TRIGGERS : TRIGGERS).map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {editing && (
            <div className="grid grid-cols-2 gap-3">
              {form.kind === "base" && (
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                    Déclencheur
                  </span>
                  <select
                    value={form.triggerType}
                    onChange={(e) =>
                      setForm({ ...form, triggerType: e.target.value as TriggerType })
                    }
                    disabled
                    className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900"
                  >
                    {TRIGGERS.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                  Action
                </span>
                <select
                  value={form.actionType}
                  onChange={(e) =>
                    setForm({ ...form, actionType: e.target.value as ActionType })
                  }
                  disabled
                  className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {(form.kind === "autonomous" ? AUTONOMOUS_ACTIONS : BASE_ACTIONS).map(
                    (a) => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                        {a.tag ? ` (${a.tag})` : ""}
                      </option>
                    )
                  )}
                </select>
              </label>
            </div>
            )}

            {editing && form.actionType === "webhook" && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                  URL du webhook
                </span>
                <input
                  value={form.webhookUrl}
                  onChange={(e) => setForm({ ...form, webhookUrl: e.target.value })}
                  placeholder="https://exemple.com/hook"
                  className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
                />
              </label>
            )}

            {editing && form.actionType === "send_email" && (
              <div className="space-y-3 rounded border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/40">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                    Destinataire
                  </span>
                  <PlaceholderField
                    value={form.emailTo}
                    onChange={(v) => setForm({ ...form, emailTo: v })}
                    groups={placeholderGroups}
                    placeholder="alice@exemple.com"
                    className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                    Objet
                  </span>
                  <PlaceholderField
                    value={form.emailSubject}
                    onChange={(v) => setForm({ ...form, emailSubject: v })}
                    groups={placeholderGroups}
                    placeholder="Nouvelle ligne créée"
                    className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                    Corps (HTML)
                  </span>
                  <PlaceholderField
                    value={form.emailBody}
                    onChange={(v) => setForm({ ...form, emailBody: v })}
                    groups={placeholderGroups}
                    multiline
                    rows={5}
                    placeholder="<p>Bonjour,</p><p>Une nouvelle ligne a été créée.</p>"
                    className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </label>
                <p className="text-[11px] text-neutral-500">
                  Utilisez « Insérer une variable » pour ajouter une donnée
                  dynamique (cellule, utilisateur…).
                </p>
              </div>
            )}

            {editing && form.actionType === "ai" && (
              <div className="space-y-3 rounded border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/40">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                    Prompt
                  </span>
                  <PlaceholderField
                    value={form.aiPrompt}
                    onChange={(v) => setForm({ ...form, aiPrompt: v })}
                    groups={placeholderGroups}
                    multiline
                    rows={5}
                    placeholder="Rédige un compte-rendu à partir des données de la ligne…"
                    className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                    Instruction système (optionnel)
                  </span>
                  <textarea
                    value={form.aiSystemPrompt}
                    onChange={(e) => setForm({ ...form, aiSystemPrompt: e.target.value })}
                    rows={3}
                    placeholder="Tu es un assistant qui rédige des documents professionnels concis en français."
                    className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                      Document généré
                    </span>
                    <select
                      value={form.aiFormat}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          aiFormat: e.target.value as FormState["aiFormat"],
                        })
                      }
                      className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                    >
                      <option value="none">Aucun (texte seul)</option>
                      <option value="pdf">PDF</option>
                      <option value="docx">Word (DOCX)</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                      Titre du document (optionnel)
                    </span>
                    <PlaceholderField
                      value={form.aiTitle}
                      onChange={(v) => setForm({ ...form, aiTitle: v })}
                      groups={placeholderGroups}
                      placeholder="Compte-rendu"
                      className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                    />
                  </label>
                </div>
                <p className="text-[11px] text-neutral-500">
                  Le résultat IA (et le document généré) est consultable dans
                  l&apos;historique des exécutions. Utilisez « Insérer une
                  variable » pour injecter une donnée dynamique.
                </p>
              </div>
            )}

            {editing && form.actionType === "create_document" && (
              <div className="space-y-3 rounded border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/40">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                    Titre du document
                  </span>
                  <PlaceholderField
                    value={form.docTitle}
                    onChange={(v) => setForm({ ...form, docTitle: v })}
                    groups={placeholderGroups}
                    placeholder="Compte-rendu de réunion"
                    className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                      Classification (optionnel)
                    </span>
                    <select
                      value={form.docClassification}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          docClassification: e.target
                            .value as FormState["docClassification"],
                        })
                      }
                      className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                    >
                      <option value="">Par défaut</option>
                      <option value="public">Public</option>
                      <option value="internal">Interne</option>
                      <option value="confidential">Confidentiel</option>
                      <option value="secret">Secret</option>
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                      Modèle (optionnel)
                    </span>
                    <TemplateSelector
                      spaceId={currentSpaceId}
                      value={form.docTemplateId}
                      onChange={(id) => setForm({ ...form, docTemplateId: id })}
                      className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                    />
                  </label>
                </div>
              </div>
            )}

            {editing && form.actionType === "create_task" && (
              <div className="space-y-3 rounded border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-900/40">
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                    Titre de la tâche
                  </span>
                  <input
                    value={form.taskTitle}
                    onChange={(e) => setForm({ ...form, taskTitle: e.target.value })}
                    placeholder="Relancer le client"
                    className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                      Assigné à (optionnel)
                    </span>
                    <input
                      value={form.taskAssigneeId}
                      onChange={(e) =>
                        setForm({ ...form, taskAssigneeId: e.target.value })
                      }
                      placeholder="{{user.id}} ou un ID utilisateur"
                      className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                      Échéance (optionnel)
                    </span>
                    <input
                      type="datetime-local"
                      value={form.taskDueAt}
                      onChange={(e) => setForm({ ...form, taskDueAt: e.target.value })}
                      className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                    />
                  </label>
                </div>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                    Document lié (optionnel)
                  </span>
                  <input
                    value={form.taskDocumentId}
                    onChange={(e) =>
                      setForm({ ...form, taskDocumentId: e.target.value })
                    }
                    placeholder="ID du document (défaut : document déclencheur)"
                    className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </label>
              </div>
            )}

            {!editing && (
              <p className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500 dark:border-neutral-800 dark:bg-neutral-900/40">
                Le réglage fin du déclencheur (planification, colonne, webhook…) et
                l&apos;ajout des actions se font juste après la création, dans le
                canevas déclencheur → actions.
              </p>
            )}

            {editing &&
              form.actionType !== "send_email" &&
              form.actionType !== "ai" &&
              form.actionType !== "create_document" &&
              form.actionType !== "create_task" && (
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                  {form.actionType === "webhook"
                    ? "Config additionnelle (JSON)"
                    : "Config de l'action (JSON)"}
                </span>
                <textarea
                  value={form.actionConfigJson}
                  onChange={(e) => setForm({ ...form, actionConfigJson: e.target.value })}
                  rows={4}
                  className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
                />
              </label>
            )}

            {editing && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={(e) => setForm({ ...form, enabled: e.target.checked })}
                />
                <span className="text-xs">Activer immédiatement</span>
              </label>
            )}

            {formError && (
              <p className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">
                {formError}
              </p>
            )}
          </div>

          <DialogFooter>
            <button
              onClick={() => setDialogOpen(false)}
              className="rounded px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Annuler
            </button>
            <button
              onClick={save}
              disabled={saving}
              className="rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
            >
              {saving ? "Enregistrement…" : editing ? "Mettre à jour" : "Créer"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation suppression */}
      <Dialog
        open={confirmDelete !== null}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Supprimer l&apos;automatisation ?</DialogTitle>
            <DialogDescription>
              {confirmDelete?.name} sera définitivement supprimée, ainsi que son
              historique d&apos;exécutions. Cette action est irréversible.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <button
              onClick={() => setConfirmDelete(null)}
              className="rounded px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
            >
              Annuler
            </button>
            <button
              onClick={() => confirmDelete && remove(confirmDelete)}
              disabled={busy === confirmDelete?.id}
              className="rounded bg-red-600 px-3 py-1.5 text-sm text-white hover:bg-red-700 disabled:opacity-50"
            >
              Supprimer
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {(() => {
        const tallyItem = items.find((i) => i.id === tallyDialogId && isTallyReception(i));
        return tallyItem && tallyItem.databaseId ? (
          <TallyReceptionDialog
            open
            onOpenChange={(o) => !o && setTallyDialogId(null)}
            automation={{ id: tallyItem.id, databaseId: tallyItem.databaseId, triggerConfig: tallyItem.triggerConfig ?? {} }}
            onSaved={() => router.refresh()}
          />
        ) : null;
      })()}

    </div>
  );
}
