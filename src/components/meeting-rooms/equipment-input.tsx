"use client";

import { useState, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";

interface Props {
  value: string[];
  onChange: (next: string[]) => void;
}

export function EquipmentInput({ value, onChange }: Props) {
  const t = useTranslations("organisation.equipment");
  const [draft, setDraft] = useState("");

  function add() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    if (value.includes(trimmed)) return;
    onChange([...value, trimmed]);
    setDraft("");
  }

  function remove(item: string) {
    onChange(value.filter((v) => v !== item));
  }

  function onKey(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add();
    }
  }

  return (
    <div className="space-y-2">
      <Label>{t("label")}</Label>
      <div className="flex flex-wrap gap-1.5">
        {value.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-xs"
          >
            {item}
            <button
              type="button"
              onClick={() => remove(item)}
              className="text-muted-foreground hover:text-foreground"
              aria-label={t("removeAria", { item })}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKey}
          placeholder={t("placeholder")}
        />
        <Button type="button" variant="secondary" size="sm" onClick={add}>
          {t("addButton")}
        </Button>
      </div>
    </div>
  );
}
