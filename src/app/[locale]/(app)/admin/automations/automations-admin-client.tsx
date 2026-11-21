"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, CheckCircle2, XCircle, SkipForward, Zap, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { TRIGGER_LABELS, ACTION_LABELS } from "@/app/[locale]/(app)/automations/automation-labels";

type Tab = "config" | "list" | "log";

interface AutomationRow {
  id: string;
  name: string;
  triggerType: string;
  actionType: string;
  enabled: boolean;
  lastRunAt: string | null;
  createdAt: string;
  databaseId: string;
  databaseName: string;
  spaceName: string;
  creatorName: string | null;
  creatorEmail: string | null;
  runCount: number;
}

interface RunRow {
  id: string;
  automationId: string;
  automationName: string;
  databaseName: string;
  triggeredAt: string;
  status: "success" | "error" | "skipped" | "partial";
  durationMs: number | null;
  errorMessage: string | null;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AutomationsAdminClient() {
  const [tab, setTab] = useState<Tab>("config");
  const [globalEnabled, setGlobalEnabled] = useState(true);
  const [toggling, setToggling] = useState(false);
  const [loadingCfg, setLoadingCfg] = useState(true);

  const [automations, setAutomations] = useState<AutomationRow[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"" | "success" | "error" | "skipped" | "partial">("");

  const loadConfig = useCallback(async () => {
    setLoadingCfg(true);
    try {
      const res = await fetch("/api/admin/settings");
      if (!res.ok) return;
      const data = await res.json();
      setGlobalEnabled(data.automations?.enabled !== false);
    } finally {
      setLoadingCfg(false);
    }
  }, []);

  const loadList = useCallback(async () => {
    setLoadingList(true);
    try {
      const res = await fetch("/api/admin/automations");
      if (!res.ok) return;
      setAutomations(await res.json());
    } finally {
      setLoadingList(false);
    }
  }, []);

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const url = statusFilter
        ? `/api/admin/automations/runs?status=${statusFilter}&limit=200`
        : "/api/admin/automations/runs?limit=200";
      const res = await fetch(url);
      if (!res.ok) return;
      setRuns(await res.json());
    } finally {
      setLoadingRuns(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    if (tab === "list") loadList();
    if (tab === "log") loadRuns();
  }, [tab, loadList, loadRuns]);

  async function handleToggleGlobal() {
    setToggling(true);
    const newValue = !globalEnabled;
    setGlobalEnabled(newValue);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ automations: { enabled: newValue } }),
      });
      if (!res.ok) {
        setGlobalEnabled(!newValue);
        toast.error("Impossible d'enregistrer le réglage");
      } else {
        toast.success(
          newValue
            ? "Automatismes activés globalement"
            : "Automatismes désactivés globalement"
        );
      }
    } finally {
      setToggling(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-neutral-200 dark:border-neutral-800">
        {[
          { id: "config" as const, label: "Configuration" },
          { id: "list" as const, label: "Automations" },
          { id: "log" as const, label: "Journal" },
        ].map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === t.id
                ? "border-orange-500 text-orange-600 dark:text-orange-400"
                : "border-transparent text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "config" && (
        <div className="space-y-4">
          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-5">
            <div className="flex items-start gap-4">
              <div className="rounded-md bg-orange-100 dark:bg-orange-950 p-2 text-orange-600 dark:text-orange-400">
                <Zap className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 className="font-medium">Activation globale</h3>
                    <p className="text-sm text-neutral-500 mt-1">
                      Lorsque désactivé, les déclencheurs sont court-circuités
                      (aucun webhook envoyé, aucun email, aucun cron). La
                      création de nouvelles automatisations est également bloquée.
                    </p>
                  </div>
                  {loadingCfg ? (
                    <Loader2 className="h-5 w-5 animate-spin text-neutral-400" />
                  ) : (
                    <Switch
                      checked={globalEnabled}
                      onCheckedChange={handleToggleGlobal}
                      disabled={toggling}
                    />
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-5">
            <h3 className="font-medium mb-2">Qui peut créer une automatisation ?</h3>
            <p className="text-sm text-neutral-500 mb-3">
              Seuls les utilisateurs ayant l&apos;un de ces rôles globaux peuvent
              créer ou modifier des automatisations depuis <code>/automations</code> :
            </p>
            <ul className="text-sm space-y-1 list-disc list-inside text-neutral-700 dark:text-neutral-300">
              <li><strong>super_admin</strong> — accès complet</li>
              <li><strong>admin</strong> — accès complet</li>
              <li><strong>automation_manager</strong> — rôle dédié, pas d&apos;autres droits admin</li>
            </ul>
            <p className="text-sm text-neutral-500 mt-3">
              Pour assigner le rôle <code>automation_manager</code> à un utilisateur, allez dans{" "}
              <a href="/admin/users" className="text-orange-600 hover:underline">/admin/users</a>.
            </p>
          </div>
        </div>
      )}

      {tab === "list" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-neutral-500">
              {automations.length} automatisation{automations.length > 1 ? "s" : ""} au total
            </p>
            <Button variant="outline" size="sm" onClick={loadList} disabled={loadingList}>
              {loadingList ? <Loader2 className="h-4 w-4 animate-spin" /> : "Rafraîchir"}
            </Button>
          </div>
          {loadingList ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
            </div>
          ) : automations.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-8 text-center text-sm text-neutral-500">
              Aucune automatisation configurée sur cette instance.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 dark:bg-neutral-900/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Nom</th>
                    <th className="px-3 py-2 font-medium">Base</th>
                    <th className="px-3 py-2 font-medium">Déclencheur</th>
                    <th className="px-3 py-2 font-medium">Action</th>
                    <th className="px-3 py-2 font-medium">Créateur</th>
                    <th className="px-3 py-2 font-medium text-right">Runs</th>
                    <th className="px-3 py-2 font-medium">Dernier</th>
                    <th className="px-3 py-2 font-medium">État</th>
                  </tr>
                </thead>
                <tbody>
                  {automations.map((a) => (
                    <tr key={a.id} className="border-t border-neutral-200 dark:border-neutral-800">
                      <td className="px-3 py-2">{a.name}</td>
                      <td className="px-3 py-2 text-neutral-500">
                        {a.databaseName}
                        <span className="text-neutral-400"> · {a.spaceName}</span>
                      </td>
                      <td className="px-3 py-2">{TRIGGER_LABELS[a.triggerType] ?? a.triggerType}</td>
                      <td className="px-3 py-2">{ACTION_LABELS[a.actionType] ?? a.actionType}</td>
                      <td className="px-3 py-2 text-neutral-500">
                        {a.creatorName ?? a.creatorEmail ?? "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{a.runCount}</td>
                      <td className="px-3 py-2 text-neutral-500">{fmtDate(a.lastRunAt)}</td>
                      <td className="px-3 py-2">
                        {a.enabled ? (
                          <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                            <CheckCircle2 className="h-3.5 w-3.5" /> actif
                          </span>
                        ) : (
                          <span className="text-neutral-400">désactivé</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === "log" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-1">
              {([
                { id: "" as const, label: "Tous" },
                { id: "success" as const, label: "Succès" },
                { id: "error" as const, label: "Échecs" },
                { id: "skipped" as const, label: "Sautés" },
                { id: "partial" as const, label: "Partiels" },
              ]).map((f) => (
                <button
                  key={f.id || "all"}
                  type="button"
                  onClick={() => setStatusFilter(f.id)}
                  className={`px-3 py-1 text-xs rounded-md border ${
                    statusFilter === f.id
                      ? "bg-orange-100 dark:bg-orange-950 border-orange-300 dark:border-orange-800 text-orange-700 dark:text-orange-300"
                      : "border-neutral-200 dark:border-neutral-800 text-neutral-600 hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={loadRuns} disabled={loadingRuns}>
              {loadingRuns ? <Loader2 className="h-4 w-4 animate-spin" /> : "Rafraîchir"}
            </Button>
          </div>
          {loadingRuns ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-neutral-400" />
            </div>
          ) : runs.length === 0 ? (
            <div className="rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 p-8 text-center text-sm text-neutral-500">
              Aucun déclenchement enregistré.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-neutral-200 dark:border-neutral-800">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 dark:bg-neutral-900/50 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Automatisation</th>
                    <th className="px-3 py-2 font-medium">Base</th>
                    <th className="px-3 py-2 font-medium">État</th>
                    <th className="px-3 py-2 font-medium text-right">Durée</th>
                    <th className="px-3 py-2 font-medium">Erreur</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.map((r) => (
                    <tr key={r.id} className="border-t border-neutral-200 dark:border-neutral-800">
                      <td className="px-3 py-2 text-neutral-500 whitespace-nowrap">
                        {fmtDate(r.triggeredAt)}
                      </td>
                      <td className="px-3 py-2">{r.automationName}</td>
                      <td className="px-3 py-2 text-neutral-500">{r.databaseName}</td>
                      <td className="px-3 py-2">
                        {r.status === "success" && (
                          <span className="inline-flex items-center gap-1 text-green-600 dark:text-green-400">
                            <CheckCircle2 className="h-3.5 w-3.5" /> succès
                          </span>
                        )}
                        {r.status === "error" && (
                          <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                            <XCircle className="h-3.5 w-3.5" /> échec
                          </span>
                        )}
                        {r.status === "partial" && (
                          <span
                            className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400"
                            title="Une étape a échoué mais le scénario a continué"
                          >
                            <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> partiel
                          </span>
                        )}
                        {r.status === "skipped" && (
                          <span className="inline-flex items-center gap-1 text-neutral-500">
                            <SkipForward className="h-3.5 w-3.5" /> sauté
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-neutral-500">
                        {r.durationMs != null ? `${r.durationMs} ms` : "—"}
                      </td>
                      <td className="px-3 py-2 text-neutral-500 max-w-md truncate" title={r.errorMessage ?? ""}>
                        {r.errorMessage ?? "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
