"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { BarChart3, Download, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

interface Stats {
  period: number;
  from: string;
  to: string;
  occupancy: Array<{
    roomId: string;
    roomName: string;
    bookingsCount: number;
    totalMinutes: number;
  }>;
  topUsers: Array<{ userId: string; name: string; bookingsCount: number }>;
  hourlyDistribution: Array<{ hour: number; count: number }>;
}

export function OccupancyClient() {
  const t = useTranslations("organisation");
  const [period, setPeriod] = useState<7 | 30>(7);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/meeting-rooms/stats?period=${period}d`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data) setStats(data);
      })
      .catch(() => toast.error(t("toasts.loadStatsError")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [period, t]);

  async function handleExport() {
    setExporting(true);
    try {
      const res = await fetch("/api/meeting-rooms/export");
      if (!res.ok) throw new Error();
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download =
        res.headers
          .get("content-disposition")
          ?.match(/filename="?([^"]+)"?/)?.[1] ?? "salles-reservations.csv";
      link.click();
      URL.revokeObjectURL(url);
      toast.success(t("toasts.exportSuccess"));
    } catch {
      toast.error(t("toasts.exportError"));
    } finally {
      setExporting(false);
    }
  }

  const maxBookings = stats
    ? Math.max(1, ...stats.occupancy.map((o) => o.bookingsCount))
    : 1;
  const maxHourCount = stats
    ? Math.max(1, ...stats.hourlyDistribution.map((h) => h.count))
    : 1;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-5 w-5 text-primary" />
          <div>
            <h2 className="text-lg font-semibold">{t("occupancy.title")}</h2>
            <p className="text-sm text-muted-foreground">
              {t("occupancy.subtitle")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            <button
              type="button"
              onClick={() => setPeriod(7)}
              className={`px-3 py-1.5 text-xs ${period === 7 ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            >
              {t("occupancy.period7")}
            </button>
            <button
              type="button"
              onClick={() => setPeriod(30)}
              className={`px-3 py-1.5 text-xs border-l border-border ${period === 30 ? "bg-primary text-primary-foreground" : "hover:bg-accent"}`}
            >
              {t("occupancy.period30")}
            </button>
          </div>
          <Button variant="secondary" onClick={handleExport} disabled={exporting}>
            {exporting ? (
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-1.5" />
            )}
            {t("occupancy.exportCsv")}
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !stats ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <p className="text-sm text-muted-foreground">
            {t("occupancy.noStats")}
          </p>
        </div>
      ) : (
        <>
          <section className="rounded-lg border border-border bg-card p-4">
            <h3 className="text-sm font-medium mb-3">{t("occupancy.bookingsPerRoom")}</h3>
            {stats.occupancy.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("occupancy.noBookings")}
              </p>
            ) : (
              <ul className="space-y-2">
                {stats.occupancy.map((o) => (
                  <li key={o.roomId} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span>{o.roomName}</span>
                      <span className="text-muted-foreground">
                        {t("occupancy.bookingsCount", { count: o.bookingsCount })}
                        {" · "}
                        {t("occupancy.totalHours", { hours: Math.round(o.totalMinutes / 60) })}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-secondary overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${(o.bookingsCount / maxBookings) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-medium mb-3">
                {t("occupancy.topUsers")}
              </h3>
              {stats.topUsers.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("occupancy.noUsers")}</p>
              ) : (
                <ol className="space-y-1.5">
                  {stats.topUsers.map((u, i) => (
                    <li key={u.userId} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground w-4">
                          {i + 1}.
                        </span>
                        {u.name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {t("occupancy.bookingsCount", { count: u.bookingsCount })}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="text-sm font-medium mb-3">{t("occupancy.popularSlots")}</h3>
              {stats.hourlyDistribution.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t("occupancy.noData")}</p>
              ) : (
                <div className="flex items-end gap-0.5 h-32">
                  {Array.from({ length: 24 }, (_, h) => {
                    const count =
                      stats.hourlyDistribution.find((d) => d.hour === h)?.count ?? 0;
                    const ratio = count / maxHourCount;
                    return (
                      <div
                        key={h}
                        className="flex-1 flex flex-col items-center gap-0.5"
                        title={t("occupancy.slotTooltip", { hour: h, count })}
                      >
                        <div
                          className="w-full bg-primary/70 rounded-t"
                          style={{ height: `${Math.max(1, ratio * 100)}%` }}
                        />
                        {h % 4 === 0 && (
                          <span className="text-[9px] text-muted-foreground">
                            {h}h
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
