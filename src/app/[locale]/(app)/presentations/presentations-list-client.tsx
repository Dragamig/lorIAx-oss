"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowRight,
  BookmarkPlus,
  Loader2,
  MoreHorizontal,
  Plus,
  Presentation,
  Trash2,
} from "lucide-react";
import { Link, useRouter } from "@/i18n/routing";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ui/hint";
import { ConfirmTemplateDialog } from "@/components/presentations/templates/confirm-template-dialog";
import { TemplatesExperience } from "@/components/presentations/templates/templates-experience";
import { SpaceSwitcher } from "@/components/spaces/space-switcher";

interface PresentationRow {
  id: string;
  title: string;
  slideCount: number;
  updatedAt: string;
}

export function PresentationsListClient({
  spaceId,
  spaces = [],
  isAdmin,
  canDelete = true,
}: {
  spaceId: string;
  /** Espaces accessibles, pour le sélecteur d'espace (ordre alphabétique). */
  spaces?: { id: string; name: string }[];
  isAdmin: boolean;
  /** Droit d'éditeur sur l'espace : sans lui la corbeille est masquée et la création désactivée (l'API refuserait). */
  canDelete?: boolean;
}) {
  const t = useTranslations("presentations");
  const tt = useTranslations("presentations.templates");
  const locale = useLocale();
  const router = useRouter();

  const [rows, setRows] = useState<PresentationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [toDelete, setToDelete] = useState<PresentationRow | null>(null);
  const [toSave, setToSave] = useState<PresentationRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const formatDate = useCallback(
    (value: string) =>
      new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
        new Date(value),
      ),
    [locale],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/presentations?spaceId=${encodeURIComponent(spaceId)}`)
      .then((res) => {
        if (!res.ok) throw new Error("load failed");
        return res.json();
      })
      .then((data: unknown) => {
        if (cancelled) return;
        setRows(Array.isArray(data) ? (data as PresentationRow[]) : []);
        setError(null);
      })
      .catch(() => {
        if (!cancelled) setError(t("loadError"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [spaceId, t]);

  async function create() {
    if (creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/presentations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId }),
      });
      if (!res.ok) throw new Error("create failed");
      const created: PresentationRow = await res.json();
      setError(null);
      router.push(`/presentations/${created.id}`);
    } catch {
      setError(t("createError"));
      setCreating(false);
    }
  }

  async function remove(row: PresentationRow): Promise<boolean> {
    try {
      const res = await fetch(`/api/presentations/${row.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("delete failed");
      setRows((current) => current.filter((r) => r.id !== row.id));
      setError(null);
      toast.success(t("deleted", { title: row.title }));
      return true;
    } catch {
      toast.error(t("deleteError"));
      return false;
    }
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <Presentation className="w-6 h-6" />
          {t("title")}
        </h1>
        <div className="flex items-center gap-2">
          {spaces.length > 0 ? (
            <SpaceSwitcher
              spaces={spaces}
              currentSpaceId={spaceId}
              basePath="/presentations"
              label={t("spaceLabel")}
            />
          ) : null}
          <Hint
            label={canDelete ? t("newButton") : t("readOnlyCreate")}
            disabled={creating || !canDelete}
          >
            <Button
              onClick={() => setGalleryOpen(true)}
              disabled={creating || !canDelete}
              aria-label={t("newButton")}
              data-tour="presentations-create"
            >
              {creating ? (
                <Loader2
                  className="w-4 h-4 animate-spin mr-2"
                  aria-hidden="true"
                />
              ) : (
                <Plus className="w-4 h-4 mr-2" aria-hidden="true" />
              )}
              {t("newButton")}
            </Button>
          </Hint>
        </div>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-destructive/10 border border-destructive/30 rounded-lg text-destructive text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center p-12">
          <Loader2 className="w-8 h-8 animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-12 gap-4 text-muted-foreground">
          <Presentation className="w-12 h-12" />
          <p>{t("empty")}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {rows.map((row) => (
            <div
              key={row.id}
              className="border border-border rounded-lg p-4 flex flex-col gap-3 hover:border-primary transition-colors bg-card"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-1 flex-1 min-w-0">
                  <h2 className="font-medium truncate">{row.title}</h2>
                  <p className="text-sm text-muted-foreground">
                    {t("slideCount", { count: row.slideCount })}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t("updatedAt", { date: formatDate(row.updatedAt) })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {isAdmin ? (
                    <DropdownMenu>
                      <Hint label={tt("moreActionsTip")}>
                        <DropdownMenuTrigger
                          render={
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              className="min-h-6 min-w-6"
                              aria-label={tt("moreActions")}
                            >
                              <MoreHorizontal aria-hidden="true" />
                            </Button>
                          }
                        />
                      </Hint>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => setToSave(row)}>
                          <BookmarkPlus aria-hidden="true" />
                          <span>{tt("saveAsTemplate")}</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                  {canDelete ? (
                    <Hint label={t("delete")} align="end">
                      <button
                        type="button"
                        onClick={() => setToDelete(row)}
                        className="text-muted-foreground hover:text-destructive transition-colors p-1 rounded"
                        aria-label={t("delete")}
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </button>
                    </Hint>
                  ) : null}
                </div>
              </div>
              {/* nativeButton={false} : le rendu est un lien, pas un bouton, et
                  Base UI refuse d'annoncer des sémantiques de bouton natif sur
                  un élément qui n'en est pas un. */}
              <Hint label={t("open")} className="w-full">
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  nativeButton={false}
                  aria-label={t("open")}
                  render={
                    <Link href={`/presentations/${row.id}`}>
                      <ArrowRight className="w-4 h-4 mr-2" aria-hidden="true" />
                      {t("open")}
                    </Link>
                  }
                />
              </Hint>
            </div>
          ))}
        </div>
      )}

      {toDelete ? (
        <ConfirmTemplateDialog
          title={t("delete")}
          body={t("deleteConfirm", { title: toDelete.title })}
          confirmLabel={t("delete")}
          confirmTip={t("delete")}
          confirmIcon={Trash2}
          destructive
          keepTip={tt("cancel")}
          onConfirm={() => remove(toDelete)}
          onClose={() => setToDelete(null)}
        />
      ) : null}
      <TemplatesExperience
        spaceId={spaceId}
        isAdmin={isAdmin}
        presentations={rows.map(({ id, title, slideCount }) => ({
          id,
          title,
          slideCount,
        }))}
        galleryOpen={galleryOpen}
        onGalleryOpenChange={setGalleryOpen}
        onCreateBlank={create}
        saveTarget={
          toSave
            ? {
                id: toSave.id,
                title: toSave.title,
                slideCount: toSave.slideCount,
              }
            : null
        }
        onSaveTargetClose={() => setToSave(null)}
      />
    </div>
  );
}
