"use client";

import { Extension } from "@tiptap/react";
import { ReactRenderer } from "@tiptap/react";
import Suggestion from "@tiptap/suggestion";
import type { SuggestionProps, SuggestionKeyDownProps } from "@tiptap/suggestion";
import type { Editor, Range } from "@tiptap/core";
import { PluginKey, NodeSelection, Selection, TextSelection } from "@tiptap/pm/state";
import tippy, { type Instance as TippyInstance } from "tippy.js";

import { commands, defaultAliases } from "./commands";
import { CommandList } from "./command-list";
import type { SuggestionListRef } from "@/types/editor";

// Alias custom chargés depuis l'API admin — remplacent les défauts par commande
let _customAliases: Record<string, string[]> = {};

export function setCustomAliases(aliases: Record<string, string[]>) {
  _customAliases = aliases;
}

function getEffectiveAliases(title: string): string[] {
  return _customAliases[title] ?? defaultAliases[title] ?? [];
}

// Modules actifs chargés depuis /api/modules/active — null = pas encore chargé
// (on n'occulte alors aucune commande, pour éviter un flash de menu incomplet).
let _activeModules: Set<string> | null = null;

export function setActiveModules(ids: string[]) {
  _activeModules = new Set(ids);
}

/**
 * Rend la main à l'usager après l'insertion d'un bloc.
 *
 * Les blocs de l'éditeur sont des nœuds atomiques : après `insertContent`,
 * ProseMirror laisse une sélection de nœud sur le bloc inséré, et le navigateur
 * peint alors tout son contenu comme sélectionné. L'usager vient pourtant
 * seulement de créer le bloc, il s'attend à le voir au repos.
 *
 * On place donc un simple curseur juste après le bloc, dans le nœud de texte
 * qui suit s'il en existe un, sinon dans un paragraphe créé pour l'occasion
 * (cas du bloc inséré en fin de document, qui serait autrement impossible à
 * quitter au clavier).
 *
 * Sans effet quand la commande ne laisse pas de sélection de nœud, ce qui est
 * le cas de toutes les commandes de texte (titres, listes, citations).
 */
function placerCurseurApresBloc(editor: Editor): void {
  const selection = editor.state.selection;
  if (!(selection instanceof NodeSelection)) return;

  const apres = selection.to;
  const suivante = Selection.near(editor.state.doc.resolve(apres), 1);

  if (suivante instanceof TextSelection && suivante.from >= apres) {
    editor.chain().setTextSelection(suivante.from).focus().run();
    return;
  }
  editor.chain().createParagraphNear().focus().run();
}

export const SlashCommands = Extension.create({
  name: "slashCommands",

  addOptions() {
    return {
      suggestion: {
        char: "/",
        allowSpaces: true,
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: Range;
          props: SuggestionProps;
        }) => {
          props.command({ editor, range });
          placerCurseurApresBloc(editor);
        },
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        pluginKey: new PluginKey("slashCommands"),
        editor: this.editor,
        ...this.options.suggestion,
        items: ({ query }: { query: string }) => {
          const q = query.toLowerCase();
          const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
          return commands.filter(
            (item) =>
              (!isMobile || !item.desktopOnly) &&
              (!item.module || _activeModules === null || _activeModules.has(item.module)) &&
              (item.title.toLowerCase().includes(q) ||
              item.description.toLowerCase().includes(q) ||
              getEffectiveAliases(item.title).some((alias) => alias.toLowerCase().includes(q)))
          );
        },
        render: () => {
          let component: ReactRenderer | null = null;
          let popup: TippyInstance | null = null;

          return {
            onStart: (props: SuggestionProps) => {
              component = new ReactRenderer(CommandList, {
                props,
                editor: props.editor,
              });

              if (!props.clientRect) return;

              popup = tippy(document.body, {
                getReferenceClientRect: props.clientRect as () => DOMRect,
                appendTo: () => document.body,
                content: component.element,
                showOnCreate: true,
                interactive: true,
                trigger: "manual",
                placement: "bottom-start",
              }) as unknown as TippyInstance;
            },
            onUpdate(props: SuggestionProps) {
              component?.updateProps(props);
              if (props.clientRect) {
                popup?.setProps({
                  getReferenceClientRect: props.clientRect as () => DOMRect,
                });
              }
            },
            onKeyDown(props: SuggestionKeyDownProps) {
              if (props.event.key === "Escape") {
                popup?.hide();
                return true;
              }
              const ref = component?.ref as SuggestionListRef | null;
              return ref?.onKeyDown?.(props) || false;
            },
            onExit() {
              popup?.destroy();
              component?.destroy();
            },
          };
        },
      }),
    ];
  },
});
