"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { FolderOpen, ChevronRight, ChevronDown, X, Copy, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Space {
  id: string;
  name: string;
  slug: string;
}

interface FolderNode {
  id: string;
  title: string;
  children?: FolderNode[];
}

export interface DocumentMoveDialogProps {
  documentId: string;
  documentTitle: string;
  currentSpaceSlug: string;
  open: boolean;
  onClose: () => void;
  onMoved: () => void;
  mode: "move" | "copy";
}

// ---------------------------------------------------------------------------
// FolderRow — composant récursif pour afficher l'arbre de dossiers
// ---------------------------------------------------------------------------

interface FolderRowProps {
  folder: FolderNode;
  depth: number;
  selected: string | null;
  onSelect: (id: string) => void;
}

function FolderRow({ folder, depth, selected, onSelect }: FolderRowProps) {
  const t = useTranslations("document");
  const [expanded, setExpanded] = useState(false);
  const hasChildren = folder.children && folder.children.length > 0;
  const isSelected = selected === folder.id;

  return (
    <div>
      <button
        type="button"
        onClick={() => onSelect(folder.id)}
        className={cn(
          "flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors text-left",
          isSelected
            ? "bg-primary/10 text-primary font-medium"
            : "hover:bg-muted text-foreground"
        )}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setExpanded((v) => !v);
            }}
            className="shrink-0 rounded p-0.5 hover:bg-muted-foreground/20"
            aria-label={expanded ? t("moveDialog.collapseAria") : t("moveDialog.expandAria")}
          >
            {expanded ? (
              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
            )}
          </button>
        ) : (
          <span className="h-5 w-5 shrink-0" />
        )}
        <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate">{folder.title}</span>
      </button>

      {hasChildren && expanded && (
        <div>
          {folder.children!.map((child) => (
            <FolderRow
              key={child.id}
              folder={child}
              depth={depth + 1}
              selected={selected}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DocumentMoveDialog — composant principal
// ---------------------------------------------------------------------------

export function DocumentMoveDialog({
  documentId,
  documentTitle,
  currentSpaceSlug,
  open,
  onClose,
  onMoved,
  mode,
}: DocumentMoveDialogProps) {
  const t = useTranslations("document");
  const [activeTab, setActiveTab] = useState<"folder" | "space">("folder");

  // Données chargées
  const [folders, setFolders] = useState<FolderNode[]>([]);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [loadingFolders, setLoadingFolders] = useState(false);
  const [loadingSpaces, setLoadingSpaces] = useState(false);

  // Sélections
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [selectedSpaceSlug, setSelectedSpaceSlug] = useState<string | null>(null);

  // Action en cours
  const [submitting, setSubmitting] = useState(false);

  // -------------------------------------------------------------------------
  // Chargement des dossiers de l'espace courant
  // -------------------------------------------------------------------------
  const loadFolders = useCallback(async () => {
    setLoadingFolders(true);
    try {
      const res = await fetch(`/api/spaces/${currentSpaceSlug}/documents`);
      if (!res.ok) throw new Error("load-folders");
      const data = await res.json();

      // On extrait uniquement les entrées qui ont des enfants (dossiers)
      function extractFolders(docs: FolderNode[]): FolderNode[] {
        return docs
          .filter((d) => d.children && d.children.length > 0)
          .map((d) => ({
            ...d,
            children: extractFolders(d.children ?? []),
          }));
      }

      setFolders(extractFolders(Array.isArray(data) ? data : data.documents ?? []));
    } catch {
      toast.error(t("moveDialog.toasts.loadFoldersError"));
    } finally {
      setLoadingFolders(false);
    }
  }, [currentSpaceSlug, t]);

  // -------------------------------------------------------------------------
  // Chargement de la liste des espaces
  // -------------------------------------------------------------------------
  const loadSpaces = useCallback(async () => {
    setLoadingSpaces(true);
    try {
      const res = await fetch("/api/spaces");
      if (!res.ok) throw new Error("load-spaces");
      const data = await res.json();
      const allSpaces: Space[] = Array.isArray(data) ? data : data.spaces ?? [];

      // Pour le déplacement, exclure l'espace courant
      const filtered =
        mode === "move"
          ? allSpaces.filter((s) => s.slug !== currentSpaceSlug)
          : allSpaces;

      setSpaces(filtered);
    } catch {
      toast.error(t("moveDialog.toasts.loadSpacesError"));
    } finally {
      setLoadingSpaces(false);
    }
  }, [currentSpaceSlug, mode, t]);

  // -------------------------------------------------------------------------
  // Effets
  // -------------------------------------------------------------------------
  useEffect(() => {
    if (!open) return;

    // Réinitialiser les sélections à l'ouverture
    setSelectedFolderId(null);
    setSelectedSpaceSlug(null);
    setActiveTab(mode === "copy" ? "space" : "folder");

    if (mode === "move") {
      loadFolders();
    }
    loadSpaces();
  }, [open, mode, loadFolders, loadSpaces]);

  // -------------------------------------------------------------------------
  // Soumission
  // -------------------------------------------------------------------------
  async function handleSubmit() {
    setSubmitting(true);
    try {
      if (mode === "copy") {
        if (!selectedSpaceSlug) {
          toast.error(t("moveDialog.toasts.selectDestination"));
          return;
        }
        const res = await fetch(`/api/documents/${documentId}/copy`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetSpaceSlug: selectedSpaceSlug }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? t("moveDialog.toasts.copyError"));
        }
        toast.success(t("moveDialog.toasts.copied"));
      } else if (activeTab === "folder") {
        // Déplacement vers un dossier (null = racine de l'espace)
        const res = await fetch(`/api/documents/${documentId}/move`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ parentId: selectedFolderId }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? t("moveDialog.toasts.moveError"));
        }
        toast.success(
          selectedFolderId
            ? t("moveDialog.toasts.movedToFolder")
            : t("moveDialog.toasts.movedToRoot")
        );
      } else {
        // Déplacement vers un autre espace
        if (!selectedSpaceSlug) {
          toast.error(t("moveDialog.toasts.selectDestination"));
          return;
        }
        const res = await fetch(`/api/documents/${documentId}/move`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ targetSpaceSlug: selectedSpaceSlug }),
        });
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          throw new Error(err.error ?? t("moveDialog.toasts.moveError"));
        }
        toast.success(t("moveDialog.toasts.movedToSpace"));
      }

      onMoved();
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : t("moveDialog.toasts.unknownError")
      );
    } finally {
      setSubmitting(false);
    }
  }

  // -------------------------------------------------------------------------
  // Libellés selon le mode
  // -------------------------------------------------------------------------
  const dialogTitle =
    mode === "copy" ? t("moveDialog.copyTitle") : t("moveDialog.moveTitle");
  const submitLabel =
    mode === "copy"
      ? t("moveDialog.copy")
      : activeTab === "folder"
      ? t("moveDialog.moveHere")
      : t("moveDialog.moveToSpace");

  const canSubmit =
    !submitting &&
    (mode === "copy"
      ? !!selectedSpaceSlug
      : activeTab === "folder"
      ? true // root = always valid without selection
      : !!selectedSpaceSlug);

  // -------------------------------------------------------------------------
  // Rendu
  // -------------------------------------------------------------------------
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-md rounded-xl border bg-popover shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            {mode === "copy" && <Copy className="h-4 w-4 text-muted-foreground" />}
            <div>
              <h2 className="text-sm font-medium">{dialogTitle}</h2>
              <p className="text-xs text-muted-foreground truncate max-w-[280px]">
                {documentTitle}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            aria-label={t("moveDialog.closeAria")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs (move mode only) */}
        {mode === "move" && (
          <div className="flex border-b px-4">
            {(["folder", "space"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  "mr-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
                  activeTab === tab
                    ? "border-primary text-primary"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {tab === "folder"
                  ? t("moveDialog.folderTab")
                  : t("moveDialog.spaceTab")}
              </button>
            ))}
          </div>
        )}

        {/* Contenu */}
        <div className="max-h-72 overflow-y-auto p-2">
          {/* Onglet Dossier */}
          {mode === "move" && activeTab === "folder" && (
            <>
              {loadingFolders ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  <span className="text-sm">{t("moveDialog.loadingFolders")}</span>
                </div>
              ) : (
                <div>
                  {/* Option racine */}
                  <button
                    type="button"
                    onClick={() => setSelectedFolderId(null)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors text-left",
                      selectedFolderId === null
                        ? "bg-primary/10 text-primary font-medium"
                        : "hover:bg-muted text-foreground"
                    )}
                  >
                    <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span>{t("moveDialog.rootSpace")}</span>
                  </button>

                  {folders.length === 0 && (
                    <p className="px-2 py-3 text-sm text-muted-foreground">
                      {t("moveDialog.noFolders")}
                    </p>
                  )}

                  {folders.map((folder) => (
                    <FolderRow
                      key={folder.id}
                      folder={folder}
                      depth={0}
                      selected={selectedFolderId}
                      onSelect={setSelectedFolderId}
                    />
                  ))}
                </div>
              )}
            </>
          )}

          {/* Onglet Espace (mode move) ou vue unique (mode copy) */}
          {(mode === "copy" || activeTab === "space") && (
            <>
              {loadingSpaces ? (
                <div className="flex items-center justify-center py-8 text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  <span className="text-sm">{t("moveDialog.loadingSpaces")}</span>
                </div>
              ) : spaces.length === 0 ? (
                <p className="px-2 py-8 text-center text-sm text-muted-foreground">
                  {mode === "move"
                    ? t("moveDialog.noOtherSpaces")
                    : t("moveDialog.noSpaces")}
                </p>
              ) : (
                <div>
                  {spaces.map((space) => (
                    <button
                      key={space.id}
                      type="button"
                      onClick={() => setSelectedSpaceSlug(space.slug)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors text-left",
                        selectedSpaceSlug === space.slug
                          ? "bg-primary/10 text-primary font-medium"
                          : "hover:bg-muted text-foreground"
                      )}
                    >
                      <span className="truncate">{space.name}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Pied de page */}
        <div className="-mx-0 rounded-b-xl border-t bg-muted/50 flex items-center justify-end gap-2 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
          >
            {t("moveDialog.cancel")}
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
