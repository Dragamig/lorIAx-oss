"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Info, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/hint";
import type { AssignmentDraft } from "@/lib/ai/assignment-drafts";

/**
 * Repli de l'usage « Création » : sans assignation, le modèle du Chat est
 * utilisé. Le bouton supprime l'assignation enregistrée ; le toast permet de
 * la rétablir.
 */
export function CreationUsageFallback({
  assigned,
  onRemoved,
  onRestored,
}: {
  /** Dernière assignation enregistrée (`undefined` : repli déjà actif). */
  assigned: AssignmentDraft | undefined;
  onRemoved: () => void;
  onRestored: (previous: AssignmentDraft) => void;
}) {
  const t = useTranslations("admin.ai.creation.fallback");
  const LABEL = t("button");
  const [busy, setBusy] = useState(false);
  const reason = busy ? t("busy") : !assigned ? t("alreadyFallback") : null;

  const restore = async (previous: AssignmentDraft) => {
    const res = await fetch("/api/admin/ai/assignments", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        usageType: "creation",
        providerId: previous.providerId || null,
        model: previous.model,
        fallbackProviderId: previous.fallbackProviderId || null,
        fallbackModel: previous.fallbackModel || null,
        timeoutSeconds: previous.timeoutSeconds,
        maxRetries: previous.maxRetries,
        isEnabled: previous.isEnabled,
      }),
    });
    if (!res.ok) {
      toast.error(t("restoreFailed"));
      return;
    }
    onRestored(previous);
    toast.success(t("restored"));
  };

  const remove = async () => {
    if (!assigned) return;
    const previous = assigned;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/ai/assignments?usageType=creation", { method: "DELETE" });
      if (!res.ok) {
        toast.error(t("removeFailed"));
        return;
      }
      onRemoved();
      toast.success(t("removed"), {
        action: { label: t("undo"), onClick: () => restore(previous) },
      });
    } catch {
      toast.error(t("unreachable"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-2 space-y-1.5" data-testid="creation-fallback">
      <p data-testid="creation-fallback-note" className="flex items-start gap-1.5 text-xs font-normal text-muted-foreground">
        <Info className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        {t("note")}
      </p>
      <Hint label={reason ?? t("tip")} disabled={!!reason}>
        <Button type="button" variant="outline" size="sm" aria-label={LABEL} disabled={!!reason} onClick={remove}>
          <MessageSquare className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
          {LABEL}
        </Button>
      </Hint>
    </div>
  );
}
