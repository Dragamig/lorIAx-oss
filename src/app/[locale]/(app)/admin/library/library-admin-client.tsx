"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import { AlertCircle, Loader2, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const MIN_DAYS = 7;
const MAX_DAYS = 365;
const UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;

type AdminData = {
  settings: { trashRetentionDays: number };
  storage: { usedBytes: number; limitBytes: number | null; percent: number | null };
  counts: { media: number; trash: number; orphan: number; unused: number };
  canEdit: boolean;
};

function formatBytes(bytes: number, locale: string): string {
  let value = Math.max(0, bytes);
  let i = 0;
  while (value >= 1024 && i < UNITS.length - 1) {
    value /= 1024;
    i++;
  }
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit: UNITS[i],
    unitDisplay: "short",
    maximumFractionDigits: i === 0 ? 0 : 1,
  }).format(value);
}

function isValidDays(n: number): boolean {
  return Number.isInteger(n) && n >= MIN_DAYS && n <= MAX_DAYS;
}

export function LibraryAdminClient() {
  const t = useTranslations("library.admin");
  const locale = useLocale();
  const [data, setData] = useState<AdminData | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoadFailed(false);
    setData(null);
    try {
      const res = await fetch("/api/admin/library");
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as AdminData;
      setData(body);
      setDraft(String(body.settings.trashRetentionDays));
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Écrit le délai ; ne rend true et ne touche l'état local qu'après confirmation du serveur. */
  const write = useCallback(async (days: number): Promise<boolean> => {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/library", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trashRetentionDays: days }),
      });
      if (!res.ok) return false;
      const body = (await res.json()) as { settings?: { trashRetentionDays?: number } };
      const saved = body.settings?.trashRetentionDays;
      if (saved !== days) return false;
      setData((d) => (d ? { ...d, settings: { trashRetentionDays: saved } } : d));
      setDraft(String(saved));
      return true;
    } catch {
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  const onSave = useCallback(async () => {
    if (!data) return;
    const previous = data.settings.trashRetentionDays;
    const next = Number(draft);
    if (!isValidDays(next) || next === previous) return;
    if (!(await write(next))) {
      toast.error(t("saveFailed"));
      return;
    }
    toast.success(t("saved"), {
      action: {
        label: t("undo"),
        onClick: () => {
          void write(previous).then((ok) => (ok ? toast.success(t("undone")) : toast.error(t("saveFailed"))));
        },
      },
    });
  }, [data, draft, write, t]);

  if (loadFailed) {
    return (
      <div role="alert" className="flex max-w-xl items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
        <div className="space-y-3">
          <p className="text-sm">{t("loadError")}</p>
          <Button variant="outline" size="sm" onClick={() => void load()} title={t("retryTip")} aria-label={t("retry")}>
            <RotateCcw className="h-4 w-4" aria-hidden />
            {t("retry")}
          </Button>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="max-w-xl space-y-4" role="status" aria-label={t("loading")}>
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  const { storage, counts, canEdit } = data;
  const percent = storage.limitBytes === null ? null : Math.min(100, Math.max(0, storage.percent ?? 0));
  const used = formatBytes(storage.usedBytes, locale);
  const days = Number(draft);
  const valid = draft.trim() !== "" && isValidDays(days);
  const unchanged = valid && days === data.settings.trashRetentionDays;
  const saveDisabled = !canEdit || saving || !valid || unchanged;
  const saveTip = !canEdit
    ? t("retention.readOnly")
    : saving
      ? t("retention.savingTip")
      : !valid
        ? t("retention.invalidTip", { min: MIN_DAYS, max: MAX_DAYS })
        : unchanged
          ? t("retention.unchangedTip")
          : t("retention.saveTip");

  return (
    <div className="max-w-xl space-y-8">
      <section aria-labelledby="lib-storage" className="space-y-2">
        <h2 id="lib-storage" className="text-lg font-semibold">{t("storage.title")}</h2>
        <p className="text-sm">
          {storage.limitBytes === null
            ? t("storage.unlimited", { used })
            : t("storage.usage", { used, limit: formatBytes(storage.limitBytes, locale) })}
        </p>
        {percent !== null && (
          <div
            role="progressbar"
            aria-label={t("storage.title")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(percent)}
            aria-valuetext={t("storage.percent", { percent: Math.round(percent) })}
            className="h-2 overflow-hidden rounded-full bg-muted"
          >
            <div
              className={cn("h-full rounded-full", percent >= 90 ? "bg-destructive" : "bg-primary")}
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
        <p className="text-xs text-muted-foreground">{t("storage.note")}</p>
      </section>

      <section aria-labelledby="lib-counts" className="space-y-2">
        <h2 id="lib-counts" className="text-lg font-semibold">{t("counts.title")}</h2>
        <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["media", "trash", "orphan", "unused"] as const).map((k) => (
            <div key={k} className="rounded-lg border border-border p-3">
              <dt className="text-xs text-muted-foreground">{t(`counts.${k}`)}</dt>
              <dd className="text-xl font-semibold tabular-nums">{counts[k].toLocaleString(locale)}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="lib-retention" className="space-y-3">
        <h2 id="lib-retention" className="text-lg font-semibold">{t("retention.title")}</h2>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void onSave();
          }}
        >
          <label htmlFor="lib-retention-days" className="block text-sm font-medium">
            {t("retention.label")}
          </label>
          <div className="flex items-center gap-2">
            <Input
              id="lib-retention-days"
              type="number"
              inputMode="numeric"
              min={MIN_DAYS}
              max={MAX_DAYS}
              step={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!canEdit || saving}
              aria-invalid={!valid}
              aria-describedby="lib-retention-help"
              className="w-28"
            />
            {/* span porteur de l'info-bulle : un bouton désactivé ne reçoit pas le survol. */}
            <span title={saveTip}>
              <Button type="submit" size="sm" disabled={saveDisabled} aria-label={t("retention.save")} title={saveTip}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
                {t("retention.save")}
              </Button>
            </span>
          </div>
          <p id="lib-retention-help" className="text-xs text-muted-foreground">
            {t("retention.help", { min: MIN_DAYS, max: MAX_DAYS })}
          </p>
          {!canEdit && <p className="text-xs text-muted-foreground">{t("retention.readOnly")}</p>}
        </form>
      </section>
    </div>
  );
}
