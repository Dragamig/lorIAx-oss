"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import { TaskItemAssignable } from "./extensions/task-item-assignable";
import { Checklist, ChecklistItem } from "./extensions/checklist";
import { useTaskSync } from "@/hooks/use-task-sync";
import { ImageWithMissingState } from "./extensions/image-with-missing-state";
import TiptapLink from "@tiptap/extension-link";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import Highlight from "@tiptap/extension-highlight";
import { TableExtended } from "./extensions/table-block/table-extended";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { common, createLowlight } from "lowlight";
import Dropcursor from "@tiptap/extension-dropcursor";
import Collaboration from "@tiptap/extension-collaboration";
// lowlight est chargé dynamiquement pour réduire le bundle initial (~180KB)
import { Markdown } from "tiptap-markdown";
import { useEffect, useRef, useMemo, useState } from "react";
import { EditorToolbar } from "./editor-toolbar";
import { EditorImagePicker } from "./editor-image-picker";
import { EditorFilePicker } from "./editor-file-picker";
import { useFollowEnd } from "./use-follow-end";
import { WikiLink, WikiLinkSuggestion } from "./extensions/wiki-link";
import { TemplateVariable } from "./extensions/template-variable";
import { GoogleDocsEmbed } from "./extensions/google-docs-embed";
import { LinkPreview } from "./extensions/link-preview";
import { MentionExtension } from "./extensions/mention-extension";
import { SlashCommands, setCustomAliases, setActiveModules } from "./extensions/slash-commands/slash-extension";
import { ChartBlock } from "./extensions/chart-block-node";
import { DatabaseBlock } from "./extensions/database-block/node";
import { WhiteboardBlock } from "./extensions/whiteboard-block-node";
import { MindmapBlock } from "./extensions/mindmap-block-node";
import { MapBlock } from "./extensions/map-block-node";
import { CalendarBlock } from "./extensions/calendar-block-node";
import { ChronoBlock } from "./extensions/chrono-block-node";
import { AutomationButtonBlock } from "./extensions/button-block-node";
import { EventInlineNode } from "./extensions/event-inline-node";
import { SpreadsheetBlock } from "./extensions/spreadsheet-block-node";
import { SyncedBlock } from "./extensions/synced-block-node";
import { OPTIONAL_EDITOR_EXTENSIONS } from "./extensions/optional.generated";
import { BlockquoteWithAuthor } from "./extensions/blockquote-with-author";
import { CalloutBlock } from "./extensions/callout-block";
import { EditorContext } from "./extensions/editor-context";
import { MetaContext } from "./extensions/meta-context";
import { PreserveFieldSelection } from "./extensions/preserve-field-selection";
import { Details, DetailsSummary, DetailsContent } from "./extensions/details-block";
import { WifiOff } from "lucide-react";
import type { HocuspocusProvider } from "@hocuspocus/provider";
import type * as Y from "yjs";

// CodeBlockLowlight chargé statiquement. L'import dynamique précédent laissait
// useEditor (deps stables) créer l'éditeur AVANT la résolution de la promesse :
// l'extension n'était jamais réinjectée, donc toggleCodeBlock restait absent et
// « /Code » était un no-op permanent en prod dès le 1er montage (issue #89).
const codeBlockExt = CodeBlockLowlight.configure({ lowlight: createLowlight(common) });

interface LorIAxEditorProps {
  content: string;
  onChange?: (markdown: string) => void;
  onSave?: (markdown: string) => void;
  editable?: boolean;
  placeholder?: string;
  spaceId?: string;
  documentId?: string;
  // Collaboration props
  collaborationEnabled?: boolean;
  provider?: HocuspocusProvider | null;
  ydoc?: Y.Doc | null;
  // Pessimistic lock mode: read-only when offline and locked by another user
  lockedOffline?: boolean;
  // Garde la vue collée au bas du document quand du contenu s'ajoute
  followEnd?: boolean;
}

export function LorIAxEditor({
  content,
  onChange,
  onSave,
  editable = true,
  placeholder = "Tapez / pour inserer un bloc...",
  spaceId,
  documentId,
  collaborationEnabled = false,
  provider,
  ydoc,
  lockedOffline = false,
  followEnd = false,
}: LorIAxEditorProps) {
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scrollContainer, setScrollContainer] = useState<HTMLDivElement | null>(null);
  useFollowEnd(scrollContainer, followEnd);
  const syncTasks = useTaskSync(documentId);
  const isCollab = collaborationEnabled && ydoc && provider;
  // In collab mode (Yjs CRDT), always allow editing — merging happens automatically.
  // Only restrict editing for pessimistic lock mode when offline.
  const effectiveEditable = lockedOffline ? false : editable;

  // Charger les alias custom des slash commands
  useEffect(() => {
    fetch("/api/admin/slash-aliases")
      .then((r) => r.ok ? r.json() : {})
      .then((aliases) => setCustomAliases(aliases))
      .catch(() => {});
  }, []);

  // Charger les capacités des modules actifs : pilote extensions + /commandes.
  // null tant que non chargé → on ne masque rien (évite un flash de blocs absents).
  const [activeExt, setActiveExt] = useState<Set<string> | null>(null);
  useEffect(() => {
    fetch("/api/modules/active")
      .then((r) => (r.ok ? r.json() : null))
      .then((caps) => {
        if (!caps) return;
        setActiveExt(new Set<string>(caps.editorExtensions ?? []));
        setActiveModules(caps.modules ?? []);
      })
      .catch(() => {});
  }, []);

  // Build extensions list based on collaboration mode
  const extensions = useMemo(() => {
    // Charge une extension de module seulement si le module est actif.
    // activeExt === null (capacités non encore chargées) → on ne masque rien.
    const gate = <T,>(key: string, ext: T): T[] =>
      activeExt === null || activeExt.has(key) ? [ext] : [];

    const baseExtensions = [
      StarterKit.configure({
        codeBlock: false,
        dropcursor: false,
        blockquote: false,
        link: false,       // Configured explicitly below
        underline: false,  // Configured explicitly below
        // Disable undo/redo when collaboration is enabled (Yjs handles history).
        // StarterKit v3 renamed the `history` extension to `undoRedo`; the old
        // `history` key was silently ignored, leaving UndoRedo active in collab.
        ...(isCollab ? { undoRedo: false as const } : {}),
      }),
      BlockquoteWithAuthor,
      CalloutBlock,
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItemAssignable,
      Checklist,
      ChecklistItem,
      ImageWithMissingState.configure({ inline: false, allowBase64: true }),
      TiptapLink.configure({
        openOnClick: false,
        HTMLAttributes: { class: "text-primary underline" },
      }),
      Underline,
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      TableExtended.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      codeBlockExt,
      Dropcursor.configure({ color: "var(--primary)", width: 2 }),
      WikiLink,
      WikiLinkSuggestion,
      TemplateVariable,
      MentionExtension,
      SlashCommands,
      GoogleDocsEmbed,
      LinkPreview,
      ChartBlock,
      DatabaseBlock,
      WhiteboardBlock,
      ...Object.entries(OPTIONAL_EDITOR_EXTENSIONS).flatMap(([key, ext]) =>
        // Le nœud Fichier reste enregistré même module désactivé : les blocs existants
        // restent lisibles (seule la commande d'insertion disparaît).
        key === "FileBlock" ? [ext] : gate(key, ext),
      ),
      MindmapBlock,
      MapBlock,
      CalendarBlock,
      ChronoBlock,
      AutomationButtonBlock,
      EventInlineNode,
      SpreadsheetBlock,
      SyncedBlock,
      EditorContext,
      MetaContext,
      PreserveFieldSelection,
      Details,
      DetailsSummary,
      DetailsContent,
      Markdown.configure({
        html: true,
        transformCopiedText: true,
        transformPastedText: true,
      }),
    ];

    // Add collaboration extensions when enabled
    if (isCollab) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      baseExtensions.push(
        Collaboration.configure({
          document: ydoc,
        }) as any,
      );
      /* eslint-enable @typescript-eslint/no-explicit-any */
    }

    return baseExtensions;
  }, [isCollab, ydoc, placeholder, activeExt]);

  const editor = useEditor({
    extensions,
    immediatelyRender: false,
    // In collaboration mode, content comes from Yjs, not from props
    content: isCollab ? undefined : content,
    editable: effectiveEditable,
    editorProps: {
      attributes: {
        class: "focus:outline-none min-h-[300px] px-4 py-4 md:px-8 md:py-6",
      },
      handleKeyDown: (_view, event) => {
        // Ctrl+S pour sauvegarder
        if ((event.metaKey || event.ctrlKey) && event.key === "s") {
          event.preventDefault();
          if (onSave && editor && !isCollab) {
            const storage = editor.storage as { markdown?: { getMarkdown?: () => string } };
            const md = typeof storage.markdown?.getMarkdown === 'function' ? storage.markdown.getMarkdown() : "";
            onSave(md);
          }
          return true;
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      // Always sync task assignees regardless of collab mode
      syncTasks(editor);

      if (!isCollab) {
        const md = (editor.storage as { markdown?: { getMarkdown: () => string } }).markdown?.getMarkdown() ?? "";
        onChange?.(md);

        // Auto-save avec debounce (2s)
        if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = setTimeout(() => {
          onSave?.(md);
        }, 2000);
      }
    },
  });

  // Expose ydoc/provider dans le storage EditorContext pour les extensions canvas
  useEffect(() => {
    type EditorContextStorage = { editorContext?: { ydoc: unknown; provider: unknown } };
    const storage = editor?.storage as EditorContextStorage | undefined;
    if (editor && storage?.editorContext) {
      storage.editorContext.ydoc = ydoc ?? null;
      storage.editorContext.provider = provider ?? null;
    }
  }, [editor, ydoc, provider]);

  // Exposer spaceId/docId — window pour les blocs legacy, storage pour les composants avec accès editor
  useEffect(() => {
    if (spaceId) window.__loriax_spaceId = spaceId;
    if (documentId) window.__loriax_docId = documentId;
    type MetaStorage = { metaContext?: { spaceId: string; docId: string } };
    const meta = (editor?.storage as MetaStorage | undefined)?.metaContext;
    if (meta) {
      meta.spaceId = spaceId ?? "";
      meta.docId = documentId ?? "";
    }
  }, [spaceId, documentId, editor]);

  // Sync initial des tâches au chargement (délai pour laisser Yjs charger le contenu en mode collab)
  useEffect(() => {
    if (!editor || !documentId) return;
    const t = setTimeout(() => {
      syncTasks(editor);
    }, isCollab ? 4000 : 500);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, documentId]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // Expose getMarkdown pour usage externe (ref directe vers l'éditeur)
  useEffect(() => {
    (window as Window & { __loriax_getMarkdown?: () => string }).__loriax_getMarkdown = () => {
      if (!editor) return "";
      return (editor.storage as { markdown?: { getMarkdown?: () => string } }).markdown?.getMarkdown?.() ?? "";
    };
    return () => {
      delete (window as Window & { __loriax_getMarkdown?: () => string }).__loriax_getMarkdown;
    };
  }, [editor]);

  // Écouter l'événement "Verser dans le document" émis par le chat panel
  useEffect(() => {
    const handleInsertBlock = (e: Event) => {
      const node = (e as CustomEvent).detail;
      if (!editor || !node) return;
      editor.commands.insertContent(node);
    };
    window.addEventListener("loriax:insert-block", handleInsertBlock);
    return () => window.removeEventListener("loriax:insert-block", handleInsertBlock);
  }, [editor]);

  if (!editor) return null;

  return (
    <div className="tiptap-editor flex flex-col h-full bg-card rounded-lg border border-border overflow-hidden">
      {lockedOffline && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 dark:bg-amber-950/40 border-b border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 text-sm">
          <WifiOff className="h-4 w-4 flex-shrink-0" />
          <span>Lecture seule (verrou actif, hors ligne)</span>
        </div>
      )}
      {effectiveEditable && <EditorToolbar editor={editor} />}
      {effectiveEditable && <EditorImagePicker editor={editor} />}
      {effectiveEditable && <EditorFilePicker editor={editor} />}
      <div className="flex-1 overflow-y-auto" ref={setScrollContainer}>
        <EditorContent editor={editor} />
        {/* Espace de respiration en fin de document — clic pour focus l'éditeur */}
        <div
          className="min-h-[40vh] cursor-text"
          onClick={() => editor?.commands.focus("end")}
        />
      </div>
    </div>
  );
}
