"use client";

import { useState, useEffect, useCallback, useReducer, useRef } from "react";
import { useTranslations, useFormatter } from "next-intl";
import { Link, useRouter } from "@/i18n/routing";
import dynamic from "next/dynamic";

function EditorLoading() {
  const t = useTranslations("document");
  return (
    <div className="flex items-center justify-center h-full">
      <div className="animate-pulse text-muted-foreground">{t("loading")}</div>
    </div>
  );
}

const LorIAxEditor = dynamic(
  () => import("@/components/editor/loriax-editor").then((m) => m.LorIAxEditor),
  {
    ssr: false,
    loading: () => <EditorLoading />,
  }
);
import { LockBanner } from "@/components/editor/lock-banner";
import { CollaboratorsBar } from "@/components/editor/collaborators-bar";

// Lazy-load des panneaux latéraux (chargés uniquement quand affichés)
const BacklinksPanel = dynamic(
  () => import("@/components/graph/backlinks-panel").then((m) => m.BacklinksPanel),
  { ssr: false }
);
const HistoryPanel = dynamic(
  () => import("@/components/editor/history-panel").then((m) => m.HistoryPanel),
  { ssr: false }
);
const AISummaryPanel = dynamic(
  () => import("@/components/ai/ai-summary-panel").then((m) => m.AISummaryPanel),
  { ssr: false }
);
const CommentsPanel = dynamic(
  () => import("@/components/editor/comments-panel").then((m) => m.CommentsPanel),
  { ssr: false }
);
const DocumentMoveDialog = dynamic(
  () => import("@/components/document-move-dialog").then((m) => m.DocumentMoveDialog),
  { ssr: false }
);
import { useDocumentLock } from "@/hooks/use-document-lock";
import { useCollaboration } from "@/hooks/use-collaboration";
import { usePresence } from "@/hooks/use-presence";
import { useSyncStatus } from "@/hooks/use-sync-status";
import { useCurrentUser } from "@/hooks/use-session";
import { useSpaceAppearance } from "@/hooks/use-space-appearance";
import { useNetworkStatus } from "@/hooks/use-network-status";
import { SyncStatusIndicator } from "@/components/sync-status-indicator";
import { enqueue as enqueuePendingOp } from "@/lib/offline/pending-queue";
import { validateExternalUrl } from "@/lib/security/url-validator";
import { toast } from "sonner";
import {
  Clock,
  Eye,
  ChevronRight,
  Sparkles,
  MessageSquare,
  Link2,
  Copy,
  Trash2,
  ExternalLink,
  MoreHorizontal,
  LayoutTemplate,
  FolderInput,
  AlignVerticalJustifyCenter,
  ArrowDownToLine,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExportDropdown } from "@/components/editor/export-dropdown";
import { EmojiPickerPopover } from "@/components/emoji-picker-popover";
import { ClassificationBadge } from "@/components/classification-badge";
import { ClassificationSelector } from "@/components/classification-selector";
import { getAllowedDocClassifications, canShareExternally } from "@/lib/auth/classification";
import type { ClassificationLevel } from "@/types";

interface Backlink {
  sourceId: string;
  linkText: string;
  title: string;
  slug: string;
}

interface DocumentData {
  id: string;
  title: string;
  slug: string;
  content: string;
  icon: string | null;
  visibility: "private" | "team" | "public";
  classification: ClassificationLevel;
  spaceClassification: ClassificationLevel;
  spaceId: string;
  createdBy: string;
  updatedAt: string;
  backlinks: Backlink[];
  properties?: { editorPaddingY?: string; followEnd?: boolean } | null;
}

interface PublicShareData {
  id: string;
  token: string;
  viewCount: number;
  createdAt: string;
  expiresAt: string | null;
}

function SharePopover({
  documentId,
  shares,
  onShareCreated,
  onShareRevoked,
  open,
  onClose,
}: {
  documentId: string;
  shares: PublicShareData[];
  onShareCreated: (share: PublicShareData & { url: string }) => void;
  onShareRevoked: (shareId: string) => void;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("document");
  const ref = useRef<HTMLDivElement>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    }
    if (open) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open, onClose]);

  if (!open) return null;

  async function handleCreate() {
    setCreating(true);
    try {
      const res = await fetch(`/api/documents/${documentId}/share`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        const data = await res.json();
        onShareCreated(data);
        toast.success(t("toasts.shareLinkCreated"));
      } else {
        const err = await res.json();
        toast.error(err.error || t("toasts.shareLinkCreateError"));
      }
    } catch {
      toast.error(t("toasts.networkError"));
    }
    setCreating(false);
  }

  async function handleRevoke(shareId: string) {
    try {
      const res = await fetch(`/api/documents/${documentId}/share`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shareId }),
      });
      if (res.ok) {
        onShareRevoked(shareId);
        toast.success(t("toasts.shareRevoked"));
      }
    } catch {
      toast.error(t("toasts.networkError"));
    }
  }

  function copyUrl(token: string) {
    const url = `${window.location.origin}/public/${token}`;
    navigator.clipboard.writeText(url);
    toast.success(t("toasts.linkCopied"));
  }

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 z-50 w-80 bg-popover border border-border rounded-lg shadow-lg p-3"
    >
      <p className="text-sm font-medium mb-2">{t("share.title")}</p>

      {shares.length > 0 ? (
        <div className="space-y-2 mb-3">
          {shares.map((share) => (
            <div
              key={share.id}
              className="flex items-center gap-2 p-2 rounded-md bg-accent/30 text-xs"
            >
              <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate font-mono text-[10px]">
                /public/{share.token.slice(0, 8)}...
              </span>
              <span className="text-muted-foreground">
                {t("share.views", { count: share.viewCount })}
              </span>
              <button
                onClick={() => copyUrl(share.token)}
                className="p-1 rounded hover:bg-accent"
                title={t("share.copyLinkAria")}
              >
                <Copy className="h-3 w-3" />
              </button>
              <button
                onClick={() => handleRevoke(share.id)}
                className="p-1 rounded hover:bg-destructive/10 text-destructive"
                title={t("share.revokeAria")}
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground mb-3">
          {t("share.noLinks")}
        </p>
      )}

      <Button
        size="sm"
        className="w-full text-xs"
        onClick={handleCreate}
        disabled={creating}
      >
        <Link2 className="h-3.5 w-3.5 mr-1.5" />
        {creating ? t("share.creating") : t("share.createLink")}
      </Button>
    </div>
  );
}

// PERF-12 — Props pré-chargées côté serveur (élimine le round-trip client → API)
interface BreadcrumbAncestor {
  id: string;
  title: string;
  icon: string | null;
}

interface BreadcrumbData {
  space: {
    name: string;
    icon: string | null;
    slug: string;
  };
  ancestors: BreadcrumbAncestor[];
}

interface DocumentPageClientProps {
  initialDoc: DocumentData;
  initialWsToken: string;
  spaceSlug: string;
  breadcrumb: BreadcrumbData;
}

export default function DocumentPageClient({
  initialDoc,
  initialWsToken,
  spaceSlug,
  breadcrumb,
}: DocumentPageClientProps) {
  const t = useTranslations("document");
  const format = useFormatter();
  const docId = initialDoc.id;
  const router = useRouter();

  const [doc, setDoc] = useState<DocumentData>(initialDoc);
  const [docPaddingY, setDocPaddingY] = useState<string>(initialDoc.properties?.editorPaddingY ?? "");
  const [followEnd, setFollowEnd] = useState<boolean>(initialDoc.properties?.followEnd ?? false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [moveDialogOpen, setMoveDialogOpen] = useState(false);
  const [moveDialogMode, setMoveDialogMode] = useState<"move" | "copy">("move");
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [saving, setSaving] = useState(false);
  const [publicShares, setPublicShares] = useState<PublicShareData[]>([]);
  const [wsToken] = useState<string>(initialWsToken);
  const [_contentVersion, setContentVersion] = useState(0);

  // PERF-06 — useReducer pour les panneaux (évite les re-renders en cascade)
  type PanelState = {
    history: boolean;
    backlinks: boolean;
    ai: boolean;
    classification: boolean;
    comments: boolean;
    share: boolean;
  };
  type PanelAction =
    | { type: "toggle"; panel: keyof PanelState }
    | { type: "close"; panel: keyof PanelState };

  const [panels, dispatchPanels] = useReducer(
    (state: PanelState, action: PanelAction): PanelState => {
      if (action.type === "close") {
        return { ...state, [action.panel]: false };
      }
      // toggle — les panneaux latéraux (history, ai, comments) sont mutuellement exclusifs
      const exclusive = ["history", "ai", "comments"] as const;
      if (exclusive.includes(action.panel as typeof exclusive[number])) {
        const newState = { ...state };
        for (const p of exclusive) newState[p] = false;
        newState[action.panel] = !state[action.panel];
        return newState;
      }
      return { ...state, [action.panel]: !state[action.panel] };
    },
    {
      history: false,
      backlinks: true,
      ai: false,
      classification: false,
      comments: false,
      share: false,
    }
  );

  const currentUser = useCurrentUser();
  useSpaceAppearance(spaceSlug);

  // Collaboration hooks
  const { provider, ydoc, isConnected, isSynced, connectionError, pendingUpdates, ydocReady } = useCollaboration({
    documentId: docId,
    token: wsToken,
    enabled: !!wsToken && !!doc,
  });

  const { isOnline } = useNetworkStatus();

  // Lock collab mode: once synced, stay in collab mode to prevent editor re-creation
  // which causes "ystate is undefined" crashes on reconnect
  const collabEverSynced = useRef(false);
  if (isConnected && isSynced) collabEverSynced.current = true;

  // collabActive: triggered by ydocReady (IndexedDB, ~50ms) rather than isSynced (WS, 500ms-2s).
  // collabEverSynced guards reconnect scenarios so collab mode stays active.
  const collabActive = (ydocReady && !!provider && !!ydoc) || collabEverSynced.current;

  // Only mount the editor once collab mode is determined — prevents a flash of text-only content
  // before Yjs (which holds the custom blocks) is applied.
  // If wsToken is absent (read-only public share), mount immediately in solo mode.
  const editorVisible = !wsToken || collabActive;

  const { collaborators } = usePresence({
    provider,
    currentUser,
  });

  // Fallback to lock when collaboration is not available
  const { isLocked, lockedByName, isOwner } = useDocumentLock(
    collabActive ? "" : docId // Disable lock when collab is active
  );
  const lockedByOther = !collabActive && isLocked && !isOwner;

  // Sync status tracking
  const syncStatus = useSyncStatus({
    provider,
    isConnected,
    isSynced,
    pendingUpdates,
  });

  const handleSave = useCallback(
    async (markdown: string) => {
      if (!doc) return;
      setSaving(true);
      try {
        const res = await fetch(`/api/documents/${doc.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: markdown }),
        });
        if (res.ok) {
          toast.success(t("toasts.saved"));
        } else {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch {
        // Network error or server error — queue for later sync
        try {
          await enqueuePendingOp("markdown-save", {
            documentId: doc.id,
            content: markdown,
          });
          toast.info(t("toasts.savePending"));
        } catch {
          toast.error(t("toasts.saveError"));
        }
      }
      setSaving(false);
    },
    [doc, t]
  );

  async function handleIconChange(icon: string | null) {
    if (!doc) return;
    setDoc({ ...doc, icon });
    try {
      await fetch(`/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ icon }),
      });
    } catch {
      // revert en cas d'erreur
      setDoc((prev) => prev ? { ...prev, icon: doc.icon } : prev);
      toast.error(t("toasts.iconChangeError"));
    }
  }

  async function handleClassificationChange(classification: ClassificationLevel) {
    if (!doc || doc.classification === classification) return;

    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classification }),
      });
      if (res.ok) {
        setDoc({ ...doc, classification });
        toast.success(t("toasts.classificationUpdated"));
      } else {
        const data = await res.json();
        toast.error(data.error || t("toasts.classificationError"));
      }
    } catch {
      toast.error(t("toasts.networkError"));
    }
  }

  // Charger les liens de partage si le document est public.
  // On dépend des champs primitifs (et non de `doc` entier) pour ne pas refetch
  // à chaque édition d'un autre champ du document. `docId` est déjà déclaré
  // plus haut (l'id du document est stable).
  const docClassification = doc.classification;
  const docSpaceClassification = doc.spaceClassification;
  useEffect(() => {
    if (!canShareExternally(docClassification, docSpaceClassification)) return;
    fetch(`/api/documents/${docId}/share`)
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) setPublicShares(data);
      })
      .catch(() => {});
  }, [docId, docClassification, docSpaceClassification]);

  function handleRestoreVersion(content: string) {
    if (!doc) return;
    setDoc({ ...doc, content });
    setContentVersion((v) => v + 1);
    toast.info(t("toasts.versionRestored"));
  }

  // Click-outside pour le menu "..."
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (moreMenuRef.current && !moreMenuRef.current.contains(e.target as Node)) {
        setMoreMenuOpen(false);
      }
    }
    if (moreMenuOpen) document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [moreMenuOpen]);

  // Détection du paramètre ?addLibrary= (ajout depuis le store Excalidraw)
  useEffect(() => {
    if (typeof window === "undefined") return;

    const params = new URLSearchParams(window.location.search);
    const addLibraryParam = params.get("addLibrary");
    if (!addLibraryParam) return;

    // Nettoyer l'URL immédiatement pour éviter re-trigger
    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState(null, "", cleanUrl);

    (async () => {
      try {
        // Valider que l'URL provient de libraries.excalidraw.com (protection SSRF)
        const decoded = decodeURIComponent(addLibraryParam);
        const validationError = validateExternalUrl(decoded);
        if (validationError) return;

        const parsed = new URL(decoded);
        if (parsed.hostname !== "libraries.excalidraw.com") return;

        // Charger la bibliothèque distante
        const libRes = await fetch(decoded);
        if (!libRes.ok) return;
        const libData = await libRes.json();
        const newItems: { id: string }[] = Array.isArray(libData.libraryItems)
          ? libData.libraryItems
          : [];
        if (newItems.length === 0) return;

        // Charger les items personnels existants
        const currentRes = await fetch("/api/whiteboard/library");
        const currentData = currentRes.ok ? await currentRes.json() : { items: [] };
        const currentItems: { id: string }[] = Array.isArray(currentData.items)
          ? currentData.items
          : [];

        // Merge sans doublons
        const existingIds = new Set(currentItems.map((i) => i.id));
        const toAdd = newItems.filter((i) => !existingIds.has(i.id));
        if (toAdd.length === 0) {
          toast.info(t("toasts.libraryAlreadyAdded"));
          return;
        }

        const merged = [...currentItems, ...toAdd];

        // Sauvegarder
        await fetch("/api/whiteboard/library", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: merged }),
        });

        toast.success(t("toasts.libraryAdded", { count: toAdd.length }));
      } catch {
        // Silencieux — l'utilisateur peut réessayer
      }
    })();
  }, [t]);

  // Écrit une préférence d'affichage dans `documents.properties` (colonne jsonb).
  // On met aussi `doc.properties` à jour : sans cela, deux réglages écrits l'un
  // après l'autre repartaient du même instantané figé et s'écrasaient mutuellement.
  async function updateDocProperties(patch: NonNullable<DocumentData["properties"]>) {
    const properties = { ...doc.properties, ...patch };
    setDoc((prev) => ({ ...prev, properties }));
    try {
      await fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ properties }),
      });
    } catch {
      // Non-bloquant
    }
  }

  async function handlePaddingChange(value: string) {
    const next = docPaddingY === value ? "" : value;
    setDocPaddingY(next);
    // Le menu reste ouvert : on compare les trois densités d'un coup d'œil.
    await updateDocProperties({ editorPaddingY: next || undefined });
  }

  async function handleFollowEndChange() {
    const next = !followEnd;
    setFollowEnd(next);
    setMoreMenuOpen(false);
    await updateDocProperties({ followEnd: next || undefined });
  }

  async function handleSaveAsTemplate() {
    setMoreMenuOpen(false);
    const name = window.prompt(t("saveAsTemplatePrompt"), doc.title);
    if (!name?.trim()) return;

    try {
      const res = await fetch("/api/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: t("saveAsTemplateDesc", { title: doc.title }),
          content: { markdown: doc.content },
          icon: doc.icon || "📝",
          category: "général", // i18n-ignore — API slug
          isGlobal: true,
        }),
      });

      if (res.ok) {
        toast.success(t("toasts.templateSaved"));
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t("toasts.templateSaveError"));
      }
    } catch {
      toast.error(t("toasts.networkError"));
    }
  }

  async function handleDeleteDocument() {
    setMoreMenuOpen(false);
    if (!window.confirm(t("deleteConfirm"))) return;
    try {
      const res = await fetch(`/api/documents/${docId}`, { method: "DELETE" });
      if (res.ok) {
        toast.success(t("toasts.documentDeleted"));
        router.push(`/s/${spaceSlug}`);
      } else {
        const data = await res.json().catch(() => ({}));
        toast.error(data.error || t("toasts.deleteError"));
      }
    } catch {
      toast.error(t("toasts.networkError"));
    }
  }

  function togglePanel(panel: "history" | "ai" | "comments") {
    dispatchPanels({ type: "toggle", panel });
  }

  // Un seul message d'état à la fois, par ordre de priorité : une erreur de
  // connexion prime sur l'enregistrement en cours, qui prime sur l'horodatage.
  const status: { text: string; tone: "error" | "saving" | "idle"; title?: string } | null =
    connectionError
      ? { text: connectionError, tone: "error" }
      : saving
        ? { text: t("saving"), tone: "saving" }
        : doc.updatedAt
          ? {
              text: t("modifiedAt", {
                relativeTime: format.relativeTime(new Date(doc.updatedAt)),
              }),
              tone: "idle",
              title: format.dateTime(new Date(doc.updatedAt), {
                year: "numeric",
                month: "long",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              }),
            }
          : null;

  // Entrées « Panneaux » du menu — mêmes libellés qu'avant, désormais
  // accessibles aussi sur mobile où les boutons disparaissaient sans repli.
  const panelItems: {
    key: "history" | "backlinks" | "ai" | "comments";
    label: string;
    icon: typeof Clock;
    count?: number;
  }[] = [
    { key: "ai", label: t("toolbar.aiButton"), icon: Sparkles },
    { key: "comments", label: t("toolbar.commentsButton"), icon: MessageSquare },
    { key: "history", label: t("toolbar.historyButton"), icon: Clock },
    {
      key: "backlinks",
      label: t("toolbar.backlinksButton"),
      icon: Eye,
      count: doc.backlinks.length,
    },
  ];

  const menuItemClass =
    "w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm transition-colors hover:bg-accent";
  const sectionClass =
    "px-3 pt-2 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

  return (
    <div className="flex h-full">
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header document */}
        <div className="flex items-center justify-between px-6 py-3 border-b border-border bg-card">
          <nav className="flex items-center gap-1.5 text-sm text-muted-foreground min-w-0 max-w-[200px] md:max-w-none">
            <Link
              href={`/s/${breadcrumb.space.slug}`}
              className="flex items-center gap-1 hover:text-foreground transition-colors shrink-0"
            >
              {breadcrumb.space.icon && (
                <span className="text-sm">{breadcrumb.space.icon}</span>
              )}
              <span>{breadcrumb.space.name}</span>
            </Link>
            {breadcrumb.ancestors.map((ancestor) => (
              <div key={ancestor.id} className="flex items-center gap-1.5 min-w-0">
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                <Link
                  href={`/s/${spaceSlug}/${ancestor.id}`}
                  className="flex items-center gap-1 hover:text-foreground transition-colors truncate"
                >
                  {ancestor.icon && (
                    <span className="text-sm shrink-0">{ancestor.icon}</span>
                  )}
                  <span className="truncate">{ancestor.title}</span>
                </Link>
              </div>
            ))}
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            <div className="flex items-center gap-1.5 min-w-0">
              <EmojiPickerPopover
                value={doc.icon}
                onChange={handleIconChange}
                size="sm"
              />
              <span className="text-foreground font-medium truncate">{doc.title}</span>
            </div>
          </nav>
          <div className="flex items-center gap-1.5">
            {/* Bloc d'état : présence, synchronisation et un seul message */}
            <div className="flex items-center gap-2">
              <CollaboratorsBar
                collaborators={collaborators}
                isConnected={isConnected}
              />
              <SyncStatusIndicator syncStatus={syncStatus} />
              {status && (
                <span
                  className={`text-xs hidden sm:inline ${
                    status.tone === "error"
                      ? "text-destructive"
                      : status.tone === "saving"
                        ? "text-muted-foreground animate-pulse"
                        : "text-muted-foreground"
                  }`}
                  title={status.title}
                >
                  {status.text}
                </span>
              )}
            </div>

            <div className="relative">
              <Button
                variant="ghost"
                size="sm"
                className="text-xs gap-1.5"
                onClick={() => dispatchPanels({ type: "toggle", panel: "classification" })}
                title={t("toolbar.classificationAria")}
              >
                <ClassificationBadge classification={doc.classification} size="sm" />
              </Button>
              <ClassificationSelector
                current={doc.classification}
                allowedLevels={getAllowedDocClassifications(doc.spaceClassification)}
                onChange={handleClassificationChange}
                open={panels.classification}
                onClose={() => dispatchPanels({ type: "close", panel: "classification" })}
              />
            </div>
            <div className="mx-1 h-5 w-px bg-border" aria-hidden="true" />

            {canShareExternally(doc.classification, doc.spaceClassification) && (
              <div className="relative">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs gap-1.5"
                  onClick={() => dispatchPanels({ type: "toggle", panel: "share" })}
                  title={t("toolbar.shareAria")}
                >
                  <Link2 className="h-3.5 w-3.5" />
                  {t("toolbar.shareButton")}
                  {publicShares.length > 0 && (
                    <span className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1.5 rounded-full text-[10px]">
                      {publicShares.length}
                    </span>
                  )}
                </Button>
                <SharePopover
                  documentId={doc.id}
                  shares={publicShares}
                  onShareCreated={(share) => setPublicShares((prev) => [...prev, share])}
                  onShareRevoked={(shareId) => setPublicShares((prev) => prev.filter((s) => s.id !== shareId))}
                  open={panels.share}
                  onClose={() => dispatchPanels({ type: "close", panel: "share" })}
                />
              </div>
            )}
            <ExportDropdown title={doc.title} />
            <div className="relative" ref={moreMenuRef}>
              <Button
                variant="ghost"
                size="sm"
                className="text-xs px-1.5"
                onClick={() => setMoreMenuOpen(!moreMenuOpen)}
                title={t("toolbar.moreAria")}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
              {moreMenuOpen && (
                <div className="absolute right-0 top-full mt-1 z-50 w-64 bg-popover border border-border rounded-lg shadow-lg p-1">
                  <div className={sectionClass}>{t("toolbar.sections.panels")}</div>
                  {panelItems.map(({ key, label, icon: Icon, count }) => (
                    <button
                      key={key}
                      onClick={() => {
                        setMoreMenuOpen(false);
                        if (key === "backlinks") {
                          dispatchPanels({ type: "toggle", panel: "backlinks" });
                        } else {
                          togglePanel(key);
                        }
                      }}
                      className={menuItemClass}
                    >
                      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                      <span className="flex-1">{label}</span>
                      {count !== undefined && count > 0 && (
                        <span className="bg-primary/10 text-primary px-1.5 rounded-full text-[10px]">
                          {count}
                        </span>
                      )}
                      {panels[key] && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </button>
                  ))}

                  <div className="my-1 border-t border-border" />
                  <div className={sectionClass}>{t("toolbar.sections.display")}</div>
                  <button onClick={handleFollowEndChange} className={menuItemClass}>
                    <ArrowDownToLine className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1">{t("toolbar.followEnd")}</span>
                    {followEnd && <Check className="h-4 w-4 shrink-0 text-primary" />}
                  </button>
                  <div className="flex items-center gap-2 px-3 py-2 text-sm">
                    <AlignVerticalJustifyCenter className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="flex-1">{t("toolbar.layoutButton")}</span>
                  </div>
                  <div className="flex gap-1 px-3 pb-2">
                    {(["compact", "normal", "spacious"] as const).map((val) => (
                      <button
                        key={val}
                        onClick={() => handlePaddingChange(val)}
                        className={`flex-1 px-2 py-1 text-xs rounded-md border transition-colors ${
                          docPaddingY === val
                            ? "border-primary bg-primary/10 text-primary font-medium"
                            : "border-border hover:bg-accent text-muted-foreground"
                        }`}
                      >
                        {t(`toolbar.padding.${val}`)}
                      </button>
                    ))}
                  </div>
                  {docPaddingY && (
                    <button
                      onClick={() => handlePaddingChange("")}
                      className="w-full px-3 pb-2 text-left text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {t("toolbar.padding.reset")}
                    </button>
                  )}

                  <div className="my-1 border-t border-border" />
                  <div className={sectionClass}>{t("toolbar.sections.document")}</div>
                  <button onClick={handleSaveAsTemplate} className={menuItemClass}>
                    <LayoutTemplate className="h-4 w-4 shrink-0 text-purple-500" />
                    {t("toolbar.saveAsTemplate")}
                  </button>
                  <button
                    onClick={() => {
                      setMoreMenuOpen(false);
                      setMoveDialogMode("move");
                      setMoveDialogOpen(true);
                    }}
                    className={menuItemClass}
                  >
                    <FolderInput className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {t("toolbar.move")}
                  </button>
                  <button
                    onClick={() => {
                      setMoreMenuOpen(false);
                      setMoveDialogMode("copy");
                      setMoveDialogOpen(true);
                    }}
                    className={menuItemClass}
                  >
                    <Copy className="h-4 w-4 shrink-0 text-muted-foreground" />
                    {t("toolbar.copyToSpace")}
                  </button>
                  <div className="my-1 border-t border-border" />
                  <button
                    onClick={handleDeleteDocument}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
                  >
                    <Trash2 className="h-4 w-4 shrink-0" />
                    {t("toolbar.delete")}
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Lock banner (collab fallback) */}
        {lockedByOther && (
          <LockBanner lockedByName={lockedByName ?? t("unknownUser")} />
        )}

        {/* Editor */}
        <div
          className="flex-1 overflow-hidden"
          style={
            docPaddingY
              ? ({ "--loriax-editor-padding-y": { compact: "0.75rem", normal: "2rem", spacious: "4rem" }[docPaddingY] } as React.CSSProperties)
              : undefined
          }
        >
          {editorVisible ? (
            <LorIAxEditor
              key={`editor-${doc.id}-${collabActive ? "collab" : "solo"}`}
              content={doc.content}
              onSave={collabActive ? undefined : handleSave}
              editable={!lockedByOther}
              spaceId={doc.spaceId}
              documentId={doc.id}
              placeholder={t("placeholder")}
              collaborationEnabled={collabActive}
              provider={provider}
              ydoc={ydoc}
              lockedOffline={!collabActive && lockedByOther && !isOnline}
              followEnd={followEnd}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                {t("documentLoading")}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Side panels (hidden on mobile) */}
      {panels.history && (
        <HistoryPanel
          documentId={doc.id}
          onRestore={handleRestoreVersion}
          onClose={() => dispatchPanels({ type: "close", panel: "history" })}
        />
      )}

      {panels.ai && (
        <AISummaryPanel
          documentId={doc.id}
          onClose={() => dispatchPanels({ type: "close", panel: "ai" })}
        />
      )}

      {panels.comments && currentUser && (
        <CommentsPanel
          documentId={doc.id}
          currentUserId={currentUser.id}
          onClose={() => dispatchPanels({ type: "close", panel: "comments" })}
        />
      )}

      {panels.backlinks && doc.backlinks.length > 0 && !panels.history && !panels.ai && !panels.comments && (
        <BacklinksPanel
          backlinks={doc.backlinks}
          spaceSlug={spaceSlug}
          onClose={() => dispatchPanels({ type: "close", panel: "backlinks" })}
        />
      )}

      <DocumentMoveDialog
        documentId={doc.id}
        documentTitle={doc.title}
        currentSpaceSlug={spaceSlug}
        open={moveDialogOpen}
        onClose={() => setMoveDialogOpen(false)}
        onMoved={() => router.refresh()}
        mode={moveDialogMode}
      />
    </div>
  );
}
