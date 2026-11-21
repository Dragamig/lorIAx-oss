"use client";

import { useState } from "react";
import { Lock, MoreHorizontal, Trash2, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { viewsApi } from "./views-api";
import { scopeChangeBlockedReason, type ViewDef, type ViewScope } from "./view-scope";

interface Props {
  view: ViewDef;
  viewerId: string;
  sharedCount: number;
  databaseId: string;
  readOnly: boolean;
  onChanged(): void;
  onDeleted(viewId: string, recreatedId?: string): void;
}

const itemClass =
  "flex h-7 w-full items-center gap-2 rounded px-2 text-left text-xs hover:bg-neutral-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent dark:hover:bg-neutral-800";

export function ViewScopeMenu({ view, viewerId, sharedCount, databaseId, readOnly, onChanged, onDeleted }: Props) {
  const t = useTranslations("basesViews");
  const [open, setOpen] = useState(false);
  const target: ViewScope = view.scope === "personal" ? "shared" : "personal";
  const blocked = scopeChangeBlockedReason({ view, viewerId, sharedCount, target });
  const scopeReason = readOnly
    ? t("readOnlyDisabled")
    : blocked === "not_author" || blocked === "no_author"
      ? t("changeScopeDisabledNotAuthor")
      : blocked === "is_default"
        ? t("changeScopeDisabledDefault")
        : blocked === "last_shared"
          ? t("changeScopeDisabledLastShared")
          : null;
  const deleteReason = readOnly
    ? t("readOnlyDisabled")
    : view.scope !== "personal" && sharedCount <= 1
      ? t("deleteDisabledLastShared")
      : null;

  async function changeScope(next: ViewScope) {
    const res = await viewsApi.setScope(databaseId, view.id, next);
    if (!res.ok) {
      toast.error(res.error ?? t("scopeFailed"));
      return;
    }
    onChanged();
    toast.success(next === "shared" ? t("scopeChangedSharedToast", { name: view.name }) : t("scopeChangedPersonalToast", { name: view.name }), {
      action: {
        label: t("undo"),
        onClick: () => {
          void viewsApi.setScope(databaseId, view.id, view.scope).then((back) => {
            if (back.ok) onChanged();
            else toast.error(back.error ?? t("scopeFailed"));
          });
        },
      },
    });
  }

  async function remove() {
    const res = await viewsApi.remove(databaseId, view.id);
    if (!res.ok) {
      toast.error(res.error ?? t("deleteFailed"));
      return;
    }
    onDeleted(view.id);
    toast.success(t("deletedToast", { name: view.name }), {
      action: {
        label: t("undo"),
        onClick: () => {
          void viewsApi.restore(databaseId, view).then((back) => {
            if (back.ok) {
              onDeleted(view.id, back.data.id);
              toast.success(t("restoredToast", { name: view.name }));
            } else {
              toast.error(back.error ?? t("deleteFailed"));
            }
          });
        },
      },
    });
  }

  const label = t("viewMenu", { name: view.name });
  const ScopeIcon = target === "personal" ? Lock : Users;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tip label={label}>
        <PopoverTrigger
          render={
            <button
              type="button"
              aria-label={label}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral-500 opacity-0 hover:bg-neutral-200 focus-visible:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 group-hover/view:opacity-100 data-[popup-open]:opacity-100 dark:hover:bg-neutral-700"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          }
        />
      </Tip>
      <PopoverContent className="w-60 p-1" sideOffset={4} role="menu" aria-label={label}>
        <Tip label={scopeReason ?? t("changeScope")}>
          <button
            type="button"
            role="menuitem"
            aria-disabled={scopeReason ? true : undefined}
            aria-label={target === "personal" ? t("makePersonal") : t("makeShared")}
            className={itemClass}
            onClick={() => {
              if (scopeReason) return;
              setOpen(false);
              void changeScope(target);
            }}
          >
            <ScopeIcon className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{target === "personal" ? t("makePersonal") : t("makeShared")}</span>
          </button>
        </Tip>
        <Tip label={deleteReason ?? t("deleteView")}>
          <button
            type="button"
            role="menuitem"
            aria-disabled={deleteReason ? true : undefined}
            aria-label={t("deleteView")}
            className={`${itemClass} text-red-600 dark:text-red-400`}
            onClick={() => {
              if (deleteReason) return;
              setOpen(false);
              void remove();
            }}
          >
            <Trash2 className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{t("deleteView")}</span>
          </button>
        </Tip>
      </PopoverContent>
    </Popover>
  );
}
