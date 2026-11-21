"use client";

import { useEffect, useState, useMemo } from "react";
import { Link } from "@/i18n/routing";
import { toast } from "sonner";
import {
  DoorOpen,
  MapPin,
  Users,
  Search,
  Loader2,
  ArrowRight,
  Clock,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import type { MeetingRoom } from "@/types";
import { useTranslations, useFormatter } from "next-intl";

type NextSlot = { start: string; end: string } | null;

export function RoomsListClient() {
  const t = useTranslations("organisation");
  const format = useFormatter();
  const [rooms, setRooms] = useState<MeetingRoom[]>([]);
  const [nextSlots, setNextSlots] = useState<Record<string, NextSlot>>({});
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/meeting-rooms").then((r) => (r.ok ? r.json() : [])),
      fetch("/api/meeting-rooms/next-available").then((r) => (r.ok ? r.json() : {})),
    ])
      .then(([rooms, slots]) => {
        if (!cancelled) {
          setRooms(rooms);
          setNextSlots(slots);
        }
      })
      .catch(() => toast.error(t("toasts.loadRoomsError")))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [t]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rooms;
    return rooms.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.address?.toLowerCase().includes(q) ?? false) ||
        (r.equipment as string[] | null)?.some((e) =>
          e.toLowerCase().includes(q)
        )
    );
  }, [rooms, query]);

  function formatNextSlot(iso: string): string {
    const date = new Date(iso);
    const now = new Date();
    const isToday =
      date.getFullYear() === now.getFullYear() &&
      date.getMonth() === now.getMonth() &&
      date.getDate() === now.getDate();
    const time = format.dateTime(date, { hour: "2-digit", minute: "2-digit" });
    if (isToday) return t("rooms.availableToday", { time });
    const day = format.dateTime(date, { weekday: "short", day: "numeric", month: "short" });
    return t("rooms.availableDay", { day, time });
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">{t("rooms.title")}</h2>
          <p className="text-sm text-muted-foreground">
            {t("rooms.count", { count: rooms.length })}
          </p>
        </div>
        <div className="relative w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("rooms.searchPlaceholder")}
            className="pl-8"
          />
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-12 text-center">
          <DoorOpen className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">
            {rooms.length === 0
              ? t("rooms.noRooms.title")
              : t("rooms.noResults.title")}
          </p>
          <p className="text-xs text-muted-foreground">
            {rooms.length === 0
              ? t("rooms.noRooms.description")
              : t("rooms.noResults.description")}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((room) => (
            <Link
              key={room.id}
              href={`/organisation/salles/${room.id}`}
              className="group rounded-lg border border-border bg-card p-4 hover:border-primary transition-colors"
            >
              <header className="flex items-start justify-between">
                <DoorOpen className="h-5 w-5 text-primary" />
                <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground transition-colors" />
              </header>
              <h3 className="mt-3 font-semibold">{room.name}</h3>
              {room.address && (
                <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                  <MapPin className="h-3 w-3" />
                  {room.address}
                  {room.floor && ` · ${room.floor}`}
                </p>
              )}
              <p className="text-xs text-muted-foreground flex items-center gap-1 mt-2">
                <Users className="h-3 w-3" />
                {t("rooms.capacity", { count: room.capacity })}
              </p>
              {nextSlots[room.id] && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 mt-1">
                  <Clock className="h-3 w-3" />
                  {formatNextSlot(nextSlots[room.id]!.start)}
                </p>
              )}
              {Array.isArray(room.equipment) &&
                (room.equipment as string[]).length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1">
                    {(room.equipment as string[]).slice(0, 3).map((e) => (
                      <span
                        key={e}
                        className="rounded-full bg-secondary px-2 py-0.5 text-[11px]"
                      >
                        {e}
                      </span>
                    ))}
                    {(room.equipment as string[]).length > 3 && (
                      <span className="text-[11px] text-muted-foreground">
                        +{(room.equipment as string[]).length - 3}
                      </span>
                    )}
                  </div>
                )}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
