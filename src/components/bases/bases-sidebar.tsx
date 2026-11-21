"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { resolveCurrentSpaceId } from "@/lib/spaces/resolve-current-space";
import { setLastSpaceCookie } from "@/lib/spaces/last-space-cookie";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Database,
  FolderOpen,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { AiCreateModal } from "./ai-create-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface SpaceItem {
  id: string;
  name: string;
}

interface GroupItem {
  id: string;
  name: string;
  icon: string | null;
}

interface DatabaseItem {
  id: string;
  name: string;
  icon: string | null;
  groupId: string | null;
  isFavorite: boolean;
}

export interface BasesSidebarSpaceData {
  groups: GroupItem[];
  databases: DatabaseItem[];
  recentIds: string[];
  archivedCount: number;
  trashedCount: number;
}

interface BasesSidebarProps {
  spaces: SpaceItem[];
  spaceData: Record<string, BasesSidebarSpaceData>;
  /** databaseId vers spaceId, archivées et corbeille comprises. */
  databaseSpaceIds: Record<string, string>;
  lastSpaceId: string | null;
  aiEnabled: boolean;
}

export function BasesSidebar({
  spaces,
  spaceData,
  databaseSpaceIds,
  lastSpaceId,
  aiEnabled,
}: BasesSidebarProps) {
  const params = useParams<{ databaseId?: string }>();
  const databaseId = Array.isArray(params.databaseId) ? params.databaseId[0] : params.databaseId;
  const searchParams = useSearchParams();
  const router = useRouter();
  const currentSpaceId =
    resolveCurrentSpaceId({
      accessibleIds: spaces.map((s) => s.id),
      requested: searchParams.get("spaceId"),
      databaseSpaceId: databaseId ? databaseSpaceIds[databaseId] : null,
      lastSpaceId,
    }) ?? spaces[0].id;
  const { groups, databases, recentIds, archivedCount, trashedCount } =
    spaceData[currentSpaceId];

  // Mémorise le dernier espace choisi (préférence, revalidée côté serveur).
  useEffect(() => {
    setLastSpaceCookie(currentSpaceId);
  }, [currentSpaceId]);
  const [openGroups, setOpenGroups] = useState<Set<string>>(
    () => new Set(groups.map((g) => g.id))
  );
  const [dragOverGroupId, setDragOverGroupId] = useState<string | "orphan" | null>(null);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [groupPromptOpen, setGroupPromptOpen] = useState(false);
  const [dbPromptOpen, setDbPromptOpen] = useState(false);
  // Masquage optimiste : archive/trash retirent la base de la liste avant
  // même que l'API ne réponde — évite la latence perçue de router.refresh()
  // en dev Next.js 16.
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(() => new Set());

  function toggleGroup(id: string) {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function moveDatabase(databaseId: string, groupId: string | null) {
    const current = databases.find((d) => d.id === databaseId);
    if (!current || current.groupId === groupId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/databases/${databaseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId }),
      });
      if (res.ok) router.refresh();
      else toast.error("Déplacement impossible");
    } finally {
      setBusy(false);
    }
  }

  function onDropToGroup(e: React.DragEvent, groupId: string | null) {
    e.preventDefault();
    setDragOverGroupId(null);
    const databaseId = e.dataTransfer.getData("text/database-id");
    if (databaseId) void moveDatabase(databaseId, groupId);
  }

  async function createDatabase(name: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, spaceId: currentSpaceId }),
      });
      if (res.ok) {
        const created = await res.json();
        toast.success(`Base « ${name} » créée`);
        router.push(`/bases/${created.id}?spaceId=${encodeURIComponent(currentSpaceId)}`);
        router.refresh();
      } else toast.error("Création impossible");
    } finally {
      setBusy(false);
    }
  }

  async function createGroup(name: string) {
    setBusy(true);
    try {
      const res = await fetch("/api/database-groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId: currentSpaceId, name }),
      });
      if (res.ok) {
        toast.success(`Groupe « ${name} » créé`);
        router.refresh();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Création du groupe impossible");
      }
    } finally {
      setBusy(false);
    }
  }

  const q = query.trim().toLowerCase();
  const matches = (d: DatabaseItem) =>
    q === "" || d.name.toLowerCase().includes(q);

  const visibleDbs = databases.filter((d) => !hiddenIds.has(d.id)).filter(matches);
  const favoriteDbs = visibleDbs.filter((d) => d.isFavorite);
  const recentDbs = useMemo(() => {
    const byId = new Map(visibleDbs.map((d) => [d.id, d]));
    return recentIds
      .map((id) => byId.get(id))
      .filter((d): d is DatabaseItem => Boolean(d))
      .slice(0, 5);
  }, [recentIds, visibleDbs]);
  const orphanDbs = visibleDbs.filter((d) => !d.groupId);

  return (
    <aside className="w-64 shrink-0 border-r border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950 overflow-y-auto">
      {/* Sélecteur de space */}
      <div className="mb-3">
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-neutral-500">
          Espace
        </label>
        <select
          value={currentSpaceId}
          onChange={(e) =>
            router.push(`/bases?spaceId=${encodeURIComponent(e.target.value)}`)
          }
          className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          {spaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </div>

      {/* Recherche */}
      <div className="mb-3 relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher une base…"
          className="w-full rounded border border-neutral-300 bg-white pl-7 pr-7 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        {query && (
          <button
            onClick={() => setQuery("")}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
            aria-label="Effacer la recherche"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Favoris */}
      {favoriteDbs.length > 0 && (
        <Section icon={Star} label="Favoris" iconClass="text-amber-500">
          <ul className="space-y-0.5">
            {favoriteDbs.map((d) => (
              <DatabaseLink
                key={d.id}
                db={d}
                spaceId={currentSpaceId}
                active={databaseId === d.id}
                onAction={(action) => onDbAction(d, action, router, setBusy, setHiddenIds)}
              />
            ))}
          </ul>
        </Section>
      )}

      {/* Récents */}
      {recentDbs.length > 0 && (
        <Section icon={Clock} label="Récents">
          <ul className="space-y-0.5">
            {recentDbs.map((d) => (
              <DatabaseLink
                key={d.id}
                db={d}
                spaceId={currentSpaceId}
                active={databaseId === d.id}
                onAction={(action) => onDbAction(d, action, router, setBusy, setHiddenIds)}
              />
            ))}
          </ul>
        </Section>
      )}

      {/* En-tête : Bases + bouton "+" pour créer une base */}
      <div className="mb-2 mt-3 flex items-center justify-between px-1">
        <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
          Bases
        </span>
        <button
          onClick={() => setDbPromptOpen(true)}
          disabled={busy}
          data-tour="base-create"
          title="Nouvelle base"
          aria-label="Nouvelle base"
          className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 dark:hover:bg-neutral-800 dark:hover:text-neutral-200 disabled:opacity-50"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Groupes (bases logiques) */}
      <div className="space-y-1">
        {groups.map((group) => {
          const open = openGroups.has(group.id);
          const groupDbs = visibleDbs.filter((d) => d.groupId === group.id);
          const isOver = dragOverGroupId === group.id;
          return (
            <div
              key={group.id}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                setDragOverGroupId(group.id);
              }}
              onDragLeave={(e) => {
                if (e.currentTarget.contains(e.relatedTarget as Node)) return;
                setDragOverGroupId((prev) => (prev === group.id ? null : prev));
              }}
              onDrop={(e) => onDropToGroup(e, group.id)}
              className={`rounded ${
                isOver ? "bg-blue-50 ring-1 ring-blue-300 dark:bg-blue-950/40 dark:ring-blue-800" : ""
              }`}
            >
              <button
                onClick={() => toggleGroup(group.id)}
                className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-sm font-medium hover:bg-neutral-100 dark:hover:bg-neutral-900"
              >
                {open ? (
                  <ChevronDown className="h-3.5 w-3.5 text-neutral-500" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5 text-neutral-500" />
                )}
                <FolderOpen className="h-4 w-4 text-neutral-500" />
                <span className="truncate">{group.name}</span>
              </button>
              {open && (
                <ul className="ml-5 mt-0.5 space-y-0.5 border-l border-neutral-200 pl-1.5 dark:border-neutral-800">
                  {groupDbs.length === 0 && (
                    <li className="px-2 py-1 text-xs italic text-neutral-400">
                      Vide
                    </li>
                  )}
                  {groupDbs.map((d) => (
                    <DatabaseLink
                      key={d.id}
                      db={d}
                      spaceId={currentSpaceId}
                      active={databaseId === d.id}
                      onAction={(action) => onDbAction(d, action, router, setBusy, setHiddenIds)}
                    />
                  ))}
                </ul>
              )}
            </div>
          );
        })}

        {/* Bases sans groupe — zone de dépôt pour retirer d'un groupe */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            setDragOverGroupId("orphan");
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node)) return;
            setDragOverGroupId((prev) => (prev === "orphan" ? null : prev));
          }}
          onDrop={(e) => onDropToGroup(e, null)}
          className={`mt-2 min-h-[28px] rounded ${
            dragOverGroupId === "orphan"
              ? "bg-blue-50 ring-1 ring-blue-300 dark:bg-blue-950/40 dark:ring-blue-800"
              : ""
          }`}
        >
          {orphanDbs.length > 0 ? (
            <ul className="space-y-0.5">
              {orphanDbs.map((d) => (
                <DatabaseLink
                  key={d.id}
                  db={d}
                  spaceId={currentSpaceId}
                  active={databaseId === d.id}
                  onAction={(action) => onDbAction(d, action, router, setBusy, setHiddenIds)}
                />
              ))}
            </ul>
          ) : (
            dragOverGroupId === "orphan" && (
              <div className="px-2 py-1 text-xs italic text-neutral-400">
                Déposer ici pour retirer du groupe
              </div>
            )
          )}
        </div>

        {/* Bouton "+ Nouveau groupe" en bas de l'arbre */}
        <button
          onClick={() => setGroupPromptOpen(true)}
          disabled={busy}
          className="mt-2 flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-900 dark:hover:text-neutral-200 disabled:opacity-50"
        >
          <Plus className="h-3 w-3" />
          <span>Nouveau groupe</span>
        </button>
      </div>

      {q !== "" && visibleDbs.length === 0 && (
        <p className="mt-3 px-2 text-xs italic text-neutral-400">
          Aucune base trouvée pour « {query} ».
        </p>
      )}

      {/* Liens vers Archivées et Corbeille */}
      <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-800 space-y-1">
        <Link
          href={`/bases/archived?spaceId=${encodeURIComponent(currentSpaceId)}`}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"
        >
          <Archive className="h-3.5 w-3.5" />
          <span>Archivées</span>
          <span className="ml-auto rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] dark:bg-neutral-800">
            {archivedCount}
          </span>
        </Link>
        <Link
          href={`/bases/trash?spaceId=${encodeURIComponent(currentSpaceId)}`}
          className="flex items-center gap-1.5 rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Corbeille</span>
          <span className="ml-auto rounded bg-neutral-200 px-1.5 py-0.5 text-[10px] dark:bg-neutral-800">
            {trashedCount}
          </span>
        </Link>
      </div>

      {/* Actions création */}
      <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-800">
        <CreateButtons spaceId={currentSpaceId} aiEnabled={aiEnabled} />
      </div>

      {/* Liens secondaires */}
      <div className="mt-4 border-t border-neutral-200 pt-3 dark:border-neutral-800 space-y-1">
        <Link
          href={`/bases/settings?spaceId=${encodeURIComponent(currentSpaceId)}`}
          className="block rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"
        >
          Modèles de base
        </Link>
        <Link
          href={`/automations?spaceId=${encodeURIComponent(currentSpaceId)}`}
          className="block rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"
        >
          Automatisations
        </Link>
        <Link
          href={`/bases/ai-tools?spaceId=${encodeURIComponent(currentSpaceId)}`}
          className="block rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"
        >
          Outils IA
        </Link>
        <Link
          href={`/bases/aide-formules?spaceId=${encodeURIComponent(currentSpaceId)}`}
          className="block rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800 dark:hover:bg-neutral-900 dark:hover:text-neutral-200"
        >
          Aide aux formules
        </Link>
      </div>

      {groupPromptOpen && (
        <InlinePrompt
          open={groupPromptOpen}
          title="Nouveau groupe"
          placeholder="Nom du groupe"
          onCancel={() => setGroupPromptOpen(false)}
          onSubmit={async (name) => {
            setGroupPromptOpen(false);
            await createGroup(name);
          }}
        />
      )}
      {dbPromptOpen && (
        <InlinePrompt
          open={dbPromptOpen}
          title="Nouvelle base"
          placeholder="Nom de la base"
          onCancel={() => setDbPromptOpen(false)}
          onSubmit={async (name) => {
            setDbPromptOpen(false);
            await createDatabase(name);
          }}
        />
      )}
    </aside>
  );
}

type DbAction = "favorite" | "unfavorite" | "duplicate" | "archive" | "trash";

async function onDbAction(
  db: DatabaseItem,
  action: DbAction,
  router: ReturnType<typeof useRouter>,
  setBusy: (b: boolean) => void,
  setHiddenIds: React.Dispatch<React.SetStateAction<Set<string>>>,
) {
  // Masquage optimiste pour les actions qui retirent la base de la sidebar :
  // l'UI réagit immédiatement, le refresh suit en arrière-plan.
  if (action === "archive" || action === "trash") {
    setHiddenIds((prev) => {
      const next = new Set(prev);
      next.add(db.id);
      return next;
    });
    toast.success(action === "archive" ? "Base archivée" : "Base supprimée");
    try {
      const res = await fetch(`/api/databases/${db.id}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        setHiddenIds((prev) => {
          const next = new Set(prev);
          next.delete(db.id);
          return next;
        });
        toast.error("Action impossible");
        return;
      }
      router.refresh();
    } catch {
      setHiddenIds((prev) => {
        const next = new Set(prev);
        next.delete(db.id);
        return next;
      });
      toast.error("Action impossible");
    }
    return;
  }

  setBusy(true);
  try {
    if (action === "favorite") {
      const res = await fetch("/api/favorites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entityType: "database", entityId: db.id }),
      });
      if (res.ok) {
        toast.success("Ajouté aux favoris");
        router.refresh();
      } else toast.error("Action impossible");
    } else if (action === "unfavorite") {
      const res = await fetch(
        `/api/favorites?entityType=database&entityId=${encodeURIComponent(db.id)}`,
        { method: "DELETE" }
      );
      if (res.ok) {
        toast.success("Retiré des favoris");
        router.refresh();
      } else toast.error("Action impossible");
    } else if (action === "duplicate") {
      const res = await fetch(`/api/databases/${db.id}/duplicate`, { method: "POST" });
      if (res.ok) {
        toast.success("Base dupliquée");
        router.refresh();
      } else toast.error("Duplication impossible");
    }
  } finally {
    setBusy(false);
  }
}

function Section({
  icon: Icon,
  label,
  iconClass,
  children,
}: {
  icon: typeof Star;
  label: string;
  iconClass?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center gap-1.5 px-1 text-xs font-medium uppercase tracking-wide text-neutral-500">
        <Icon className={`h-3 w-3 ${iconClass ?? ""}`} />
        <span>{label}</span>
      </div>
      {children}
    </div>
  );
}

function DatabaseLink({
  db,
  spaceId,
  active,
  onAction,
}: {
  db: DatabaseItem;
  spaceId: string;
  active: boolean;
  onAction: (action: DbAction) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  return (
    <li className="relative group">
      <Link
        href={`/bases/${db.id}?spaceId=${encodeURIComponent(spaceId)}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData("text/database-id", db.id);
          e.dataTransfer.effectAllowed = "move";
          setDragging(true);
        }}
        onDragEnd={() => setDragging(false)}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenuOpen(true);
        }}
        className={`flex items-center gap-1.5 rounded px-2 py-1 pr-7 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-900 ${
          active ? "bg-neutral-200 font-medium dark:bg-neutral-800" : ""
        } ${dragging ? "opacity-50" : ""}`}
      >
        <Database className="h-3.5 w-3.5 text-neutral-500" />
        <span className="truncate">{db.name}</span>
        {db.isFavorite && (
          <Star className="ml-auto h-3 w-3 fill-amber-400 text-amber-400" />
        )}
      </Link>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger
          render={
            <button
              type="button"
              aria-label="Options"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              className="absolute right-1 top-1/2 -translate-y-1/2 hidden h-5 w-5 items-center justify-center rounded text-neutral-500 hover:bg-neutral-200 hover:text-neutral-800 group-hover:flex data-[popup-open]:flex dark:hover:bg-neutral-700"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          }
        />
        <DropdownMenuContent align="end" sideOffset={2} className="w-44">
          <DropdownMenuItem
            onClick={() => onAction(db.isFavorite ? "unfavorite" : "favorite")}
          >
            <Star className="h-3.5 w-3.5" />
            <span>
              {db.isFavorite ? "Retirer des favoris" : "Ajouter aux favoris"}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAction("duplicate")}>
            <Copy className="h-3.5 w-3.5" />
            <span>Dupliquer</span>
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAction("archive")}>
            <Archive className="h-3.5 w-3.5" />
            <span>Archiver</span>
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onClick={() => onAction("trash")}
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Supprimer</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}

function InlinePrompt({
  open,
  title,
  placeholder,
  onCancel,
  onSubmit,
}: {
  open: boolean;
  title: string;
  placeholder: string;
  onCancel: () => void;
  onSubmit: (value: string) => void;
}) {
  const [value, setValue] = useState("");
  function submit() {
    const v = value.trim();
    if (v) onSubmit(v);
  }
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setValue("");
          onCancel();
        }
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={placeholder}
          aria-label={title}
          className="w-full rounded border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        />
        <DialogFooter>
          <button
            type="button"
            onClick={onCancel}
            className="rounded px-3 py-1 text-sm text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!value.trim()}
            className="rounded bg-neutral-900 px-3 py-1 text-sm text-white hover:bg-neutral-700 disabled:opacity-50 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300"
          >
            Créer
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateButtons({ spaceId, aiEnabled }: { spaceId: string; aiEnabled: boolean }) {
  const router = useRouter();
  const [aiOpen, setAiOpen] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <button
        onClick={() => setAiOpen(true)}
        disabled={!aiEnabled}
        title={
          aiEnabled
            ? undefined
            : "Aucun fournisseur IA configuré — branchez-en un dans Paramètres → IA pour activer cette option"
        }
        aria-disabled={!aiEnabled}
        className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs disabled:cursor-not-allowed ${
          aiEnabled
            ? "text-purple-600 hover:bg-purple-50 dark:hover:bg-purple-950 disabled:opacity-50"
            : "text-neutral-400 dark:text-neutral-600"
        }`}
      >
        <Sparkles className="h-3 w-3" />
        Créer avec l&apos;IA
        {!aiEnabled && (
          <span className="ml-auto text-[10px] uppercase tracking-wide text-neutral-400">
            indisponible
          </span>
        )}
      </button>
      <AiCreateModal
        open={aiOpen}
        spaceId={spaceId}
        onClose={() => setAiOpen(false)}
        onCreated={(id) => {
          router.push(`/bases/${id}?spaceId=${encodeURIComponent(spaceId)}`);
          router.refresh();
        }}
      />
    </div>
  );
}
