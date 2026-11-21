"use client";

import { useRef, KeyboardEvent, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface MessageInputProps {
  onSend: (content: string) => void;
  onTyping: () => void;
  disabled?: boolean;
}

export function MessageInput({ onSend, onTyping, disabled }: MessageInputProps) {
  const t = useTranslations("chat");
  const ref = useRef<HTMLTextAreaElement>(null);

  const submit = useCallback(() => {
    const value = ref.current?.value.trim();
    if (!value) return;
    onSend(value);
    if (ref.current) {
      ref.current.value = "";
      ref.current.style.height = "auto";
    }
  }, [onSend]);

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    e.currentTarget.style.height = "auto";
    e.currentTarget.style.height = `${e.currentTarget.scrollHeight}px`;
    onTyping();
  };

  return (
    <div className="flex gap-2 p-3 border-t">
      <Textarea
        ref={ref}
        rows={1}
        placeholder={t("messagePlaceholder")}
        className="resize-none min-h-[40px] max-h-[120px]"
        onKeyDown={handleKeyDown}
        onChange={handleChange}
        disabled={disabled}
      />
      <Button size="sm" onClick={submit} disabled={disabled}>
        {t("sendButton")}
      </Button>
    </div>
  );
}
