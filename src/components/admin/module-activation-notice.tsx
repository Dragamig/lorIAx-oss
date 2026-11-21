import { Link } from "@/i18n/routing";
import { ArrowRight, Power, PowerOff } from "lucide-react";

/**
 * Bandeau de lecture seule sur les pages de configuration historiques.
 *
 * L'activation d'un module ne s'écrit plus que depuis `/admin/modules` :
 * ces pages n'affichent donc que l'état courant, avec un renvoi vers la page
 * unique. Sans cela, l'administrateur ne comprendrait pas pourquoi la
 * configuration qu'il règle ici ne s'applique pas encore.
 */
export function ModuleActivationNotice({
  enabled,
  moduleName,
}: {
  enabled: boolean;
  moduleName: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
      <div className="flex items-center gap-2">
        {enabled ? (
          <Power className="h-4 w-4 text-green-600 dark:text-green-400" />
        ) : (
          <PowerOff className="h-4 w-4 text-muted-foreground" />
        )}
        <p className="text-sm">
          <span className="font-medium">{moduleName}</span>{" "}
          {enabled ? (
            <span className="text-green-700 dark:text-green-400">: module activé</span>
          ) : (
            <span className="text-muted-foreground">
              : module désactivé, cette configuration ne s&apos;applique pas encore
            </span>
          )}
        </p>
      </div>
      <Link
        href="/admin/modules"
        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
      >
        L&apos;activation se règle depuis Modules et services
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}
