"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useSession } from "next-auth/react";
import {
  Plus,
  Pencil,
  Trash2,
  RefreshCw,
  Loader2,
  CheckCircle2,
  XCircle,
  Zap,
  Search,
  AlertTriangle,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Hint } from "@/components/ui/hint";
import { useUnsavedChangesGuard } from "@/hooks/use-unsaved-changes-guard";
import { UnsavedChangesDialog } from "@/components/admin/unsaved-changes-dialog";
import {
  AI_USAGE_LABELS,
  AI_USAGE_TYPES_ASSIGNABLE,
  AI_USAGE_DESCRIPTIONS,
} from "@/lib/ai/usage-labels";
import { CreationUsageFallback } from "./creation-usage-fallback";
import { submitAssignment } from "@/lib/ai/assignment-form";
import {
  buildPristine,
  toDraft,
  countDirty,
  isRowDirty,
  dirtyUsages,
  applySavedRows,
  resetRow,
  resetAll,
  validateDraft,
  type AssignmentDraft,
  type DraftMap,
  type SaveResult,
} from "@/lib/ai/assignment-drafts";
import { AdminSaveBar } from "@/components/admin/floating-save-button";
import {
  PROVIDER_PRESETS,
  getPreset,
  buildPresetBaseUrl,
  inferPresetId,
  extractProductId,
} from "@/lib/ai/provider-presets";
import type { DetectedModel } from "@/lib/ai/detect-models";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  compareAssignedToCurrent,
  type CurrentEmbeddingIndex,
} from "@/lib/ai/embedding-assignment";
import { dimensionForModel } from "@/lib/ai/embedding-model-dimensions";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Provider {
  id: string;
  name: string;
  displayName: string;
  connectorType: "anthropic" | "openai_compatible" | "mistral";
  apiBaseUrl: string | null;
  defaultModel: string | null;
  isEnabled: boolean;
  isDefault: boolean;
  pricing: { input_cost_per_1k?: number; output_cost_per_1k?: number } | null;
  icon: string | null;
  color: string | null;
  config: Record<string, unknown> | null;
  createdAt: string;
}

type RowStatus = { state: "idle" } | { state: "error"; message: string };

interface Assignment {
  id: string;
  usageType: string;
  providerId: string;
  model: string;
  fallbackProviderId: string | null;
  fallbackModel: string | null;
  timeoutSeconds: number;
  maxRetries: number;
  isEnabled: boolean;
}

type ConnectorType = "anthropic" | "openai_compatible" | "mistral";

interface ProviderForm {
  id?: string;
  presetId: string;
  productId: string;
  name: string;
  displayName: string;
  connectorType: ConnectorType;
  apiBaseUrl: string;
  apiKey: string;
  defaultModel: string;
  pricing: { input_cost_per_1k: number; output_cost_per_1k: number };
  icon: string;
  color: string;
}

const EMPTY_FORM: ProviderForm = {
  presetId: "ollama",
  productId: "",
  name: "",
  displayName: "",
  connectorType: "openai_compatible",
  apiBaseUrl: "http://localhost:11434/v1",
  apiKey: "",
  defaultModel: "",
  pricing: { input_cost_per_1k: 0, output_cost_per_1k: 0 },
  icon: "",
  color: "#6366f1",
};

const CONNECTOR_LABELS: Record<ConnectorType, string> = {
  anthropic: "Anthropic",
  openai_compatible: "Compatible OpenAI",
  mistral: "Mistral AI",
};

// Une ligne d'affectation par usage réellement résolu via le résolveur par
// usage. La liste vit dans `@/lib/ai/usage-labels` pour qu'un usage ajouté à
// l'énumération ne puisse plus être oublié ici (test de complétude).
const USAGE_TYPES = AI_USAGE_TYPES_ASSIGNABLE.map((value) => ({
  value,
  label: AI_USAGE_LABELS[value],
  description: AI_USAGE_DESCRIPTIONS[value],
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Appelle l'API des fournisseurs et rend le verdict visible. Aucun appel de
 * cette page ne doit échouer en silence : l'utilisateur croirait avoir
 * enregistré alors que rien n'a été écrit.
 */
async function callProviderApi(
  method: "POST" | "PATCH" | "DELETE",
  body: unknown,
  failureMessage: string,
): Promise<boolean> {
  let res: Response;
  try {
    res = await fetch("/api/admin/ai/providers", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    toast.error("Le serveur est injoignable, rien n'a été enregistré.");
    return false;
  }

  if (!res.ok) {
    toast.error(
      res.status === 403
        ? "Vous n'avez pas les droits pour modifier les fournisseurs IA."
        : failureMessage,
    );
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AdminAIProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  // Brouillons d'assignation : pristine = dernier état connu du serveur,
  // drafts = saisie en cours, rowStatus = erreur d'enregistrement par usage.
  const [pristine, setPristine] = useState<DraftMap>({});
  const pristineRef = useRef<DraftMap>({});
  pristineRef.current = pristine;
  const [drafts, setDrafts] = useState<DraftMap>({});
  const [rowStatus, setRowStatus] = useState<Record<string, RowStatus>>({});
  const [savingAssignments, setSavingAssignments] = useState(false);
  // Résultat du dernier test par ligne (effacé à la prochaine modification).
  const [rowTest, setRowTest] = useState<
    Record<string, "testing" | "ok" | "fail">
  >({});
  const { data: session } = useSession();
  const isSuperAdmin =
    (session?.user as { globalRole?: string } | undefined)?.globalRole ===
    "super_admin";
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [form, setForm] = useState<ProviderForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{
    success: boolean;
    latency?: number;
    response?: string;
    error?: string;
  } | null>(null);
  const [detectingModels, setDetectingModels] = useState(false);
  const [detectedModels, setDetectedModels] = useState<string[]>([]);
  const [detectedDetails, setDetectedDetails] = useState<
    Record<string, DetectedModel["pricing"]>
  >({});
  const [detectError, setDetectError] = useState<string | null>(null);

  // --- Data fetching ---

  const fetchProviders = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/ai/providers");
      if (!res.ok) {
        toast.error("Impossible de charger la liste des fournisseurs IA.");
        return;
      }
      setProviders(await res.json());
    } catch {
      toast.error("Le serveur est injoignable : fournisseurs IA non chargés.");
    }
  }, []);

  const fetchAssignments = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/ai/assignments");
      if (!res.ok) {
        toast.error("Impossible de charger les affectations de modèles.");
        return;
      }
      // Chargement initial uniquement : alimente pristine et drafts une fois.
      const rows = (await res.json()) as Assignment[];
      const base = buildPristine(rows);
      setPristine(base);
      setDrafts(base);
    } catch {
      toast.error("Le serveur est injoignable : affectations non chargées.");
    }
  }, []);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchProviders(), fetchAssignments()]);
    setLoading(false);
  }, [fetchProviders, fetchAssignments]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // --- Provider CRUD ---

  function openCreateDialog() {
    setForm(EMPTY_FORM);
    setTestResult(null);
    setDetectedModels([]);
    setDetectError(null);
    setDialogOpen(true);
  }

  function openEditDialog(p: Provider) {
    setForm({
      id: p.id,
      presetId: inferPresetId(p.connectorType, p.apiBaseUrl),
      productId: extractProductId(p.apiBaseUrl),
      name: p.name,
      displayName: p.displayName,
      connectorType: p.connectorType,
      apiBaseUrl: p.apiBaseUrl || "",
      apiKey: "", // Never show the encrypted key
      defaultModel: p.defaultModel || "",
      pricing: {
        input_cost_per_1k: (p.pricing as ProviderForm["pricing"])?.input_cost_per_1k || 0,
        output_cost_per_1k: (p.pricing as ProviderForm["pricing"])?.output_cost_per_1k || 0,
      },
      icon: p.icon || "",
      color: p.color || "#6366f1",
    });
    setTestResult(null);
    setDetectedModels([]);
    setDetectError(null);
    setDialogOpen(true);
  }

  async function saveProvider() {
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name,
        displayName: form.displayName,
        connectorType: form.connectorType,
        apiBaseUrl: form.apiBaseUrl || null,
        defaultModel: form.defaultModel || null,
        pricing: form.pricing,
        icon: form.icon || null,
        color: form.color || null,
      };

      if (form.apiKey) {
        payload.apiKeyEnc = form.apiKey;
      }

      const isUpdate = !!form.id;
      if (isUpdate) payload.id = form.id;

      const ok = await callProviderApi(
        isUpdate ? "PATCH" : "POST",
        payload,
        isUpdate
          ? "La modification du fournisseur a échoué, rien n'a été enregistré."
          : "La création du fournisseur a échoué, rien n'a été enregistré.",
      );
      if (!ok) return;

      toast.success(
        isUpdate ? "Fournisseur mis à jour." : "Fournisseur ajouté.",
      );
      setDialogOpen(false);
      await fetchProviders();
    } finally {
      setSaving(false);
    }
  }

  async function deleteProvider(id: string) {
    if (!confirm("Supprimer ce fournisseur ?")) return;
    const ok = await callProviderApi(
      "DELETE",
      { id },
      "La suppression du fournisseur a échoué, rien n'a été supprimé.",
    );
    if (!ok) return;
    toast.success("Fournisseur supprimé.");
    await fetchProviders();
  }

  async function toggleEnabled(p: Provider) {
    const ok = await callProviderApi(
      "PATCH",
      { id: p.id, isEnabled: !p.isEnabled },
      `Impossible de ${p.isEnabled ? "désactiver" : "activer"} « ${p.displayName} », rien n'a été modifié.`,
    );
    if (!ok) return;
    toast.success(
      p.isEnabled
        ? `« ${p.displayName} » désactivé.`
        : `« ${p.displayName} » activé.`,
    );
    await fetchProviders();
  }

  async function setAsDefault(p: Provider) {
    const ok = await callProviderApi(
      "PATCH",
      { id: p.id, isDefault: true },
      `Impossible de définir « ${p.displayName} » par défaut, rien n'a été modifié.`,
    );
    if (!ok) return;
    toast.success(`« ${p.displayName} » est maintenant le fournisseur par défaut.`);
    await fetchProviders();
  }

  // --- Test connection ---

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch("/api/admin/ai/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          connectorType: form.connectorType,
          apiBaseUrl: form.apiBaseUrl,
          apiKey: form.apiKey,
          model: form.defaultModel,
        }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch {
      setTestResult({ success: false, error: "Erreur réseau" });
    } finally {
      setTesting(false);
    }
  }

  // --- Auto-detect models ---

  async function detectModels() {
    setDetectingModels(true);
    setDetectedModels([]);
    setDetectedDetails({});
    setDetectError(null);
    try {
      const res = await fetch("/api/admin/ai/providers/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiBaseUrl: form.apiBaseUrl,
          apiKey: form.apiKey,
          connectorType: form.connectorType,
        }),
      });
      const data = await res.json();
      if (res.ok && data.models?.length) {
        setDetectedModels(data.models);
        const details: Record<string, DetectedModel["pricing"]> = {};
        for (const d of (data.details || []) as DetectedModel[]) {
          if (d.pricing) details[d.id] = d.pricing;
        }
        setDetectedDetails(details);
      } else {
        setDetectError(
          data.error ||
            "Aucun modèle détecté. Saisissez le nom du modèle manuellement."
        );
      }
    } catch {
      setDetectError(
        "Connexion impossible. Vérifiez l'URL de base et la clé API."
      );
    } finally {
      setDetectingModels(false);
    }
  }

  // --- Provider presets ---

  function selectPreset(presetId: string) {
    const preset = getPreset(presetId);
    if (!preset) return;
    setDetectedModels([]);
    setDetectError(null);
    setForm((f) => ({
      ...f,
      presetId,
      productId: "",
      connectorType: preset.connectorType,
      apiBaseUrl: buildPresetBaseUrl(preset, ""),
      displayName: f.displayName || preset.defaultDisplayName,
    }));
  }

  function changeProductId(productId: string) {
    setForm((f) => {
      const preset = getPreset(f.presetId);
      return {
        ...f,
        productId,
        apiBaseUrl: preset
          ? buildPresetBaseUrl(preset, productId)
          : f.apiBaseUrl,
      };
    });
  }

  // Auto-détection des modèles : se déclenche quand le fournisseur, l'URL et la
  // clé sont prêts (Ollama sans clé). Débounce pour éviter de spammer pendant la
  // saisie de la clé.
  useEffect(() => {
    if (!dialogOpen) return;
    const preset = getPreset(form.presetId);
    const ready =
      !!form.apiBaseUrl &&
      !form.apiBaseUrl.includes("{product_id}") &&
      (preset ? !preset.needsKey || !!form.apiKey : !!form.apiKey);
    if (!ready) return;
    const t = setTimeout(() => {
      detectModels();
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    dialogOpen,
    form.presetId,
    form.connectorType,
    form.apiBaseUrl,
    form.apiKey,
  ]);

  // --- Assignments ---

  function getDraft(usageType: string): AssignmentDraft {
    return drafts[usageType] ?? pristine[usageType] ?? toDraft();
  }

  function changeDraft(usageType: string, next: AssignmentDraft) {
    setDrafts((prev) => ({ ...prev, [usageType]: next }));
    setRowTest((prev) => {
      if (!prev[usageType]) return prev;
      const { [usageType]: _removed, ...rest } = prev;
      return rest;
    });
    setRowStatus((prev) =>
      prev[usageType]?.state === "error"
        ? { ...prev, [usageType]: { state: "idle" } }
        : prev
    );
  }

  function cancelRow(usageType: string) {
    setDrafts((prev) => resetRow(pristine, prev, usageType));
    setRowStatus((prev) => ({ ...prev, [usageType]: { state: "idle" } }));
  }

  function cancelAll() {
    setDrafts((prev) => resetAll(pristine, prev));
    setRowStatus({});
  }

  // Annulation d'une ligne avec retour arrière possible via le toast.
  function cancelRowWithUndo(usageType: string, label: string) {
    const snapshot = drafts[usageType];
    const pristineAtCancel = pristine[usageType];
    cancelRow(usageType);
    toast(`Modifications de la ligne ${label} annulées`, {
      action: {
        label: "Annuler",
        onClick: () => {
          // Un enregistrement intermediaire rend l'instantane perime.
          if (snapshot && pristineRef.current[usageType] === pristineAtCancel)
            setDrafts((prev) => ({ ...prev, [usageType]: snapshot }));
        },
      },
    });
  }

  function cancelAllWithUndo() {
    const snapshot = drafts;
    const pristineAtCancel = pristine;
    cancelAll();
    toast("Toutes les modifications annulées", {
      action: {
        label: "Annuler",
        onClick: () =>
          setDrafts((prev) => {
            const next = { ...prev };
            for (const u of Object.keys(snapshot)) {
              if (pristineRef.current[u] === pristineAtCancel[u]) {
                next[u] = snapshot[u];
              }
            }
            return next;
          }),
      },
    });
  }

  // Teste le modèle du brouillon affiché, même non enregistré.
  async function testRow(usageType: string) {
    const d = getDraft(usageType);
    if (!d.providerId || !d.model.trim()) return;
    setRowTest((prev) => ({ ...prev, [usageType]: "testing" }));
    try {
      const res = await fetch("/api/admin/ai/providers/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ providerId: d.providerId, model: d.model }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        success?: boolean;
        latency?: number;
        response?: string;
        error?: string;
      };
      if (res.ok && data.success) {
        setRowTest((prev) => ({ ...prev, [usageType]: "ok" }));
        toast.success(`Connexion réussie : ${data.latency} ms`, {
          description: data.response || undefined,
        });
      } else {
        setRowTest((prev) => ({ ...prev, [usageType]: "fail" }));
        toast.error(data.error || "Le test du modèle a échoué.");
      }
    } catch {
      setRowTest((prev) => ({ ...prev, [usageType]: "fail" }));
      toast.error("Le serveur est injoignable : test impossible.");
    }
  }

  // Enregistre les lignes modifiées : un PUT par ligne, en parallèle.
  async function saveAll() {
    const usages = dirtyUsages(pristine, drafts);
    if (usages.length === 0) return true;
    const labelOf = (u: string) =>
      USAGE_TYPES.find((t) => t.value === u)?.label ?? u;

    let allOk = false;
    setSavingAssignments(true);
    const status: Record<string, RowStatus> = {};
    const toSend: string[] = [];
    for (const u of usages) {
      const check = validateDraft(drafts[u]);
      if (!check.valid) {
        status[u] = {
          state: "error",
          message: !drafts[u].providerId.trim()
            ? "Aucun fournisseur choisi."
            : "Aucun modèle choisi.",
        };
      } else {
        toSend.push(u);
      }
    }

    try {
      const settled = await Promise.allSettled(
        toSend.map(async (u): Promise<SaveResult> => {
          const sent = { ...drafts[u] };
          let errorMessage = "";
          const ok = await submitAssignment(
            labelOf(u),
            {
              usageType: u,
              providerId: sent.providerId || null,
              model: sent.model,
              fallbackProviderId: sent.fallbackProviderId || null,
              fallbackModel: sent.fallbackModel || null,
              timeoutSeconds: sent.timeoutSeconds,
              maxRetries: sent.maxRetries,
              isEnabled: sent.isEnabled,
            },
            {
              send: async (body) => {
                const res = await fetch("/api/admin/ai/assignments", {
                  method: "PUT",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(body),
                });
                return { ok: res.ok, status: res.status };
              },
              onError: (m) => {
                errorMessage = m;
              },
              onSuccess: () => {},
            }
          );
          if (!ok) status[u] = { state: "error", message: errorMessage };
          return { usageType: u, ok, sent };
        })
      );

      const results: SaveResult[] = settled.map((r, idx) => {
        if (r.status === "fulfilled") return r.value;
        const u = toSend[idx];
        status[u] = { state: "error", message: "Enregistrement impossible." };
        return { usageType: u, ok: false, sent: drafts[u] };
      });

      // Fusion locale : pas de nouveau fetch, les saisies en cours restent.
      setPristine((prev) => applySavedRows(prev, drafts, results));
      setRowStatus((prev) => {
        const next = { ...prev };
        for (const u of usages) next[u] = status[u] ?? { state: "idle" };
        return next;
      });

      const okCount = results.filter((r) => r.ok).length;
      const total = usages.length;
      const failed = usages.filter((u) => status[u]?.state === "error");
      allOk = failed.length === 0;
      if (failed.length === 0) {
        toast.success(
          `${okCount} assignation${okCount > 1 ? "s" : ""} enregistrée${okCount > 1 ? "s" : ""}`
        );
      } else if (okCount === 0) {
        toast.error("Aucune assignation enregistrée", {
          description: failed.map(labelOf).join(", "),
        });
      } else {
        toast.error(`${okCount} sur ${total} enregistrées`, {
          description: failed.map(labelOf).join(", "),
        });
      }
    } finally {
      setSavingAssignments(false);
    }
    return allOk;
  }

  const dirtyCount = countDirty(pristine, drafts);
  const guard = useUnsavedChangesGuard(dirtyCount > 0);

  // Ctrl+S / Cmd+S : enregistre les assignations modifiées.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "s") return;
      if (dirtyCount === 0) return;
      e.preventDefault();
      if (!savingAssignments) void saveAll();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // --- Render ---

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-24">
      {/* ================================================================ */}
      {/* SECTION 1: Fournisseurs                                         */}
      {/* ================================================================ */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-2xl font-bold">Fournisseurs IA</h1>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger
              render={<Button onClick={openCreateDialog} />}
            >
              <Plus className="h-4 w-4 mr-1" />
              Ajouter un fournisseur
            </DialogTrigger>

            <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>
                  {form.id ? "Modifier le fournisseur" : "Nouveau fournisseur"}
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                {/* Display name */}
                <div>
                  <label className="text-sm font-medium">
                    Nom d&apos;affichage
                  </label>
                  <input
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={form.displayName}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        displayName: e.target.value,
                        name: e.target.value
                          .toLowerCase()
                          .replace(/[^a-z0-9]+/g, "-")
                          .replace(/(^-|-$)/g, ""),
                      }))
                    }
                    placeholder="Ollama local"
                  />
                </div>

                {/* Provider preset */}
                <div>
                  <label className="text-sm font-medium">Fournisseur</label>
                  <select
                    className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                    value={form.presetId}
                    onChange={(e) => selectPreset(e.target.value)}
                  >
                    {PROVIDER_PRESETS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                  {getPreset(form.presetId)?.help && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      {getPreset(form.presetId)?.help}
                    </p>
                  )}
                </div>

                {/* Product ID (Infomaniak) */}
                {getPreset(form.presetId)?.needsProductId && (
                  <div>
                    <label className="text-sm font-medium">
                      Identifiant produit
                    </label>
                    <input
                      className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
                      value={form.productId}
                      onChange={(e) => changeProductId(e.target.value)}
                      placeholder="ex. 1234"
                    />
                  </div>
                )}

                {/* Advanced: connector + base URL (custom only) */}
                {form.presetId === "custom" ? (
                  <>
                    <div>
                      <label className="text-sm font-medium">Connecteur</label>
                      <div className="mt-1 flex gap-4">
                        {(
                          Object.entries(CONNECTOR_LABELS) as [
                            ConnectorType,
                            string
                          ][]
                        ).map(([value, label]) => (
                          <label
                            key={value}
                            className="flex items-center gap-2 text-sm cursor-pointer"
                          >
                            <input
                              type="radio"
                              name="connectorType"
                              value={value}
                              checked={form.connectorType === value}
                              onChange={() =>
                                setForm((f) => ({
                                  ...f,
                                  connectorType: value,
                                }))
                              }
                              className="accent-primary"
                            />
                            {label}
                          </label>
                        ))}
                      </div>
                    </div>
                    <div>
                      <label className="text-sm font-medium">URL de base</label>
                      <input
                        className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm font-mono"
                        value={form.apiBaseUrl}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, apiBaseUrl: e.target.value }))
                        }
                        placeholder="http://localhost:11434/v1"
                      />
                    </div>
                  </>
                ) : (
                  form.apiBaseUrl && (
                    <p className="text-xs text-muted-foreground">
                      URL :{" "}
                      <span className="font-mono">{form.apiBaseUrl}</span>
                    </p>
                  )
                )}

                {/* API Key */}
                {getPreset(form.presetId)?.needsKey !== false && (
                  <div>
                    <label className="text-sm font-medium">Clé API</label>
                    <input
                      type="password"
                      className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={form.apiKey}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, apiKey: e.target.value }))
                      }
                      placeholder={
                        form.id
                          ? "Laisser vide pour conserver l'actuelle"
                          : getPreset(form.presetId)?.keyPlaceholder || "sk-..."
                      }
                    />
                  </div>
                )}

                {/* Default model */}
                <div>
                  <label className="text-sm font-medium">
                    Modèle par défaut
                  </label>
                  <div className="mt-1 flex gap-2">
                    <input
                      className="flex-1 rounded-md border bg-background px-3 py-2 text-sm"
                      value={form.defaultModel}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          defaultModel: e.target.value,
                        }))
                      }
                      placeholder="gemma4:e4b"
                      list="detected-models"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={detectModels}
                      disabled={detectingModels || !form.apiBaseUrl}
                      title="Détecter les modèles disponibles"
                    >
                      {detectingModels ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Search className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                  {detectError && (
                    <p className="mt-2 text-xs text-destructive">
                      {detectError}
                    </p>
                  )}
                  {detectedModels.length > 0 && (
                    <datalist id="detected-models">
                      {detectedModels.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  )}
                  {detectedModels.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {detectedModels.map((m) => {
                        const p = detectedDetails[m];
                        const per1k = (amount?: number) =>
                          amount != null && p?.unitAmount
                            ? (amount * 1000) / p.unitAmount
                            : undefined;
                        const inK = per1k(p?.input);
                        const outK = per1k(p?.output);
                        const priceLabel =
                          inK != null || outK != null
                            ? `${inK?.toFixed(4) ?? "?"} / ${outK?.toFixed(4) ?? "?"} par 1k`
                            : null;
                        return (
                          <button
                            key={m}
                            type="button"
                            className={cn(
                              "rounded-md border px-2 py-0.5 text-xs transition-colors",
                              form.defaultModel === m
                                ? "border-primary bg-primary/10 text-primary"
                                : "hover:bg-accent"
                            )}
                            title={priceLabel ? `Tarif (HT) : ${priceLabel}` : undefined}
                            onClick={() =>
                              setForm((f) => ({
                                ...f,
                                defaultModel: m,
                                // Pré-remplit les coûts si le fournisseur les expose.
                                pricing:
                                  inK != null || outK != null
                                    ? {
                                        ...f.pricing,
                                        input_cost_per_1k:
                                          inK ?? f.pricing.input_cost_per_1k,
                                        output_cost_per_1k:
                                          outK ?? f.pricing.output_cost_per_1k,
                                      }
                                    : f.pricing,
                              }))
                            }
                          >
                            {m}
                            {priceLabel && (
                              <span className="ml-1 text-[10px] text-muted-foreground">
                                {priceLabel}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Pricing */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium">
                      Coût entrée / 1k tokens
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      min="0"
                      className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={form.pricing.input_cost_per_1k}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          pricing: {
                            ...f.pricing,
                            input_cost_per_1k: parseFloat(e.target.value) || 0,
                          },
                        }))
                      }
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">
                      Coût sortie / 1k tokens
                    </label>
                    <input
                      type="number"
                      step="0.0001"
                      min="0"
                      className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={form.pricing.output_cost_per_1k}
                      onChange={(e) =>
                        setForm((f) => ({
                          ...f,
                          pricing: {
                            ...f.pricing,
                            output_cost_per_1k:
                              parseFloat(e.target.value) || 0,
                          },
                        }))
                      }
                    />
                  </div>
                </div>

                {/* Icon + Color */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-sm font-medium">Icône (emoji)</label>
                    <input
                      className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                      value={form.icon}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, icon: e.target.value }))
                      }
                      placeholder="🤖"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-medium">Couleur</label>
                    <div className="mt-1 flex items-center gap-2">
                      <input
                        type="color"
                        className="h-9 w-12 rounded-md border cursor-pointer"
                        value={form.color}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, color: e.target.value }))
                        }
                      />
                      <span className="text-sm font-mono text-muted-foreground">
                        {form.color}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Test connection */}
                <div className="rounded-md border p-3 space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={testConnection}
                    disabled={testing || !form.defaultModel}
                  >
                    {testing ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    ) : (
                      <Zap className="h-4 w-4 mr-1" />
                    )}
                    Tester la connexion
                  </Button>
                  {testResult && (
                    <div
                      className={cn(
                        "flex items-center gap-2 text-sm",
                        testResult.success
                          ? "text-green-600"
                          : "text-red-600"
                      )}
                    >
                      {testResult.success ? (
                        <>
                          <CheckCircle2 className="h-4 w-4" />
                          Connexion réussie : {testResult.latency} ms
                          {testResult.response && (
                            <span className="text-muted-foreground">
                              ({testResult.response})
                            </span>
                          )}
                        </>
                      ) : (
                        <>
                          <XCircle className="h-4 w-4" />
                          {testResult.error}
                        </>
                      )}
                    </div>
                  )}
                </div>
              </div>

              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDialogOpen(false)}
                >
                  Annuler
                </Button>
                <Button
                  onClick={saveProvider}
                  disabled={saving || !form.displayName || !form.name}
                >
                  {saving && (
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  )}
                  {form.id ? "Enregistrer" : "Créer"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {/* Providers table */}
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Nom</th>
                <th className="px-4 py-3 text-left font-medium">Connecteur</th>
                <th className="px-4 py-3 text-left font-medium">URL</th>
                <th className="px-4 py-3 text-left font-medium">
                  Modèle par défaut
                </th>
                <th className="px-4 py-3 text-left font-medium">Statut</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {providers.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="px-4 py-8 text-center text-muted-foreground"
                  >
                    Aucun fournisseur configuré
                  </td>
                </tr>
              ) : (
                providers.map((p) => (
                  <tr
                    key={p.id}
                    className="border-b last:border-b-0 hover:bg-muted/30 transition-colors"
                  >
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {p.icon && <span>{p.icon}</span>}
                        {p.color && (
                          <span
                            className="inline-block h-3 w-3 rounded-full"
                            style={{ backgroundColor: p.color }}
                          />
                        )}
                        <span className="font-medium">{p.displayName}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {CONNECTOR_LABELS[p.connectorType]}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground max-w-48 truncate">
                      {p.apiBaseUrl || "Non défini"}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {p.defaultModel || "Non défini"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => toggleEnabled(p)}
                          className={cn(
                            "rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors",
                            p.isEnabled
                              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                              : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                          )}
                        >
                          {p.isEnabled ? "Actif" : "Inactif"}
                        </button>
                        {p.isDefault ? (
                          <span className="rounded-full bg-primary/10 text-primary px-2.5 py-0.5 text-xs font-medium">
                            Par défaut
                          </span>
                        ) : (
                          <button
                            onClick={() => setAsDefault(p)}
                            className="rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground hover:bg-accent transition-colors"
                          >
                            Définir par défaut
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => openEditDialog(p)}
                          title="Modifier"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          onClick={() => deleteProvider(p.id)}
                          title="Supprimer"
                          className="text-destructive hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ================================================================ */}
      {/* SECTION 2: Assignation modèle par usage                         */}
      {/* ================================================================ */}
      <section>
        <AdminSaveBar
          title="Assignation modèle par usage"
          onSave={saveAll}
          saving={savingAssignments}
          isDirty={dirtyCount > 0}
          pendingLabel={`${dirtyCount} modification${dirtyCount > 1 ? "s" : ""} non enregistrée${dirtyCount > 1 ? "s" : ""}`}
          disabledHint="Aucune modification à enregistrer"
          className="mb-4"
        >
          {dirtyCount > 0 && (
            <Hint label="Annuler toutes les modifications non enregistrées">
              <Button
                variant="outline"
                onClick={cancelAllWithUndo}
                disabled={savingAssignments}
                aria-label="Tout annuler"
              >
                <Undo2 className="h-4 w-4 mr-2" aria-hidden="true" />
                Tout annuler
              </Button>
            </Hint>
          )}
        </AdminSaveBar>
        <UnsavedChangesDialog
          open={guard.confirmOpen}
          onStay={guard.cancelLeave}
          onLeave={guard.confirmLeave}
          onSaveAndLeave={async () => {
            if (await saveAll()) guard.confirmLeave();
            else guard.cancelLeave();
          }}
        />

        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="px-4 py-3 text-left font-medium">Usage</th>
                <th className="px-4 py-3 text-left font-medium">
                  Fournisseur principal
                </th>
                <th className="px-4 py-3 text-left font-medium">Modèle</th>
                <th className="px-4 py-3 text-left font-medium">
                  Fallback fournisseur
                </th>
                <th className="px-4 py-3 text-left font-medium">
                  Fallback modèle
                </th>
                <th className="px-4 py-3 text-left font-medium">Timeout</th>
                <th className="px-4 py-3 text-center font-medium">Actif</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {USAGE_TYPES.map((ut) => (
                <AssignmentRow
                  key={ut.value}
                  usageType={ut.value}
                  label={ut.label}
                  description={ut.description}
                  providers={providers}
                  value={getDraft(ut.value)}
                  onChange={(next) => changeDraft(ut.value, next)}
                  status={rowStatus[ut.value]}
                  dirty={isRowDirty(pristine[ut.value], drafts[ut.value])}
                  testState={rowTest[ut.value]}
                  isSuperAdmin={isSuperAdmin}
                  onTest={() => testRow(ut.value)}
                  onCancel={() => cancelRowWithUndo(ut.value, ut.label)}
                  extra={
                    ut.value === "creation" ? (
                      <CreationUsageFallback
                        assigned={pristine.creation}
                        onRemoved={() => {
                          setPristine((prev) => {
                            const { creation: _c, ...rest } = prev;
                            return rest;
                          });
                          setDrafts((prev) => {
                            const { creation: _c, ...rest } = prev;
                            return rest;
                          });
                        }}
                        onRestored={(previous) => {
                          setPristine((prev) => ({ ...prev, creation: previous }));
                          setDrafts((prev) => {
                            const { creation: _c, ...rest } = prev;
                            return rest;
                          });
                        }}
                      />
                    ) : undefined
                  }
                />
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ================================================================ */}
      {/* SECTION 3: Embeddings, réindexation                            */}
      {/* ================================================================ */}
      <EmbeddingReindexPanel
        assigned={pristine.embeddings ?? null}
        providers={providers}
        embeddingsDirty={isRowDirty(pristine.embeddings, drafts.embeddings)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// EmbeddingReindexPanel : modèle/dimension actifs + réindexation
// ---------------------------------------------------------------------------

interface ReindexStatus {
  running: boolean;
  phase: "idle" | "kb" | "documents" | "media" | "done" | "error";
  total: number;
  done: number;
  startedAt: string | null;
  finishedAt: string | null;
  model?: string;
  dimensions?: number;
  error?: string;
  current?: CurrentEmbeddingIndex | null;
}

const PHASE_LABELS: Record<ReindexStatus["phase"], string> = {
  idle: "Inactif",
  kb: "Base de connaissances",
  documents: "Documents",
  media: "Médias",
  done: "Terminé",
  error: "Erreur",
};

function EmbeddingReindexPanel({
  assigned,
  providers,
  embeddingsDirty,
}: {
  assigned: { providerId: string; model: string } | null;
  providers: Array<{ id: string; displayName: string }>;
  embeddingsDirty: boolean;
}) {
  const [status, setStatus] = useState<ReindexStatus | null>(null);
  const [starting, setStarting] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/ai/embeddings/reindex");
      if (res.ok) setStatus(await res.json());
    } catch {
      // silently fail
    }
  }, []);

  // Chargement initial, et rechargement quand l'assignation enregistrée change.
  const assignedKey = `${assigned?.providerId ?? ""}|${assigned?.model ?? ""}`;
  useEffect(() => {
    fetchStatus();
  }, [fetchStatus, assignedKey]);

  // Polling tant qu'une réindexation est en cours.
  useEffect(() => {
    if (!status?.running) return;
    const t = setInterval(fetchStatus, 2000);
    return () => clearInterval(t);
  }, [status?.running, fetchStatus]);

  async function startReindex() {
    setStarting(true);
    try {
      await fetch("/api/admin/ai/embeddings/reindex", { method: "POST" });
      await fetchStatus();
    } finally {
      setStarting(false);
    }
  }

  const running = status?.running ?? false;
  const progress =
    status && status.total > 0
      ? Math.round((status.done / status.total) * 100)
      : 0;

  const current: CurrentEmbeddingIndex | null = status?.current ?? null;
  const state = compareAssignedToCurrent(assigned, current);
  const providerName = (id: string | null | undefined) =>
    providers.find((p) => p.id === id)?.displayName ?? "fournisseur inconnu";
  const dimText = (n: number | null) =>
    n == null ? "dimension inconnue" : `${n} dimensions`;
  const assignedDim = assigned ? dimensionForModel(assigned.model) : null;

  return (
    <section>
      <h2 className="text-xl font-bold mb-4">Embeddings et réindexation</h2>

      <div className="rounded-lg border p-4 space-y-4">
        <div className="space-y-1 text-sm" data-testid="embedding-models">
          {state === "unassigned" && (
            <div>
              <span className="text-muted-foreground">Modèle assigné : </span>
              <span>Aucun</span>
            </div>
          )}
          {state === "same" && assigned && current && (
            <div>
              <span className="text-muted-foreground">Modèle actif : </span>
              <span className="font-mono">{assigned.model}</span> (
              {providerName(assigned.providerId)}), {dimText(current.dimensions)}
            </div>
          )}
          {(state === "different" || state === "no-index") && assigned && (
            <div>
              <span className="text-muted-foreground">Modèle assigné : </span>
              <span className="font-mono">{assigned.model}</span> (
              {providerName(assigned.providerId)}), {dimText(assignedDim)}
            </div>
          )}
          {(state === "different" || state === "no-index") && (
            <div>
              <span className="text-muted-foreground">Index actuel : </span>
              {current ? (
                <>
                  <span className="font-mono">{current.model}</span> (
                  {providerName(current.providerId)}),{" "}
                  {dimText(current.dimensions)}
                </>
              ) : (
                <span>Aucun index</span>
              )}
            </div>
          )}
          {embeddingsDirty && (
            <p className="text-xs text-muted-foreground">
              Enregistrez la ligne Embeddings pour la prendre en compte
            </p>
          )}
        </div>

        {(state === "different" || state === "no-index") && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200"
          >
            <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" />
            <p>
              Réindexation nécessaire pour appliquer le nouveau modèle. Pendant
              l&apos;opération, la recherche bascule en mode mots-clés.
            </p>
          </div>
        )}

        {/* Progression */}
        {status && status.phase !== "idle" && (
          <div className="space-y-1 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                Phase : {PHASE_LABELS[status.phase]}
                {(status.phase === "documents" || status.phase === "media") &&
                  ` (${status.done}/${status.total})`}
              </span>
              {(status.phase === "documents" || status.phase === "media") && (
                <span className="font-mono text-xs text-muted-foreground">
                  {progress}%
                </span>
              )}
            </div>
            {(status.phase === "documents" || status.phase === "media") && (
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            )}
            {status.phase === "error" && status.error && (
              <p className="text-destructive">{status.error}</p>
            )}
          </div>
        )}

        {/* Action */}
        <div className="flex items-center gap-3">
          <Button onClick={startReindex} disabled={running || starting}>
            {running || starting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-1" />
            )}
            {running ? "Réindexation en cours…" : "Réindexer maintenant"}
          </Button>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// AssignmentRow: editable row for each usage type
// ---------------------------------------------------------------------------

function AssignmentRow({
  usageType,
  label,
  description,
  providers,
  value,
  onChange,
  status,
  dirty,
  testState,
  isSuperAdmin,
  onTest,
  onCancel,
  extra,
}: {
  extra?: ReactNode;
  usageType: string;
  label: string;
  description?: string;
  providers: Provider[];
  value: AssignmentDraft;
  onChange: (next: AssignmentDraft) => void;
  status?: RowStatus;
  dirty: boolean;
  testState?: "testing" | "ok" | "fail";
  isSuperAdmin: boolean;
  onTest: () => void;
  onCancel: () => void;
}) {
  // L'usage « rerank » a son propre catalogue de modèles (détection dédiée,
  // toujours non vide) : on l'ajoute en paramètre de requête plutôt que de
  // dupliquer les deux effets de chargement ci-dessous.
  const modelsQuery = usageType === "rerank" ? "?usage=rerank" : "";
  const {
    providerId,
    model,
    fallbackProviderId,
    fallbackModel,
    timeoutSeconds: timeout,
    isEnabled,
  } = value;
  // Modèles détectés par fournisseur sélectionné (pour les listes déroulantes).
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [fallbackModelOptions, setFallbackModelOptions] = useState<string[]>(
    []
  );
  const patch = (p: Partial<AssignmentDraft>) => onChange({ ...value, ...p });

  // Charge les modèles disponibles du fournisseur principal (clé déchiffrée
  // côté serveur). Alimente la datalist du champ « Modèle ».
  useEffect(() => {
    if (!providerId) {
      setModelOptions([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/admin/ai/providers/${providerId}/models${modelsQuery}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.models) setModelOptions(d.models);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [providerId, modelsQuery]);

  useEffect(() => {
    if (!fallbackProviderId) {
      setFallbackModelOptions([]);
      return;
    }
    let cancelled = false;
    fetch(`/api/admin/ai/providers/${fallbackProviderId}/models${modelsQuery}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.models) setFallbackModelOptions(d.models);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [fallbackProviderId, modelsQuery]);

  return (
    <tr className="border-b last:border-b-0">
      <td className="px-4 py-3 font-medium">
        <span className="inline-flex flex-wrap items-center gap-2">
          {label}
          {dirty && <Badge variant="secondary">Modifié</Badge>}
          {status?.state === "error" && (
            <Badge variant="destructive">Échec</Badge>
          )}
        </span>
        {description && (
          <p className="mt-1 text-xs font-normal text-muted-foreground">
            {description}
          </p>
        )}
        {extra}
        {status?.state === "error" && (
          <p role="alert" className="mt-1 text-xs font-normal text-destructive">
            {status.message}
          </p>
        )}
      </td>

      {/* Provider principal */}
      <td className="px-4 py-2">
        <select
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          value={providerId}
          onChange={(e) => {
            patch({ providerId: e.target.value });
          }}
        >
          <option value="">Aucun fournisseur</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
      </td>

      {/* Modèle */}
      <td className="px-4 py-2">
        {modelOptions.length > 0 ? (
          <select
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={model}
            onChange={(e) => {
              patch({ model: e.target.value });
            }}
          >
            <option value="">Aucun modèle</option>
            {/* Garantit que la valeur enregistrée reste sélectionnable même
                si elle n'est plus dans la liste détectée. */}
            {model && !modelOptions.includes(model) && (
              <option value={model}>{model}</option>
            )}
            {modelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={model}
            onChange={(e) => {
              patch({ model: e.target.value });
            }}
            placeholder="gemma4:e4b"
          />
        )}
      </td>

      {/* Fallback provider */}
      <td className="px-4 py-2">
        <select
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          value={fallbackProviderId}
          onChange={(e) => {
            patch({ fallbackProviderId: e.target.value });
          }}
        >
          <option value="">Aucun</option>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </select>
      </td>

      {/* Fallback modèle */}
      <td className="px-4 py-2">
        {fallbackModelOptions.length > 0 ? (
          <select
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={fallbackModel}
            onChange={(e) => {
              patch({ fallbackModel: e.target.value });
            }}
          >
            <option value="">Aucun modèle</option>
            {fallbackModel && !fallbackModelOptions.includes(fallbackModel) && (
              <option value={fallbackModel}>{fallbackModel}</option>
            )}
            {fallbackModelOptions.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        ) : (
          <input
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={fallbackModel}
            onChange={(e) => {
              patch({ fallbackModel: e.target.value });
            }}
            placeholder="Aucun"
          />
        )}
      </td>

      {/* Timeout */}
      <td className="px-4 py-2">
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={5}
            max={300}
            className="w-20 rounded-md border bg-background py-1.5 pl-2 pr-1 text-sm text-right dark:[color-scheme:dark] [&::-webkit-inner-spin-button]:ml-1.5"
            value={timeout}
            onChange={(e) => {
              patch({ timeoutSeconds: parseInt(e.target.value) || 30 });
            }}
          />
          <span className="text-xs text-muted-foreground">s</span>
        </div>
      </td>

      {/* Toggle actif */}
      <td className="px-4 py-2 text-center">
        <button
          onClick={() => {
            patch({ isEnabled: !isEnabled });
          }}
          className={cn(
            "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
            isEnabled ? "bg-primary" : "bg-gray-300 dark:bg-gray-600"
          )}
        >
          <span
            className={cn(
              "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform",
              isEnabled ? "translate-x-4.5" : "translate-x-0.5"
            )}
          />
        </button>
      </td>

      {/* Actions */}
      <td className="px-4 py-2">
        <div className="flex items-center justify-end gap-1">
          {testState === "ok" && (
            <span
              role="img"
              aria-label="Dernier test réussi"
              className="h-2 w-2 rounded-full bg-green-500"
            />
          )}
          {testState === "fail" && (
            <span
              role="img"
              aria-label="Dernier test en échec"
              className="h-2 w-2 rounded-full bg-red-500"
            />
          )}
          <Hint
            label={
              !isSuperAdmin
                ? "Réservé au super administrateur"
                : !providerId || !model.trim()
                  ? "Choisissez un modèle pour le tester"
                  : "Tester ce modèle"
            }
            disabled={!isSuperAdmin || !providerId || !model.trim() || testState === "testing"}
          >
            <Button
              variant="ghost"
              size="icon"
              aria-label="Tester ce modèle"
              onClick={onTest}
              disabled={
                !isSuperAdmin ||
                !providerId ||
                !model.trim() ||
                testState === "testing"
              }
            >
              {testState === "testing" ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Zap className="h-4 w-4" aria-hidden="true" />
              )}
            </Button>
          </Hint>
          <Hint
            label={
              dirty
                ? "Annuler les modifications de cette ligne"
                : "Aucune modification sur cette ligne"
            }
            disabled={!dirty}
          >
            <Button
              variant="ghost"
              size="icon"
              aria-label="Annuler les modifications de cette ligne"
              onClick={onCancel}
              disabled={!dirty}
            >
              <Undo2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Hint>
        </div>
      </td>
    </tr>
  );
}
