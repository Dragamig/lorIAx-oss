"use client";

import { useCallback, useRef, useState } from "react";
import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer, NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/core";
import { Braces, Check } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { stopMouse } from "../utils/stop-mouse";

// Slugifie un libellé en clé de placeholder ({{key}}) : minuscules, sans
// accents, séparateurs → underscores. Partagé entre saisie auto et manuelle.
export function slugifyVariableKey(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

// ─── Node View (rendu de la puce dans l'éditeur) ───────────────────────────

function TemplateVariableView({
  node,
  updateAttributes,
  deleteNode,
  editor,
}: NodeViewProps) {
  const key = (node.attrs.key as string) || "";
  const label = (node.attrs.label as string) || "";
  const editable = editor?.isEditable ?? false;
  const displayLabel = label || key || "Variable";

  // Ouvre le formulaire d'emblée juste après insertion (clé encore vide).
  const [open, setOpen] = useState(editable && !key);
  const [labelDraft, setLabelDraft] = useState(label);
  const [keyDraft, setKeyDraft] = useState(key);
  // La clé cesse d'être auto-dérivée dès que l'utilisateur la modifie à la main.
  const [keyTouched, setKeyTouched] = useState(!!key);
  // Distingue une fermeture après validation d'une annulation (pour ne pas
  // laisser un {{}} vide polluer extractTemplateVariables).
  const committedRef = useRef(false);

  const onLabelChange = useCallback(
    (value: string) => {
      setLabelDraft(value);
      if (!keyTouched) setKeyDraft(slugifyVariableKey(value));
    },
    [keyTouched]
  );

  const onKeyChange = useCallback((value: string) => {
    setKeyTouched(true);
    setKeyDraft(slugifyVariableKey(value));
  }, []);

  const commit = useCallback(() => {
    const finalKey = slugifyVariableKey(keyDraft || labelDraft);
    if (!finalKey) return; // clé obligatoire — on garde le formulaire ouvert
    committedRef.current = true;
    updateAttributes({ key: finalKey, label: labelDraft.trim() || finalKey });
    setOpen(false);
  }, [keyDraft, labelDraft, updateAttributes]);

  const onOpenChange = useCallback(
    (next: boolean) => {
      if (next) {
        // (Ré)ouverture : réamorce les brouillons depuis les attributs actuels.
        committedRef.current = false;
        setLabelDraft(label);
        setKeyDraft(key);
        setKeyTouched(!!key);
        setOpen(true);
        return;
      }
      // Fermeture : si on annule une variable jamais configurée, on la retire.
      if (!committedRef.current && !key) {
        deleteNode();
        return;
      }
      setOpen(false);
    },
    [key, label, deleteNode]
  );

  // Lecture seule : simple puce, sans interaction.
  if (!editable) {
    return (
      <NodeViewWrapper
        as="span"
        className="template-variable-wrapper"
        contentEditable={false}
      >
        <span
          className="inline-flex items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-xs font-medium text-violet-700 dark:bg-violet-950 dark:text-violet-300"
          title={`Placeholder : ${key}`}
        >
          <Braces className="h-3 w-3" />
          {displayLabel}
        </span>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper
      as="span"
      className="template-variable-wrapper"
      contentEditable={false}
    >
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger
          render={
            <button
              type="button"
              onMouseDown={stopMouse}
              className={
                "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium transition-colors " +
                (key
                  ? "bg-violet-100 text-violet-700 hover:bg-violet-200 dark:bg-violet-950 dark:text-violet-300 dark:hover:bg-violet-900"
                  : "border border-dashed border-violet-400 bg-violet-50 text-violet-500 dark:border-violet-700 dark:bg-violet-950/40 dark:text-violet-400")
              }
              title={key ? `Placeholder : ${key}` : "Configurer la variable"}
            >
              <Braces className="h-3 w-3" />
              {displayLabel}
            </button>
          }
        />
        <PopoverContent className="w-64" onMouseDown={stopMouse}>
          <div className="flex flex-col gap-2">
            <span className="flex items-center gap-1.5 text-sm font-medium">
              <Braces className="h-4 w-4 text-violet-500" /> Variable de modèle
            </span>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Nom de la variable
              <input
                autoFocus
                value={labelDraft}
                onChange={(e) => onLabelChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                  }
                }}
                onMouseDown={stopMouse}
                placeholder="Prénom"
                className="rounded border bg-background px-2 py-1.5 text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">
              Clé ({"{{clé}}"})
              <input
                value={keyDraft}
                onChange={(e) => onKeyChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commit();
                  }
                }}
                onMouseDown={stopMouse}
                placeholder="prenom"
                className="rounded border bg-background px-2 py-1.5 font-mono text-sm text-foreground outline-none placeholder:text-muted-foreground/50"
              />
            </label>
            <button
              type="button"
              onClick={commit}
              onMouseDown={stopMouse}
              disabled={!slugifyVariableKey(keyDraft || labelDraft)}
              className="inline-flex items-center justify-center gap-1 self-end rounded bg-violet-500 px-2.5 py-1 text-xs font-medium text-white hover:bg-violet-600 disabled:opacity-50"
            >
              <Check className="h-3.5 w-3.5" /> Valider
            </button>
          </div>
        </PopoverContent>
      </Popover>
    </NodeViewWrapper>
  );
}

// ─── Extension TipTap : TemplateVariable Node ──────────────────────────────

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    templateVariable: {
      setTemplateVariable: (attrs: { key: string; label: string }) => ReturnType;
    };
  }
}

export const TemplateVariable = Node.create({
  name: "templateVariable",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      key: { default: "" },
      label: { default: "" },
    };
  },

  parseHTML() {
    return [
      {
        tag: "span[data-template-variable]",
        getAttrs: (dom) => {
          if (!(dom instanceof HTMLElement)) return { key: "", label: "" };
          return {
            key: dom.getAttribute("data-key") || "",
            label: dom.getAttribute("data-label") || "",
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "span",
      mergeAttributes(HTMLAttributes, {
        "data-template-variable": "",
        "data-key": HTMLAttributes.key,
        "data-label": HTMLAttributes.label || HTMLAttributes.key,
      }),
      HTMLAttributes.label || HTMLAttributes.key,
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TemplateVariableView);
  },

  addCommands() {
    return {
      setTemplateVariable:
        (attrs) =>
        ({ chain }) => {
          return chain()
            .insertContent({
              type: this.name,
              attrs,
            })
            .run();
        },
    };
  },

  // Sérialisation markdown : {{key}} — compatible avec `interpolate` /
  // `instantiateTemplate` et `scanMarkdownPlaceholders` (Task 10).
  addStorage() {
    return {
      markdown: {
        serialize(state: { write: (s: string) => void }, node: { attrs: Record<string, string> }) {
          state.write(`{{${node.attrs.key || ""}}}`);
        },
        parse: {
          // Le parsing markdown → nœud n'est pas nécessaire : les anciens
          // templates en `{{clé}}` texte restent gérés par le repli de scan
          // (`scanMarkdownPlaceholders`), pas par une reconversion en nœud.
        },
      },
    };
  },
});
