"use client";

import { useState, type ClipboardEvent, type KeyboardEvent, type Ref } from "react";
import { useTranslations } from "next-intl";
import { AlertCircle, X } from "lucide-react";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { cn } from "@/lib/utils";

const EMAIL = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;
export const isValidAddress = (a: string) => EMAIL.test(a);

export interface RecipientFieldProps {
  label: string;
  inputLabel: string;
  value: string[];
  onChange: (next: string[]) => void;
  inputRef?: Ref<HTMLInputElement>;
  trailing?: React.ReactNode;
  /** Reports whether typed text is still waiting to be validated into a chip. */
  onPendingChange?: (pending: boolean) => void;
}

export function RecipientField({ label, inputLabel, value, onChange, inputRef, trailing, onPendingChange }: RecipientFieldProps) {
  const t = useTranslations("mailing.compose");
  const [text, setText] = useState("");

  function commit(raw: string) {
    const parts = raw
      .split(/[\s,;]+/)
      .map((p) => p.trim().toLowerCase())
      .filter(Boolean);
    if (parts.length === 0) return;
    const next = [...value];
    for (const p of parts) if (!next.includes(p)) next.push(p);
    onChange(next);
    setText("");
    onPendingChange?.(false);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === "," || e.key === ";") {
      if (text.trim()) {
        e.preventDefault();
        commit(text);
      }
    } else if (e.key === "Backspace" && !text && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function onPaste(e: ClipboardEvent<HTMLInputElement>) {
    const pasted = e.clipboardData.getData("text");
    if (/[\s,;]/.test(pasted.trim())) {
      e.preventDefault();
      commit(pasted);
    }
  }

  return (
    <div className="flex min-h-10 items-start gap-3 border-b border-border px-4 py-1.5">
      <span className="w-10 shrink-0 pt-1.5 text-xs font-bold text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
        {value.map((address) => {
          const bad = !isValidAddress(address);
          return (
            <span
              key={address}
              data-invalid={bad ? "true" : undefined}
              className={cn(
                "inline-flex h-6 max-w-full items-center gap-1 rounded-full pl-2 pr-1 text-xs",
                bad ? "bg-destructive/15 text-destructive ring-1 ring-destructive/50" : "bg-sky-100 text-sky-900 dark:bg-sky-900/40 dark:text-sky-100",
              )}
            >
              <span className="truncate">{address}</span>
              {bad && <AlertCircle className="size-3 shrink-0" aria-hidden="true" />}
              <Tip label={t("removeRecipientTip", { address })}>
                <button
                  type="button"
                  aria-label={t("removeRecipient", { address })}
                  onClick={() => onChange(value.filter((a) => a !== address))}
                  className="inline-flex size-5 cursor-pointer items-center justify-center rounded-full outline-none hover:bg-black/10 focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X className="size-3" aria-hidden="true" />
                </button>
              </Tip>
            </span>
          );
        })}
        <input
          ref={inputRef}
          type="text"
          value={text}
          aria-label={inputLabel}
          placeholder={inputLabel}
          onChange={(e) => {
            setText(e.target.value);
            onPendingChange?.(e.target.value.trim() !== "");
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onBlur={() => commit(text)}
          className="h-7 min-w-32 flex-1 rounded-md bg-transparent px-1 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
        />
        {value.some((a) => !isValidAddress(a)) && (
          <p role="alert" className="w-full text-xs font-medium text-destructive first-letter:uppercase">
            {t("invalidAddress")}
          </p>
        )}
      </div>
      {trailing}
    </div>
  );
}
