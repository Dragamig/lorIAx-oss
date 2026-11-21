"use client";

import { Link } from "@/i18n/routing";
import { Video, FileText, Clock, Trash2, CalendarClock } from "lucide-react";
import { MeetingStatusBadge } from "./meeting-status-badge";
import { Button } from "@/components/ui/button";
import { useTranslations, useFormatter } from "next-intl";

interface Meeting {
  id: string;
  title: string;
  roomName: string;
  status: string;
  spaceId?: string | null;
  notesDocumentId?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  createdAt: string;
  scheduledAt?: string | null;
}

interface MeetingCardProps {
  meeting: Meeting;
  canDelete?: boolean;
  notesUrl?: string | null;
  onDelete?: (id: string) => void;
}

export function MeetingCard({ meeting, canDelete, notesUrl, onDelete }: MeetingCardProps) {
  const t = useTranslations("meet");
  const format = useFormatter();
  const isActive = meeting.status === "active";
  const isProcessing =
    meeting.status === "transcribing" || meeting.status === "summarizing";

  function formatRelativeTime(dateStr: string): string {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (minutes < 1) return t("card.now");
    if (minutes < 60) return t("card.minutesAgo", { minutes });
    if (hours < 24) return t("card.hoursAgo", { hours });
    if (days < 7) return t("card.daysAgo", { days });
    return format.dateTime(date, { day: "numeric", month: "short" });
  }

  return (
    <div className="flex items-center justify-between rounded-lg border border-border/50 bg-card p-4 transition-colors hover:bg-accent/5">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <Video className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0">
          <h3 className="truncate text-sm font-medium">{meeting.title}</h3>
          <div className="flex items-center gap-2 mt-1">
            <MeetingStatusBadge status={meeting.status} />
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              {meeting.scheduledAt ? (
                <>
                  <CalendarClock className="h-3 w-3" />
                  {format.dateTime(new Date(meeting.scheduledAt), {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </>
              ) : (
                <>
                  <Clock className="h-3 w-3" />
                  {formatRelativeTime(meeting.startedAt || meeting.createdAt)}
                </>
              )}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 shrink-0 ml-4">
        {meeting.status === "scheduled" && canDelete && onDelete && (
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              if (confirm(t("card.confirmDelete"))) {
                onDelete(meeting.id);
              }
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
        {isActive && (
          <Link href={`/meet/${meeting.roomName}`}>
            <Button size="sm" variant="default">
              {t("card.join")}
            </Button>
          </Link>
        )}
        {isProcessing && (
          <span className="text-xs text-muted-foreground animate-pulse">
            {t("card.processing")}
          </span>
        )}
        {meeting.status === "completed" && meeting.notesDocumentId && notesUrl && (
          <Link href={notesUrl} title={t("card.viewNotesAria")}>
            <Button size="sm" variant="outline">
              <FileText className="h-4 w-4 mr-1" />
              {t("card.viewNotes")}
            </Button>
          </Link>
        )}
      </div>
    </div>
  );
}
