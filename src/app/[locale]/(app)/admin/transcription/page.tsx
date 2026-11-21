"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { toast } from "sonner";
import { Loader2, Wifi, WifiOff, Mic, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModuleActivationNotice } from "@/components/admin/module-activation-notice";
import { BackToServices } from "@/components/admin/back-to-services";
import { AdminSaveBar } from "@/components/admin/floating-save-button";

interface TranscriptionSettings {
  engine: "whisper" | "voxtral";
  vocabulary: string;
}

interface WhisperSettings {
  whisperEnabled: boolean;
  whisperApiUrl: string;
  whisperModel: string;
  whisperLanguage: string;
  whisperDiarize: boolean;
}

interface VoxtralSettings {
  voxtralEnabled: boolean;
  voxtralApiUrl: string;
  voxtralModel: string;
  voxtralLanguage: string;
}

interface HealthResult {
  status: "up" | "down";
  latency?: number;
}

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

const VOXTRAL_MODELS = [
  { value: "mistralai/Voxtral-Mini-4B-Realtime-2602", label: "Voxtral Mini 4B Realtime (GPU >= 16 Go)" },
];

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

/**
 * Mention affichée à la place des blocs de configuration que l'API réserve à
 * l'administration d'instance (`transcription`, `whisper`, `voxtral`). Les
 * afficher quand même montrerait les valeurs par défaut des constantes
 * ci-dessus, pas celles de l'instance.
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

export default function AdminTranscriptionPage() {
  /**
   * AZ-08 : `whisper`, `voxtral` et, depuis le lot 6, `transcription` sont des
   * clés d'infrastructure. L'API ne les rend plus à un administrateur
   * d'organisation et IGNORE silencieusement celles qu'il enverrait. La page
   * affichait donc les valeurs par défaut de ses constantes comme si c'était la
   * configuration réelle, puis annonçait un enregistrement complet. On n'offre
   * plus à l'édition ce qu'on n'a pas pu lire, et on lit le champ `ignored` de
   * la réponse.
   *
   * Le commutateur de moteur et le vocabulaire métier étaient les deux seuls
   * réglages que cet écran laissait encore à une administration d'organisation.
   * Une fois `transcription` passée en instance, il ne reste RIEN à lui offrir :
   * on rend une explication plutôt qu'un formulaire vide, comme l'écran des
   * courriels.
   */
  const { data: session, status: sessionStatus } = useSession();
  const isInstanceAdmin =
    (session?.user as { globalRole?: string } | undefined)?.globalRole === "super_admin";

  const [transcription, setTranscription] = useState<TranscriptionSettings>(DEFAULT_TRANSCRIPTION);
  const [whisper, setWhisper] = useState<WhisperSettings>(DEFAULT_WHISPER);
  const [voxtral, setVoxtral] = useState<VoxtralSettings>(DEFAULT_VOXTRAL);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [healthResults, setHealthResults] = useState<Record<string, HealthResult>>({});
  const [testingHealth, setTestingHealth] = useState<Record<string, boolean>>({});

  // Snapshot du dernier état enregistré (détection des modifications en attente)
  const [pristine, setPristine] = useState<string | null>(null);
  const currentSnapshot = useMemo(
    () => JSON.stringify({ transcription, whisper, voxtral }),
    [transcription, whisper, voxtral]
  );
  const isDirty = pristine !== null && pristine !== currentSnapshot;

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/ai/settings");
      if (!res.ok) return;
      const data = await res.json();
      if (data.transcription) setTranscription((prev) => ({ ...prev, ...data.transcription }));
      if (data.whisper) setWhisper((prev) => ({ ...prev, ...data.whisper }));
      if (data.voxtral) setVoxtral((prev) => ({ ...prev, ...data.voxtral }));
    } catch (err) {
      console.error("Failed to load transcription settings:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Capturer le snapshot pristine une fois le chargement initial terminé
  useEffect(() => {
    if (loading || pristine !== null) return;
    setPristine(currentSnapshot);
  }, [loading, pristine, currentSnapshot]);

  const handleSave = async () => {
    setSaving(true);
    try {
      // `whisperEnabled` est l'interrupteur du module Transcription : il ne
      // s'écrit que depuis /admin/modules, on ne le renvoie pas ici.
      const { whisperEnabled: _whisperEnabled, ...whisperConfig } = whisper;
      // Tous les réglages de cet écran sont d'infrastructure, y compris le
      // choix du moteur et le vocabulaire : on ne les émet que si l'appelant a
      // le droit de les écrire, sinon l'API les ignore sans rien dire.
      const payload: Record<string, unknown> = {};
      if (isInstanceAdmin) {
        payload.transcription = transcription;
        payload.whisper = whisperConfig;
        payload.voxtral = voxtral;
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
          toast.success("Réglages de transcription enregistrés");
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

  const testConnection = async (service: "whisper" | "voxtral") => {
    setTestingHealth((prev) => ({ ...prev, [service]: true }));
    try {
      if (service === "voxtral") {
        const start = Date.now();
        const res = await fetch(`${voxtral.voxtralApiUrl}/health`);
        const latency = Date.now() - start;
        setHealthResults((prev) => ({
          ...prev,
          voxtral: res.ok ? { status: "up", latency } : { status: "down" },
        }));
      } else {
        const res = await fetch("/api/admin/services/health");
        if (res.ok) {
          const data = await res.json();
          setHealthResults((prev) => ({
            ...prev,
            [service]: data[service] ?? { status: "down" },
          }));
        } else {
          setHealthResults((prev) => ({ ...prev, [service]: { status: "down" } }));
        }
      }
    } catch {
      setHealthResults((prev) => ({ ...prev, [service]: { status: "down" } }));
    } finally {
      setTestingHealth((prev) => ({ ...prev, [service]: false }));
    }
  };

  // On attend la fin du chargement de la session avant de trancher : afficher
  // le refus pendant ce temps le ferait clignoter chez l'administration
  // d'instance, qui a pourtant tous les droits sur cet écran.
  if (sessionStatus === "loading") {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isInstanceAdmin) {
    return (
      <div className="space-y-6">
        <BackToServices />
        <div className="flex items-center gap-2">
          <Mic className="h-5 w-5 text-purple-500 shrink-0" />
          <p className="text-sm text-muted-foreground">
            Configuration du moteur de transcription audio utilisé pour les
            réunions et les notes vocales.
          </p>
        </div>
        <InstanceOnlySection text="La transcription audio repose sur des services partagés par toute l'instance : le moteur retenu (Faster-Whisper ou Voxtral), son adresse, son modèle et le vocabulaire métier valent pour l'ensemble des organisations. Aucun de ces réglages n'est lisible ni modifiable depuis l'administration d'une organisation." />
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-24">
      <BackToServices />

      <AdminSaveBar
        title="Transcription audio"
        onSave={handleSave}
        saving={saving}
        isDirty={isDirty}
      />

      <div className="flex items-center gap-2">
        <Mic className="h-5 w-5 text-purple-500 shrink-0" />
        <p className="text-sm text-muted-foreground">
          Configuration du moteur de transcription audio utilisé pour les réunions et les notes vocales.
        </p>
        {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {/* Moteur */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <div>
          <p className="text-sm font-medium">Moteur de transcription</p>
          <p className="text-xs text-muted-foreground">
            Choisissez le service utilisé pour la transcription audio vers texte.
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
            onChange={(e) => setTranscription({ ...transcription, vocabulary: e.target.value })}
            placeholder="LorIAx, Hocuspocus, MasterProject, Ollama"
            rows={3}
            className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          <p className="text-xs text-muted-foreground">
            Noms propres, acronymes et termes spécifiques à votre organisation. Séparez-les par des virgules.
            Améliore la reconnaissance des mots peu courants. Partagé entre tous les moteurs.
          </p>
        </div>
      </div>

      {/* Whisper */}
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Faster-Whisper (transcription CPU)</p>
            {transcription.engine === "whisper" && (
              <span className="text-[10px] font-semibold uppercase tracking-wider bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                Actif
              </span>
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
                onChange={(e) => setWhisper({ ...whisper, whisperApiUrl: e.target.value })}
                placeholder="http://localhost:9000"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="whisper-model">Modèle</Label>
              <select
                id="whisper-model"
                value={whisper.whisperModel}
                onChange={(e) => setWhisper({ ...whisper, whisperModel: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {WHISPER_MODELS.map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="whisper-lang">Langue</Label>
              <select
                id="whisper-lang"
                value={whisper.whisperLanguage}
                onChange={(e) => setWhisper({ ...whisper, whisperLanguage: e.target.value })}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {TRANSCRIPTION_LANGUAGES.map((l) => (
                  <option key={l.value} value={l.value}>{l.label}</option>
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
      <div className="rounded-lg border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">Voxtral Realtime (transcription GPU)</p>
            {transcription.engine === "voxtral" && (
              <span className="text-[10px] font-semibold uppercase tracking-wider bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                Actif
              </span>
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
          Mistral Voxtral Mini 4B Realtime — transcription temps réel via vLLM. Requiert un GPU NVIDIA avec
          au moins 16 Go de VRAM.
        </p>

        {voxtral.voxtralEnabled && (
          <div className="space-y-4 p-4 rounded-lg border border-border bg-muted/30">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="voxtral-url">URL du service</Label>
                <Input
                  id="voxtral-url"
                  value={voxtral.voxtralApiUrl}
                  onChange={(e) => setVoxtral({ ...voxtral, voxtralApiUrl: e.target.value })}
                  placeholder="http://localhost:9001"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="voxtral-model">Modèle</Label>
                <select
                  id="voxtral-model"
                  value={voxtral.voxtralModel}
                  onChange={(e) => setVoxtral({ ...voxtral, voxtralModel: e.target.value })}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {VOXTRAL_MODELS.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="voxtral-lang">Langue</Label>
                <select
                  id="voxtral-lang"
                  value={voxtral.voxtralLanguage}
                  onChange={(e) => setVoxtral({ ...voxtral, voxtralLanguage: e.target.value })}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {TRANSCRIPTION_LANGUAGES.map((l) => (
                    <option key={l.value} value={l.value}>{l.label}</option>
                  ))}
                </select>
              </div>
            </div>
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
        )}
      </div>
    </div>
  );
}
