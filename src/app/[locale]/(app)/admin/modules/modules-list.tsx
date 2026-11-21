"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  DoorOpen,
  Wifi,
  Mic,
  Users,
  Network,
  Brain,
  Mail,
  DatabaseBackup,
  Images,
  Zap,
  Palette,
  Clapperboard,
  Presentation,
  AudioLines,
  LibraryBig,
  Briefcase,
} from "lucide-react";
import { toast } from "sonner";
import { refreshCrmStatus } from "@/lib/crm/use-crm-status";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { CrmActionButton } from "@/components/crm/crm-states";
import { ActivationDialog } from "@/components/crm/activation-dialog";
import { ServiceCard, type HealthStatus } from "@/components/admin/service-card";
import type {
  ModuleCategory,
  ModuleHealthProbe,
  ModuleIconName,
  ModuleManageRole,
} from "@/lib/modules/types";

export interface ModuleRow {
  id: string;
  name: string;
  description: string;
  category: ModuleCategory;
  icon: ModuleIconName;
  configHref?: string;
  healthProbe?: ModuleHealthProbe;
  entitlement: string;
  manageRole: ModuleManageRole;
  status: string;
  toggledOn: boolean;
  /** Noms lisibles des dépendances inactives (pas des identifiants). */
  missingDeps: string[];
}

/** Dictionnaire explicite : garde le reste de lucide hors du bundle. */
const ICONS: Record<ModuleIconName, React.ComponentType<{ className?: string }>> = {
  "door-open": DoorOpen,
  wifi: Wifi,
  mic: Mic,
  users: Users,
  network: Network,
  brain: Brain,
  mail: Mail,
  "database-backup": DatabaseBackup,
  images: Images,
  zap: Zap,
  palette: Palette,
  clapperboard: Clapperboard,
  presentation: Presentation,
  "audio-lines": AudioLines,
  "library-big": LibraryBig,
  briefcase: Briefcase,
};

const CATEGORY_LABELS: Record<ModuleCategory, string> = {
  communication: "Communication",
  ia: "Intelligence artificielle",
  contenu: "Contenu et création",
  infrastructure: "Infrastructure",
};

const CATEGORY_ORDER: ModuleCategory[] = [
  "communication",
  "ia",
  "contenu",
  "infrastructure",
];

interface ServiceHealth {
  status: string;
  latency?: number;
}

export interface CrmOrgState {
  /** Module disponible sur l'instance pour l'organisation. */
  available: boolean;
  /** Connexion CRM activée pour l'organisation. */
  enabled: boolean;
  canAdminOrg: boolean;
}

/** Activation du CRM pour l'organisation, sous la carte du module. */
function CrmOrgActivation({ crm }: { crm: CrmOrgState }) {
  const t = useTranslations("crm");
  const router = useRouter();
  const [enabled, setEnabled] = useState(crm.enabled);
  const [open, setOpen] = useState(false);

  // Retour d'un changement d'organisation depuis la modale : le paramètre rouvre l'assistant.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("activer-crm") !== "1") return;
    params.delete("activer-crm");
    const query = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}${window.location.hash}`);
    if (!crm.enabled && crm.available && crm.canAdminOrg) queueMicrotask(() => setOpen(true));
  }, [crm.enabled, crm.available, crm.canAdminOrg]);

  async function post(url: string, body?: unknown) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(url);
    refreshCrmStatus();
  }

  /** L'assistant peut activer puis être annulé depuis le toast : on relit l'état réel. */
  async function syncEnabled() {
    try {
      const res = await fetch("/api/crm/status");
      refreshCrmStatus();
      if (res.ok) setEnabled(((await res.json()) as { enabled: boolean }).enabled === true);
    } catch {
      // l'état affiché reste celui du dernier rendu serveur
    }
  }

  async function reactivate() {
    try {
      await post("/api/crm/activate", {});
      setEnabled(true);
      toast.success(t("activation.reactivatedToast"));
      router.refresh();
    } catch {
      toast.error(t("activation.error"));
    }
  }

  async function deactivate() {
    try {
      await post("/api/crm/deactivate");
      setEnabled(false);
      toast.success(t("activation.deactivatedToast"), {
        action: { label: t("activation.undo"), onClick: () => void reactivate() },
      });
      router.refresh();
    } catch {
      toast.error(t("activation.deactivateError"));
    }
  }

  if (!crm.canAdminOrg) return null;
  if (!crm.available) {
    return (
      <CrmActionButton
        actionId="activate"
        label={t("activation.cardUnavailable")}
        tip={t("activation.cardActionTip")}
        ariaLabel={t("activation.cardUnavailable")}
        disabledReason={t("activation.cardUnavailableReason")}
      />
    );
  }
  return (
    <>
      {enabled ? (
        <CrmActionButton
          actionId="deactivate"
          label={t("activation.cardActive")}
          tip={t("activation.cardActiveTip")}
          ariaLabel={t("activation.cardActive")}
          onClick={() => void deactivate()}
        />
      ) : (
        <CrmActionButton
          actionId="activate"
          label={t("activation.cardAction")}
          tip={t("activation.cardActionTip")}
          ariaLabel={t("activation.cardAction")}
          onClick={() => setOpen(true)}
        />
      )}
      <ActivationDialog
        open={open}
        onOpenChange={setOpen}
        onDone={() => {
          void syncEnabled();
          router.refresh();
        }}
      />
    </>
  );
}

export function ModulesList({
  modules,
  canManageLicensed,
  crm,
}: {
  modules: ModuleRow[];
  canManageLicensed: boolean;
  crm?: CrmOrgState;
}) {
  const router = useRouter();
  const [rows, setRows] = useState(modules);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Record<string, ServiceHealth>>({});
  const [healthLoading, setHealthLoading] = useState(true);
  const [healthLoaded, setHealthLoaded] = useState(false);

  const checkHealth = useCallback(async () => {
    setHealthLoading(true);
    try {
      const res = await fetch("/api/admin/services/health");
      if (res.ok) setHealth(await res.json());
    } catch {
      // une sonde muette n'empêche pas de piloter les modules
    } finally {
      setHealthLoading(false);
      setHealthLoaded(true);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(checkHealth, 0);
    const interval = setInterval(checkHealth, 30000);
    return () => {
      clearTimeout(t);
      clearInterval(interval);
    };
  }, [checkHealth]);

  async function toggle(row: ModuleRow) {
    const enabled = !row.toggledOn;
    setBusy(row.id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/modules/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Échec de la mise à jour");
        return;
      }
      // Le serveur renvoie l'état recalculé : éteindre un module bascule ses
      // dépendants, ce qu'un patch local de la seule ligne touchée manquerait.
      if (Array.isArray(data.states)) {
        const byId = new Map(
          (data.states as { id: string; status: string; toggledOn: boolean }[]).map(
            (s) => [s.id, s]
          )
        );
        setRows((prev) =>
          prev.map((r) => {
            const s = byId.get(r.id);
            return s ? { ...r, status: s.status, toggledOn: s.toggledOn } : r;
          })
        );
      }
      router.refresh();
      await checkHealth();
    } catch {
      setError("Erreur réseau");
    } finally {
      setBusy(null);
    }
  }

  // Disponibilité du CRM : la valeur serveur tant que le module n'a pas été
  // basculé, puis l'état local des lignes (sans attendre le rafraîchissement).
  const crmStatus = rows.find((r) => r.id === "crm")?.status;
  const crmInitialStatus = modules.find((r) => r.id === "crm")?.status;
  const crmLive: CrmOrgState | undefined = crm
    ? {
        ...crm,
        available:
          crmStatus === crmInitialStatus ? crm.available : crmStatus === "active",
      }
    : undefined;

  /** Ce qui empêche de basculer ce module, ou null s'il est pilotable. */
  function lockedReason(row: ModuleRow): string | null {
    if (row.status === "unavailable") return "Non inclus dans cette image";
    if (row.status === "locked") return "Licence ou offre insuffisante";
    if (row.manageRole === "super_admin" && !canManageLicensed)
      return "Super administrateur requis";
    return null;
  }

  const visibleCategories = CATEGORY_ORDER.filter((c) =>
    rows.some((r) => r.category === c)
  );

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">Modules et services</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Activation et état des fonctionnalités de l&apos;application. Un module
            éteint disparaît entièrement de l&apos;interface et de l&apos;API.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={checkHealth}
          disabled={healthLoading}
        >
          <RefreshCw
            className={`h-4 w-4 mr-2 ${healthLoading ? "animate-spin" : ""}`}
          />
          Actualiser
        </Button>
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      {visibleCategories.map((category) => (
        <section key={category} className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">
            {CATEGORY_LABELS[category]}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {rows
              .filter((r) => r.category === category)
              .map((row) => {
                const Icon = ICONS[row.icon];
                const probe = row.healthProbe ? health[row.healthProbe] : undefined;
                const reason = lockedReason(row);
                return (
                  <ServiceCard
                    key={row.id}
                    testId={row.id}
                    icon={<Icon className="h-5 w-5" />}
                    name={row.name}
                    description={row.description}
                    // L'interrupteur reflète l'intention de l'administrateur,
                    // pas le statut résolu : un module allumé mais bloqué par une
                    // dépendance reste allumé, l'avertissement dit pourquoi il dort.
                    enabled={row.toggledOn}
                    healthStatus={probe?.status as HealthStatus | undefined}
                    latency={probe?.latency}
                    configHref={row.configHref}
                    onToggle={() => toggle(row)}
                    toggling={busy === row.id}
                    healthLoading={
                      !!row.healthProbe && !healthLoaded && healthLoading
                    }
                    lockedReason={reason ?? undefined}
                    extra={row.id === "crm" && crmLive ? <CrmOrgActivation crm={crmLive} /> : undefined}
                    warning={
                      row.status === "blocked-deps"
                        ? `Dépendance inactive : ${row.missingDeps.join(", ")}`
                        : undefined
                    }
                  />
                );
              })}
          </div>
        </section>
      ))}
    </div>
  );
}
