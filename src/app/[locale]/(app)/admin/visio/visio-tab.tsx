"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useSession } from "next-auth/react";
import { Video, Loader2, Settings, Lock } from "lucide-react";
import { toast } from "sonner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ModuleActivationNotice } from "@/components/admin/module-activation-notice";
import { AdminSaveBar } from "@/components/admin/floating-save-button";

type VisioAction =
  | "join_immediate"
  | "join_scheduled_invited"
  | "join_scheduled_uninvited"
  | "create_immediate"
  | "create_scheduled"
  | "modify_cancel";

type Role = "viewer" | "editor";

const ACTION_LABELS: Record<VisioAction, string> = {
  join_immediate: "Rejoindre une réunion immédiate",
  join_scheduled_invited: "Rejoindre une réunion planifiée (invité)",
  join_scheduled_uninvited: "Rejoindre une réunion planifiée (sans invitation)",
  create_immediate: "Créer une réunion immédiate",
  create_scheduled: "Planifier une réunion",
  modify_cancel: "Modifier / annuler une réunion",
};

const ACTIONS = Object.keys(ACTION_LABELS) as VisioAction[];
const ROLES: Role[] = ["viewer", "editor"];

type Matrix = Record<VisioAction, Record<Role | "admin", boolean>>;

interface LiveKitSettings {
  livekitEnabled: boolean;
  livekitUrl: string;
  livekitEgressPath: string;
  livekitApiKey: string;
  livekitApiSecret: string;
}

const DEFAULT_LIVEKIT: LiveKitSettings = {
  livekitEnabled: true,
  livekitUrl: "ws://localhost:7880",
  livekitEgressPath: "/recordings",
  livekitApiKey: "",
  livekitApiSecret: "",
};

/**
 * Mention affichée à la place d'un réglage que l'API réserve à
 * l'administration d'instance.
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

export function AdminVisioTab() {
  /**
   * AZ-06 / AZ-08 : la matrice PAR DÉFAUT sert de repli à toutes les
   * organisations, son écriture est donc réservée à l'administration
   * d'instance, et la clé `livekit` est d'infrastructure (ni lue ni écrite pour
   * un administrateur d'organisation). La lecture de la matrice, elle, reste
   * ouverte au rôle `admin` : on l'affiche, mais en lecture seule, plutôt que
   * de laisser cliquer des interrupteurs qui reviennent en arrière sur un 403.
   */
  const { data: session, status: sessionStatus } = useSession();
  const isInstanceAdmin =
    (session?.user as { globalRole?: string } | undefined)?.globalRole === "super_admin";

  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [livekit, setLivekit] = useState<LiveKitSettings>(DEFAULT_LIVEKIT);
  const [livekitSaving, setLivekitSaving] = useState(false);

  // Snapshot du dernier état enregistré (détection des modifications en attente)
  const [livekitPristine, setLivekitPristine] = useState<string | null>(null);
  const livekitSnapshot = useMemo(() => JSON.stringify(livekit), [livekit]);
  const livekitDirty = livekitPristine !== null && livekitPristine !== livekitSnapshot;

  const fetchMatrix = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/visio-permissions");
      if (res.ok) {
        setMatrix(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMatrix();
  }, [fetchMatrix]);

  useEffect(() => {
    fetch("/api/admin/settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const next: LiveKitSettings = { ...DEFAULT_LIVEKIT, ...(data?.livekit ?? {}) };
        setLivekit(next);
        setLivekitPristine(JSON.stringify(next));
      })
      .catch(() => setLivekitPristine(JSON.stringify(DEFAULT_LIVEKIT)));
  }, []);

  const handleToggle = async (action: VisioAction, role: Role) => {
    if (!matrix) return;

    const current = matrix[action][role];
    const newValue = !current;

    setMatrix((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        [action]: { ...prev[action], [role]: newValue },
      };
    });

    try {
      const res = await fetch("/api/admin/visio-permissions", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          spaceId: null,
          action,
          role,
          allowed: newValue,
        }),
      });

      if (!res.ok) {
        setMatrix((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            [action]: { ...prev[action], [role]: current },
          };
        });
        // Le service explique POURQUOI il refuse (rôle insuffisant sur la
        // matrice par défaut, espace hors périmètre). Sans cela, l'utilisateur
        // voyait l'interrupteur revenir en arrière sans savoir de quoi il
        // s'agissait.
        const data = await res.json().catch(() => null);
        toast.error(
          (data && typeof data.error === "string" && data.error) ||
            "Erreur lors de la mise à jour"
        );
      }
    } catch {
      setMatrix((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [action]: { ...prev[action], [role]: current },
        };
      });
    }
  };

  async function handleLivekitSave() {
    setLivekitSaving(true);
    try {
      // `livekitEnabled` est l'interrupteur du module Visioconférence : il ne
      // s'écrit que depuis /admin/modules, on ne le renvoie pas ici.
      const { livekitEnabled: _livekitEnabled, ...livekitConfig } = livekit;
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ livekit: livekitConfig }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      setLivekitPristine(livekitSnapshot);
      toast.success("Paramètres LiveKit enregistrés");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setLivekitSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!matrix) return null;

  return (
    <div className="max-w-3xl space-y-8">
      {isInstanceAdmin && (
        <AdminSaveBar
          title="Visioconférence"
          label="Enregistrer LiveKit"
          onSave={handleLivekitSave}
          saving={livekitSaving}
          isDirty={livekitDirty}
        />
      )}

      {/* Matrice des permissions */}
      <div>
        <div className="flex items-center gap-3 mb-6">
          <Video className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">Permissions visio</h2>
            <p className="text-sm text-muted-foreground">
              Configuration globale des permissions de visioconférence par rôle.
              Les administrateurs ont toujours accès.
            </p>
          </div>
        </div>

        {!isInstanceAdmin && sessionStatus !== "loading" && (
          <div className="mb-4">
            <InstanceOnlySection text="Cette matrice par défaut s'applique à toutes les organisations de l'instance : elle est affichée ici en lecture seule. Seule l'administration d'instance peut la modifier." />
          </div>
        )}

        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50">
                <th className="text-left px-4 py-3 font-medium">Action</th>
                <th className="text-center px-4 py-3 font-medium w-24">Lecteur</th>
                <th className="text-center px-4 py-3 font-medium w-24">Éditeur</th>
                <th className="text-center px-4 py-3 font-medium w-24">Admin</th>
              </tr>
            </thead>
            <tbody>
              {ACTIONS.map((action) => (
                <tr key={action} className="border-t border-border">
                  <td className="px-4 py-3">{ACTION_LABELS[action]}</td>
                  {ROLES.map((role) => (
                    <td key={role} className="text-center px-4 py-3">
                      <input
                        type="checkbox"
                        checked={matrix[action][role]}
                        onChange={() => handleToggle(action, role)}
                        disabled={!isInstanceAdmin}
                        className={`rounded ${isInstanceAdmin ? "" : "opacity-50"}`}
                      />
                    </td>
                  ))}
                  <td className="text-center px-4 py-3">
                    <input
                      type="checkbox"
                      checked
                      disabled
                      className="rounded opacity-50"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground mt-3">
          Le créateur d&apos;une réunion peut toujours la modifier ou l&apos;annuler, indépendamment de cette matrice.
          Ces permissions peuvent être surchargées au niveau de chaque espace. Chaque case cochée est
          enregistrée immédiatement : le bouton en haut de page ne concerne que la configuration LiveKit.
        </p>
      </div>

      {/* Configuration LiveKit */}
      <section className="space-y-4">
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <Settings className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium">Configuration LiveKit</h3>
        </div>

        {!isInstanceAdmin && sessionStatus !== "loading" && (
          <InstanceOnlySection text="Le serveur média LiveKit et son couple clé/secret sont partagés par toute l'instance. Sa configuration n'est ni lisible ni modifiable depuis l'administration d'une organisation." />
        )}

        {isInstanceAdmin && (
        <ModuleActivationNotice enabled={livekit.livekitEnabled} moduleName="Visioconférence" />
        )}

        {isInstanceAdmin && (
        <div className="grid grid-cols-2 gap-4 p-4 rounded-lg border border-border bg-muted/30">
          <div className="space-y-2">
            <Label htmlFor="lk-url">URL WebSocket</Label>
            <Input
              id="lk-url"
              value={livekit.livekitUrl}
              onChange={(e) => setLivekit((p) => ({ ...p, livekitUrl: e.target.value }))}
              placeholder="ws://localhost:7880"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lk-egress">Chemin Egress</Label>
            <Input
              id="lk-egress"
              value={livekit.livekitEgressPath}
              onChange={(e) => setLivekit((p) => ({ ...p, livekitEgressPath: e.target.value }))}
              placeholder="/recordings"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lk-key">API Key</Label>
            <Input
              id="lk-key"
              type="password"
              value={livekit.livekitApiKey}
              onChange={(e) => setLivekit((p) => ({ ...p, livekitApiKey: e.target.value }))}
              placeholder="devkey"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="lk-secret">API Secret</Label>
            <Input
              id="lk-secret"
              type="password"
              value={livekit.livekitApiSecret}
              onChange={(e) => setLivekit((p) => ({ ...p, livekitApiSecret: e.target.value }))}
              placeholder="devsecret"
            />
          </div>
        </div>
        )}
      </section>
    </div>
  );
}
