"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import {
  ShieldCheck,
  Server,
  Bell,
  Database,
  Loader2,
  Wifi,
  WifiOff,
  Download,
  RefreshCw,
  Check,
  LifeBuoy,
  AlertTriangle,
  ArrowRight,
  ArrowUpDown,
  Lock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/i18n/routing";
import { ModuleActivationNotice } from "@/components/admin/module-activation-notice";
import { AdminSaveBar } from "@/components/admin/floating-save-button";

// --- Types ---

interface RolePermissions {
  viewer: { canUseAI: boolean; canUsePlayground: boolean; canViewLogs: boolean };
  editor: { canUseAI: boolean; canUsePlayground: boolean; canViewLogs: boolean };
  admin: { canUseAI: boolean; canUsePlayground: boolean; canViewLogs: boolean };
}

interface WhisperSettings {
  whisperEnabled: boolean;
  whisperApiUrl: string;
  whisperModel: string;
  whisperLanguage: string;
  whisperDiarize: boolean;
}

interface TranscriptionSettings {
  engine: "whisper" | "voxtral";
  vocabulary: string;
}

interface VoxtralSettings {
  voxtralEnabled: boolean;
  voxtralApiUrl: string;
  voxtralModel: string;
  voxtralLanguage: string;
}

interface OllamaSettings {
  ollamaEnabled: boolean;
  ollamaBaseUrl: string;
  ollamaDefaultModel: string;
}

interface OllamaModel {
  name: string;
  size?: number;
  details?: { parameter_size?: string; quantization_level?: string };
}

const OLLAMA_SUGGESTIONS = ["gemma3:4b", "llama3.1:8b", "qwen2.5:7b", "mistral:7b"];

function formatBytes(bytes?: number): string {
  if (!bytes) return "";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1)} Go`;
  const mb = bytes / 1024 ** 2;
  return `${mb.toFixed(0)} Mo`;
}

interface AIAlertsSettings {
  thresholdWarning: number;
  thresholdCritical: number;
  notificationEmail: string;
}

interface LogRetentionSettings {
  retentionDays: number;
  storeContent: boolean;
}

interface RerankSettingsForm {
  enabled: boolean;
  chat: boolean;
  help: boolean;
  search: boolean;
}

// --- Toggle component ---

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (val: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
        checked ? "bg-primary" : "bg-gray-300 dark:bg-gray-600"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          checked ? "translate-x-6" : "translate-x-1"
        }`}
      />
    </button>
  );
}

// --- Defaults ---

const DEFAULT_ROLE_PERMISSIONS: RolePermissions = {
  viewer: { canUseAI: false, canUsePlayground: false, canViewLogs: false },
  editor: { canUseAI: true, canUsePlayground: false, canViewLogs: false },
  admin: { canUseAI: true, canUsePlayground: true, canViewLogs: true },
};

const DEFAULT_TRANSCRIPTION: TranscriptionSettings = {
  engine: "whisper",
  vocabulary: "",
};

const DEFAULT_WHISPER: WhisperSettings = {
  whisperEnabled: false,
  whisperApiUrl: "http://localhost:9000",
  whisperModel: "Systran/faster-whisper-medium",
  whisperLanguage: "fr",
  whisperDiarize: false,
};

const DEFAULT_VOXTRAL: VoxtralSettings = {
  voxtralEnabled: false,
  voxtralApiUrl: "http://localhost:9001",
  voxtralModel: "mistralai/Voxtral-Mini-Latest",
  voxtralLanguage: "fr",
};

const DEFAULT_OLLAMA: OllamaSettings = {
  ollamaEnabled: false,
  ollamaBaseUrl: "http://localhost:11434",
  ollamaDefaultModel: "gemma4:e4b",
};

const DEFAULT_ALERTS: AIAlertsSettings = {
  thresholdWarning: 80,
  thresholdCritical: 100,
  notificationEmail: "",
};

const DEFAULT_RETENTION: LogRetentionSettings = {
  retentionDays: 90,
  storeContent: true,
};

// Fermé par défaut (fail-closed) : cohérent avec `normalizeRerankSettings`
// côté serveur, aucune activation accidentelle tant que rien n'est chargé.
const DEFAULT_RERANK: RerankSettingsForm = {
  enabled: false,
  chat: false,
  help: false,
  search: false,
};

// --- Labels ---

const ROLE_LABELS: Record<string, string> = {
  viewer: "Lecteur",
  editor: "Éditeur",
  admin: "Administrateur",
};

const PERMISSION_LABELS: Record<string, string> = {
  canUseAI: "Utiliser l'IA",
  canUsePlayground: "Playground",
  canViewLogs: "Voir les logs",
};

const WHISPER_MODELS = [
  { value: "Systran/faster-whisper-tiny", label: "Tiny (39M — rapide, qualité limitée)" },
  { value: "Systran/faster-whisper-base", label: "Base (74M — basique)" },
  { value: "Systran/faster-whisper-small", label: "Small (244M — bon compromis)" },
  { value: "Systran/faster-whisper-medium", label: "Medium (769M — recommandé FR)" },
  { value: "Systran/faster-whisper-large-v3", label: "Large v3 (1.5G — meilleure qualité)" },
];
const TRANSCRIPTION_LANGUAGES = [
  { value: "fr", label: "Français" },
  { value: "en", label: "Anglais" },
  { value: "de", label: "Allemand" },
  { value: "es", label: "Espagnol" },
  { value: "it", label: "Italien" },
];
const WHISPER_LANGUAGES = TRANSCRIPTION_LANGUAGES;

const VOXTRAL_MODELS = [
  { value: "mistralai/Voxtral-Mini-4B-Realtime-2602", label: "Voxtral Mini 4B Realtime (GPU >= 16 Go)" },
];

// --- Service health test ---

interface HealthResult {
  status: "up" | "down";
  latency?: number;
}

function HealthBadge({ result }: { result?: HealthResult }) {
  if (!result) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs">
      {result.status === "up" ? (
        <>
          <Wifi className="h-3 w-3 text-green-500" />
          <span className="text-green-600">
            En ligne{result.latency ? ` (${result.latency} ms)` : ""}
          </span>
        </>
      ) : (
        <>
          <WifiOff className="h-3 w-3 text-red-500" />
          <span className="text-red-600">Hors ligne</span>
        </>
      )}
    </span>
  );
}

// --- Main component ---

/**
 * Mention affichée à la place des blocs de configuration que l'API réserve à
 * l'administration d'instance (`whisper`, `voxtral`, `ollama`,
 * `transcription`). Les afficher
 * quand même montrerait les valeurs par défaut des constantes ci-dessus, pas
 * celles de l'instance.
 */
function InstanceOnlySection({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
      <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="space-y-1">
        <p className="text-sm font-medium">
          Réglages réservés à l&apos;administration d&apos;instance
        </p>
        <p className="text-xs text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

export default function AdminAISettingsPage() {
  /**
   * AZ-08 : `whisper`, `voxtral`, `ollama` et `transcription` sont des clés
   * d'infrastructure.
   * L'API ne les rend plus à un administrateur d'organisation et IGNORE celles
   * qu'il enverrait, en les listant dans le champ `ignored` de la réponse. Sans
   * cette garde, la page affichait les valeurs par défaut de ses constantes
   * comme si c'était la configuration réelle, puis annonçait « Réglages IA
   * enregistrés » pour une écriture qui n'avait pas eu lieu.
   */
  const { data: session, status: sessionStatus } = useSession();
  const isInstanceAdmin =
    (session?.user as { globalRole?: string } | undefined)?.globalRole === "super_admin";

  // Coupe-circuit IA global : lecture seule ici, il se règle depuis /admin/modules.
  const [aiEnabled, setAiEnabled] = useState(true);
  const [rolePermissions, setRolePermissions] = useState<RolePermissions>(DEFAULT_ROLE_PERMISSIONS);
  const [transcription, setTranscription] = useState<TranscriptionSettings>(DEFAULT_TRANSCRIPTION);
  const [whisper, setWhisper] = useState<WhisperSettings>(DEFAULT_WHISPER);
  const [voxtral, setVoxtral] = useState<VoxtralSettings>(DEFAULT_VOXTRAL);
  const [ollama, setOllama] = useState<OllamaSettings>(DEFAULT_OLLAMA);
  const [alerts, setAlerts] = useState<AIAlertsSettings>(DEFAULT_ALERTS);
  const [retention, setRetention] = useState<LogRetentionSettings>(DEFAULT_RETENTION);
  const [helpAssistantEnabled, setHelpAssistantEnabled] = useState(true);
  // Au moins une IA est-elle configurée ? Détermine l'avertissement sous le
  // toggle de l'assistant d'aide. `true` par défaut pour éviter un flash.
  const [aiConfigured, setAiConfigured] = useState(true);
  const [rerank, setRerank] = useState<RerankSettingsForm>(DEFAULT_RERANK);
  // Un modèle est-il assigné à l'usage « rerank » ? Détermine l'avertissement
  // sous le bloc Reclassement. `true` par défaut pour éviter un flash.
  const [rerankAssigned, setRerankAssigned] = useState(true);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [healthResults, setHealthResults] = useState<Record<string, HealthResult>>({});
  const [testingHealth, setTestingHealth] = useState<Record<string, boolean>>({});

  // Snapshot du dernier état sauvegardé (pour détecter les modifications en attente)
  const [pristine, setPristine] = useState<string | null>(null);
  const currentSnapshot = useMemo(
    () =>
      JSON.stringify({
        rolePermissions,
        transcription,
        whisper,
        voxtral,
        ollama,
        alerts,
        retention,
        helpAssistantEnabled,
        rerank,
      }),
    [
      rolePermissions,
      transcription,
      whisper,
      voxtral,
      ollama,
      alerts,
      retention,
      helpAssistantEnabled,
      rerank,
    ]
  );
  const isDirty = pristine !== null && pristine !== currentSnapshot;

  // Avertir avant de quitter la page si des modifications sont en attente
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  // Ollama models
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[] | null>(null);
  const [ollamaModelsLoading, setOllamaModelsLoading] = useState(false);
  const [ollamaModelsError, setOllamaModelsError] = useState<string | null>(null);
  const [ollamaPullName, setOllamaPullName] = useState("");
  const [ollamaPulling, setOllamaPulling] = useState(false);

  // Load settings
  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/ai/settings");
      if (!res.ok) return;
      const data = await res.json();

      if (typeof data.ai_global?.enabled === "boolean") setAiEnabled(data.ai_global.enabled);
      if (data.rolePermissions) {
        setRolePermissions((prev) => {
          const merged = { ...prev };
          for (const role of ["viewer", "editor", "admin"] as const) {
            if (data.rolePermissions[role]) {
              merged[role] = { ...prev[role], ...data.rolePermissions[role] };
            }
          }
          return merged;
        });
      }
      if (data.transcription) setTranscription((prev) => ({ ...prev, ...data.transcription }));
      if (data.whisper) setWhisper((prev) => ({ ...prev, ...data.whisper }));
      if (data.voxtral) setVoxtral((prev) => ({ ...prev, ...data.voxtral }));
      if (data.ollama) setOllama((prev) => ({ ...prev, ...data.ollama }));
      if (data.ai_alerts) {
        const a = data.ai_alerts;
        setAlerts((prev) => ({ ...prev, ...a }));
        if (a.retention) {
          setRetention((prev) => ({ ...prev, ...a.retention }));
        }
      }
      if (typeof data.help_assistant_enabled === "boolean") {
        setHelpAssistantEnabled(data.help_assistant_enabled);
      }
      if (data.rerank) setRerank((prev) => ({ ...prev, ...data.rerank }));
    } catch (err) {
      console.error("Failed to load AI settings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Capturer le snapshot pristine une fois le chargement initial terminé
  useEffect(() => {
    if (loading || pristine !== null) return;
    setPristine(currentSnapshot);
  }, [loading, pristine, currentSnapshot]);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // État de configuration IA (pour l'avertissement de l'assistant d'aide).
  useEffect(() => {
    fetch("/api/help/enabled")
      .then((r) => r.json() as Promise<{ aiConfigured?: boolean }>)
      .then((d) => setAiConfigured(d.aiConfigured !== false))
      .catch(() => {});
  }, []);

  // Un modèle est-il assigné à l'usage « rerank » (pour l'avertissement du
  // bloc Reclassement) ? Repose sur la même route que l'écran d'assignation.
  useEffect(() => {
    fetch("/api/admin/ai/assignments")
      .then((r) => r.json())
      .then(
        (
          list: Array<{
            usageType?: string;
            providerId?: string | null;
            model?: string | null;
            isEnabled?: boolean;
          }>
        ) => {
          const row = Array.isArray(list)
            ? list.find((a) => a.usageType === "rerank")
            : undefined;
          setRerankAssigned(!!(row?.isEnabled && row.providerId && row.model));
        }
      )
      .catch(() => {});
  }, []);

  // Save
  const handleSave = async () => {
    setSaving(true);
    try {
      // `whisperEnabled` est l'interrupteur du module Transcription : il ne
      // s'écrit que depuis /admin/modules, on ne le renvoie pas ici.
      const { whisperEnabled: _whisperEnabled, ...whisperConfig } = whisper;
      const payload: Record<string, unknown> = {
        rolePermissions,
        ai_alerts: {
          ...alerts,
          retention,
        },
        help_assistant_enabled: helpAssistantEnabled,
        rerank,
      };
      // Services auto-hébergés : d'infrastructure, donc émis seulement si
      // l'appelant a le droit de les écrire (sinon l'API les écarte).
      // `transcription` les a rejoints : le commutateur de moteur et le
      // vocabulaire valent pour toute l'instance, pas pour une organisation.
      if (isInstanceAdmin) {
        payload.transcription = transcription;
        payload.whisper = whisperConfig;
        payload.voxtral = voxtral;
        payload.ollama = ollama;
      }
      const res = await fetch("/api/admin/ai/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (res.ok) {
        // Filet de sécurité : si l'API a tout de même écarté des clés, on le
        // dit au lieu d'annoncer un succès complet.
        if (Array.isArray(data.ignored) && data.ignored.length > 0) {
          toast.warning(
            data.message ||
              "Une partie des réglages n'a pas été enregistrée : elle relève de l'administration d'instance."
          );
        } else {
          toast.success("Réglages IA enregistrés");
        }
        setPristine(currentSnapshot);
      } else {
        throw new Error(data.error || "Erreur");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur lors de la sauvegarde");
    } finally {
      setSaving(false);
    }
  };

  // Test connection
  const testConnection = async (service: "whisper" | "ollama" | "voxtral") => {
    setTestingHealth((prev) => ({ ...prev, [service]: true }));
    try {
      if (service === "voxtral") {
        // Direct health check for Voxtral
        const start = Date.now();
        const res = await fetch(`${voxtral.voxtralApiUrl}/health`);
        const latency = Date.now() - start;
        if (res.ok) {
          setHealthResults((prev) => ({
            ...prev,
            voxtral: { status: "up", latency },
          }));
        } else {
          setHealthResults((prev) => ({
            ...prev,
            voxtral: { status: "down" },
          }));
        }
      } else {
        const res = await fetch("/api/admin/services/health");
        if (res.ok) {
          const data = await res.json();
          if (data[service]) {
            setHealthResults((prev) => ({ ...prev, [service]: data[service] }));
          } else {
            setHealthResults((prev) => ({
              ...prev,
              [service]: { status: "down" },
            }));
          }
        } else {
          setHealthResults((prev) => ({
            ...prev,
            [service]: { status: "down" },
          }));
        }
      }
    } catch {
      setHealthResults((prev) => ({
        ...prev,
        [service]: { status: "down" },
      }));
    } finally {
      setTestingHealth((prev) => ({ ...prev, [service]: false }));
    }
  };

  // Ollama models
  const loadOllamaModels = useCallback(async () => {
    setOllamaModelsLoading(true);
    setOllamaModelsError(null);
    try {
      const res = await fetch("/api/admin/services/ollama-models");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setOllamaModelsError(data.error || "Impossible de joindre Ollama");
        setOllamaModels(null);
        return;
      }
      const data = await res.json();
      const models: OllamaModel[] = Array.isArray(data.models) ? data.models : [];
      setOllamaModels(models);
    } catch {
      setOllamaModelsError("Impossible de joindre Ollama");
      setOllamaModels(null);
    } finally {
      setOllamaModelsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (ollama.ollamaEnabled && ollamaModels === null && !ollamaModelsLoading) {
      loadOllamaModels();
    }
  }, [ollama.ollamaEnabled, ollamaModels, ollamaModelsLoading, loadOllamaModels]);

  const pullOllamaModel = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    setOllamaPulling(true);
    try {
      const res = await fetch("/api/admin/services/ollama-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (res.ok) {
        toast.success(`Modèle ${trimmed} téléchargé`);
        setOllamaPullName("");
        await loadOllamaModels();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || "Échec du téléchargement");
      }
    } catch {
      toast.error("Échec du téléchargement");
    } finally {
      setOllamaPulling(false);
    }
  };

  // Role permission toggle
  const toggleRolePerm = (
    role: "viewer" | "editor" | "admin",
    perm: "canUseAI" | "canUsePlayground" | "canViewLogs"
  ) => {
    setRolePermissions((prev) => ({
      ...prev,
      [role]: {
        ...prev[role],
        [perm]: !prev[role][perm],
      },
    }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      {/* Header */}
      <AdminSaveBar
        title="Réglages IA"
        onSave={handleSave}
        saving={saving}
        isDirty={isDirty}
      />
      <p className="text-sm text-muted-foreground">
        Configuration globale de l&apos;intelligence artificielle, des moteurs auto-hébergés et des alertes.
      </p>

      {/* 1. Acces et permissions */}
      <div className="rounded-lg border bg-card p-6 space-y-6">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-blue-500" />
          <h3 className="text-lg font-semibold">Accès et permissions</h3>
        </div>

        {/* Coupe-circuit IA global : lecture seule, réglé depuis /admin/modules */}
        <ModuleActivationNotice enabled={aiEnabled} moduleName="Intelligence artificielle" />

        {/* Role permissions table */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Permissions par rôle</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-2 pr-4 font-medium text-muted-foreground">Rôle</th>
                  {Object.keys(PERMISSION_LABELS).map((perm) => (
                    <th
                      key={perm}
                      className="text-center py-2 px-4 font-medium text-muted-foreground"
                    >
                      {PERMISSION_LABELS[perm]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(["viewer", "editor", "admin"] as const).map((role) => (
                  <tr key={role} className="border-b last:border-0">
                    <td className="py-3 pr-4 font-medium">{ROLE_LABELS[role]}</td>
                    {(["canUseAI", "canUsePlayground", "canViewLogs"] as const).map((perm) => (
                      <td key={perm} className="text-center py-3 px-4">
                        <Toggle
                          checked={rolePermissions[role][perm]}
                          onChange={() => toggleRolePerm(role, perm)}
                          disabled={!aiEnabled}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Assistant d'aide produit */}
      <div className="rounded-lg border bg-card p-6 space-y-6">
        <div className="flex items-center gap-2">
          <LifeBuoy className="h-5 w-5 text-cyan-500" />
          <h3 className="text-lg font-semibold">Assistant d&apos;aide</h3>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Activer l&apos;assistant d&apos;aide</p>
            <p className="text-xs text-muted-foreground">
              Affiche le bouton d&apos;aide dans la barre latérale et autorise les
              questions produit ainsi que la remontée de bugs. Désactivé, le bouton
              disparaît pour tous les utilisateurs.
            </p>
          </div>
          <Toggle
            checked={helpAssistantEnabled}
            onChange={setHelpAssistantEnabled}
          />
        </div>

        {helpAssistantEnabled && !aiConfigured && (
          <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-4">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-2">
              <p className="text-sm font-medium">Aucune IA configurée</p>
              <p className="text-xs text-muted-foreground">
                L&apos;assistant d&apos;aide restera masqué pour tous les
                utilisateurs tant qu&apos;aucun fournisseur IA n&apos;est activé :
                il ne pourrait pas répondre aux questions.
              </p>
              <Link
                href="/admin/ai/providers"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Configurer un fournisseur IA
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* Reclassement des recherches */}
      <div className="rounded-lg border bg-card p-6 space-y-6">
        <div className="flex items-center gap-2">
          <ArrowUpDown className="h-5 w-5 text-sky-500" />
          <h3 className="text-lg font-semibold">Reclassement des recherches</h3>
        </div>

        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium">Activer le reclassement</p>
            <p className="text-xs text-muted-foreground">
              Un modèle de reclassement relit les résultats candidats et les
              réordonne par pertinence réelle. Ajoute environ 200 ms par
              recherche.
            </p>
          </div>
          <Toggle
            checked={rerank.enabled}
            onChange={(val) => setRerank((prev) => ({ ...prev, enabled: val }))}
          />
        </div>

        <div className="space-y-3 pl-1">
          {(
            [
              { key: "chat", label: "Chat sur documents" },
              { key: "help", label: "Assistant d'aide" },
              { key: "search", label: "Recherche générale" },
            ] as const
          ).map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between">
              <span
                className={`text-sm ${rerank.enabled ? "" : "text-muted-foreground"}`}
              >
                {label}
              </span>
              <Toggle
                checked={rerank[key]}
                onChange={(val) => setRerank((prev) => ({ ...prev, [key]: val }))}
                disabled={!rerank.enabled}
              />
            </div>
          ))}
        </div>

        {rerank.enabled && !rerankAssigned && (
          <div className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 p-4">
            <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-2">
              <p className="text-sm font-medium">
                Aucun modèle de reclassement assigné
              </p>
              <p className="text-xs text-muted-foreground">
                Le reclassement restera inactif tant qu&apos;aucun modèle
                n&apos;est assigné à l&apos;usage « Reclassement des
                recherches » : rien ne réordonnera les résultats.
              </p>
              <Link
                href="/admin/ai/providers"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                Assigner un modèle de reclassement
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        )}
      </div>

      {/* 2. Services IA auto-hébergés */}
      <div className="rounded-lg border bg-card p-6 space-y-8">
        <div>
          <div className="flex items-center gap-2">
            <Server className="h-5 w-5 text-purple-500" />
            <h3 className="text-lg font-semibold">Services IA auto-hébergés</h3>
          </div>
          <p className="text-xs text-muted-foreground mt-1 ml-7">
            Moteurs de transcription et LLM exécutés sur votre infrastructure.
            Les fournisseurs externes (OpenAI, Anthropic, Mistral cloud…) se configurent dans Providers.
          </p>
        </div>

        {!isInstanceAdmin && sessionStatus !== "loading" && (
          <InstanceOnlySection text="Les services auto-hébergés (Faster-Whisper, Voxtral, Ollama) sont partagés par toute l'instance, tout comme le moteur de transcription retenu et le vocabulaire métier, qui valent pour l'ensemble des organisations. Leur adresse, leurs modèles, leurs tests de connexion et ce choix de moteur ne sont ni lisibles ni modifiables depuis l'administration d'une organisation." />
        )}

        {/* Sous-bloc Transcription */}
        {isInstanceAdmin && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Transcription audio
            </h4>
            <div className="h-px flex-1 bg-border" />
          </div>

        {/* Moteur de transcription */}
        <div className="space-y-4">
          <div>
            <p className="text-sm font-medium">Moteur de transcription</p>
            <p className="text-xs text-muted-foreground">
              Choisissez le service utilisé pour la transcription audio vers texte
            </p>
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setTranscription({ ...transcription, engine: "whisper" })}
              className={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                transcription.engine === "whisper"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-transparent text-muted-foreground hover:bg-muted/50"
              }`}
            >
              Faster-Whisper (CPU)
            </button>
            <button
              type="button"
              onClick={() => setTranscription({ ...transcription, engine: "voxtral" })}
              className={`flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors ${
                transcription.engine === "voxtral"
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border bg-transparent text-muted-foreground hover:bg-muted/50"
              }`}
            >
              Voxtral Realtime (GPU)
            </button>
          </div>

          <div className="space-y-2">
            <Label htmlFor="transcription-vocabulary">Vocabulaire métier</Label>
            <textarea
              id="transcription-vocabulary"
              value={transcription.vocabulary}
              onChange={(e) =>
                setTranscription({ ...transcription, vocabulary: e.target.value })
              }
              placeholder="LorIAx, Hocuspocus, MasterProject, Ollama"
              rows={3}
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <p className="text-xs text-muted-foreground">
              Noms propres, acronymes et termes spécifiques à votre organisation.
              Séparez-les par des virgules. Améliore la reconnaissance des mots peu courants.
              Partagé entre tous les moteurs de transcription.
            </p>
          </div>
        </div>

        {/* Whisper */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">Faster-Whisper (transcription CPU)</p>
              {transcription.engine === "whisper" && (
                <span className="text-[10px] font-semibold uppercase tracking-wider bg-primary/10 text-primary px-1.5 py-0.5 rounded">Actif</span>
              )}
            </div>
            <HealthBadge result={healthResults.whisper} />
          </div>

          <ModuleActivationNotice enabled={whisper.whisperEnabled} moduleName="Transcription" />

          <div className="space-y-4 p-4 rounded-lg border border-border bg-muted/30">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="whisper-url">URL du service</Label>
                <Input
                  id="whisper-url"
                  value={whisper.whisperApiUrl}
                  onChange={(e) =>
                    setWhisper({ ...whisper, whisperApiUrl: e.target.value })
                  }
                  placeholder="http://localhost:9000"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="whisper-model">Modèle</Label>
                <select
                  id="whisper-model"
                  value={whisper.whisperModel}
                  onChange={(e) =>
                    setWhisper({ ...whisper, whisperModel: e.target.value })
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {WHISPER_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="whisper-lang">Langue</Label>
                <select
                  id="whisper-lang"
                  value={whisper.whisperLanguage}
                  onChange={(e) =>
                    setWhisper({ ...whisper, whisperLanguage: e.target.value })
                  }
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {WHISPER_LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center justify-between pt-6">
                <Label htmlFor="whisper-diarize">Diarisation (identification des locuteurs)</Label>
                <Toggle
                  checked={whisper.whisperDiarize}
                  onChange={(v) => setWhisper({ ...whisper, whisperDiarize: v })}
                />
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => testConnection("whisper")}
              disabled={testingHealth.whisper}
            >
              {testingHealth.whisper ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Wifi className="h-4 w-4 mr-2" />
              )}
              Tester la connexion
            </Button>
          </div>
        </div>

        {/* Voxtral */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium">Voxtral Realtime (transcription GPU)</p>
              {transcription.engine === "voxtral" && (
                <span className="text-[10px] font-semibold uppercase tracking-wider bg-primary/10 text-primary px-1.5 py-0.5 rounded">Actif</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <HealthBadge result={healthResults.voxtral} />
              <Toggle
                checked={voxtral.voxtralEnabled}
                onChange={(v) => setVoxtral({ ...voxtral, voxtralEnabled: v })}
              />
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Mistral Voxtral Mini 4B Realtime — transcription temps réel via vLLM.
            Requiert un GPU NVIDIA avec au moins 16 Go de VRAM.
          </p>

          {voxtral.voxtralEnabled && (
            <div className="space-y-4 p-4 rounded-lg border border-border bg-muted/30">
              {healthResults.voxtral?.status !== "up" && (
                <div className="rounded-md bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 px-3 py-2">
                  <p className="text-xs text-amber-800 dark:text-amber-200">
                    Service Voxtral non joignable. Vérifiez que le profil Docker
                    <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded mx-1">voxtral</code>
                    est lancé et qu&apos;un GPU est disponible.
                    En attendant, Whisper prend le relais automatiquement.
                  </p>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="voxtral-url">URL du service</Label>
                  <Input
                    id="voxtral-url"
                    value={voxtral.voxtralApiUrl}
                    onChange={(e) =>
                      setVoxtral({ ...voxtral, voxtralApiUrl: e.target.value })
                    }
                    placeholder="http://localhost:9001"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="voxtral-model">Modèle</Label>
                  <select
                    id="voxtral-model"
                    value={voxtral.voxtralModel}
                    onChange={(e) =>
                      setVoxtral({ ...voxtral, voxtralModel: e.target.value })
                    }
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {VOXTRAL_MODELS.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="voxtral-lang">Langue</Label>
                  <select
                    id="voxtral-lang"
                    value={voxtral.voxtralLanguage}
                    onChange={(e) =>
                      setVoxtral({ ...voxtral, voxtralLanguage: e.target.value })
                    }
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    {TRANSCRIPTION_LANGUAGES.map((l) => (
                      <option key={l.value} value={l.value}>
                        {l.label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => testConnection("voxtral")}
                  disabled={testingHealth.voxtral}
                >
                  {testingHealth.voxtral ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Wifi className="h-4 w-4 mr-2" />
                  )}
                  Tester la connexion
                </Button>
              </div>
              <p className="text-xs text-muted-foreground italic">
                Pour activer : lancer le profil Docker
                <code className="bg-muted px-1 rounded mx-1">--profile voxtral</code>
                sur un serveur avec GPU NVIDIA.
                Le modèle (4B params, BF16, ~8 Go) se télécharge au premier démarrage.
              </p>
            </div>
          )}
        </div>

        </div>
        )}

        {/* Sous-bloc LLM local */}
        {isInstanceAdmin && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <h4 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              LLM local
            </h4>
            <div className="h-px flex-1 bg-border" />
          </div>

        {/* Ollama */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Ollama (LLM local)</p>
              <p className="text-xs text-muted-foreground">
                Modèles de langage locaux pour les résumés et le chat IA
              </p>
            </div>
            <div className="flex items-center gap-3">
              <HealthBadge result={healthResults.ollama} />
              <Toggle
                checked={ollama.ollamaEnabled}
                onChange={(v) => setOllama({ ...ollama, ollamaEnabled: v })}
              />
            </div>
          </div>

          {ollama.ollamaEnabled && (
            <div className="space-y-4 p-4 rounded-lg border border-border bg-muted/30">
              <div className="space-y-2">
                <Label htmlFor="ollama-url">URL du service</Label>
                <Input
                  id="ollama-url"
                  value={ollama.ollamaBaseUrl}
                  onChange={(e) =>
                    setOllama({ ...ollama, ollamaBaseUrl: e.target.value })
                  }
                  placeholder="http://localhost:11434"
                />
              </div>

              {/* Modèles installés */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Modèles installés</Label>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={loadOllamaModels}
                    disabled={ollamaModelsLoading}
                    className="h-7 px-2"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${ollamaModelsLoading ? "animate-spin" : ""}`} />
                  </Button>
                </div>

                {ollamaModelsError && (
                  <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 px-3 py-2">
                    <p className="text-xs text-amber-800 dark:text-amber-200">
                      {ollamaModelsError}. Vérifiez que le service est démarré à l&apos;URL ci-dessus.
                    </p>
                  </div>
                )}

                {!ollamaModelsError && ollamaModels && ollamaModels.length === 0 && (
                  <p className="text-xs text-muted-foreground italic">
                    Aucun modèle installé. Téléchargez-en un ci-dessous.
                  </p>
                )}

                {!ollamaModelsError && ollamaModels && ollamaModels.length > 0 && (
                  <div className="rounded-md border border-border bg-card divide-y divide-border">
                    {ollamaModels.map((m) => {
                      const isDefault = ollama.ollamaDefaultModel === m.name;
                      return (
                        <button
                          type="button"
                          key={m.name}
                          onClick={() => setOllama({ ...ollama, ollamaDefaultModel: m.name })}
                          className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50 ${
                            isDefault ? "bg-primary/5" : ""
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span
                              className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${
                                isDefault
                                  ? "border-primary bg-primary text-primary-foreground"
                                  : "border-border"
                              }`}
                            >
                              {isDefault && <Check className="h-3 w-3" />}
                            </span>
                            <span className="font-medium truncate">{m.name}</span>
                            {m.details?.parameter_size && (
                              <span className="text-xs text-muted-foreground shrink-0">
                                {m.details.parameter_size}
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="text-xs text-muted-foreground">{formatBytes(m.size)}</span>
                            {isDefault && (
                              <span className="text-[10px] font-semibold uppercase tracking-wider bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                                Défaut
                              </span>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Fallback : si erreur de connexion, garder un input texte libre */}
                {ollamaModelsError && (
                  <div className="space-y-1">
                    <Label htmlFor="ollama-model-fallback" className="text-xs">
                      Modèle par défaut (saisie manuelle)
                    </Label>
                    <Input
                      id="ollama-model-fallback"
                      value={ollama.ollamaDefaultModel}
                      onChange={(e) =>
                        setOllama({ ...ollama, ollamaDefaultModel: e.target.value })
                      }
                      placeholder="gemma3:4b"
                    />
                  </div>
                )}
              </div>

              {/* Ajouter un modèle */}
              <div className="space-y-2">
                <Label htmlFor="ollama-pull">Ajouter un modèle</Label>
                <div className="flex gap-2">
                  <Input
                    id="ollama-pull"
                    value={ollamaPullName}
                    onChange={(e) => setOllamaPullName(e.target.value)}
                    placeholder="ex. gemma3:4b"
                    disabled={ollamaPulling}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => pullOllamaModel(ollamaPullName)}
                    disabled={ollamaPulling || !ollamaPullName.trim()}
                  >
                    {ollamaPulling ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    Télécharger
                  </Button>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-muted-foreground">Suggestions :</span>
                  {OLLAMA_SUGGESTIONS.map((s) => (
                    <button
                      type="button"
                      key={s}
                      onClick={() => setOllamaPullName(s)}
                      disabled={ollamaPulling}
                      className="text-xs rounded-md border border-border bg-transparent px-2 py-0.5 hover:bg-muted/50 disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
                {ollamaPulling && (
                  <p className="text-xs text-muted-foreground italic">
                    Téléchargement en cours… cela peut prendre plusieurs minutes selon la taille du modèle.
                  </p>
                )}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => testConnection("ollama")}
                disabled={testingHealth.ollama}
              >
                {testingHealth.ollama ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Wifi className="h-4 w-4 mr-2" />
                )}
                Tester la connexion
              </Button>
            </div>
          )}
        </div>
        </div>
        )}
      </div>

      {/* 3. Coûts et alertes */}
      <div className="rounded-lg border bg-card p-6 space-y-6">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5 text-amber-500" />
          <h3 className="text-lg font-semibold">Coûts et alertes</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label htmlFor="threshold-warning">Seuil d&apos;avertissement (%)</Label>
            <Input
              id="threshold-warning"
              type="number"
              min={0}
              max={100}
              value={alerts.thresholdWarning}
              onChange={(e) =>
                setAlerts({ ...alerts, thresholdWarning: parseInt(e.target.value) || 0 })
              }
            />
            <p className="text-xs text-muted-foreground">
              Notification quand le budget atteint ce pourcentage
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="threshold-critical">Seuil critique (%)</Label>
            <Input
              id="threshold-critical"
              type="number"
              min={0}
              max={200}
              value={alerts.thresholdCritical}
              onChange={(e) =>
                setAlerts({ ...alerts, thresholdCritical: parseInt(e.target.value) || 0 })
              }
            />
            <p className="text-xs text-muted-foreground">
              Alerte critique quand le budget est dépassé
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notification-email">Email de notification</Label>
            <Input
              id="notification-email"
              type="email"
              value={alerts.notificationEmail}
              onChange={(e) =>
                setAlerts({ ...alerts, notificationEmail: e.target.value })
              }
              placeholder="admin@example.com"
            />
            <p className="text-xs text-muted-foreground">
              Adresse qui recevra les alertes de dépassement
            </p>
          </div>
        </div>
      </div>

      {/* 4. Rétention des logs */}
      <div className="rounded-lg border bg-card p-6 space-y-6">
        <div className="flex items-center gap-2">
          <Database className="h-5 w-5 text-green-500" />
          <h3 className="text-lg font-semibold">Rétention des logs</h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label htmlFor="retention-days">Durée de rétention (jours)</Label>
            <Input
              id="retention-days"
              type="number"
              min={1}
              max={365}
              value={retention.retentionDays}
              onChange={(e) =>
                setRetention({ ...retention, retentionDays: parseInt(e.target.value) || 90 })
              }
            />
            <p className="text-xs text-muted-foreground">
              Les logs plus anciens seront automatiquement supprimés
            </p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium">Stocker le contenu des requêtes</p>
              <p className="text-xs text-muted-foreground">
                Conserve le prompt et la réponse dans les logs (utile pour le débogage)
              </p>
            </div>
            <Toggle
              checked={retention.storeContent}
              onChange={(v) => setRetention({ ...retention, storeContent: v })}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
