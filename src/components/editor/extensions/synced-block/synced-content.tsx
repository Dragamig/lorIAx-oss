"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TiptapLink from "@tiptap/extension-link";
import Highlight from "@tiptap/extension-highlight";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import TiptapImage from "@tiptap/extension-image";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { Markdown } from "tiptap-markdown";
import { TableExtended } from "../table-block/table-extended";

/**
 * Rendu lecture seule d'un contenu markdown via un sous-éditeur TipTap.
 * On réutilise la même pile de rendu que l'éditeur principal (parsing markdown
 * assuré par tiptap-markdown au passage de `content`) pour garantir la fidélité
 * du texte synchronisé. L'éditeur est recréé quand le markdown change (deps),
 * ce qui force un nouveau parsing markdown du contenu rafraîchi.
 */
export function SyncedContent({ markdown }: { markdown: string }) {
  const editor = useEditor(
    {
      editable: false,
      immediatelyRender: false,
      content: markdown,
      extensions: [
        // StarterKit v3 embarque link/underline : on les désactive pour les
        // configurer explicitement (cohérent avec l'éditeur principal).
        StarterKit.configure({ link: false, underline: false }),
        Underline,
        TiptapLink.configure({
          openOnClick: true,
          HTMLAttributes: {
            class: "text-primary underline",
            target: "_blank",
            rel: "noopener noreferrer",
          },
        }),
        Highlight.configure({ multicolor: true }),
        TextStyle,
        Color,
        TiptapImage.configure({ inline: false, allowBase64: true }),
        TaskList,
        TaskItem.configure({ nested: true }),
        TableExtended.configure({ resizable: false }),
        TableRow,
        TableCell,
        TableHeader,
        Markdown.configure({ html: true, transformCopiedText: true }),
      ],
      editorProps: {
        attributes: { class: "focus:outline-none" },
      },
    },
    [markdown],
  );

  if (!editor) {
    return (
      <div className="text-sm text-muted-foreground animate-pulse px-1 py-2">
        Chargement…
      </div>
    );
  }

  return (
    <EditorContent
      editor={editor}
      className="synced-block-prose prose prose-sm dark:prose-invert max-w-none"
    />
  );
}
