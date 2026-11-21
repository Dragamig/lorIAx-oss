"use client";

import { useState } from "react";
import { X, Clock, MapPin, AlignLeft, Repeat, Bell, Video } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Calendar, CalendarEvent } from "@/types";

interface EventFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSave: (data: EventFormData) => Promise<void>;
  calendars: Calendar[];
  initialDate?: Date;
  event?: CalendarEvent | null;
  defaultMeeting?: boolean;
  spaceId?: string;
}

export interface EventFormData {
  calendarId: string;
  title: string;
  description: string;
  location: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  recurrenceRule: string;
  visibility: "public" | "private" | "confidential";
  status: "confirmed" | "tentative" | "cancelled";
  color: string;
  isMeeting: boolean;
  meetingSpaceId?: string;
}

function toLocalDatetime(date: Date): string {
  const d = new Date(date);
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

function addHour(date: Date): Date {
  return new Date(date.getTime() + 60 * 60 * 1000);
}

export default function EventFormDialog({
  open,
  onClose,
  onSave,
  calendars,
  initialDate,
  event,
  defaultMeeting,
  spaceId,
}: EventFormDialogProps) {
  const t = useTranslations("calendar");
  const defaultStart = initialDate || new Date();
  const defaultEnd = addHour(defaultStart);

  const [form, setForm] = useState<EventFormData>({
    calendarId: event?.calendarId || calendars[0]?.id || "",
    title: event?.title || "",
    description: event?.description || "",
    location: event?.location || "",
    startAt: event ? toLocalDatetime(new Date(event.startAt)) : toLocalDatetime(defaultStart),
    endAt: event ? toLocalDatetime(new Date(event.endAt)) : toLocalDatetime(defaultEnd),
    allDay: event?.allDay || false,
    recurrenceRule: event?.recurrenceRule || "",
    visibility: event?.visibility || "public",
    status: event?.status || "confirmed",
    color: event?.color || "",
    isMeeting: defaultMeeting || false,
    meetingSpaceId: spaceId || "",
  });
  const [reminders, setReminders] = useState<number[]>([15]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.title.trim() || !form.calendarId) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(form);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("eventForm.saveError"));
    } finally {
      setSaving(false);
    }
  };

  const update = (key: keyof EventFormData, value: string | boolean) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const recurrencePresets = [
    { label: t("eventForm.recurrence.none"), value: "" },
    { label: t("eventForm.recurrence.daily"), value: "FREQ=DAILY" },
    { label: t("eventForm.recurrence.weekly"), value: "FREQ=WEEKLY" },
    { label: t("eventForm.recurrence.monthly"), value: "FREQ=MONTHLY" },
    { label: t("eventForm.recurrence.yearly"), value: "FREQ=YEARLY" },
    { label: t("eventForm.recurrence.workdays"), value: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR" },
  ];

  const reminderPresets = [
    { label: t("eventForm.reminder.15min"), value: 15 },
    { label: t("eventForm.reminder.30min"), value: 30 },
    { label: t("eventForm.reminder.1hour"), value: 60 },
    { label: t("eventForm.reminder.1day"), value: 1440 },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-lg shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-base font-semibold">
            {event ? t("eventForm.titleEdit") : t("eventForm.titleNew")}
          </h2>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title={t("eventForm.closeAria")}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Title */}
          <Input
            placeholder={t("eventForm.titlePlaceholder")}
            value={form.title}
            onChange={(e) => update("title", e.target.value)}
            className="text-lg font-medium border-0 border-b rounded-none px-0 focus-visible:ring-0"
            autoFocus
          />

          {/* Calendar selector */}
          <div className="flex items-center gap-2">
            <div
              className="w-3 h-3 rounded-sm"
              style={{
                backgroundColor:
                  calendars.find((c) => c.id === form.calendarId)?.color || "#3b82f6",
              }}
            />
            <select
              value={form.calendarId}
              onChange={(e) => update("calendarId", e.target.value)}
              className="text-sm bg-transparent border border-border rounded px-2 py-1"
            >
              {calendars.map((cal) => (
                <option key={cal.id} value={cal.id}>
                  {cal.name}
                </option>
              ))}
            </select>
          </div>

          {/* Date/Time */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-muted-foreground" />
              <Label className="text-sm text-muted-foreground">{t("eventForm.scheduleLabel")}</Label>
              <label className="flex items-center gap-1 ml-auto text-xs">
                <input
                  type="checkbox"
                  checked={form.allDay}
                  onChange={(e) => update("allDay", e.target.checked)}
                  className="rounded"
                />
                {t("eventForm.allDay")}
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2 ml-6">
              <Input
                type={form.allDay ? "date" : "datetime-local"}
                value={form.allDay ? form.startAt.slice(0, 10) : form.startAt}
                onChange={(e) => update("startAt", e.target.value)}
                className="text-sm"
              />
              <Input
                type={form.allDay ? "date" : "datetime-local"}
                value={form.allDay ? form.endAt.slice(0, 10) : form.endAt}
                onChange={(e) => update("endAt", e.target.value)}
                className="text-sm"
              />
            </div>
          </div>

          {/* Location */}
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={t("eventForm.locationPlaceholder")}
              value={form.location}
              onChange={(e) => update("location", e.target.value)}
              className="border-0 border-b rounded-none px-0 focus-visible:ring-0 text-sm"
            />
          </div>

          {/* Description */}
          <div className="flex items-start gap-2">
            <AlignLeft className="h-4 w-4 text-muted-foreground mt-2" />
            <textarea
              placeholder={t("eventForm.descriptionPlaceholder")}
              value={form.description}
              onChange={(e) => update("description", e.target.value)}
              className="flex-1 text-sm bg-transparent border border-border rounded px-3 py-2 resize-none min-h-[60px]"
            />
          </div>

          {/* Recurrence */}
          <div className="flex items-center gap-2">
            <Repeat className="h-4 w-4 text-muted-foreground" />
            <select
              value={form.recurrenceRule}
              onChange={(e) => update("recurrenceRule", e.target.value)}
              className="text-sm bg-transparent border border-border rounded px-2 py-1"
            >
              {recurrencePresets.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* Meeting toggle */}
          <div className="flex items-center gap-2">
            <Video className="h-4 w-4 text-muted-foreground" />
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={form.isMeeting}
                onChange={(e) => update("isMeeting", e.target.checked)}
                className="rounded"
              />
              {t("eventForm.meeting")}
            </label>
          </div>

          {/* Reminder */}
          <div className="flex items-center gap-2">
            <Bell className="h-4 w-4 text-muted-foreground" />
            <select
              value={reminders[0] || 15}
              onChange={(e) => setReminders([parseInt(e.target.value)])}
              className="text-sm bg-transparent border border-border rounded px-2 py-1"
            >
              {reminderPresets.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* Visibility + Status */}
          <div className="flex gap-3 ml-6">
            <select
              value={form.visibility}
              onChange={(e) => update("visibility", e.target.value)}
              className="text-xs bg-transparent border border-border rounded px-2 py-1"
            >
              <option value="public">{t("eventForm.visibility.public")}</option>
              <option value="private">{t("eventForm.visibility.private")}</option>
              <option value="confidential">{t("eventForm.visibility.confidential")}</option>
            </select>
            <select
              value={form.status}
              onChange={(e) => update("status", e.target.value)}
              className="text-xs bg-transparent border border-border rounded px-2 py-1"
            >
              <option value="confirmed">{t("eventForm.status.confirmed")}</option>
              <option value="tentative">{t("eventForm.status.tentative")}</option>
              <option value="cancelled">{t("eventForm.status.cancelled")}</option>
            </select>
          </div>

          {/* Actions */}
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <div className="flex justify-end gap-2 pt-2 border-t border-border">
            <Button variant="ghost" type="button" onClick={onClose}>
              {t("eventForm.cancel")}
            </Button>
            <Button type="submit" disabled={saving || !form.title.trim()}>
              {saving ? t("eventForm.saving") : event ? t("eventForm.update") : t("eventForm.save")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
