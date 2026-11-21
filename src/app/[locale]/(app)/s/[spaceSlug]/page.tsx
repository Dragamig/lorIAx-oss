"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useParams } from "next/navigation";
import { useTranslations, useFormatter } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import { emitSidebarRefresh } from "@/lib/events/sidebar-sync";
import {
  FileText,
  FolderOpen,
  Plus,
  Settings,
  User,
  Users,
  Building2,
  Clock,
  MoreHorizontal,
  Trash2,
  Pencil,
  FolderInput,
  FolderPlus,
  Check,
  X,
  ChevronRight,
  ArrowLeft,
  GripVertical,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { toast } from "sonner";

interface SpaceData {
  id: string;
  name: string;
  slug: string;
  type: "personal" | "team" | "organization";
  description: string | null;
  createdAt: string;
}

interface DocumentItem {
  id: string;
  title: string;
  slug: string;
  isFolder: boolean;
  parentId?: string | null;
  updatedAt?: string;
  children?: DocumentItem[];
}

interface SpaceOption {
  id: string;
  name: string;
  slug: string;
}

function SpaceIcon({ type }: { type: SpaceData["type"] }) {
  const cls = "h-6 w-6 text-primary";
  switch (type) {
    case "personal":
      return <User className={cls} />;
    case "team":
      return <Users className={cls} />;
    case "organization":
      return <Building2 className={cls} />;
  }
}


// ---------------------------------------------------------------------------
// Document action menu
// ---------------------------------------------------------------------------

function DocActionMenu({
  doc,
  spaceSlug,
  allSpaces,
  onDeleted,
  onRenamed,
}: {
  doc: DocumentItem;
  spaceSlug: string;
  allSpaces: SpaceOption[];
  onDeleted: () => void;
  onRenamed: (id: string, newTitle: string) => void;
}) {
  const t = useTranslations("space");
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(doc.title);
  const [moving, setMoving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
        setConfirmDelete(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  async function handleDelete() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/documents/${doc.id}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(t("toasts.documentDeleted"));
        onDeleted();
        emitSidebarRefresh();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t("toasts.deleteError"));
      }
    } catch {
      toast.error(t("toasts.networkError"));
    }
    setDeleting(false);
    setOpen(false);
    setConfirmDelete(false);
  }

  async function handleRename() {
    if (!renameValue.trim() || renameValue === doc.title) {
      setRenaming(false);
      return;
    }
    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: renameValue.trim() }),
      });
      if (res.ok) {
        onRenamed(doc.id, renameValue.trim());
        toast.success(t("toasts.documentRenamed"));
        emitSidebarRefresh();
      } else {
        toast.error(t("toasts.renameError"));
      }
    } catch {
      toast.error(t("toasts.networkError"));
    }
    setRenaming(false);
    setOpen(false);
  }

  async function handleMove(targetSlug: string) {
    try {
      const res = await fetch(`/api/documents/${doc.id}/move`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetSpaceSlug: targetSlug }),
      });
      if (res.ok) {
        toast.success(t("toasts.documentMoved"));
        onDeleted(); // Reload list
        emitSidebarRefresh();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t("toasts.moveError"));
      }
    } catch {
      toast.error(t("toasts.networkError"));
    }
    setMoving(false);
    setOpen(false);
  }

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(!open);
          setConfirmDelete(false);
          setRenaming(false);
          setMoving(false);
        }}
        className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover:opacity-100"
        title={t("docActions.actionsAria")}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 w-56 bg-popover border border-border rounded-lg shadow-lg p-1"
          onClick={(e) => e.preventDefault()}
        >
          {/* Renommer */}
          {renaming ? (
            <div className="px-2 py-1.5">
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  // Empêche dnd-kit (KeyboardSensor) de capturer Espace/Entrée
                  // comme touche d'activation du drag pendant la saisie.
                  e.stopPropagation();
                  if (e.key === "Enter") handleRename();
                  if (e.key === "Escape") { setRenaming(false); setRenameValue(doc.title); }
                }}
                autoFocus
                className="w-full text-sm px-2 py-1 rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <div className="flex gap-1 mt-1">
                <button
                  onClick={() => handleRename()}
                  className="flex-1 text-xs px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  {t("docActions.validate")}
                </button>
                <button
                  onClick={() => { setRenaming(false); setRenameValue(doc.title); }}
                  className="flex-1 text-xs px-2 py-1 rounded border border-border hover:bg-muted"
                >
                  {t("docActions.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setRenaming(true)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm transition-colors hover:bg-muted"
            >
              <Pencil className="h-4 w-4 shrink-0 text-muted-foreground" />
              {t("docActions.rename")}
            </button>
          )}

          {/* Move dialog trigger */}
          {moving ? (
            <div className="px-2 py-1.5 max-h-40 overflow-y-auto">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 px-1">
                {t("docActions.moveTo")}
              </p>
              {allSpaces
                .filter((s) => s.slug !== spaceSlug)
                .map((s) => (
                  <button
                    key={s.id}
                    onClick={() => handleMove(s.slug)}
                    className="w-full text-left text-xs px-2 py-1.5 rounded hover:bg-muted transition-colors truncate"
                  >
                    {s.name}
                  </button>
                ))}
            </div>
          ) : (
            <button
              onClick={() => setMoving(true)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm transition-colors hover:bg-muted"
            >
              <FolderInput className="h-4 w-4 shrink-0 text-muted-foreground" />
              {t("docActions.move")}
            </button>
          )}

          <div className="border-t border-border my-1" />

          {/* Supprimer */}
          {confirmDelete ? (
            <div className="px-2 py-1.5">
              <p className="text-xs text-destructive mb-2">
                {t("docActions.confirmDelete", { title: doc.title })}
              </p>
              <div className="flex gap-1">
                <button
                  onClick={() => handleDelete()}
                  disabled={deleting}
                  className="flex-1 text-xs px-2 py-1 rounded bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
                >
                  {deleting ? t("docActions.deleting") : t("docActions.confirm")}
                </button>
                <button
                  onClick={() => setConfirmDelete(false)}
                  className="flex-1 text-xs px-2 py-1 rounded border border-border hover:bg-muted"
                >
                  {t("docActions.cancel")}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setConfirmDelete(true)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4 shrink-0" />
              {t("docActions.delete")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Droppable folder row (cible de dépôt, pas de tri magnétique)
// ---------------------------------------------------------------------------

function DroppableFolderRow({
  doc,
  spaceSlug,
  allSpaces,
  onDeleted,
  onRenamed,
  onEnterFolder,
}: {
  doc: DocumentItem;
  spaceSlug: string;
  allSpaces: SpaceOption[];
  onDeleted: () => void;
  onRenamed: (id: string, newTitle: string) => void;
  onEnterFolder: (folder: DocumentItem) => void;
}) {
  const t = useTranslations("space");
  const { setNodeRef, isOver } = useDroppable({
    id: doc.id,
    data: { type: "folder", folderId: doc.id },
  });

  return (
    <div
      ref={setNodeRef}
      className={`group flex items-center gap-3 px-4 py-3 rounded-lg border transition-all ${
        isOver
          ? "bg-primary/10 border-primary/30 ring-2 ring-primary/30"
          : "border-transparent hover:bg-secondary/50 hover:border-border"
      }`}
    >
      <button
        onClick={() => onEnterFolder(doc)}
        className="flex items-center gap-3 flex-1 min-w-0 text-left"
      >
        <FolderOpen className="h-5 w-5 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{doc.title}</p>
        </div>
        {doc.children !== undefined && (
          <span className="text-xs text-muted-foreground">
            {t("docList.folderItems", { count: doc.children.length })}
          </span>
        )}
        <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>
      <DocActionMenu
        doc={doc}
        spaceSlug={spaceSlug}
        allSpaces={allSpaces}
        onDeleted={onDeleted}
        onRenamed={onRenamed}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable document row (draggable + réordonnable)
// ---------------------------------------------------------------------------

function SortableDocRow({
  doc,
  spaceSlug,
  allSpaces,
  onDeleted,
  onRenamed,
}: {
  doc: DocumentItem;
  spaceSlug: string;
  allSpaces: SpaceOption[];
  onDeleted: () => void;
  onRenamed: (id: string, newTitle: string) => void;
}) {
  const format = useFormatter();
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
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative flex items-center gap-3 px-4 py-3 rounded-lg border border-transparent hover:bg-secondary/50 hover:border-border transition-all cursor-grab active:cursor-grabbing"
      {...attributes}
      {...listeners}
    >
      <span className="pointer-events-none absolute left-0.5 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-40 transition-opacity">
        <GripVertical className="h-4 w-3 text-muted-foreground" />
      </span>
      <Link
        href={`/s/${spaceSlug}/${doc.id}`}
        className="flex items-center gap-3 flex-1 min-w-0"
        onClick={(e) => { if (isDragging) e.preventDefault(); }}
      >
        <FileText className="h-5 w-5 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{doc.title}</p>
        </div>
        {doc.updatedAt && (
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {format.dateTime(new Date(doc.updatedAt), { dateStyle: "short" })}
          </span>
        )}
      </Link>
      <DocActionMenu
        doc={doc}
        spaceSlug={spaceSlug}
        allSpaces={allSpaces}
        onDeleted={onDeleted}
        onRenamed={onRenamed}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Space Page
// ---------------------------------------------------------------------------

export default function SpacePage() {
  const t = useTranslations("space");
  const params = useParams<{ spaceSlug: string }>();
  const router = useRouter();
  const [space, setSpace] = useState<SpaceData | null>(null);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [allSpaces, setAllSpaces] = useState<SpaceOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeDrag, setActiveDrag] = useState<DocumentItem | null>(null);

  // Folder navigation
  const [currentFolder, setCurrentFolder] = useState<DocumentItem | null>(null);
  const [folderStack, setFolderStack] = useState<DocumentItem[]>([]);

  // New folder creation
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [savingFolder, setSavingFolder] = useState(false);
  const newFolderInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const abortRef = useRef<AbortController | null>(null);

  const loadData = useCallback(() => {
    const slug = params.spaceSlug;
    if (!slug) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    Promise.all([
      fetch(`/api/spaces/${slug}`, { signal: controller.signal }).then((r) => r.json()),
      fetch(`/api/spaces/${slug}/documents`, { signal: controller.signal }).then((r) => r.json()),
      fetch("/api/spaces", { signal: controller.signal }).then((r) => r.json()),
    ])
      .then(([spaceData, docs, spaces]) => {
        if (controller.signal.aborted) return;
        if (spaceData?.id) setSpace(spaceData);
        if (Array.isArray(docs)) setDocuments(docs);
        if (Array.isArray(spaces)) setAllSpaces(spaces);
      })
      .catch(() => {})
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
  }, [params.spaceSlug]);

  useEffect(() => {
    loadData();
    return () => abortRef.current?.abort();
  }, [loadData]);

  // Focus the new folder input when it appears
  useEffect(() => {
    if (creatingFolder) {
      setTimeout(() => newFolderInputRef.current?.focus(), 50);
    }
  }, [creatingFolder]);

  function handleRenamed(id: string, newTitle: string) {
    setDocuments((prev) =>
      prev.map((d) => (d.id === id ? { ...d, title: newTitle } : d))
    );
  }

  // ---------------------------------------------------------------------------
  // Folder navigation helpers
  // ---------------------------------------------------------------------------

  function enterFolder(folder: DocumentItem) {
    setFolderStack((prev) => (currentFolder ? [...prev, currentFolder] : prev));
    setCurrentFolder(folder);
    setCreatingFolder(false);
    setNewFolderName("");
  }

  function goBack() {
    if (folderStack.length === 0) {
      setCurrentFolder(null);
    } else {
      const stack = [...folderStack];
      const parent = stack.pop()!;
      setFolderStack(stack);
      setCurrentFolder(parent);
    }
    setCreatingFolder(false);
    setNewFolderName("");
  }

  function goToRoot() {
    setCurrentFolder(null);
    setFolderStack([]);
    setCreatingFolder(false);
    setNewFolderName("");
  }

  function goToStackItem(index: number) {
    // index refers to folderStack position; -1 means root
    if (index === -1) {
      goToRoot();
      return;
    }
    const target = folderStack[index];
    setFolderStack((prev) => prev.slice(0, index));
    setCurrentFolder(target);
    setCreatingFolder(false);
    setNewFolderName("");
  }

  // Compute visible documents: children of currentFolder, or root-level docs.
  // Mémoïsé pour stabiliser les useCallback qui en dépendent.
  const visibleDocuments = useMemo(
    () =>
      currentFolder
        ? (currentFolder.children ?? [])
        : documents.filter((d) => !d.parentId),
    [currentFolder, documents]
  );

  // ---------------------------------------------------------------------------
  // Create folder
  // ---------------------------------------------------------------------------

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name) {
      setCreatingFolder(false);
      return;
    }
    setSavingFolder(true);
    try {
      const res = await fetch(`/api/spaces/${params.spaceSlug}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: name,
          isFolder: true,
          parentId: currentFolder?.id ?? null,
        }),
      });
      if (res.ok) {
        toast.success(t("toasts.folderCreated"));
        setNewFolderName("");
        setCreatingFolder(false);
        loadData();
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t("toasts.folderCreateError"));
      }
    } catch {
      toast.error(t("toasts.networkError"));
    }
    setSavingFolder(false);
  }

  // ---------------------------------------------------------------------------
  // Drag & drop
  // ---------------------------------------------------------------------------

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const found = visibleDocuments.find((d) => d.id === event.active.id) ?? null;
      setActiveDrag(found);
    },
    [visibleDocuments]
  );

  // Helper : retirer un document de l'arbre (optimiste)
  const removeDocFromTree = useCallback(
    (docId: string) => {
      setDocuments((prev) =>
        prev
          .filter((d) => d.id !== docId)
          .map((d) =>
            d.isFolder && d.children
              ? { ...d, children: d.children.filter((c) => c.id !== docId) }
              : d
          )
      );
      // Mettre à jour currentFolder si on est dedans
      if (currentFolder) {
        setCurrentFolder((f) =>
          f ? { ...f, children: (f.children ?? []).filter((c) => c.id !== docId) } : f
        );
      }
    },
    [currentFolder]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDrag(null);
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      // Drop sur un dossier → mise à jour optimiste + API
      if (over.data.current?.type === "folder") {
        const folderId = String(over.id);
        const docId = String(active.id);
        if (docId === folderId) return;

        // Parent d'origine, pour pouvoir annuler le déplacement.
        const sourceParentId = currentFolder?.id ?? null;

        const moveToParent = (parentId: string | null) =>
          fetch("/api/documents/reorder", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              items: [{ id: docId, position: 0, parentId }],
            }),
          });

        // Optimiste : retirer le document de la vue courante
        removeDocFromTree(docId);

        moveToParent(folderId)
          .then((res) => {
            if (!res.ok) throw new Error("move failed");
            emitSidebarRefresh();
            // Resynchroniser l'arbre : le document doit réapparaître dans
            // le dossier cible (sinon il semble avoir disparu).
            loadData();
            toast.success(t("toasts.documentMoved"), {
              action: {
                label: t("docActions.cancel"),
                onClick: () => {
                  moveToParent(sourceParentId)
                    .then((r) => {
                      if (!r.ok) throw new Error("undo failed");
                      emitSidebarRefresh();
                      loadData();
                    })
                    .catch(() => toast.error(t("toasts.moveError")));
                },
              },
            });
          })
          .catch(() => {
            // Rollback : restaurer l'état réel depuis le serveur.
            toast.error(t("toasts.moveError"));
            loadData();
          });
        return;
      }

      // Réordonnancement au même niveau — optimiste
      const docs = visibleDocuments.filter((d) => !d.isFolder);
      const oldIndex = docs.findIndex((d) => d.id === active.id);
      const newIndex = docs.findIndex((d) => d.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const newOrder = arrayMove(docs, oldIndex, newIndex);

      // Optimiste : mettre à jour le state local
      if (currentFolder) {
        const folders = visibleDocuments.filter((d) => d.isFolder);
        setCurrentFolder((f) => f ? { ...f, children: [...folders, ...newOrder] } : f);
      } else {
        setDocuments((prev) => {
          const folders = prev.filter((d) => d.isFolder);
          return [...folders, ...newOrder];
        });
      }

      const items = newOrder.map((doc, index) => ({
        id: doc.id,
        position: index,
      }));

      fetch("/api/documents/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      }).then(() => emitSidebarRefresh()).catch(() => loadData()); // Rollback en cas d'erreur
    },
    [visibleDocuments, currentFolder, removeDocFromTree, loadData, t]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-pulse text-muted-foreground">{t("loading")}</div>
      </div>
    );
  }

  if (!space) {
    return (
      <div className="max-w-2xl mx-auto px-8 py-12 text-center">
        <h1 className="text-xl font-bold mb-2">{t("notFound.title")}</h1>
        <p className="text-muted-foreground mb-4">
          {t("notFound.description")}
        </p>
        <Button onClick={() => router.push("/")}>{t("notFound.backHome")}</Button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-6 md:px-8 md:py-12">
      {/* Space header */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-xl bg-primary/10 flex items-center justify-center">
            <SpaceIcon type={space.type} />
          </div>
          <div>
            <h1 className="text-2xl font-bold">{space.name}</h1>
            <p className="text-sm text-muted-foreground">
              {t(`types.${space.type}`)}
              {space.description && ` — ${space.description}`}
            </p>
          </div>
        </div>
        <Link href={`/s/${space.slug}/settings`}>
          <Button variant="outline" size="sm">
            <Settings className="h-4 w-4 mr-2" />
            {t("header.settings")}
          </Button>
        </Link>
      </div>

      {/* Fil d'Ariane */}
      {currentFolder && (
        <nav className="flex items-center gap-1 text-sm text-muted-foreground mb-6 flex-wrap">
          <button
            onClick={goToRoot}
            className="hover:text-foreground transition-colors"
          >
            {space.name}
          </button>
          {folderStack.map((folder, i) => (
            <span key={folder.id} className="flex items-center gap-1">
              <ChevronRight className="h-3 w-3 shrink-0" />
              <button
                onClick={() => goToStackItem(i)}
                className="hover:text-foreground transition-colors"
              >
                {folder.title}
              </button>
            </span>
          ))}
          <span className="flex items-center gap-1">
            <ChevronRight className="h-3 w-3 shrink-0" />
            <span className="text-foreground font-medium">{currentFolder.title}</span>
          </span>
        </nav>
      )}

      {/* Actions */}
      <div className="flex flex-wrap gap-3 mb-8">
        {currentFolder && (
          <Button variant="outline" onClick={goBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t("docList.back")}
          </Button>
        )}
        <Link href={`/s/${space.slug}/new`}>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            {t("docList.newDocument")}
          </Button>
        </Link>
        {!creatingFolder && (
          <Button
            variant="outline"
            onClick={() => {
              setCreatingFolder(true);
              setNewFolderName("");
            }}
          >
            <FolderPlus className="h-4 w-4 mr-2" />
            {t("docList.newFolder")}
          </Button>
        )}
      </div>

      {/* Inline folder creation form */}
      {creatingFolder && (
        <div className="flex items-center gap-2 mb-4 px-4 py-3 rounded-lg border border-primary/40 bg-primary/5">
          <FolderOpen className="h-5 w-5 text-muted-foreground shrink-0" />
          <input
            ref={newFolderInputRef}
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleCreateFolder();
              if (e.key === "Escape") {
                setCreatingFolder(false);
                setNewFolderName("");
              }
            }}
            placeholder={t("docList.folderNamePlaceholder")}
            className="flex-1 bg-transparent text-sm focus:outline-none placeholder:text-muted-foreground"
          />
          <button
            onClick={handleCreateFolder}
            disabled={savingFolder || !newFolderName.trim()}
            className="p-1.5 rounded hover:bg-primary/10 text-primary disabled:opacity-40 transition-colors"
            title={t("docList.createFolderAria")}
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            onClick={() => {
              setCreatingFolder(false);
              setNewFolderName("");
            }}
            className="p-1.5 rounded hover:bg-muted text-muted-foreground transition-colors"
            title={t("docList.cancelAria")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Liste des documents */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-lg font-semibold">
            {currentFolder ? currentFolder.title : t("docList.title")}
          </h2>
          <span className="text-sm text-muted-foreground">
            ({visibleDocuments.length})
          </span>
        </div>

        {visibleDocuments.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border">
            <EmptyState
              icon={currentFolder ? FolderOpen : FileText}
              title={currentFolder ? t("docList.emptyFolderTitle") : t("docList.emptySpaceTitle")}
              description={currentFolder ? t("docList.emptyFolderDescription") : undefined}
              action={
                !currentFolder ? (
                  <Link href={`/s/${space.slug}/new`}>
                    <Button>
                      <Plus className="h-4 w-4 mr-2" />
                      {t("docList.createFirst")}
                    </Button>
                  </Link>
                ) : undefined
              }
            />
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <div className="space-y-1">
              {/* Dossiers : droppable uniquement, hors SortableContext */}
              {visibleDocuments.filter((d) => d.isFolder).map((doc) => (
                <DroppableFolderRow
                  key={doc.id}
                  doc={doc}
                  spaceSlug={space.slug}
                  allSpaces={allSpaces}
                  onDeleted={loadData}
                  onRenamed={handleRenamed}
                  onEnterFolder={enterFolder}
                />
              ))}
              {/* Documents: sortable (reorder + draggable) */}
              <SortableContext
                items={visibleDocuments.filter((d) => !d.isFolder).map((d) => d.id)}
                strategy={verticalListSortingStrategy}
              >
                {visibleDocuments.filter((d) => !d.isFolder).map((doc) => (
                  <SortableDocRow
                    key={doc.id}
                    doc={doc}
                    spaceSlug={space.slug}
                    allSpaces={allSpaces}
                    onDeleted={loadData}
                    onRenamed={handleRenamed}
                  />
                ))}
              </SortableContext>
            </div>
            <DragOverlay>
              {activeDrag && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-lg bg-popover border border-border shadow-lg text-sm">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <span className="truncate max-w-[200px] font-medium">{activeDrag.title}</span>
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </div>
  );
}
