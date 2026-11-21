"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useTranslations } from "next-intl";

interface Props {
  roomId: string;
  roomName: string;
  open: boolean;
  defaultStart?: Date;
  onOpenChange: (open: boolean) => void;
  onBooked: () => void;
}

function toLocalIsoInput(date: Date): string {
  const tz = date.getTimezoneOffset();
  const local = new Date(date.getTime() - tz * 60_000);
  return local.toISOString().slice(0, 16);
}

export function BookRoomDialog({
  roomId,
  roomName,
  open,
  defaultStart,
  onOpenChange,
  onBooked,
}: Props) {
  const t = useTranslations("organisation");
  const tCommon = useTranslations("common");
  const [title, setTitle] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [attendeesRaw, setAttendeesRaw] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    const start = defaultStart ?? nextHour();
    const end = new Date(start.getTime() + 60 * 60_000);
    setStartAt(toLocalIsoInput(start));
    setEndAt(toLocalIsoInput(end));
    setTitle("");
    setAttendeesRaw("");
  }, [open, defaultStart]);

  async function submit() {
    if (!title.trim()) {
      toast.error(t("toasts.titleRequired"));
      return;
    }
    const start = new Date(startAt);
    const end = new Date(endAt);
    if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) {
      toast.error(t("toasts.invalidTimeRange"));
      return;
    }

    const attendees = attendeesRaw
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean)
      .map((value) =>
        value.includes("@")
          ? { email: value }
          : { displayName: value }
      );

    setSaving(true);
    try {
      const res = await fetch(`/api/meeting-rooms/${roomId}/bookings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          startAt: start.toISOString(),
          endAt: end.toISOString(),
          attendees,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || t("toasts.bookingError"));
      }
      toast.success(t("toasts.bookingConfirmed"));
      onOpenChange(false);
      onBooked();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("toasts.genericError"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("bookRoom.dialogTitle", { roomName })}</DialogTitle>
          <DialogDescription>
            {t("bookRoom.description")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <Label htmlFor="bk-title">{t("bookRoom.meetingTitle")}</Label>
            <Input
              id="bk-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("bookRoom.titlePlaceholder")}
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="bk-start">{t("bookRoom.startLabel")}</Label>
              <Input
                id="bk-start"
                type="datetime-local"
                value={startAt}
                onChange={(e) => setStartAt(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="bk-end">{t("bookRoom.endLabel")}</Label>
              <Input
                id="bk-end"
                type="datetime-local"
                value={endAt}
                onChange={(e) => setEndAt(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="bk-attendees">{t("bookRoom.attendeesLabel")}</Label>
            <Input
              id="bk-attendees"
              value={attendeesRaw}
              onChange={(e) => setAttendeesRaw(e.target.value)}
              placeholder={t("bookRoom.attendeesPlaceholder")}
            />
            <p className="text-xs text-muted-foreground">
              {t("bookRoom.attendeesHint")}
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            {tCommon("cancel")}
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {t("bookRoom.book")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function nextHour(): Date {
  const d = new Date();
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}
