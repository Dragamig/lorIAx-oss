"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Check, Italic, Link2, List, Underline as UnderlineIcon, Unlink } from "lucide-react";
import { Tip } from "@/components/editor/extensions/database-block/row-tip";
import { cn } from "@/lib/utils";

export interface BodyEditorProps {
  value: string;
  onChange: (html: string) => void;
  label: string;
  placeholder?: string;
}

const tool =
  "inline-flex size-7 cursor-pointer items-center justify-center rounded-md border border-transparent text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring aria-pressed:border-border aria-pressed:bg-muted";

const SAFE_URL = /^(https?:\/\/|mailto:)/i;

/** Simple rich editor for outgoing mail: bold, italic, underline, bullet list, link. */
export function BodyEditor({ value, onChange, label, placeholder }: BodyEditorProps) {
  const t = useTranslations("mailing.compose");
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState("");
  const [urlBad, setUrlBad] = useState(false);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
        blockquote: false,
        horizontalRule: false,
        strike: false,
        link: { openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" } },
        underline: {},
      }),
    ],
    content: value,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
        "data-placeholder": placeholder ?? "",
        class: "min-h-40 px-4 py-3 text-sm leading-relaxed outline-none [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
      },
    },
    onUpdate: ({ editor: ed }) => onChange(ed.isEmpty ? "" : ed.getHTML()),
  });

  const active = useEditorState({
    editor,
    selector: ({ editor: ed }) => ({
      bold: ed?.isActive("bold") ?? false,
      italic: ed?.isActive("italic") ?? false,
      underline: ed?.isActive("underline") ?? false,
      list: ed?.isActive("bulletList") ?? false,
      link: ed?.isActive("link") ?? false,
    }),
  });

  function openLink() {
    setUrl((editor?.getAttributes("link").href as string | undefined) ?? "");
    setUrlBad(false);
    setLinkOpen(true);
  }

  function applyLink() {
    const v = url.trim();
    if (!SAFE_URL.test(v)) {
      setUrlBad(true);
      return;
    }
    editor?.chain().focus().extendMarkRange("link").setLink({ href: v }).run();
    setLinkOpen(false);
  }

  function removeLink() {
    editor?.chain().focus().extendMarkRange("link").unsetLink().run();
    setLinkOpen(false);
  }

  const btn = (Icon: typeof Bold, label: string, pressed: boolean, run: () => void) => (
    <Tip label={label}>
      <button type="button" aria-label={label} aria-pressed={pressed} onClick={run} className={tool}>
        <Icon className="size-4" aria-hidden="true" />
      </button>
    </Tip>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="toolbar" aria-label={t("toolbar")} className="flex items-center gap-1 border-b border-border px-3 py-1.5">
        {btn(Bold, t("bold"), active?.bold ?? false, () => editor?.chain().focus().toggleBold().run())}
        {btn(Italic, t("italic"), active?.italic ?? false, () => editor?.chain().focus().toggleItalic().run())}
        {btn(UnderlineIcon, t("underline"), active?.underline ?? false, () => editor?.chain().focus().toggleUnderline().run())}
        {btn(List, t("list"), active?.list ?? false, () => editor?.chain().focus().toggleBulletList().run())}
        {btn(Link2, t("link"), active?.link ?? false, openLink)}
      </div>
      {linkOpen && (
        <div
          className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              setLinkOpen(false);
            }
          }}
        >
          <input
            autoFocus
            type="url"
            value={url}
            aria-label={t("linkUrl")}
            aria-invalid={urlBad || undefined}
            placeholder="https://"
            onChange={(e) => {
              setUrl(e.target.value);
              setUrlBad(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                applyLink();
              }
            }}
            className={cn("h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", urlBad ? "border-destructive" : "border-border")}
          />
          <Tip label={t("linkApplyTip")}>
            <button type="button" aria-label={t("linkApply")} onClick={applyLink} className={tool}>
              <Check className="size-4" aria-hidden="true" />
            </button>
          </Tip>
          <Tip label={t("linkRemove")}>
            <button type="button" aria-label={t("linkRemove")} onClick={removeLink} className={tool}>
              <Unlink className="size-4" aria-hidden="true" />
            </button>
          </Tip>
          {urlBad && <span role="alert" className="text-xs text-destructive">{t("linkInvalid")}</span>}
        </div>
      )}
      <EditorContent editor={editor} className="min-h-0 flex-1 overflow-y-auto" />
    </div>
  );
}
