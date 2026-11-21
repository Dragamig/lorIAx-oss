"use client";

import { useState, useEffect, useRef, memo, useMemo } from "react";
import { useRouter, Link, usePathname } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  FileText,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  GripVertical,
  Trash2,
  BookMarked,
  Tag,
} from "lucide-react";
import { toast } from "sonner";
import { useFavoritesContext } from "@/hooks/use-favorites";
import { FavoriteStar } from "@/components/ui/favorite-star";
import { SaveAsTemplateDialog } from "@/components/document/save-as-template-dialog";
import { LabelBadge } from "@/components/labels/label-badge";
import { LabelPicker } from "@/components/labels/label-picker";
import type { DocumentItem } from "./types";

// ─── Folder droppable (drop target only, no sorting) ─────────────────────────

const FolderNode = memo(function FolderNode({
  doc,
  spaceSlug,
  depth,
  onDeleted,
}: {
  doc: DocumentItem;
  spaceSlug: string;
  depth: number;
  onDeleted?: () => void;
}) {
  const t = useTranslations("shell.sidebar");
  const [expanded, setExpanded] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  const { setNodeRef, isOver } = useDroppable({
    id: doc.id,
    data: { type: "folder", folderId: doc.id },
  });

  useEffect(() => {
    if (!contextMenu) return;
    function handleClickOutside(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [contextMenu]);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }

  async function handleDelete() {
    setContextMenu(null);
    if (!window.confirm(t("document.confirmDeleteFolder"))) return;
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(t("toasts.folderDeleted"));
        onDeleted?.();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t("toasts.deleteError"));
      }
    } catch {
      toast.error(t("toasts.networkError"));
    }
  }

  return (
    <li
      ref={setNodeRef}
      className={isOver ? "bg-primary/10 ring-2 ring-primary/30 rounded-md" : undefined}
    >
      <div
        className="w-full flex items-center gap-1 pr-2 py-1.5 rounded-md text-sm hover:bg-sidebar-accent transition-colors group"
        style={{ paddingLeft: `${8 + depth * 8}px` }}
        onContextMenu={handleContextMenu}
      >
        {/* Spacer to align with document grip */}
        <span className="w-3 flex-shrink-0" />
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 flex-1 min-w-0"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          )}
          {doc.icon ? (
            <span className="text-base leading-none flex-shrink-0">{doc.icon}</span>
          ) : (
            <FolderOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          )}
          <span className="truncate">{doc.title}</span>
        </button>
      </div>
      {expanded && doc.children && doc.children.length > 0 && (
        <SortableDocumentTree
          documents={doc.children}
          spaceSlug={spaceSlug}
          depth={depth + 1}
          onDeleted={onDeleted}
        />
      )}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-[100] w-44 bg-popover border border-border rounded-lg shadow-lg p-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={handleDelete}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4 shrink-0" />
            {t("document.deleteAction")}
          </button>
        </div>
      )}
    </li>
  );
});

// ─── Sortable document node (draggable + reorderable) ────────────────────────

const SortableDocumentNode = memo(function SortableDocumentNode({
  doc: initialDoc,
  spaceSlug,
  depth,
  pathname,
  onDeleted,
}: {
  doc: DocumentItem;
  spaceSlug: string;
  depth: number;
  pathname: string;
  onDeleted?: () => void;
}) {
  const t = useTranslations("shell.sidebar");
  const [doc, setDoc] = useState<DocumentItem>(initialDoc);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const [saveAsTemplateOpen, setSaveAsTemplateOpen] = useState(false);
  const [documentContent, setDocumentContent] = useState("");
  const [documentSpaceId, setDocumentSpaceId] = useState("");
  const [isFetchingContent, setIsFetchingContent] = useState(false);
  const [labelPickerOpen, setLabelPickerOpen] = useState(false);
  const router = useRouter();
  const { isFavorite, toggleFavorite } = useFavoritesContext();
  const href = `/s/${spaceSlug}/${doc.id}`;
  const isActive = pathname === href;

  // Sync doc when prop changes (e.g. tree reload)
  useEffect(() => {
    setDoc(initialDoc);
  }, [initialDoc]);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: doc.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  useEffect(() => {
    if (!contextMenu) return;
    function handleClickOutside(e: MouseEvent) {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [contextMenu]);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }

  async function handleDelete() {
    setContextMenu(null);
    if (!window.confirm(t("document.confirmDeleteDocument"))) return;
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(t("toasts.documentDeleted"));
        if (isActive) {
          router.push(`/s/${spaceSlug}`);
        }
        onDeleted?.();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t("toasts.deleteError"));
      }
    } catch {
      toast.error(t("toasts.networkError"));
    }
  }

  async function handleSaveAsTemplate() {
    setContextMenu(null);
    setIsFetchingContent(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}`);
      if (!res.ok) {
        toast.error(t("toasts.documentContentError"));
        return;
      }
      const data = await res.json();
      setDocumentContent(data.content ?? "");
      setDocumentSpaceId(data.spaceId ?? "");
      setSaveAsTemplateOpen(true);
    } catch {
      toast.error(t("toasts.networkError"));
    } finally {
      setIsFetchingContent(false);
    }
  }

  function handleOpenLabelPicker() {
    setContextMenu(null);
    setLabelPickerOpen(true);
  }

  function handleLabelsChange(newLabelIds: string[]) {
    // Optimistic local update of displayed labels
    const existingLabels = doc.labels ?? [];
    const updatedLabels = newLabelIds.map((id) => {
      const found = existingLabels.find((l) => l.id === id);
      return found ?? { id, name: "…", color: "#6b7280" };
    });
    setDoc((prev) => ({ ...prev, labels: updatedLabels }));
  }

  const visibleLabels = (doc.labels ?? []).slice(0, 3);
  const extraLabels = (doc.labels ?? []).length - 3;

  return (
    <li ref={setNodeRef} style={style}>
      <div
        className={`flex items-center gap-1 pr-2 py-1.5 rounded-md text-sm transition-colors group cursor-grab active:cursor-grabbing ${
          isActive
            ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
            : "hover:bg-sidebar-accent text-sidebar-foreground"
        }`}
        style={{ paddingLeft: `${8 + depth * 8}px` }}
        onContextMenu={handleContextMenu}
        {...attributes}
        {...listeners}
      >
        <span className="opacity-0 group-hover:opacity-50 transition-opacity">
          <GripVertical className="h-3 w-3" />
        </span>
        <div className="flex flex-col flex-1 min-w-0">
          <Link
            href={href}
            className="flex items-center gap-2 min-w-0"
            onClick={(e) => { if (isDragging) e.preventDefault(); }}
          >
            {/* Spacer to align with folder chevron */}
            <span className="w-3.5 flex-shrink-0" />
            {doc.icon ? (
              <span className="text-base leading-none flex-shrink-0">{doc.icon}</span>
            ) : (
              <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
            )}
            <span className="truncate">{doc.title}</span>
          </Link>
          {visibleLabels.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-0.5 pl-[calc(0.875rem+0.5rem+1rem)]">
              {visibleLabels.map((label) => (
                <LabelBadge key={label.id} label={label} size="sm" />
              ))}
              {extraLabels > 0 && (
                <span className="text-xs text-muted-foreground">+{extraLabels}</span>
              )}
            </div>
          )}
        </div>
        <FavoriteStar
          entityType="document"
          entityId={doc.id}
          isFavorite={isFavorite("document", doc.id)}
          onToggle={() => toggleFavorite("document", doc.id)}
          size={14}
        />
      </div>
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-[100] w-52 bg-popover border border-border rounded-lg shadow-lg p-1"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={handleOpenLabelPicker}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm transition-colors hover:bg-accent"
          >
            <Tag className="h-4 w-4 shrink-0" />
            {t("document.labelsAction")}
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            onClick={handleSaveAsTemplate}
            disabled={isFetchingContent}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm transition-colors hover:bg-accent disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <BookMarked className="h-4 w-4 shrink-0" />
            {isFetchingContent ? t("document.loading") : t("document.saveAsTemplate")}
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            onClick={handleDelete}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
          >
            <Trash2 className="h-4 w-4 shrink-0" />
            {t("document.deleteAction")}
          </button>
        </div>
      )}
      {/* LabelPicker triggered from context menu */}
      {labelPickerOpen && (
        <div className="px-3 pb-1">
          <LabelPicker
            documentId={doc.id}
            spaceSlug={spaceSlug}
            currentLabelIds={doc.labels?.map((l) => l.id) ?? []}
            onLabelsChange={handleLabelsChange}
            defaultOpen
            onClose={() => setLabelPickerOpen(false)}
          />
        </div>
      )}
      <SaveAsTemplateDialog
        open={saveAsTemplateOpen}
        onOpenChange={setSaveAsTemplateOpen}
        documentTitle={doc.title}
        documentContent={documentContent}
        spaceId={documentSpaceId}
      />
    </li>
  );
});

// ─── Document tree ────────────────────────────────────────────────────────────

export function SortableDocumentTree({
  documents,
  spaceSlug,
  depth = 0,
  onDeleted,
}: {
  documents: DocumentItem[];
  spaceSlug: string;
  depth?: number;
  onDeleted?: () => void;
}) {
  const pathname = usePathname();
  const folders = documents.filter((d) => d.isFolder);
  const docs = documents.filter((d) => !d.isFolder);

  return (
    <ul className="space-y-0.5">
      {/* Folders: droppable only, outside SortableContext */}
      {folders.map((folder) => (
        <FolderNode
          key={folder.id}
          doc={folder}
          spaceSlug={spaceSlug}
          depth={depth}
          onDeleted={onDeleted}
        />
      ))}
      {/* Documents: sortable (reorder + draggable) */}
      <SortableContext
        items={useMemo(() => docs.map((d) => d.id), [docs])}
        strategy={verticalListSortingStrategy}
      >
        {docs.map((doc) => (
          <SortableDocumentNode
            key={doc.id}
            doc={doc}
            spaceSlug={spaceSlug}
            depth={depth}
            pathname={pathname}
            onDeleted={onDeleted}
          />
        ))}
      </SortableContext>
    </ul>
  );
}
