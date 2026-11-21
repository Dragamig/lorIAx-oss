"use client";

import { useTranslations } from "next-intl";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import type { RowActivityComment } from "@/lib/databases/row-activity-types";
import type { PermissionLevel } from "@/types";

export interface CommentEntryMenuProps {
  comment: RowActivityComment;
  viewerId: string;
  permission: PermissionLevel;
  onEdit(): void;
  onDelete(): Promise<void>;
}

/** Only the author edits (an admin cannot); the author or a space admin deletes. */
export function commentMenuRights(comment: RowActivityComment, viewerId: string, permission: PermissionLevel) {
  if (comment.deleted || permission === "viewer") return { canEdit: false, canDelete: false };
  const isAuthor = comment.actor !== null && comment.actor.id === viewerId;
  return { canEdit: isAuthor, canDelete: isAuthor || permission === "admin" };
}

export function CommentEntryMenu({ comment, viewerId, permission, onEdit, onDelete }: CommentEntryMenuProps) {
  const t = useTranslations("rowActivity");
  const { canEdit, canDelete } = commentMenuRights(comment, viewerId, permission);
  if (!canEdit && !canDelete) return null;

  return (
    <DropdownMenu>
      <Tip label={t("commentMenu")}>
        <DropdownMenuTrigger
          render={
            <Button type="button" variant="ghost" size="icon-xs" aria-label={t("commentMenu")}>
              <MoreHorizontal />
            </Button>
          }
        />
      </Tip>
      <DropdownMenuContent align="end" className="w-40">
        {canEdit && (
          <DropdownMenuItem onClick={() => onEdit()}>
            <Pencil aria-hidden="true" />
            <span>{t("commentEdit")}</span>
          </DropdownMenuItem>
        )}
        {canDelete && (
          <DropdownMenuItem variant="destructive" onClick={() => void onDelete().catch(() => {})}>
            <Trash2 aria-hidden="true" />
            <span>{t("commentDelete")}</span>
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
