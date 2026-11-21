"use client";

import { type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Eye, Pencil } from "lucide-react";
import { TemplateBadge } from "./template-badge";

/**
 * Bandeau de l'éditeur sur un modèle : « Vous modifiez un modèle » pour un
 * admin (avec ses commandes, dont « Terminer »), « Modèle en lecture seule »
 * pour un membre.
 */
export function TemplateEditBanner({
  kind,
  name,
  hidden = false,
  children,
}: {
  kind: "editing" | "readOnly";
  name: string;
  /** Modèle masqué (visible de l'admin seulement) : le badge « Masqué » le signale. */
  hidden?: boolean;
  /** Commandes à droite du bandeau (bouton « Terminer »). */
  children?: ReactNode;
}) {
  const t = useTranslations("presentations.templates");
  const Icon = kind === "editing" ? Pencil : Eye;
  return (
    <div
      role="status"
      data-testid="template-banner"
      data-kind={kind}
      className="flex min-h-9 shrink-0 items-center gap-2 border-b border-primary/30 bg-primary/10 px-3 py-1 text-sm text-foreground"
    >
      <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">
        {kind === "editing" ? t("editingBanner", { name }) : t("readOnlyBanner", { name })}
      </span>
      {hidden ? <TemplateBadge kind="hidden" /> : null}
      {children}
    </div>
  );
}
