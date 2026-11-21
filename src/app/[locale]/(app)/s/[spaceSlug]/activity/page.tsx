"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useTranslations, useFormatter } from "next-intl";
import { Link } from "@/i18n/routing";
import {
  ArrowLeft,
  Clock,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  UserMinus,
  Loader2,
} from "lucide-react";

interface Activity {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  userId: string | null;
  userName: string | null;
  userEmail: string | null;
}

const actionIcons: Record<string, typeof Plus> = {
  create: Plus,
  update: Pencil,
  delete: Trash2,
  add_member: UserPlus,
  remove_member: UserMinus,
  restore: Clock,
};

function ActivityIcon({ action }: { action: string }) {
  const Icon = actionIcons[action] || Clock;
  const colorClass =
    action === "create"
      ? "text-green-500 bg-green-500/10"
      : action === "delete"
        ? "text-red-500 bg-red-500/10"
        : action === "update"
          ? "text-blue-500 bg-blue-500/10"
          : "text-muted-foreground bg-muted";

  return (
    <div
      className={`h-8 w-8 rounded-full flex items-center justify-center ${colorClass}`}
    >
      <Icon className="h-4 w-4" />
    </div>
  );
}

export default function SpaceActivityPage() {
  const t = useTranslations("space");
  const format = useFormatter();
  const params = useParams<{ spaceSlug: string }>();
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!params.spaceSlug) return;

    fetch(`/api/spaces/${params.spaceSlug}/activity?limit=100`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setActivities(data);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [params.spaceSlug]);

  // Grouper par jour
  const grouped = activities.reduce<Record<string, Activity[]>>((acc, activity) => {
    const date = format.dateTime(new Date(activity.createdAt), {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    if (!acc[date]) acc[date] = [];
    acc[date].push(activity);
    return acc;
  }, {});

  return (
    <div className="max-w-2xl mx-auto px-8 py-12">
      <div className="mb-8">
        <Link
          href={`/s/${params.spaceSlug}`}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("activity.backToSpace")}
        </Link>
        <h1 className="text-2xl font-bold">{t("activity.title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("activity.subtitle")}
        </p>
      </div>

      {loading && (
        <div className="flex items-center gap-2 text-muted-foreground py-8">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("activity.loading")}
        </div>
      )}

      {!loading && activities.length === 0 && (
        <div className="text-center py-12">
          <Clock className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground">
            {t("activity.noActivity")}
          </p>
        </div>
      )}

      <div className="space-y-8">
        {Object.entries(grouped).map(([date, items]) => (
          <div key={date}>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3">
              {date}
            </h3>
            <div className="space-y-3">
              {items.map((activity) => {
                const metadata = (activity.metadata || {}) as { name?: string; title?: string };
                return (
                  <div
                    key={activity.id}
                    className="flex items-start gap-3 px-3 py-2.5 rounded-lg hover:bg-accent/30 transition-colors"
                  >
                    <ActivityIcon action={activity.action} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm">
                        <span className="font-medium">
                          {activity.userName || t("activity.unknownUser")}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {t(`activity.actions.${activity.action}`, { defaultValue: activity.action })}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {t(`activity.entities.${activity.entityType}`, { defaultValue: activity.entityType })}
                        </span>{" "}
                        {metadata.name && (
                          <span className="font-medium">
                            {metadata.name || metadata.title}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {format.relativeTime(new Date(activity.createdAt))}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
