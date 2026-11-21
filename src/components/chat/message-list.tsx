"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { MessageBubble } from "./message-bubble";
import type { ChatMessage } from "@/hooks/use-chat-ws";

interface StoredMessage extends ChatMessage {
  authorAvatarUrl?: string | null;
}

interface MessageListProps {
  channelId: string;
  liveMessages: ChatMessage[];
  currentUserId: string;
  onPour?: (messageId: string) => void;
  onDelete?: (messageId: string) => void;
}

export function MessageList({
  channelId,
  liveMessages,
  currentUserId,
  onPour,
  onDelete,
}: MessageListProps) {
  const t = useTranslations("chat");
  const [history, setHistory] = useState<StoredMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [_hasMore, setHasMore] = useState(true);
  const topRef = useRef<HTMLDivElement>(null);
  const oldestRef = useRef<string | null>(null);
  // Refs pour éviter les stale closures dans loadMore
  const loadingRef = useRef(false);
  const hasMoreRef = useRef(true);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || !hasMoreRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    const params = oldestRef.current
      ? `?before=${encodeURIComponent(oldestRef.current)}&limit=50`
      : "?limit=50";
    try {
      const res = await fetch(`/api/chat/channels/${channelId}/messages${params}`);
      if (!res.ok) return;
      const data: StoredMessage[] = await res.json();
      if (data.length < 50) {
        hasMoreRef.current = false;
        setHasMore(false);
      }
      if (data.length > 0) oldestRef.current = data[0].createdAt;
      setHistory((prev) => [...data, ...prev]);
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, [channelId]);

  // Reset + chargement initial au changement de canal
  useEffect(() => {
    setHistory([]);
    setHasMore(true);
    loadingRef.current = false;
    hasMoreRef.current = true;
    oldestRef.current = null;
    loadMore();
  }, [channelId, loadMore]);

  // IntersectionObserver pour pagination vers le haut
  useEffect(() => {
    const el = topRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadMore(); },
      { threshold: 1 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  const allMessages = [
    ...history,
    ...liveMessages.filter(
      (m) => m.channelId === channelId && !history.find((h) => h.id === m.id)
    ),
  ];

  return (
    <div className="flex-1 overflow-y-auto flex flex-col">
      <div ref={topRef} className="h-1 shrink-0" />
      {loading && (
        <div className="text-xs text-center text-muted-foreground py-2">{t("loading")}</div>
      )}
      <div className="flex flex-col justify-end flex-1 py-2">
        {allMessages.map((msg, i) => {
          const prev = allMessages[i - 1];
          const isGrouped =
            !!prev &&
            prev.authorId === msg.authorId &&
            new Date(msg.createdAt).getTime() - new Date(prev.createdAt).getTime() < 5 * 60 * 1000;
          return (
            <MessageBubble
              key={msg.id}
              message={msg}
              isGrouped={isGrouped}
              currentUserId={currentUserId}
              onPour={onPour}
              onDelete={onDelete}
            />
          );
        })}
      </div>
    </div>
  );
}
