"use client";

import { useEffect, useState, useCallback } from "react";
import { toast } from "sonner";
import {
  ArrowLeft,
  CalendarPlus,
  DoorOpen,
  Loader2,
  MapPin,
  Trash2,
  Users,
  Image as ImageIcon,
  Map as MapIcon,
} from "lucide-react";
import { Link } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { BookRoomDialog } from "@/components/meeting-rooms/book-room-dialog";
import type {
  MeetingRoom,
  MeetingRoomBooking,
  OpeningHours,
  DayOfWeek,
} from "@/types";
import { useTranslations, useFormatter } from "next-intl";

interface Props {
  roomId: string;
}

export function RoomDetailClient({ roomId }: Props) {
  const t = useTranslations("organisation");
  const format = useFormatter();
  const [room, setRoom] = useState<MeetingRoom | null>(null);
  const [bookings, setBookings] = useState<MeetingRoomBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [bookingOpen, setBookingOpen] = useState(false);

  const DAYS: { key: DayOfWeek; label: string }[] = [
    { key: "mon", label: t("days.mon") },
    { key: "tue", label: t("days.tue") },
    { key: "wed", label: t("days.wed") },
    { key: "thu", label: t("days.thu") },
    { key: "fri", label: t("days.fri") },
    { key: "sat", label: t("days.sat") },
    { key: "sun", label: t("days.sun") },
  ];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [roomRes, bookingsRes] = await Promise.all([
        fetch(`/api/meeting-rooms/${roomId}`),
        fetch(
          `/api/meeting-rooms/${roomId}/bookings?from=${weekStart().toISOString()}&to=${weekEnd().toISOString()}`
        ),
      ]);
      if (!roomRes.ok) {
        if (roomRes.status === 403) {
          toast.error(t("toasts.unauthorized"));
        }
        return;
      }
      setRoom(await roomRes.json());
      setBookings(bookingsRes.ok ? await bookingsRes.json() : []);
    } catch {
      toast.error(t("toasts.loadError"));
    } finally {
      setLoading(false);
    }
  }, [roomId, t]);

  useEffect(() => {
    load();
  }, [load]);

  async function cancelBooking(b: MeetingRoomBooking) {
    if (!confirm(t("roomDetail.confirmCancel"))) return;
    try {
      const res = await fetch(
        `/api/meeting-rooms/${roomId}/bookings/${b.id}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error();
      toast.success(t("toasts.cancelSuccess"));
      load();
    } catch {
      toast.error(t("toasts.cancelError"));
    }
  }

  function formatRange(start: Date, end: Date): string {
    const sd = format.dateTime(start, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
    const sh = format.dateTime(start, { hour: "2-digit", minute: "2-digit" });
    const eh = format.dateTime(end, { hour: "2-digit", minute: "2-digit" });
    return `${sd} · ${sh} – ${eh}`;
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!room) {
    return (
      <div className="rounded-lg border border-dashed border-border p-12 text-center">
        <p className="text-sm text-muted-foreground">{t("roomDetail.notFound")}</p>
        <Link
          href="/organisation/salles"
          className="text-xs text-primary mt-2 inline-block"
        >
          {t("roomDetail.backToList2")}
        </Link>
      </div>
    );
  }

  const equipment = (room.equipment as string[] | null) ?? [];
  const hours = (room.openingHours as OpeningHours | null) ?? null;

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <Link
          href="/organisation/salles"
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          {t("roomDetail.backToList")}
        </Link>
        <Button onClick={() => setBookingOpen(true)} disabled={!room.isActive}>
          <CalendarPlus className="h-4 w-4 mr-1.5" />
          {t("roomDetail.book")}
        </Button>
      </div>

      <header className="rounded-lg border border-border bg-card p-6 space-y-2">
        <div className="flex items-center gap-2">
          <DoorOpen className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold">{room.name}</h2>
          {!room.isActive && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
              {t("roomDetail.inactive")}
            </span>
          )}
        </div>
        {room.address && (
          <p className="text-sm text-muted-foreground flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5" />
            {room.address}
            {room.floor && ` · ${room.floor}`}
          </p>
        )}
        <p className="text-sm text-muted-foreground flex items-center gap-1">
          <Users className="h-3.5 w-3.5" />
          {t("roomDetail.capacity", { count: room.capacity })}
        </p>
        {room.description && (
          <p className="text-sm text-muted-foreground mt-2">{room.description}</p>
        )}
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {room.photoKey && (
          <a
            href={`/api/meeting-rooms/${room.id}/upload?type=photo`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-border bg-card p-4"
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <ImageIcon className="h-4 w-4" />
              {t("roomDetail.photo")}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/meeting-rooms/${room.id}/upload?type=photo`}
              alt={t("roomDetail.photoAlt", { name: room.name })}
              className="mt-3 w-full rounded-md object-cover max-h-64"
            />
          </a>
        )}
        {room.floorPlanKey && (
          <a
            href={`/api/meeting-rooms/${room.id}/upload?type=floor_plan`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-lg border border-border bg-card p-4"
          >
            <div className="flex items-center gap-2 text-sm font-medium">
              <MapIcon className="h-4 w-4" />
              {t("roomDetail.plan")}
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/api/meeting-rooms/${room.id}/upload?type=floor_plan`}
              alt={t("roomDetail.planAlt", { name: room.name })}
              className="mt-3 w-full rounded-md object-cover max-h-64"
            />
          </a>
        )}
      </div>

      {equipment.length > 0 && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-medium mb-2">{t("roomDetail.equipment")}</h3>
          <div className="flex flex-wrap gap-1.5">
            {equipment.map((e) => (
              <span
                key={e}
                className="rounded-full bg-secondary px-2.5 py-1 text-xs"
              >
                {e}
              </span>
            ))}
          </div>
        </section>
      )}

      {hours && (
        <section className="rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-medium mb-2">{t("roomDetail.openingHours")}</h3>
          <ul className="space-y-1 text-sm">
            {DAYS.map(({ key, label }) => {
              const slots = hours[key] ?? [];
              return (
                <li key={key} className="flex items-center justify-between">
                  <span className="text-muted-foreground">{label}</span>
                  <span>
                    {slots.length === 0
                      ? t("roomDetail.closed")
                      : slots.map((s) => `${s.from} – ${s.to}`).join(", ")}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="rounded-lg border border-border bg-card p-4">
        <h3 className="text-sm font-medium mb-3">
          {t("roomDetail.weekBookings")}
        </h3>
        {bookings.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("roomDetail.noBookings")}
          </p>
        ) : (
          <ul className="space-y-2">
            {bookings.map((b) => (
              <li
                key={b.id}
                className="flex items-center justify-between rounded-md border border-border p-3"
              >
                <div>
                  <p className="text-sm font-medium">{b.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatRange(new Date(b.startAt), new Date(b.endAt))}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => cancelBooking(b)}
                  aria-label={t("roomDetail.cancelAria")}
                  className="text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <BookRoomDialog
        roomId={room.id}
        roomName={room.name}
        open={bookingOpen}
        onOpenChange={setBookingOpen}
        onBooked={load}
      />
    </div>
  );
}

function weekStart(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}
function weekEnd(): Date {
  const d = weekStart();
  d.setDate(d.getDate() + 7);
  return d;
}
