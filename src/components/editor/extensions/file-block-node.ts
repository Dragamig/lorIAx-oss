import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { FileBlockView } from "./file-block";
import { normalizeFileBlockAttrs, serializeFileBlock } from "./file-block-markdown";

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    fileBlock: {
      setFileBlock: (attrs: {
        mediaId: string;
        filename?: string;
        mimeType?: string;
        size?: number;
        preview?: boolean;
      }) => ReturnType;
    };
  }
}

export const FileBlock = Node.create({
  name: "fileBlock",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      mediaId: {
        default: null,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-media-id")?.toLowerCase() ?? null,
      },
      filename: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-filename") ?? "",
      },
      mimeType: {
        default: "",
        parseHTML: (el: HTMLElement) => el.getAttribute("data-mime-type") ?? "",
      },
      size: {
        default: 0,
        parseHTML: (el: HTMLElement) => {
          const n = Number(el.getAttribute("data-size"));
          return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
        },
      },
      preview: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute("data-preview") === "true",
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-type="file-block"]',
        // Sans identifiant UUID valide : pas de nœud fantôme.
        getAttrs: (el) =>
          normalizeFileBlockAttrs({ mediaId: (el as HTMLElement).getAttribute("data-media-id") })
            ? null
            : false,
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      "div",
      mergeAttributes(
        {
          "data-media-id": node.attrs.mediaId,
          "data-filename": node.attrs.filename,
          "data-mime-type": node.attrs.mimeType,
          "data-size": String(node.attrs.size ?? 0),
          "data-preview": node.attrs.preview ? "true" : "false",
        },
        { "data-type": "file-block" },
        // Les attributs de nœud sont déjà rendus ci-dessus.
        Object.fromEntries(Object.entries(HTMLAttributes).filter(([k]) => k === "class")),
      ),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileBlockView, {
      stopEvent: ({ event }) => {
        const target = event.target as HTMLElement | null;
        return !!(target && target.closest("a, button"));
      },
    });
  },

  addCommands() {
    return {
      setFileBlock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({
            type: this.name,
            attrs: { filename: "", mimeType: "", size: 0, preview: false, ...attrs },
          }),
    };
  },

  addStorage() {
    return {
      markdown: {
        serialize(
          state: {
            out: string;
            write: (s?: string) => void;
            flushClose: (size?: number) => void;
            closeBlock: (n: unknown) => void;
          },
          node: { attrs: Record<string, unknown> },
        ) {
          // Un bloc précédent qui ne ferme pas (image) ne doit pas absorber la balise.
          state.flushClose(2);
          if (state.out && !state.out.endsWith("\n\n")) {
            state.out += state.out.endsWith("\n") ? "\n" : "\n\n";
          }
          state.write(serializeFileBlock(node.attrs));
          state.closeBlock(node);
        },
        parse: {},
      },
    };
  },
});
