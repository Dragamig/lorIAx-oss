"use client";

import { useTranslations, useFormatter } from "next-intl";
import type { ChatMessage } from "@/hooks/use-chat-ws";

interface MessageBubbleProps {
  message: ChatMessage & { authorAvatarUrl?: string | null };
  isGrouped?: boolean;
  onPour?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
  currentUserId: string;
}

export function MessageBubble({ message, isGrouped, onPour, onDelete, currentUserId }: MessageBubbleProps) {
  const t = useTranslations("chat");
  const format = useFormatter();
  const isOwn = message.authorId === currentUserId;

  return (
    <div className="group relative flex gap-2 px-3 py-0.5 hover:bg-muted/50 rounded">
      {!isGrouped ? (
        <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center text-xs font-medium shrink-0 mt-0.5">
          {message.authorName?.[0]?.toUpperCase() ?? "?"}
        </div>
      ) : (
        <div className="w-8 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        {!isGrouped && (
          <div className="flex items-baseline gap-2 mb-0.5">
            <span className="font-medium text-sm">{message.authorName}</span>
            <span className="text-xs text-muted-foreground">
              {format.relativeTime(new Date(message.createdAt))}
            </span>
          </div>
        )}
        <p className="text-sm whitespace-pre-wrap break-words">
          {message.content ?? <span className="italic text-muted-foreground">{t("deletedMessage")}</span>}
        </p>
      </div>
      <div className="absolute right-2 top-0.5 hidden group-hover:flex items-center gap-1 bg-background border rounded shadow-sm px-1 py-0.5">
        {onPour && (
          <button onClick={() => onPour(message.id)} className="text-xs text-muted-foreground hover:text-foreground px-1" title={t("pourToDocTitle")}>
            {t("pourToDoc")}
          </button>
        )}
        {isOwn && onDelete && (
          <button onClick={() => onDelete(message.id)} className="text-xs text-destructive hover:text-destructive/80 px-1" title={t("deleteTitle")}>
            ✕
          </button>
        )}
      </div>
    </div>
  );
}
