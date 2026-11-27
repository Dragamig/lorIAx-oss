"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LayoutDashboard, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Link, useRouter } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Hint } from "@/components/ui/hint";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmTemplateDialog } from "@/components/presentations/templates/confirm-template-dialog";
import { SpaceSwitcher } from "@/components/spaces/space-switcher";
import type { DashboardDef } from "@/lib/dashboards/types";
import { DashboardRenameField } from "./dashboard-rename-field";
import { dashboardRequest, jsonInit } from "./dashboard-request";

export function DashboardsListClient({
  spaceId,
  spaces,
  canEdit,
  initial,
}: {
  spaceId: string;
  spaces: { id: string; name: string }[];
  /** Droit d'éditeur sur l'espace, calculé côté serveur par le même juge que l'API. */
  canEdit: boolean;
  initial: DashboardDef[];
}) {
  const t = useTranslations("dashboards");
  const tt = useTranslations("presentations.templates");
  const router = useRouter();
  const [rows, setRows] = useState(initial);
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<DashboardDef | null>(null);

  async function create() {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const res = await dashboardRequest(
        "/api/dashboards",
        jsonInit("POST", { name: name.trim(), spaceId }),
        t,
        "create"
      );
      if (res) {
        const d = await res.json();
        router.push(`/dashboards/${d.id}?spaceId=${encodeURIComponent(spaceId)}`);
      }
    } finally {
      setCreating(false);
    }
  }

  async function rename(row: DashboardDef, next: string): Promise<boolean> {
    const res = await dashboardRequest(`/api/dashboards/${row.id}`, jsonInit("PATCH", { name: next }), t, "rename");
    if (!res) return false;
    setRows((current) =>
      current
        .map((r) => (r.id === row.id ? { ...r, name: next } : r))
        .sort((a, b) => a.name.localeCompare(b.name))
    );
    toast.success(t("renamed"));
    return true;
  }

  async function remove(row: DashboardDef): Promise<boolean> {
    const res = await dashboardRequest(`/api/dashboards/${row.id}`, { method: "DELETE" }, t, "delete");
    if (!res) return false;
    setRows((current) => current.filter((r) => r.id !== row.id));
    toast.success(t("deleted", { name: row.name }));
    return true;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <LayoutDashboard className="w-5 h-5" aria-hidden="true" />
          {t("title")}
        </h1>
        <SpaceSwitcher spaces={spaces} currentSpaceId={spaceId} basePath="/dashboards" label={t("spaceLabel")} />
      </div>
      {canEdit ? (
        <div className="flex gap-2 mb-6">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("newPlaceholder")}
            aria-label={t("newPlaceholder")}
            onKeyDown={(e) => e.key === "Enter" && create()}
          />
          <Hint label={t("newTip")}>
            <Button onClick={create} disabled={creating || !name.trim()} aria-label={t("newTip")}>
              <Plus aria-hidden="true" />
              {t("newButton")}
            </Button>
          </Hint>
        </div>
      ) : (
        <p className="mb-6 text-sm text-muted-foreground">{t("readOnly")}</p>
      )}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{canEdit ? t("empty") : t("emptyReadOnly")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rows.map((d) =>
            renamingId === d.id ? (
              <div key={d.id} className="border rounded-lg p-3">
                <DashboardRenameField
                  initialName={d.name}
                  onSave={(next) => rename(d, next)}
                  onCancel={() => setRenamingId(null)}
                />
              </div>
            ) : (
              <div
                key={d.id}
                className="relative border rounded-lg hover:bg-accent transition-colors flex items-start"
              >
                <Link
                  href={`/dashboards/${d.id}?spaceId=${encodeURIComponent(spaceId)}`}
                  className="flex-1 min-w-0 p-4"
                >
                  <div className="font-medium truncate">{d.name}</div>
                  {d.description && (
                    <div className="text-xs text-muted-foreground mt-1">{d.description}</div>
                  )}
                </Link>
                {canEdit ? (
                  <div className="p-2">
                    <DropdownMenu>
                      <Hint label={t("moreActions")} align="end">
                        <DropdownMenuTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t("moreActions")}
                            >
                              <MoreHorizontal aria-hidden="true" />
                            </Button>
                          }
                        />
                      </Hint>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setRenamingId(d.id)}>
                          <Pencil aria-hidden="true" />
                          <span>{t("rename")}</span>
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => setToDelete(d)}>
                          <Trash2 aria-hidden="true" />
                          <span>{t("delete")}</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                ) : null}
              </div>
            )
          )}
        </div>
      )}
      {toDelete ? (
        <ConfirmTemplateDialog
          title={t("delete")}
          body={t("deleteConfirm", { name: toDelete.name })}
          confirmLabel={t("delete")}
          confirmTip={t("delete")}
          confirmIcon={Trash2}
          destructive
          keepTip={tt("cancel")}
          onConfirm={() => remove(toDelete)}
          onClose={() => setToDelete(null)}
        />
      ) : null}
    </div>
  );
}
