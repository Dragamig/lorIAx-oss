"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Zap,
  GitBranch,
  Plus,
  Trash2,
  Mail,
  Sparkles,
  FileText,
  Image,
  CheckSquare,
  PlusSquare,
  PencilLine,
  Search,
  Bell,
  Webhook,
  ChevronUp,
  ChevronDown,
  GripVertical,
  RefreshCw,
  Play,
  Loader2,
  ShieldAlert,
  Merge,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { WebhookBodyPanel, type LastReceived } from "./webhook-body-panel";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  validateGraph,
  findJoinNode,
  synthesizeGraphFromAction,
  type AutomationGraph,
  type GraphNode,
  type GraphEdge,
  type GraphCondition,
} from "@/lib/automations/automation-graph";
import { linearizeMainChain, reorderMainChain } from "@/lib/automations/graph-reorder";
import { describeCron, isValidCron, nextCronOccurrence } from "@/lib/automations/cron";
import { type PlaceholderGroup } from "./placeholder-field";
import { USER_PLACEHOLDER_GROUP, cellsToOptions, stepOutputOptions, useAutomationColumns, useUpstreamFindRowColumns } from "./automation-shared";
import { PlaceholderField } from "./placeholder-field";
import { ActionConfigForm } from "./action-config-form";
import { TRIGGER_LABELS } from "./automation-labels";
import { TallyImportPanel } from "./tally-import-panel";
import { WebhookTriggerFields } from "./webhook-trigger-fields";
import { StatusPill, StepInspector, TipButton, SELECTED_CLS, FOCUS_CLS, Tooltip, type TestMode, type TraceStepView } from "./debug-shared";
import { TestToolbar, useTestSample } from "./debug-toolbar";

/** Identifiant de l'entrée de trace du déclencheur (cf. TRIGGER_STEP_ID côté serveur). */
const TRIGGER_TRACE_ID = "__trigger__";

/** Déclencheurs proposés au changement de type, selon la portée (base vs autonome). */
const BASE_TRIGGER_TYPES = ["row_created", "row_updated", "row_deleted", "cron", "date_reached", "value_changed", "webhook_inbound"];
const AUTONOMOUS_TRIGGER_TYPES = ["manual", "webhook_inbound"];

// ── Palette d'actions (présentation) ────────────────────────────────────────
type PaletteEntry = { type: string; label: string; icon: typeof Mail; requiresDatabase?: boolean };
const PALETTE: PaletteEntry[] = [
  { type: "create_document", label: "Créer un document", icon: FileText },
  { type: "create_design", label: "Générer un design", icon: Image },
  { type: "create_task", label: "Créer une tâche", icon: CheckSquare },
  { type: "send_email", label: "Envoyer un e-mail", icon: Mail },
  { type: "ai", label: "Générer avec l'IA", icon: Sparkles },
  { type: "notify_user", label: "Notifier un utilisateur", icon: Bell },
  { type: "webhook", label: "Webhook", icon: Webhook },
  { type: "create_row", label: "Créer une ligne", icon: PlusSquare, requiresDatabase: true },
  { type: "update_row", label: "Modifier une ligne", icon: PencilLine, requiresDatabase: true },
  { type: "find_row", label: "Chercher une ligne", icon: Search, requiresDatabase: true },
];
const ACTION_LABEL = (t: string) => PALETTE.find((p) => p.type === t)?.label ?? t;
const ACTION_ICON = (t: string) => PALETTE.find((p) => p.type === t)?.icon ?? Webhook;

const OPERATORS: { value: string; label: string }[] = [
  { value: "is", label: "est" },
  { value: "is_not", label: "n'est pas" },
  { value: "contains", label: "contient" },
  { value: "is_empty", label: "est vide" },
  { value: "is_not_empty", label: "n'est pas vide" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
];
const VARIABLE_OPERATORS = new Set(["is_empty", "is_not_empty", "is", "is_not"]);
const VALUELESS = new Set(["is_empty", "is_not_empty", "is_checked", "is_not_checked"]);

type EditorAutomation = {
  id: string;
  databaseId: string;
  spaceId: string;
  name: string;
  triggerType: string;
  triggerLabel: string;
  triggerConfig: Record<string, unknown>;
  actionType: string;
  actionConfig: Record<string, unknown>;
  graph: AutomationGraph | null;
  /** Automatisme activé : requis pour un import réel Tally. */
  enabled?: boolean;
};

let idSeq = 0;
const genId = () => `n${Date.now().toString(36)}${(idSeq++).toString(36)}`;

/**
 * Canevas vertical d'automatisation façon Airtable : déclencheur en haut, puis
 * actions empilées. Les nœuds condition affichent leurs deux branches
 * (Si vrai / Si faux) en retrait. Panneau de configuration à droite.
 * Conserve le modèle de graphe (branchement) et l'endpoint de sauvegarde.
 */
export function AutomationStepCanvas({
  automation,
  onSaved,
  realMode = false,
  onRealModeChange,
  onRealRun,
  onOpenHistory,
}: {
  automation: EditorAutomation;
  /** Ouvre l'historique des exécutions (lien du récapitulatif d'import Tally). */
  onOpenHistory?: () => void;
  onSaved: () => void;
  /** Mode d'exécution des tests (jamais mémorisé : simulé à l'ouverture). */
  realMode?: boolean;
  onRealModeChange?: (v: boolean) => void;
  /** Appelé après un test réel (rafraîchit l'historique). */
  onRealRun?: () => void;
}) {
  const initial = useMemo(
    () =>
      automation.graph ??
      synthesizeGraphFromAction(automation.actionType, automation.actionConfig),
    [automation]
  );
  const [nodes, setNodes] = useState<GraphNode[]>(initial.nodes);
  const [edges, setEdges] = useState<GraphEdge[]>(initial.edges);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [triggerSelected, setTriggerSelected] = useState(false);
  const [triggerConfig, setTriggerConfig] = useState<Record<string, unknown>>(
    automation.triggerConfig ?? {}
  );
  // Type de déclencheur modifiable (Task 8) : état local (le canevas reçoit
  // `automation` en prop immuable), synchronisé au payload PATCH par `save()`.
  const [triggerType, setTriggerType] = useState<string>(automation.triggerType);
  const [regeneratingWebhook, setRegeneratingWebhook] = useState(false);
  const [copiedField, setCopiedField] = useState<"url" | "secret" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [lastReceived, setLastReceived] = useState<LastReceived | null>(
    (automation.triggerConfig?.lastReceived as LastReceived | undefined) ?? null
  );
  const [bodyLoading, setBodyLoading] = useState(false);
  const [bodyError, setBodyError] = useState<string | null>(null);
  // Dernier champ de saisie focalisé dans le formulaire d'action (cible d'insertion).
  const activeFieldRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const [regenOpen, setRegenOpen] = useState(false);
  // ── Test et débogage (lot 6) ──────────────────────────────────────────────
  const [trace, setTrace] = useState<TraceStepView[] | null>(null);
  const [traceMode, setTraceMode] = useState<TestMode>("simulate");
  const [runningTarget, setRunningTarget] = useState<string | "all" | null>(null);
  const [panelTab, setPanelTab] = useState<"config" | "result">("config");
  const sampleState = useTestSample({
    databaseId: automation.databaseId || undefined,
    triggerType: automation.triggerType,
    lastReceivedAt: lastReceived?.at,
  });
  const snapshot = () => JSON.stringify([nodes, edges, triggerType, triggerConfig]);
  const savedSnapshot = useRef<string | null>(null);
  // Colonnes (pour conditions + variables) — uniquement en contexte base-lié.
  const columns = useAutomationColumns(automation.databaseId);

  // Options de déclencheur proposées, filtrées selon la portée de l'automatisation :
  // une automatisation base-liée garde des déclencheurs liés aux lignes, un workflow
  // autonome ne propose que manuel/webhook (cron non câblé en autonome pour l'instant).
  const triggerOptions = automation.databaseId ? BASE_TRIGGER_TYPES : AUTONOMOUS_TRIGGER_TYPES;
  // Avertissement non bloquant : une action nécessitant une base (create_row/update_row)
  // n'a de sens que dans un contexte base-lié — signale toute incohérence.
  const hasDbOnlyAction = useMemo(
    () =>
      nodes.some(
        (n) => n.kind === "action" && PALETTE.find((p) => p.type === n.actionType)?.requiresDatabase
      ),
    [nodes]
  );
  const triggerScopeWarning = !automation.databaseId && hasDbOnlyAction;

  const byId = useMemo(() => {
    const m = new Map<string, GraphNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  const entryId = useMemo(() => {
    const incoming = new Set(edges.map((e) => e.to));
    return nodes.find((n) => !incoming.has(n.id))?.id ?? null;
  }, [nodes, edges]);

  // ── Glisser-déposer (chaîne principale d'actions uniquement) ──────────────
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const mainChainIds = useMemo(() => linearizeMainChain({ nodes, edges }), [nodes, edges]);
  function handleDragEnd(e: DragEndEvent) {
    const activeId = String(e.active.id);
    const overId = e.over ? String(e.over.id) : null;
    if (!overId || activeId === overId) return;
    setEdges((es) => reorderMainChain(es, mainChainIds, activeId, overId));
  }

  const selectedNode = selectedId ? byId.get(selectedId) ?? null : null;

  // ── Test : l'API exécute le flux ENREGISTRÉ, pas l'état en cours d'édition ──
  if (savedSnapshot.current === null) savedSnapshot.current = snapshot();
  const dirty = snapshot() !== savedSnapshot.current;
  const testBlockReason = dirty
    ? "Enregistrez le flux : le test exécute la version enregistrée"
    : sampleState.reason;
  const traceByNode = useMemo(() => {
    const m = new Map<string, TraceStepView>();
    for (const st of trace ?? []) m.set(st.nodeId, st);
    return m;
  }, [trace]);
  const selectedStep = selectedId ? traceByNode.get(selectedId) : undefined;
  const triggerStep = traceByNode.get(TRIGGER_TRACE_ID);
  const showResult = !!selectedStep && panelTab === "result";
  const showTriggerResult = triggerSelected && !!triggerStep && panelTab === "result";

  async function runTest(untilNodeId?: string) {
    if (!sampleState.sample || runningTarget) return;
    const endpoint = automation.databaseId
      ? `/api/databases/${automation.databaseId}/automations/${automation.id}/test`
      : `/api/automations/${automation.id}/test`;
    const mode: TestMode = realMode ? "real" : "simulate";
    setRunningTarget(untilNodeId ?? "all");
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, untilNodeId, sample: sampleState.sample }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(
          res.status === 429
            ? "Trop de tests ou quota atteint : réessayez dans un instant"
            : res.status === 403
              ? "Les automatisations sont désactivées par l'administrateur"
              : (j?.error ?? "Le test a échoué")
        );
        return;
      }
      const allSteps = (j.steps ?? []) as TraceStepView[];
      setTrace(allSteps);
      const steps = allSteps.filter((x) => x.kind !== "trigger");
      setTraceMode(mode);
      const failed = steps.filter((x) => x.status === "error");
      const ok = steps.filter((x) => x.status === "success" || x.status === "simulated").length;
      const skipped = steps.filter((x) => x.status === "skipped").length;
      const parts = [`${ok} réussie${ok > 1 ? "s" : ""}`];
      if (failed.length) parts.push(`${failed.length} en erreur`);
      if (skipped) parts.push(`${skipped} ignorée${skipped > 1 ? "s" : ""}`);
      const label = `${mode === "real" ? "Test réel" : "Test simulé"} terminé : ${parts.join(", ")}`;
      if (failed.length) {
        toast.error(label);
        selectNode(failed[0].nodeId);
        setPanelTab("result");
      } else if (steps.length === 0) {
        toast.error(j?.error ?? "Aucune étape exécutée");
      } else {
        toast.success(label);
        if (selectedId && steps.some((x) => x.nodeId === selectedId)) setPanelTab("result");
      }
      if (mode === "real") onRealRun?.();
    } catch {
      toast.error("Erreur réseau pendant le test");
    } finally {
      setRunningTarget(null);
    }
  }

  function openResult(id: string) {
    selectNode(id);
    setPanelTab("result");
  }

  // ── Variables disponibles (placeholders) ──────────────────────────────────
  const upstreamNodes: GraphNode[] = useMemo(() => {
    const upstream: GraphNode[] = [];
    const seenUp = new Set<string>();
    let cursor = selectedId;
    while (cursor && !seenUp.has(cursor)) {
      seenUp.add(cursor);
      const from = edges.find((e) => e.to === cursor)?.from;
      const n = from ? byId.get(from) : undefined;
      if (n?.kind === "action") upstream.unshift(n);
      cursor = from ?? null;
    }
    return upstream;
  }, [edges, byId, selectedId]);
  const upstreamColumns = useUpstreamFindRowColumns(upstreamNodes);
  const placeholderGroups: PlaceholderGroup[] = useMemo(() => {
    const groups: PlaceholderGroup[] = [USER_PLACEHOLDER_GROUP];
    if (automation.databaseId) {
      groups.push({
        group: "Ligne déclencheuse",
        options: [
          { label: "ID de la ligne", value: "{{rowId}}" },
          { label: "Événement", value: "{{event}}" },
          ...cellsToOptions(columns),
        ],
      });
    }
    // Sorties des étapes amont (storeAs + type d'action), du nœud sélectionné.
    const stored = stepOutputOptions(upstreamNodes, upstreamColumns);
    if (stored.length) groups.push({ group: "Sorties des étapes précédentes", options: stored });
    return groups;
  }, [automation.databaseId, columns, upstreamNodes, upstreamColumns]);

  function selectNode(id: string | null) {
    setSelectedId(id);
    setPanelTab("config");
    setTriggerSelected(false);
  }

  const setTriggerCfg = (key: string, value: unknown) =>
    setTriggerConfig((c) => {
      const next = { ...c };
      if (value === "" || value === undefined) delete next[key];
      else next[key] = value;
      return next;
    });

  function patchNode(id: string, patch: Partial<GraphNode>) {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));
  }

  // Met à jour un champ de la condition du nœud sélectionné en conservant les autres.
  function updateCondition(field: "columnId" | "operator" | "value" | "path", value: string) {
    if (!selectedNode) return;
    const current: GraphCondition = selectedNode.condition ?? { columnId: "", operator: "is_not_empty" };
    patchNode(selectedNode.id, { condition: { ...current, [field]: value } as GraphCondition });
  }

  // Bascule la source de la condition (cellule ↔ variable) en repartant d'une
  // condition cohérente : l'opérateur doit exister pour la nouvelle source.
  function setConditionSource(source: "cell" | "variable") {
    if (!selectedNode) return;
    patchNode(selectedNode.id, {
      condition:
        source === "variable"
          ? { source: "variable", path: "", columnId: "", operator: "is_not_empty" }
          : { columnId: "", operator: "is_not_empty" },
    });
  }

  // Ajoute une étape à la suite de `afterId` (sur la branche donnée si condition).
  function addStep(kind: "action" | "condition", afterId: string | null, branch?: "true" | "false") {
    const id = genId();
    const node: GraphNode =
      kind === "condition"
        ? { id, kind: "condition", condition: { columnId: "", operator: "is_not_empty" } }
        : { id, kind: "action", actionType: "create_document", actionConfig: {} };
    setNodes((ns) => [...ns, node]);
    setEdges((es) => (afterId ? [...es, { from: afterId, to: id, ...(branch ? { branch } : {}) }] : es));
    selectNode(id);
  }

  function deleteNode(id: string) {
    const node = byId.get(id);
    if (!node) return;
    const outgoing = edges.filter((e) => e.from === id);
    if (node.kind === "condition" && outgoing.length > 0) {
      setSaveError("Videz d'abord les branches de la condition avant de la supprimer.");
      return;
    }
    const incoming = edges.find((e) => e.to === id);
    const out = outgoing[0];
    setNodes((ns) => ns.filter((n) => n.id !== id));
    setEdges((es) => {
      let next = es.filter((e) => e.from !== id && e.to !== id);
      // Reconnecte le prédécesseur au successeur (action linéaire).
      if (incoming && out) {
        next = [...next, { from: incoming.from, to: out.to, ...(incoming.branch ? { branch: incoming.branch } : {}) }];
      }
      return next;
    });
    if (selectedId === id) selectNode(null);
    setSaveError(null);
  }

  // Insère une étape entre fromId et toId (sur l'arête existante, branche conservée).
  function insertBetween(fromId: string, toId: string, kind: "action" | "condition") {
    const id = genId();
    const node: GraphNode =
      kind === "condition"
        ? { id, kind: "condition", condition: { columnId: "", operator: "is_not_empty" } }
        : { id, kind: "action", actionType: "create_document", actionConfig: {} };
    setNodes((ns) => [...ns, node]);
    setEdges((es) => [
      ...es.map((e) => (e.from === fromId && e.to === toId ? { ...e, to: id } : e)),
      { from: id, to: toId },
    ]);
    selectNode(id);
  }

  // Réordonne une étape action dans une séquence linéaire (pas à travers une
  // condition). « down » échange le nœud avec son successeur ; « up » échange
  // le prédécesseur avec le nœud.
  function moveStep(id: string, dir: "up" | "down") {
    const aId = dir === "down" ? id : edges.find((e) => e.to === id && !e.branch)?.from;
    if (!aId) return;
    const a = byId.get(aId);
    const bEdge = edges.find((e) => e.from === aId && !e.branch);
    const bId = bEdge?.to;
    if (!a || a.kind !== "action" || !bId) return;
    const b = byId.get(bId);
    if (!b || b.kind !== "action") return;
    const predEdge = edges.find((e) => e.to === aId);
    const bNextEdge = edges.find((e) => e.from === bId && !e.branch);
    setEdges((es) => {
      const next = es.filter((e) => e !== predEdge && e !== bEdge && e !== bNextEdge);
      if (predEdge) next.push({ from: predEdge.from, to: bId, ...(predEdge.branch ? { branch: predEdge.branch } : {}) });
      next.push({ from: bId, to: aId });
      if (bNextEdge) next.push({ from: aId, to: bNextEdge.to });
      return next;
    });
  }

  async function save() {
    setSaveError(null);
    const graph: AutomationGraph = { nodes, edges };
    const check = validateGraph(graph);
    if (!check.ok) {
      setSaveError(`Flux invalide : ${check.error}`);
      return;
    }
    if (triggerType === "cron" && !isValidCron(String(triggerConfig.cron ?? ""))) {
      setSaveError("Expression cron invalide : corrigez la planification avant d'enregistrer.");
      return;
    }
    setSaving(true);
    try {
      const endpoint = automation.databaseId
        ? `/api/databases/${automation.databaseId}/automations/${automation.id}`
        : `/api/automations/${automation.id}`;
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graph, triggerConfig, triggerType }),
      });
      if (res.ok) {
        // Le serveur peut avoir complété triggerConfig (ex. génération du
        // token/secret webhook à la bascule vers webhook_inbound) : on
        // resynchronise l'état local pour l'afficher sans re-sélection.
        const updated = await res.json().catch(() => null);
        if (updated?.triggerConfig && typeof updated.triggerConfig === "object") {
          setTriggerConfig(updated.triggerConfig as Record<string, unknown>);
        }
        savedSnapshot.current = JSON.stringify([
          nodes,
          edges,
          triggerType,
          updated?.triggerConfig && typeof updated.triggerConfig === "object" ? updated.triggerConfig : triggerConfig,
        ]);
        onSaved();
      } else {
        const j = await res.json().catch(() => ({}));
        setSaveError(j?.error ?? "Enregistrement impossible.");
      }
    } finally {
      setSaving(false);
    }
  }

  // Régénère le token/secret du webhook entrant. Génération TOUJOURS côté
  // serveur (route PATCH) : le client ne calcule ni ne propose jamais de
  // valeur, il ne fait que déclencher la régénération et afficher le résultat.
  async function regenerateWebhook() {
    setSaveError(null);
    setRegeneratingWebhook(true);
    try {
      const endpoint = automation.databaseId
        ? `/api/databases/${automation.databaseId}/automations/${automation.id}`
        : `/api/automations/${automation.id}`;
      const res = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerType: "webhook_inbound", regenerateWebhookToken: true }),
      });
      if (res.ok) {
        const updated = await res.json().catch(() => null);
        if (updated?.triggerConfig && typeof updated.triggerConfig === "object") {
          setTriggerConfig(updated.triggerConfig as Record<string, unknown>);
          setLastReceived((updated.triggerConfig as Record<string, unknown>).lastReceived as LastReceived | null ?? null);
        }
        toast.success("URL et secret régénérés : les anciens ne fonctionnent plus");
        onSaved();
      } else {
        const j = await res.json().catch(() => ({}));
        setSaveError(j?.error ?? "Régénération impossible.");
        toast.error(j?.error ?? "Régénération impossible");
      }
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setRegeneratingWebhook(false);
      setRegenOpen(false);
    }
  }

  function copyToClipboard(field: "url" | "secret", value: string) {
    navigator.clipboard?.writeText(value).then(
      () => {
        setCopiedField(field);
        toast.success(field === "url" ? "URL copiée" : "Secret copié");
        setTimeout(() => setCopiedField((c) => (c === field ? null : c)), 1500);
      },
      () => toast.error("Copie impossible")
    );
  }

  // Relit l'automatisation (GET liste) pour récupérer le dernier corps reçu.
  async function refreshLastReceived() {
    setBodyLoading(true);
    setBodyError(null);
    try {
      const endpoint = automation.databaseId
        ? `/api/databases/${automation.databaseId}/automations`
        : `/api/automations?spaceId=${encodeURIComponent(automation.spaceId)}`;
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error("http");
      const list = (await res.json()) as { id: string; triggerConfig?: Record<string, unknown> }[];
      const me = list.find((a) => a.id === automation.id);
      setLastReceived((me?.triggerConfig?.lastReceived as LastReceived | undefined) ?? null);
    } catch {
      setBodyError("Impossible de lire le dernier corps reçu. Réessayez.");
    } finally {
      setBodyLoading(false);
    }
  }

  // Insère le jeton dans le dernier champ actif de l'action sélectionnée,
  // sinon le copie dans le presse-papiers.
  function pickBodyToken(token: string) {
    const el = activeFieldRef.current;
    if (selectedNode?.kind === "action" && el && el.isConnected) {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      setter?.call(el, el.value.slice(0, start) + token + el.value.slice(end));
      el.dispatchEvent(new Event("input", { bubbles: true }));
      const pos = start + token.length;
      el.focus();
      el.setSelectionRange(pos, pos);
      toast.success("Variable insérée");
      return;
    }
    navigator.clipboard?.writeText(token).then(
      () => toast.success("Variable copiée : collez-la dans un champ de l'action"),
      () => toast.error("Copie impossible")
    );
  }

  function stepDebugProps(id: string) {
    return {
      step: traceByNode.get(id),
      onOpenResult: () => openResult(id),
      onTest: () => void runTest(id),
      testingThis: runningTarget === id,
      testDisabledReason: runningTarget
        ? "Un test est déjà en cours"
        : testBlockReason,
    };
  }

  // ── Rendu récursif d'une chaîne à partir d'un nœud ────────────────────────
  function renderChain(startId: string | null, branch?: "true" | "false", parentId?: string, seen = new Set<string>(), stops: ReadonlySet<string> = new Set()): React.ReactNode {
    if (startId && stops.has(startId)) {
      const target = byId.get(startId);
      const base = target?.kind === "condition" ? "Condition" : ACTION_LABEL(target?.actionType ?? "");
      const name = target?.storeAs ? `${base} (${target.storeAs})` : base;
      return <JoinMarker name={name} onSelect={() => selectNode(startId)} />;
    }
    if (!startId) {
      return <AddStepButton onAdd={(k) => addStep(k, parentId ?? null, branch)} dbAvailable={!!automation.databaseId} />;
    }
    if (seen.has(startId)) return null;
    seen.add(startId);
    const node = byId.get(startId);
    if (!node) return null;

    if (node.kind === "condition") {
      const trueNext = edges.find((e) => e.from === startId && e.branch === "true")?.to ?? null;
      const falseNext = edges.find((e) => e.from === startId && e.branch === "false")?.to ?? null;
      const joinId = findJoinNode({ nodes, edges }, startId);
      const branchStops = joinId ? new Set([...stops, joinId]) : stops;
      return (
        <>
          <StepCard
            selected={selectedId === startId}
            onSelect={() => selectNode(startId)}
            onDelete={() => deleteNode(startId)}
            {...stepDebugProps(startId)}
            icon={<GitBranch className="h-4 w-4" />}
            tone="amber"
            title="Condition"
            subtitle={
              node.condition?.source === "variable"
                ? node.condition.path
                  ? `${node.condition.path} - ${OPERATORS.find((o) => o.value === node.condition?.operator)?.label ?? node.condition.operator}`
                  : "À configurer"
                : node.condition?.columnId
                ? `${columns.find((c) => c.id === node.condition?.columnId)?.name ?? "colonne"} - ${OPERATORS.find((o) => o.value === node.condition?.operator)?.label ?? node.condition?.operator}`
                : "À configurer"
            }
          />
          <div className="ml-4 border-l border-neutral-200 pl-4 dark:border-neutral-800">
            <div className="my-1 text-[10px] font-semibold uppercase tracking-wider text-green-600 dark:text-green-400">Si vrai</div>
            {renderChain(trueNext, "true", startId, seen, branchStops)}
            <div className="my-1 mt-3 text-[10px] font-semibold uppercase tracking-wider text-red-600 dark:text-red-400">Si faux</div>
            {renderChain(falseNext, "false", startId, seen, branchStops)}
          </div>
          {joinId && (
            <>
              <Connector />
              {renderChain(joinId, undefined, startId, seen, stops)}
            </>
          )}
        </>
      );
    }

    const Icon = ACTION_ICON(node.actionType ?? "");
    const next = edges.find((e) => e.from === startId && !e.branch)?.to ?? null;
    const predId = edges.find((e) => e.to === startId)?.from;
    const canMoveUp = !!predId && byId.get(predId)?.kind === "action";
    const canMoveDown = !!next && byId.get(next)?.kind === "action";
    // Étapes de la chaîne principale : glisser-déposer via dnd-kit. Étapes des
    // branches (Si vrai / Si faux) : rendues telles quelles, sans poignée.
    const draggable = mainChainIds.includes(startId);
    const stepCard = (
      <StepCard
        selected={selectedId === startId}
        onSelect={() => selectNode(startId)}
        onDelete={() => deleteNode(startId)}
        onMoveUp={canMoveUp ? () => moveStep(startId, "up") : undefined}
        onMoveDown={canMoveDown ? () => moveStep(startId, "down") : undefined}
        {...stepDebugProps(startId)}
        icon={<Icon className="h-4 w-4" />}
        tone="sky"
        title={ACTION_LABEL(node.actionType ?? "")}
        subtitle={
          [node.storeAs ? `→ variable « ${node.storeAs} »` : null, node.continueOnError ? "continue si échec" : null]
            .filter(Boolean)
            .join(" · ") || undefined
        }
      />
    );
    return (
      <>
        {draggable ? <SortableStepCard id={startId}>{stepCard}</SortableStepCard> : stepCard}
        {next ? (
          <AddStepButton
            onAdd={(k) => insertBetween(startId, next, k)}
            dbAvailable={!!automation.databaseId}
          />
        ) : (
          <Connector />
        )}
        {renderChain(next, undefined, startId, seen, stops)}
      </>
    );
  }

  return (
    <>
    <TestToolbar
      sample={sampleState}
      running={runningTarget === "all"}
      disabledReason={runningTarget ? "Un test est déjà en cours" : testBlockReason}
      realMode={realMode}
      onRealModeChange={(v) => onRealModeChange?.(v)}
      onRun={() => void runTest()}
    />
    <div className="grid grid-cols-[minmax(0,1fr)_340px] items-start gap-4">
      {/* Canevas vertical. Pas d'`overflow-y-auto` ici : ce conteneur n'a pas de
          hauteur propre, la classe le transformait en boîte de défilement calée
          sur la colonne de configuration, qui est plus courte, et tronquait la
          chaîne d'actions. Le défilement est porté par la carte parente. */}
      <div className="min-w-0 p-4">
        <div className="mx-auto max-w-xl">
          <div className="mb-1 text-center text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
            Déclencheur
          </div>
          <StepCard
            selected={triggerSelected}
            onSelect={() => { setSelectedId(null); setTriggerSelected(true); }}
            icon={<Zap className="h-4 w-4" />}
            tone="violet"
            title={TRIGGER_LABELS[triggerType] ?? automation.triggerLabel}
            subtitle={automation.databaseId ? undefined : "Clic sur un bouton"}
            step={triggerStep}
            onOpenResult={() => {
              setSelectedId(null);
              setTriggerSelected(true);
              setPanelTab("result");
            }}
          />
          <Connector />
          <div className="mb-1 text-center text-[10px] font-semibold uppercase tracking-widest text-neutral-400">
            Actions
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={mainChainIds} strategy={verticalListSortingStrategy}>
              {renderChain(entryId)}
            </SortableContext>
          </DndContext>
        </div>
      </div>

      {/* Panneau de configuration */}
      <div className="min-w-0 border-l border-neutral-200 p-3 dark:border-neutral-800">
        {((selectedStep && !triggerSelected) || (triggerSelected && triggerStep)) && (
          <div role="tablist" aria-label="Panneau de l'étape" className="mb-3 inline-flex rounded-md border border-neutral-200 p-0.5 dark:border-neutral-800">
            {(["config", "result"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={panelTab === t}
                onClick={() => setPanelTab(t)}
                className={`min-h-7 rounded px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                  panelTab === t ? "bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900" : "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
                }`}
              >
                {t === "config" ? "Configuration" : "Résultat"}
              </button>
            ))}
          </div>
        )}
        {showResult && selectedStep && !triggerSelected ? (
          <StepInspector
            title={
              selectedStep.kind === "condition" ? "Condition" : ACTION_LABEL(selectedStep.actionType ?? "")
            }
            step={selectedStep}
            index={(trace?.filter((x) => x.kind !== "trigger").findIndex((x) => x.nodeId === selectedStep.nodeId) ?? 0) + 1}
            mode={traceMode}
            databaseId={automation.databaseId || undefined}
          />
        ) : showTriggerResult && triggerStep ? (
          <StepInspector
            title="Déclencheur"
            step={triggerStep}
            mode={traceMode}
            databaseId={automation.databaseId || undefined}
          />
        ) : triggerSelected ? (
          <div className="space-y-3">
            <div className="text-sm font-medium">Déclencheur</div>
            <div className="text-xs text-neutral-500">{TRIGGER_LABELS[triggerType] ?? automation.triggerLabel}</div>
            {triggerType === "cron" ? (
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-500">
                  Planification (expression cron, heure UTC)
                </span>
                <input
                  value={String(triggerConfig.cron ?? "")}
                  onChange={(e) => setTriggerCfg("cron", e.target.value)}
                  placeholder="0 9 * * *"
                  className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
                />
                <span
                  className={`mt-1 block text-[11px] ${
                    triggerConfig.cron && !isValidCron(String(triggerConfig.cron))
                      ? "text-red-600 dark:text-red-400"
                      : "text-neutral-500"
                  }`}
                >
                  {triggerConfig.cron
                    ? isValidCron(String(triggerConfig.cron))
                      ? describeCron(String(triggerConfig.cron))
                      : "Expression cron invalide"
                    : "Ex. « 0 9 * * * » = tous les jours à 09:00"}
                </span>
                {typeof triggerConfig.cron === "string" &&
                  triggerConfig.cron &&
                  isValidCron(triggerConfig.cron) && (
                    <span className="mt-0.5 block text-[11px] text-neutral-400">
                      Prochaine exécution (UTC) :{" "}
                      {nextCronOccurrence(triggerConfig.cron)?.toLocaleString("fr-FR", {
                        dateStyle: "medium",
                        timeStyle: "short",
                        timeZone: "UTC",
                      })}
                    </span>
                  )}
              </label>
            ) : triggerType === "date_reached" ? (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs text-neutral-500">Colonne date</span>
                  <select
                    value={String(triggerConfig.columnId ?? "")}
                    onChange={(e) => setTriggerCfg("columnId", e.target.value)}
                    className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                  >
                    <option value="">— Choisir —</option>
                    {columns.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-neutral-500">Décalage (jours, +/−)</span>
                  <input
                    type="number"
                    value={String(triggerConfig.offsetDays ?? 0)}
                    onChange={(e) => setTriggerCfg("offsetDays", e.target.value ? Number(e.target.value) : 0)}
                    className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-neutral-500">Heure (0–23)</span>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={String(triggerConfig.atHour ?? 9)}
                    onChange={(e) => setTriggerCfg("atHour", e.target.value ? Number(e.target.value) : 0)}
                    className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </label>
              </>
            ) : triggerType === "value_changed" ? (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs text-neutral-500">Colonne surveillée</span>
                  <select
                    value={String(triggerConfig.columnId ?? "")}
                    onChange={(e) => setTriggerCfg("columnId", e.target.value)}
                    className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                  >
                    <option value="">— Choisir —</option>
                    {columns.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </label>
                <p className="text-[11px] italic text-neutral-400">
                  Le workflow se déclenche quand la valeur de cette colonne change.
                </p>
              </>
            ) : triggerType === "webhook_inbound" ? (
              <WebhookTriggerFields
                token={typeof triggerConfig.token === "string" ? triggerConfig.token : undefined}
                secret={typeof triggerConfig.secret === "string" ? triggerConfig.secret : undefined}
                copiedField={copiedField}
                onCopy={copyToClipboard}
                onRegenerate={() => setRegenOpen(true)}
                regenerating={regeneratingWebhook}
                hasReceived={!!lastReceived}
                tally={(webhookUrl) => (
                  <TallyImportPanel
                    automation={{
                      id: automation.id,
                      databaseId: automation.databaseId || null,
                      enabled: automation.enabled ?? false,
                      webhookUrl,
                    }}
                    onOpenHistory={onOpenHistory}
                  />
                )}
                body={
                  <WebhookBodyPanel
                    lastReceived={lastReceived}
                    loading={bodyLoading}
                    error={bodyError}
                    onRefresh={refreshLastReceived}
                    onPick={pickBodyToken}
                    canInsert={false}
                  />
                }
              />
            ) : (
              <p className="text-[11px] italic text-neutral-400">
                Ce déclencheur n&apos;a pas de réglages.
                {!automation.databaseId && " Il s'active au clic sur un bouton dans un document."}
              </p>
            )}

            <div className="border-t border-neutral-200 pt-3 dark:border-neutral-800">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-600 dark:text-neutral-300">
                  Type de déclencheur
                </span>
                <select
                  value={triggerType}
                  onChange={(e) => setTriggerType(e.target.value)}
                  className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {triggerOptions.map((t) => (
                    <option key={t} value={t}>
                      {TRIGGER_LABELS[t] ?? t}
                    </option>
                  ))}
                </select>
              </label>
              {triggerType !== automation.triggerType && (
                <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-500">
                  Changement non enregistré — cliquez sur « Enregistrer le flux ».
                </p>
              )}
              {triggerScopeWarning && (
                <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-500">
                  Une action de ce flux (créer/modifier une ligne) nécessite une base ; ce
                  workflow autonome ne pourra pas l&apos;exécuter.
                </p>
              )}
            </div>
          </div>
        ) : selectedNode ? (
          selectedNode.kind === "action" ? (
            <div className="space-y-3">
              <div className="text-sm font-medium">Action</div>
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-500">Type</span>
                <select
                  value={selectedNode.actionType}
                  onChange={(e) => patchNode(selectedNode.id, { actionType: e.target.value })}
                  className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {PALETTE.filter((p) => !p.requiresDatabase || automation.databaseId).map((p) => (
                    <option key={p.type} value={p.type}>{p.label}</option>
                  ))}
                </select>
              </label>
              <div
                onFocusCapture={(e) => {
                  const t = e.target;
                  if ((t instanceof HTMLInputElement && t.type === "text") || t instanceof HTMLTextAreaElement) {
                    if (!t.readOnly) activeFieldRef.current = t;
                  }
                }}
              >
                <ActionConfigForm
                  actionType={selectedNode.actionType ?? ""}
                  config={selectedNode.actionConfig ?? {}}
                  onChange={(next) => patchNode(selectedNode.id, { actionConfig: next })}
                  groups={placeholderGroups}
                  columns={columns}
                  spaceId={automation.spaceId}
                  databaseId={automation.databaseId || undefined}
                />
              </div>
              {triggerType === "webhook_inbound" && (
                <div className="border-t border-neutral-200 pt-3 dark:border-neutral-800">
                  <WebhookBodyPanel
                    lastReceived={lastReceived}
                    loading={bodyLoading}
                    error={bodyError}
                    onRefresh={refreshLastReceived}
                    onPick={pickBodyToken}
                    canInsert={!!activeFieldRef.current?.isConnected}
                  />
                </div>
              )}
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-500">Stocker le résultat (variable)</span>
                <input
                  value={selectedNode.storeAs ?? ""}
                  onChange={(e) => patchNode(selectedNode.id, { storeAs: e.target.value.trim() || undefined })}
                  placeholder="ex. doc"
                  className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
                />
              </label>
              <label
                className="flex min-h-6 cursor-pointer items-center gap-1.5 text-xs"
                title="Si cette étape échoue, l'erreur est tracée et le scénario continue. La variable de l'étape est alors vide et le run est marqué « partiel »."
              >
                <input
                  type="checkbox"
                  checked={selectedNode.continueOnError === true}
                  onChange={(e) => patchNode(selectedNode.id, { continueOnError: e.target.checked ? true : undefined })}
                  aria-label="Continuer si cette étape échoue"
                  className="h-3.5 w-3.5 rounded border-neutral-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                />
                <ShieldAlert className="h-3.5 w-3.5" aria-hidden />
                Continuer si cette étape échoue
              </label>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="text-sm font-medium">Condition</div>
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-500">Source</span>
                <select
                  value={selectedNode.condition?.source === "variable" ? "variable" : "cell"}
                  onChange={(e) => setConditionSource(e.target.value as "cell" | "variable")}
                  aria-label="Source de la condition"
                  title="Ce que la condition teste"
                  className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                >
                  <option value="cell">Cellule de la ligne</option>
                  <option value="variable">Variable</option>
                </select>
              </label>
              {selectedNode.condition?.source === "variable" ? (
                <label className="block">
                  <span className="mb-1 block text-xs text-neutral-500">Variable</span>
                  <PlaceholderField
                    value={selectedNode.condition.path ?? ""}
                    onChange={(v) => updateCondition("path", v.trim())}
                    groups={placeholderGroups.filter((g) => g.options.some((o) => o.value.startsWith("{{variables.")))
                      .map((g) => ({ ...g, options: g.options.filter((o) => o.value.startsWith("{{variables.")) }))}
                    dates={false}
                    transform={(t) => t.replace(/^\{\{variables\./, "").replace(/\}\}$/, "")}
                    placeholder="contact.foundRow.id"
                    className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </label>
              ) : (
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-500">Colonne</span>
                <select
                  value={selectedNode.condition?.columnId ?? ""}
                  onChange={(e) => updateCondition("columnId", e.target.value)}
                  className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                >
                  <option value="">— Choisir —</option>
                  {columns.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </label>
              )}
              <label className="block">
                <span className="mb-1 block text-xs text-neutral-500">Opérateur</span>
                <select
                  value={selectedNode.condition?.operator ?? "is_not_empty"}
                  onChange={(e) => updateCondition("operator", e.target.value)}
                  className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                >
                  {OPERATORS.filter(
                    (o) => selectedNode.condition?.source !== "variable" || VARIABLE_OPERATORS.has(o.value)
                  ).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </label>
              {!VALUELESS.has(selectedNode.condition?.operator ?? "") && (
                <label className="block">
                  <span className="mb-1 block text-xs text-neutral-500">Valeur</span>
                  <input
                    value={selectedNode.condition?.value ?? ""}
                    onChange={(e) => updateCondition("value", e.target.value)}
                    className="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-900"
                  />
                </label>
              )}
              {!automation.databaseId && (
                <p className="text-[11px] italic text-neutral-400">Les conditions s&apos;appliquent au contexte base-lié.</p>
              )}
            </div>
          )
        ) : (
          <p className="text-xs italic text-neutral-400">
            Sélectionnez une étape pour la configurer, ou ajoutez-en une avec « + ».
          </p>
        )}

        <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
          {saveError && (
            <p className="mb-2 rounded bg-red-50 px-2 py-1 text-xs text-red-700 dark:bg-red-950 dark:text-red-300">{saveError}</p>
          )}
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="w-full rounded bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            {saving ? "Enregistrement…" : "Enregistrer le flux"}
          </button>
        </div>
      </div>
      <Dialog open={regenOpen} onOpenChange={setRegenOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Régénérer l&apos;URL et le secret ?</DialogTitle>
            <DialogDescription>
              L&apos;URL et le secret actuels cessent de fonctionner immédiatement. Les systèmes
              qui appellent ce webhook devront être mis à jour.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRegenOpen(false)} disabled={regeneratingWebhook}>
              Annuler
            </Button>
            <Button onClick={regenerateWebhook} disabled={regeneratingWebhook}>
              <RefreshCw className={`h-3.5 w-3.5 ${regeneratingWebhook ? "animate-spin" : ""}`} />
              Régénérer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </>
  );
}

// ── Sous-composants présentation ─────────────────────────────────────────────

function JoinMarker({ name, onSelect }: { name: string; onSelect: () => void }) {
  return (
    <span className="group/tip relative inline-flex">
      <button
        type="button"
        onClick={onSelect}
        aria-label={`Rejoint l'étape : ${name}`}
        className={`inline-flex min-h-7 items-center gap-1.5 rounded border border-dashed border-neutral-400 px-2 text-xs text-neutral-700 hover:bg-neutral-100 dark:border-neutral-500 dark:text-neutral-200 dark:hover:bg-neutral-800 ${FOCUS_CLS}`}
      >
        <Merge className="h-3.5 w-3.5" aria-hidden />
        Rejoint l&apos;étape : {name}
      </button>
      <Tooltip align="left">Les deux branches se rejoignent sur cette étape, affichée sous la condition. Clic : la sélectionner.</Tooltip>
    </span>
  );
}

function Connector() {
  return <div className="mx-auto my-1 h-4 w-px bg-neutral-300 dark:bg-neutral-700" />;
}

function StepCard({
  icon,
  title,
  subtitle,
  tone,
  selected,
  onSelect,
  onDelete,
  onMoveUp,
  onMoveDown,
  step,
  onTest,
  testingThis,
  testDisabledReason,
  onOpenResult,
}: {
  step?: TraceStepView;
  onTest?: () => void;
  testingThis?: boolean;
  testDisabledReason?: string;
  onOpenResult?: () => void;
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  tone: "violet" | "sky" | "amber";
  selected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
}) {
  const toneCls = {
    violet: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
    sky: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  }[tone];
  return (
    <div
      onClick={onSelect}
      role="group"
      tabIndex={0}
      aria-label={title}
      aria-current={selected ? "step" : undefined}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      className={`group flex cursor-pointer flex-col gap-1.5 rounded-lg border px-3 py-2.5 shadow-sm transition-colors ${FOCUS_CLS} ${
        selected ? SELECTED_CLS : "border-neutral-200 bg-white hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900"
      }`}
    >
      <div className="flex items-center gap-3">
      <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded ${toneCls}`}>{icon}</span>
      <div className="min-w-24 flex-1">
        <div className="truncate text-sm font-medium">{title}</div>
        {subtitle && <div className="truncate text-xs text-neutral-500">{subtitle}</div>}
      </div>
      {onMoveUp && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
          aria-label="Monter l'étape"
          className="rounded p-1 text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-100 hover:text-neutral-700 group-hover:opacity-100 dark:hover:bg-neutral-800"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
      )}
      {onMoveDown && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onMoveDown(); }}
          aria-label="Descendre l'étape"
          className="rounded p-1 text-neutral-400 opacity-0 transition-opacity hover:bg-neutral-100 hover:text-neutral-700 group-hover:opacity-100 dark:hover:bg-neutral-800"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      )}
      {onDelete && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          aria-label="Supprimer l'étape"
          className="rounded p-1 text-neutral-400 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100 dark:hover:bg-red-950"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
      </div>
      {(step || onTest) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {step && <StatusPill status={step.status} durationMs={step.durationMs} onClick={onOpenResult} />}
          {onTest && (
            <TipButton
              label="Tester jusqu'ici"
              tip="Exécuter le scénario jusqu'à cette étape incluse"
              icon={testingThis ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Play className="h-3.5 w-3.5" aria-hidden />}
              onClick={onTest}
              disabled={!!testDisabledReason}
              disabledReason={testDisabledReason}
              align="right"
            />
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Enveloppe une `StepCard` d'action de la chaîne principale pour la rendre
 * glissable-déposable (dnd-kit). Poignée dédiée (icône) ; les boutons
 * monter/descendre existants restent un repli accessible.
 */
function SortableStepCard({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="group/sortable relative">
      <span
        {...attributes}
        {...listeners}
        aria-label="Réordonner l'étape (glisser-déposer)"
        className="absolute left-1 top-1/2 z-10 -translate-y-1/2 cursor-grab touch-none rounded p-0.5 text-neutral-300 opacity-0 transition-opacity group-hover/sortable:opacity-100 hover:text-neutral-500 active:cursor-grabbing dark:text-neutral-600"
      >
        <GripVertical className="h-3.5 w-3.5" />
      </span>
      {children}
    </div>
  );
}

function AddStepButton({ onAdd, dbAvailable }: { onAdd: (kind: "action" | "condition") => void; dbAvailable: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative flex justify-center py-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-neutral-300 text-neutral-400 hover:border-blue-400 hover:text-blue-500 dark:border-neutral-700"
        aria-label="Ajouter une étape"
      >
        <Plus className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute top-9 z-10 w-44 rounded-md border border-neutral-200 bg-white p-1 shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <button
            type="button"
            onClick={() => {
              onAdd("action");
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            <Plus className="h-3.5 w-3.5" /> Ajouter une action
          </button>
          {dbAvailable && (
            <button
              type="button"
              onClick={() => {
                onAdd("condition");
                setOpen(false);
              }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <GitBranch className="h-3.5 w-3.5" /> Ajouter une condition
            </button>
          )}
        </div>
      )}
    </div>
  );
}
