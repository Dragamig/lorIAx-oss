"use client";

import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DayOfWeek, OpeningHours, OpeningHoursSlot } from "@/types";
import { useTranslations } from "next-intl";

interface Props {
  value: OpeningHours;
  onChange: (next: OpeningHours) => void;
}

export function OpeningHoursEditor({ value, onChange }: Props) {
  const t = useTranslations("organisation");

  const DAYS: { key: DayOfWeek; label: string }[] = [
    { key: "mon", label: t("days.mon") },
    { key: "tue", label: t("days.tue") },
    { key: "wed", label: t("days.wed") },
    { key: "thu", label: t("days.thu") },
    { key: "fri", label: t("days.fri") },
    { key: "sat", label: t("days.sat") },
    { key: "sun", label: t("days.sun") },
  ];

  function updateSlot(
    day: DayOfWeek,
    index: number,
    field: keyof OpeningHoursSlot,
    next: string
  ) {
    const slots = [...(value[day] ?? [])];
    if (index < 0 || index >= slots.length) return;
    slots[index] = { ...slots[index], [field]: next };
    onChange({ ...value, [day]: slots });
  }

  function addSlot(day: DayOfWeek) {
    onChange({
      ...value,
      [day]: [...(value[day] ?? []), { from: "09:00", to: "18:00" }],
    });
  }

  function removeSlot(day: DayOfWeek, index: number) {
    const slots = [...(value[day] ?? [])];
    slots.splice(index, 1);
    onChange({ ...value, [day]: slots });
  }

  return (
    <div className="space-y-3">
      <Label>{t("openingHours.label")}</Label>
      <div className="space-y-2 rounded-md border border-border p-3">
        {DAYS.map(({ key, label }) => {
          const slots = value[key] ?? [];
          return (
            <div key={key} className="flex items-start gap-3">
              <span className="w-20 pt-1 text-sm font-medium text-muted-foreground">
                {label}
              </span>
              <div className="flex-1 space-y-1">
                {slots.length === 0 && (
                  <span className="text-xs text-muted-foreground">{t("openingHours.closed")}</span>
                )}
                {slots.map((slot, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <Input
                      type="time"
                      value={slot.from}
                      onChange={(e) => updateSlot(key, index, "from", e.target.value)}
                      className="w-28"
                    />
                    <span className="text-xs text-muted-foreground">–</span>
                    <Input
                      type="time"
                      value={slot.to}
                      onChange={(e) => updateSlot(key, index, "to", e.target.value)}
                      className="w-28"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => removeSlot(key, index)}
                      aria-label={t("openingHours.removeSlotAria")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => addSlot(key)}
                className="text-xs"
              >
                <Plus className="h-3 w-3 mr-1" />
                {t("openingHours.addSlot")}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
