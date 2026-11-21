"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

interface Channel {
  id: string;
  type: "direct" | "team" | "space";
  name: string | null;
  teamId?: string | null;
  spaceId?: string | null;
  unreadCount: number;
}

interface ChannelListProps {
  activeChannelId: string | null;
  onSelect: (channelId: string) => void;
}

export function ChannelList({ activeChannelId, onSelect }: ChannelListProps) {
  const t = useTranslations("chat");
  const [channels, setChannels] = useState<Channel[]>([]);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/chat/channels")
      .then((r) => {
        if (!r.ok) throw new Error(r.statusText);
        return r.json();
      })
      .then(setChannels)
      .catch(() => setError(true));
  }, []);

  const directs = channels.filter((c) => c.type === "direct");
  const teams = channels.filter((c) => c.type === "team");
  const spaces = channels.filter((c) => c.type === "space");

  const renderChannel = (c: Channel) => (
    <button
      key={c.id}
      onClick={() => onSelect(c.id)}
      className={cn(
        "w-full flex items-center justify-between px-3 py-1 text-sm rounded hover:bg-muted/70 text-left",
        activeChannelId === c.id && "bg-muted font-medium"
      )}
    >
      <span className="truncate">{c.name ?? t("directMessage")}</span>
      {c.unreadCount > 0 && (
        <span className="ml-1 bg-destructive text-destructive-foreground text-xs rounded-full px-1.5 py-0.5 shrink-0">
          {c.unreadCount}
        </span>
      )}
    </button>
  );

  return (
    <div className="flex-1 overflow-y-auto py-2 space-y-4">
      {error && (
        <p className="px-3 py-2 text-xs text-destructive">
          {t("channelLoadError")}
        </p>
      )}
      {directs.length > 0 && (
        <div>
          <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{t("sections.directs")}</p>
          {directs.map(renderChannel)}
        </div>
      )}
      {teams.length > 0 && (
        <div>
          <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{t("sections.teams")}</p>
          {teams.map(renderChannel)}
        </div>
      )}
      {spaces.length > 0 && (
        <div>
          <p className="px-3 text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1">{t("sections.spaces")}</p>
          {spaces.map(renderChannel)}
        </div>
      )}
    </div>
  );
}
