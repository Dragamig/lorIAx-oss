"use client";

import { ReactNode } from "react";
import { Link } from "@/i18n/routing";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

export type HealthStatus =
  | "up"
  | "down"
  | "starting"
  | "configured"
  | "unconfigured"
  | "disabled";

interface ServiceCardProps {
  icon: ReactNode;
  name: string;
  description: string;
  enabled: boolean;
  healthStatus?: HealthStatus;
  latency?: number;
  /** Absent si le module n'a pas de page de configuration dédiée. */
  configHref?: string;
  /** Si undefined, le toggle n'est pas affiché (module en lecture seule) */
  onToggle?: () => void;
  toggling?: boolean;
  /** True tant que la sonde de santé n'a pas répondu : affiche un pill "…" */
  healthLoading?: boolean;
  /** Raison pour laquelle l'interrupteur est indisponible (licence, offre,
   *  rôle insuffisant). Affichée telle quelle, l'interrupteur reste visible
   *  mais inerte pour que l'usager comprenne ce qui lui manque. */
  lockedReason?: string;
  /** Avertissement affiché sous la description (dépendance éteinte…). */
  warning?: string;
  /** Contenu libre rendu sous l'avertissement (action propre au module). */
  extra?: ReactNode;
  /** Identifiant stable pour les tests, insensible au libellé affiché. */
  testId?: string;
}

const HEALTH_MAP: Record<HealthStatus, { label: string; dot: string; pill: string }> = {
  up: {
    label: "Opérationnel",
    dot: "bg-green-500",
    pill: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  },
  configured: {
    label: "Configuré",
    dot: "bg-blue-500",
    pill: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  },
  starting: {
    label: "Démarrage",
    dot: "bg-orange-400",
    pill: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  },
  down: {
    label: "Hors ligne",
    dot: "bg-red-500",
    pill: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  },
  unconfigured: {
    label: "Non configuré",
    dot: "bg-gray-400",
    pill: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  },
  disabled: {
    label: "Désactivé",
    dot: "bg-gray-400",
    pill: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  },
};

export function ServiceCard({
  icon,
  name,
  description,
  enabled,
  healthStatus,
  latency,
  configHref,
  onToggle,
  toggling,
  healthLoading,
  lockedReason,
  warning,
  extra,
  testId,
}: ServiceCardProps) {
  const health =
    healthStatus && healthStatus !== "disabled" ? HEALTH_MAP[healthStatus] : null;
  const showLoadingPill = healthLoading && !healthStatus;

  return (
    <div
      data-testid={testId ? `module-card-${testId}` : undefined}
      className={cn(
        "relative flex flex-col gap-3 p-4 rounded-xl border transition-colors",
        enabled
          ? "border-border bg-card hover:border-primary/30"
          : "border-border/50 bg-muted/30",
      )}
    >
      {/* En-tête : icône + toggle */}
      <div className="flex items-start justify-between gap-2">
        <div
          className={cn(
            "flex items-center justify-center w-10 h-10 rounded-lg",
            enabled ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
          )}
        >
          {icon}
        </div>
        {onToggle !== undefined && (
          <button
            data-testid={testId ? `module-toggle-${testId}` : undefined}
            onClick={onToggle}
            disabled={toggling || !!lockedReason}
            title={lockedReason}
            aria-label={enabled ? `Désactiver ${name}` : `Activer ${name}`}
            className={cn(
              "relative inline-flex h-5 w-9 items-center rounded-full transition-colors shrink-0 mt-0.5",
              enabled ? "bg-primary" : "bg-gray-300 dark:bg-gray-600",
              (toggling || lockedReason) && "opacity-50 cursor-not-allowed",
            )}
          >
            <span
              className={cn(
                "inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform",
                enabled ? "translate-x-4.5" : "translate-x-0.5",
              )}
            />
          </button>
        )}
      </div>

      {/* Nom + description */}
      <div>
        <p className="text-sm font-semibold">{name}</p>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{description}</p>
        {warning && (
          <p className="text-xs text-amber-600 dark:text-amber-500 mt-1">{warning}</p>
        )}
        {extra && <div className="mt-2">{extra}</div>}
      </div>

      {/* Pills de statut */}
      <div className="flex flex-wrap gap-1.5">
        <span
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
            enabled
              ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
              : "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
          )}
        >
          <span
            className={cn("w-1.5 h-1.5 rounded-full", enabled ? "bg-green-500" : "bg-gray-400")}
          />
          {enabled ? "Activé" : "Désactivé"}
        </span>

        {onToggle === undefined && !lockedReason && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-400 dark:bg-gray-800">
            Auto-détecté
          </span>
        )}

        {lockedReason && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
            {lockedReason}
          </span>
        )}

        {showLoadingPill && (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400"
            aria-label="Vérification de l'état en cours"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-pulse" />
            …
          </span>
        )}

        {health && (
          <span
            className={cn(
              "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium",
              health.pill,
            )}
          >
            <span className={cn("w-1.5 h-1.5 rounded-full", health.dot)} />
            {health.label}
            {latency !== undefined && <span className="opacity-60">· {latency}ms</span>}
          </span>
        )}
      </div>

      {/* Lien configurer */}
      {configHref && (
        <Link
          href={configHref}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors mt-auto"
        >
          Configurer
          <ArrowRight className="h-3 w-3" />
        </Link>
      )}
    </div>
  );
}
