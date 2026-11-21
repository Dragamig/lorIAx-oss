import { Link } from "@/i18n/routing";
import { ArrowLeft } from "lucide-react";

/**
 * Lien de retour vers la page unique des modules.
 *
 * La marge basse doit rester supérieure à la bande de couverture de
 * `AdminSaveBar` (`before:h-6`, soit 24 px peints au dessus de la barre
 * collante) : avec une marge plus courte, ce lien passait sous ce bloc opaque
 * et devenait illisible en haut de page.
 */
export function BackToServices() {
  return (
    <Link
      href="/admin/modules"
      className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-8"
    >
      <ArrowLeft className="h-4 w-4" />
      Retour aux modules et services
    </Link>
  );
}
