"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Loader2, Rocket, CheckCircle2, ArrowLeft } from "lucide-react";
import type { SetupData } from "@/app/[locale]/(setup)/setup/page";
import { clearSetupToken, setupFetch } from "@/lib/setup/client";

interface StepSummaryProps {
  data: SetupData;
  onBack?: () => void;
}

export function StepSummary({ data, onBack }: StepSummaryProps) {
  const t = useTranslations("setup.summary");
  const [launching, setLaunching] = useState(false);
  const [error, setError] = useState("");

  async function handleLaunch() {
    setLaunching(true);
    setError("");
    try {
      const res = await setupFetch("/api/setup/complete", { method: "POST" });
      if (!res.ok) throw new Error(t("errors.finalizeError"));
      // Installation terminée : le jeton est consommé côté serveur, il n'a
      // plus rien à faire dans le stockage de l'onglet.
      clearSetupToken();
      window.location.href = "/login";
    } catch (err) {
      setError(err instanceof Error ? err.message : t("errors.unexpectedError"));
      setLaunching(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto mb-3" />
        <h2 className="text-2xl font-bold">{t("title")}</h2>
        <p className="text-muted-foreground mt-1">
          {t("description")}
        </p>
      </div>

      <div className="space-y-4">
        <div className="p-4 rounded-lg border border-border">
          <h3 className="font-medium mb-2">{t("organizationSection")}</h3>
          <p className="text-sm">{data.identity.name || "—"}</p>
          {data.identity.description && (
            <p className="text-sm text-muted-foreground">{data.identity.description}</p>
          )}
        </div>

        {(data.context.sector || data.context.website) && (
          <div className="p-4 rounded-lg border border-border">
            <h3 className="font-medium mb-2">{t("contextSection")}</h3>
            {data.context.sector && <p className="text-sm">{t("sector", { value: data.context.sector })}</p>}
            {data.context.website && <p className="text-sm">{t("website", { value: data.context.website })}</p>}
          </div>
        )}

        <div className="p-4 rounded-lg border border-border">
          <h3 className="font-medium mb-2">{t("usersSection")}</h3>
          <p className="text-sm">{t("usersCount", { count: data.users.length })}</p>
          <ul className="text-sm text-muted-foreground mt-1 space-y-0.5">
            {data.users.slice(0, 5).map((u) => (
              <li key={u.id}>{u.name} ({u.email}) — {u.role}</li>
            ))}
            {data.users.length > 5 && <li>{t("usersMore", { count: data.users.length - 5 })}</li>}
          </ul>
        </div>

        <div className="p-4 rounded-lg border border-border">
          <h3 className="font-medium mb-2">{t("spacesSection")}</h3>
          <ul className="text-sm space-y-0.5">
            {data.spaces.map((s) => (
              <li key={s.id}>
                {s.icon && <span className="mr-1">{s.icon}</span>}
                {s.name} <span className="text-muted-foreground">({s.classification})</span>
              </li>
            ))}
          </ul>
        </div>

        {data.permissions.length > 0 && (
          <div className="p-4 rounded-lg border border-border">
            <h3 className="font-medium mb-2">{t("permissionsSection")}</h3>
            <p className="text-sm">{t("permissionsCount", { count: data.permissions.length })}</p>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-destructive text-center">{error}</p>}

      <div className="flex justify-between pt-4">
        {onBack && (
          <Button variant="ghost" onClick={onBack} disabled={launching} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            {t("previous")}
          </Button>
        )}
        <Button size="lg" onClick={handleLaunch} disabled={launching} className="gap-2 ml-auto">
          {launching ? (
            <>
              <Loader2 className="h-5 w-5 animate-spin" />
              {t("launching")}
            </>
          ) : (
            <>
              <Rocket className="h-5 w-5" />
              {t("launch")}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
