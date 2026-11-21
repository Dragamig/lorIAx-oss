"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";
import { ChannelList } from "./channel-list";
import { MessageList } from "./message-list";
import { MessageInput } from "./message-input";
import { useChatWs, type ChatMessage } from "@/hooks/use-chat-ws";
import { cn } from "@/lib/utils";
import { MessageSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PourDialog } from "./pour-dialog";

const STORAGE_KEY = "chat-panel-open";

export function ChatToggleButton({ onClick, unreadTotal }: { onClick: () => void; unreadTotal: number }) {
  return (
    <button onClick={onClick} className="relative p-2 rounded hover:bg-muted" title="Messagerie">
      <MessageSquare className="h-5 w-5" />
      {unreadTotal > 0 && (
        <span className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground text-xs rounded-full w-4 h-4 flex items-center justify-center">
          {unreadTotal > 9 ? "9+" : unreadTotal}
        </span>
      )}
    </button>
  );
}

export function ChatPanel() {
  const t = useTranslations("chat");
  const { data: session } = useSession();
  const [open, setOpen] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY) === "true";
  });
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [pourMessageId, setPourMessageId] = useState<string | null>(null);
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  const [typingUsers, setTypingUsers] = useState<Record<string, string>>({});
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleMessage = useCallback((msg: ChatMessage) => {
    setLiveMessages((prev) => [...prev.slice(-200), msg]);
  }, []);

  const handleTyping = useCallback((channelId: string, userName: string) => {
    setTypingUsers((prev) => ({ ...prev, [channelId]: userName }));
    if (typingTimers.current[channelId]) clearTimeout(typingTimers.current[channelId]);
    typingTimers.current[channelId] = setTimeout(() => {
      setTypingUsers((prev) => { const next = { ...prev }; delete next[channelId]; return next; });
    }, 3000);
  }, []);

  const { connected, sendMessage, sendTyping, markRead } = useChatWs({
    onMessage: handleMessage,
    onTyping: handleTyping,
  });

  const toggleOpen = () => {
    setOpen((v) => {
      const next = !v;
      localStorage.setItem(STORAGE_KEY, String(next));
      return next;
    });
  };

  useEffect(() => {
    const handler = () => toggleOpen();
    window.addEventListener("loriax:toggle-chat-panel", handler);
    return () => window.removeEventListener("loriax:toggle-chat-panel", handler);
  }, []);

  const handleSelectChannel = (channelId: string) => {
    setActiveChannelId(channelId);
    markRead(channelId);
  };

  const getOpenDocumentId = (): string | null => {
    if (typeof window === "undefined") return null;
    const match = window.location.pathname.match(/\/d\/([0-9a-f-]{36})/);
    return match?.[1] ?? null;
  };

  if (!open) return null;

  const currentUserId = (session?.user as { id?: string } | undefined)?.id ?? "";

  return (
    <div className={cn("fixed right-0 top-0 bottom-0 w-80 bg-background border-l flex flex-col z-40 shadow-lg")}>
      <div className="flex items-center justify-between px-3 py-2 border-b shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          <span className="font-semibold text-sm">{t("title")}</span>
          {!connected && <span className="text-xs text-muted-foreground">{t("reconnecting")}</span>}
        </div>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggleOpen}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      {!activeChannelId ? (
        <ChannelList activeChannelId={activeChannelId} onSelect={handleSelectChannel} />
      ) : (
        <div className="flex flex-col flex-1 min-h-0">
          <button
            onClick={() => setActiveChannelId(null)}
            className="text-xs text-muted-foreground px-3 py-1.5 border-b hover:bg-muted text-left"
          >
            {t("back")}
          </button>
          <MessageList
            channelId={activeChannelId}
            liveMessages={liveMessages}
            currentUserId={currentUserId}
            onPour={(id) => setPourMessageId(id)}
            onDelete={async (id) => {
              await fetch(`/api/chat/messages/${id}`, { method: "DELETE" });
              setLiveMessages((prev) => prev.filter((m) => m.id !== id));
            }}
          />
          {typingUsers[activeChannelId] && (
            <div className="px-3 text-xs text-muted-foreground italic py-1">
              {t("typing", { name: typingUsers[activeChannelId] })}
            </div>
          )}
          <MessageInput
            onSend={(content) => sendMessage(activeChannelId, content)}
            onTyping={() => sendTyping(activeChannelId)}
            disabled={!connected}
          />
        </div>
      )}
      <PourDialog
        messageId={pourMessageId}
        documentId={pourMessageId ? getOpenDocumentId() : null}
        onClose={() => setPourMessageId(null)}
        onPoured={(node) => {
          window.dispatchEvent(new CustomEvent("loriax:insert-block", { detail: node }));
        }}
      />
    </div>
  );
}
