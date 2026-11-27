"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { ImagePlus } from "lucide-react";
import { Tooltip } from "./debug-shared";

type SpaceOption = { id: string; name: string };
type Scope = "any" | "orphan" | "space";

/**
 * Portée du déclencheur « média ajouté » : tout média de l'organisation, les
 * médias hors espace, ou un espace choisi. Le serveur revalide la portée.
 */
export function MediaTriggerFields({
  config,
  onChange,
  readOnly = false,
}: {
  config: Record<string, unknown>;
  onChange: (key: string, value: unknown) => void;
  readOnly?: boolean;
}) {
  const t = useTranslations("mediaTrigger");
  const [spaces, setSpaces] = useState<SpaceOption[]>([]);
  const [loadError, setLoadError] = useState(false);
  const scope: Scope = config.scope === "orphan" || config.scope === "space" ? config.scope : "any";
  const spaceId = typeof config.spaceId === "string" ? config.spaceId : "";

  useEffect(() => {
    if (scope !== "space") return;
    let cancelled = false;
    fetch("/api/spaces")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("spaces"))))
      .then((list: SpaceOption[]) => {
        if (!cancelled) setSpaces(list.map((s) => ({ id: s.id, name: s.name })));
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [scope]);

  const selectCls =
    "w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs disabled:opacity-60 dark:border-neutral-700 dark:bg-neutral-900";

  return (
    <div className="space-y-3">
      <div className="group/tip relative block">
        <label className="block">
          <span className="mb-1 flex items-center gap-1.5 text-xs text-neutral-500">
            <ImagePlus className="h-3.5 w-3.5" aria-hidden />
            {t("scopeLabel")}
          </span>
          <select
            value={scope}
            disabled={readOnly}
            aria-label={t("scopeAria")}
            onChange={(e) => {
              const next = e.target.value as Scope;
              onChange("scope", next);
              if (next !== "space") onChange("spaceId", "");
            }}
            className={selectCls}
          >
            <option value="any">{t("scopeAny")}</option>
            <option value="orphan">{t("scopeOrphan")}</option>
            <option value="space">{t("scopeSpace")}</option>
          </select>
        </label>
        <Tooltip align="left">{t("scopeTip")}</Tooltip>
      </div>

      {scope === "space" && (
        <label className="block">
          <span className="mb-1 block text-xs text-neutral-500">{t("spaceLabel")}</span>
          <select
            value={spaceId}
            disabled={readOnly}
            aria-label={t("spaceAria")}
            onChange={(e) => onChange("spaceId", e.target.value)}
            className={selectCls}
          >
            <option value="">{t("spacePlaceholder")}</option>
            {spaces.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          {loadError && (
            <span role="alert" className="mt-1 block text-[11px] text-red-600 dark:text-red-400">
              {t("spacesError")}
            </span>
          )}
        </label>
      )}

      <p className="text-[11px] italic text-neutral-400">{t("variablesHint")}{" : "}{"{{media.filename}}, {{media.url}}, {{media.spaceId}}"}</p>
    </div>
  );
}
