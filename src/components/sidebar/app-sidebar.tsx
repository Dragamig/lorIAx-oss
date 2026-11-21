"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { setLastSpaceCookie, findSpaceIdBySlug } from "@/lib/spaces/last-space-cookie";
import { Link, usePathname } from "@/i18n/routing";
import Image from "next/image";
import { useCurrentUser } from "@/hooks/use-session";
import { useTranslations } from "next-intl";
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import {
  FolderOpen,
  FolderPlus,
  FileText,
  Plus,
  Check,
  X,
  Compass,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateSpaceDialog } from "@/components/sidebar/create-space-dialog";
import { getClientSlots } from "@/lib/modules/hooks.client";
import { QuickNav } from "./quick-nav";
import { SpacesSection } from "./spaces-section";
import { SortableDocumentTree } from "./sortable-document";
import { SidebarFooter } from "./sidebar-footer";
import { FavoritesSection } from "./favorites-section";
import { CollapsibleSection } from "./collapsible-section";
import type { SpaceItem, DocumentItem } from "./types";
import {
  populateSpacesCache,
  populateDocTreeCache,
  getCachedSpaces,
  getCachedDocumentTree,
} from "@/lib/offline/cache-manager";
import { TeamMembersSection } from "./team-members-section";
import { SIDEBAR_REFRESH_EVENT } from "@/lib/events/sidebar-sync";

// ─── Main sidebar ────────────────────────────────────────────────────────────

export function AppSidebar() {
  const t = useTranslations("shell.sidebar");
  const user = useCurrentUser();
  const pathname = usePathname();
  const [spaces, setSpaces] = useState<SpaceItem[]>([]);
  const [activeSpace, setActiveSpace] = useState<string | null>(null);
  // Vrai quand l'espace actif vient d'une URL /s/[slug] ou du sélecteur (pas du défaut initial).
  const explicitSpaceRef = useRef(false);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [spaceSearch, setSpaceSearch] = useState("");
  const [activeDrag, setActiveDrag] = useState<DocumentItem | null>(null);
  const [availableLabels, setAvailableLabels] = useState<{ id: string; name: string; color: string }[]>([]);
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);

  // Filter document tree by selected labels
  const filteredDocuments = useMemo(() => {
    if (selectedLabelIds.length === 0) return documents;
    return documents.filter((doc) => {
      const docLabels = doc.labels?.map((l) => l.id) ?? [];
      return selectedLabelIds.some((id) => docLabels.includes(id));
    });
  }, [documents, selectedLabelIds]);

  const filteredSpaces = useMemo(() => {
    if (!spaceSearch.trim()) return spaces;
    const q = spaceSearch.toLowerCase();
    return spaces.filter((s) => s.name.toLowerCase().includes(q));
  }, [spaces, spaceSearch]);

  const spaceGroups = useMemo(() => {
    const groups: { type: SpaceItem["type"]; label: string; spaces: SpaceItem[] }[] = [
      { type: "personal", label: t("spaceGroups.personal"), spaces: [] },
      { type: "team", label: t("spaceGroups.team"), spaces: [] },
      { type: "organization", label: t("spaceGroups.organization"), spaces: [] },
    ];
    for (const space of filteredSpaces) {
      const group = groups.find((g) => g.type === space.type);
      if (group) group.spaces.push(space);
      else groups[0].spaces.push(space);
    }
    return groups;
  }, [filteredSpaces, t]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => {
    const match = pathname.match(/^\/s\/([^/]+)/);
    if (match) {
      explicitSpaceRef.current = true;
      setActiveSpace(match[1]);
    }
  }, [pathname]);

  // Mémorise le dernier espace consulté pour le menu Bases.
  useEffect(() => {
    if (!explicitSpaceRef.current) return;
    const id = findSpaceIdBySlug(spaces, activeSpace);
    if (id) setLastSpaceCookie(id);
  }, [activeSpace, spaces]);

  const handleActiveSpaceChange = useCallback((slug: string | null) => {
    explicitSpaceRef.current = true;
    setActiveSpace(slug);
  }, []);

  const loadSpaces = useCallback(() => {
    fetch("/api/spaces")
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setSpaces(data);
          if (data.length > 0) {
            setActiveSpace((prev) => {
              if (prev) return prev;
              const personal = data.find((s: SpaceItem) => s.type === "personal");
              return personal ? personal.slug : data[0].slug;
            });
          }
          // Populate offline cache
          populateSpacesCache(data);
        }
      })
      .catch(() => {
        // Offline fallback — load from IndexedDB
        getCachedSpaces().then((cached) => {
          if (cached && cached.length > 0) {
            setSpaces(cached as unknown as SpaceItem[]);
            setActiveSpace((prev) => {
              if (prev) return prev;
              const personal = (cached as unknown as SpaceItem[]).find((s) => s.type === "personal");
              return personal ? personal.slug : cached[0].slug;
            });
          }
        }).catch(() => {});
      });
  }, []);

  useEffect(() => {
    loadSpaces();
  }, [loadSpaces]);

  const reloadDocuments = useCallback(() => {
    if (!activeSpace) return;
    fetch(`/api/spaces/${activeSpace}/documents`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setDocuments(data);
          // Populate offline cache
          populateDocTreeCache(activeSpace, data);
        }
      })
      .catch(() => {
        // Offline fallback — load from IndexedDB
        getCachedDocumentTree(activeSpace).then((cached) => {
          if (cached && cached.length > 0) {
            setDocuments(cached as unknown as DocumentItem[]);
          }
        }).catch(() => {});
      });
  }, [activeSpace]);

  useEffect(() => {
    reloadDocuments();
  }, [reloadDocuments]);

  // Synchronisation sans F5 : recharger spaces + documents quand une mutation
  // est signalée ailleurs (espace de travail, réglages d'espace, déplacement…)
  // ou au retour de focus / d'onglet (filet de sécurité universel).
  useEffect(() => {
    const refresh = () => {
      loadSpaces();
      reloadDocuments();
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener(SIDEBAR_REFRESH_EVENT, refresh);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener(SIDEBAR_REFRESH_EVENT, refresh);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [loadSpaces, reloadDocuments]);

  useEffect(() => {
    if (!activeSpace) return;
    setSelectedLabelIds([]);
    fetch(`/api/spaces/${activeSpace}/labels`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setAvailableLabels(data);
      })
      .catch(() => {});
  }, [activeSpace]);

  async function handleCreateFolder() {
    if (!activeSpace || !newFolderName.trim()) return;

    try {
      const res = await fetch(`/api/spaces/${activeSpace}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newFolderName.trim(),
          isFolder: true,
        }),
      });

      if (res.ok) {
        setNewFolderName("");
        setCreatingFolder(false);
        // Reload documents
        const docsRes = await fetch(`/api/spaces/${activeSpace}/documents`);
        const data = await docsRes.json();
        if (Array.isArray(data)) setDocuments(data);
      }
    } catch {
      // ignore
    }
  }

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = event.active.id as string;
      // Search at root level first, then in children
      let found = documents.find((d) => d.id === id) ?? null;
      if (!found) {
        for (const doc of documents) {
          if (doc.children) {
            const child = doc.children.find((c) => c.id === id);
            if (child) { found = child; break; }
          }
        }
      }
      setActiveDrag(found);
    },
    [documents]
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      // Drop on folder — optimistic update
      if (over.data.current?.type === "folder") {
        const folderId = String(over.id);
        if (String(active.id) === folderId) return;

        // Optimistic: remove document from root list
        setDocuments((prev) => prev.filter((d) => d.id !== active.id));

        fetch("/api/documents/reorder", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: [{ id: String(active.id), position: 0, parentId: folderId }],
          }),
        })
          .then(() => reloadDocuments())
          .catch(() => reloadDocuments());
        return;
      }

      // Classic reorder — already optimistic (arrayMove before fetch)
      const docs = documents.filter((d) => !d.isFolder);
      const oldIndex = docs.findIndex((d) => d.id === active.id);
      const newIndex = docs.findIndex((d) => d.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const newDocs = arrayMove(docs, oldIndex, newIndex);
      const folders = documents.filter((d) => d.isFolder);
      setDocuments([...folders, ...newDocs]);

      const items = newDocs.map((doc, index) => ({
        id: doc.id,
        position: index,
      }));

      fetch("/api/documents/reorder", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      }).catch(() => reloadDocuments());
    },
    [documents, reloadDocuments]
  );

  return (
    <aside className="w-full h-screen flex flex-col bg-sidebar border-r border-sidebar-border">
      {/* Header */}
      <div className="pt-4 px-4 pb-2 border-b border-sidebar-border">
        <Link href="/" className="flex items-center gap-2 mb-1">
          <Image src="/mascotte.svg" alt="LorIAx" width={32} height={32} />
          <span className="font-semibold text-lg">LorIAx</span>
          {process.env.NEXT_PUBLIC_APP_VERSION && (
            <span className="text-[11px] text-muted-foreground self-end mb-1" title="Version">
              v{process.env.NEXT_PUBLIC_APP_VERSION}
            </span>
          )}
        </Link>
        {(() => {
          const OrgSwitcher = getClientSlots().OrgSwitcher;
          return OrgSwitcher ? <OrgSwitcher /> : null;
        })()}
      </div>

      {/* Scrollable area: Navigation + Favorites + Spaces + Documents */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Quick navigation */}
        <CollapsibleSection id="quick-nav" title={t("navigation")} icon={Compass}>
          <QuickNav pathname={pathname} user={user} />
        </CollapsibleSection>

        {/* Favorites */}
        <FavoritesSection />

        {/* Spaces */}
        <CollapsibleSection
          id="spaces"
          title={t("spaces")}
          icon={Layers}
          actions={<CreateSpaceDialog onCreated={loadSpaces} />}
        >
          <SpacesSection
            spaces={spaces}
            filteredSpaces={filteredSpaces}
            spaceGroups={spaceGroups}
            spaceSearch={spaceSearch}
            activeSpace={activeSpace}
            onSpaceSearchChange={setSpaceSearch}
            onActiveSpaceChange={handleActiveSpaceChange}
          />
        </CollapsibleSection>

        {/* Documents */}
        <CollapsibleSection
          id="documents"
          title={t("documents")}
          icon={FileText}
          actions={
            activeSpace ? (
              <div className="flex gap-0.5">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setCreatingFolder(true)}
                  title={t("newFolder")}
                  aria-label={t("newFolderAria")}
                >
                  <FolderPlus className="h-3.5 w-3.5" />
                </Button>
                <Link href={`/s/${activeSpace}/new`}>
                  <Button variant="ghost" size="icon" className="h-6 w-6" title={t("newDocument")} aria-label={t("newDocumentAria")}>
                    <Plus className="h-3.5 w-3.5" />
                  </Button>
                </Link>
              </div>
            ) : undefined
          }
        >
          <div className="px-3 py-2">
            {/* Label filter */}
            {availableLabels.length > 0 && (
              <div className="flex flex-wrap gap-1 mb-2">
                {availableLabels.map((label) => {
                  const isSelected = selectedLabelIds.includes(label.id);
                  return (
                    <button
                      key={label.id}
                      type="button"
                      onClick={() =>
                        setSelectedLabelIds((prev) =>
                          isSelected
                            ? prev.filter((id) => id !== label.id)
                            : [...prev, label.id]
                        )
                      }
                      className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded font-medium transition-opacity"
                      style={{
                        backgroundColor: label.color + "33",
                        color: label.color,
                        opacity: isSelected ? 1 : 0.5,
                        outline: isSelected ? `2px solid ${label.color}` : "none",
                        outlineOffset: "1px",
                      }}
                      title={isSelected ? t("removeFilterAria", { name: label.name }) : t("filterByAria", { name: label.name })}
                    >
                      {label.name}
                    </button>
                  );
                })}
              </div>
            )}
            {creatingFolder && activeSpace && (
              <div className="flex items-center gap-1 px-2 py-1 mb-1">
                <FolderOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                <input
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
                  placeholder={t("newFolderPlaceholder")}
                  className="flex-1 text-sm bg-transparent border-b border-primary outline-none px-1 py-0.5"
                  autoFocus
                />
                <button
                  onClick={handleCreateFolder}
                  className="p-0.5 rounded cursor-pointer hover:bg-accent active:bg-accent/70 active:translate-y-px transition-all disabled:pointer-events-none disabled:opacity-50"
                  disabled={!newFolderName.trim()}
                >
                  <Check className="h-3.5 w-3.5 text-primary" />
                </button>
                <button
                  onClick={() => {
                    setCreatingFolder(false);
                    setNewFolderName("");
                  }}
                  className="p-0.5 rounded cursor-pointer hover:bg-accent active:bg-accent/70 active:translate-y-px transition-all"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            )}
            {filteredDocuments.length > 0 && activeSpace && (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleDragStart}
                onDragEnd={(e) => { handleDragEnd(e); setActiveDrag(null); }}
              >
                <SortableDocumentTree
                  documents={filteredDocuments}
                  spaceSlug={activeSpace}
                  onDeleted={reloadDocuments}
                />
                <DragOverlay>
                  {activeDrag && (
                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-popover border border-border shadow-lg text-sm">
                      {activeDrag.isFolder ? (
                        <FolderOpen className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      ) : (
                        <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      )}
                      <span className="truncate max-w-[150px]">{activeDrag.title}</span>
                    </div>
                  )}
                </DragOverlay>
              </DndContext>
            )}
            {filteredDocuments.length === 0 && activeSpace && (
              <p className="text-xs text-muted-foreground px-2 py-4">
                {selectedLabelIds.length > 0
                  ? t("noDocumentsLabel")
                  : t("noDocuments")}
              </p>
            )}
          </div>
        </CollapsibleSection>

        {/* Active team members */}
        <TeamMembersSection />
      </div>

      {/* User footer */}
      <SidebarFooter user={user} />
    </aside>
  );
}
