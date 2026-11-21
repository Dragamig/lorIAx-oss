import TaskItem from "@tiptap/extension-task-item";
import { ReactNodeViewRenderer } from "@tiptap/react";
import { Plugin } from "prosemirror-state";
import { TaskItemView } from "./task-assignee-button";

export const TaskItemAssignable = TaskItem.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      nodeId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-node-id"),
        renderHTML: (attrs) => attrs.nodeId ? { "data-node-id": attrs.nodeId } : {},
      },
      assigneeId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-assignee-id") || null,
        renderHTML: (attrs) => attrs.assigneeId ? { "data-assignee-id": attrs.assigneeId } : {},
      },
      assigneeName: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-assignee-name") || null,
        renderHTML: (attrs) => attrs.assigneeName ? { "data-assignee-name": attrs.assigneeName } : {},
      },
      status: {
        default: "open",
        parseHTML: (el) => el.getAttribute("data-status") || "open",
        renderHTML: (attrs) => ({ "data-status": attrs.status || "open" }),
      },
    };
  },

  onCreate() {
    const { state, view } = this.editor;
    const { doc } = state;
    let tr = state.tr;
    let changed = false;
    doc.descendants((node, pos) => {
      if (node.type.name === "taskItem" && !node.attrs.nodeId) {
        tr = tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          nodeId: crypto.randomUUID(),
        });
        changed = true;
      }
    });
    if (changed) view.dispatch(tr);
  },

  addKeyboardShortcuts() {
    return {
      Enter: () =>
        this.editor
          .chain()
          .splitListItem(this.name)
          .command(({ tr, state }) => {
            // Clear assignee and nodeId on the new item so it gets a fresh UUID
            const { $from } = state.selection;
            for (let d = $from.depth; d >= 0; d--) {
              if ($from.node(d).type.name === "taskItem") {
                tr.setNodeMarkup($from.before(d), undefined, {
                  ...$from.node(d).attrs,
                  assigneeId: null,
                  assigneeName: null,
                  nodeId: null,
                  status: "open",
                  checked: false,
                });
                return true;
              }
            }
            return true;
          })
          .run(),
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, _oldState, newState) {
          if (!transactions.some((tr) => tr.docChanged)) return null;
          let tr = newState.tr;
          let changed = false;
          newState.doc.descendants((node, pos) => {
            if (node.type.name === "taskItem" && !node.attrs.nodeId) {
              tr = tr.setNodeMarkup(pos, undefined, {
                ...node.attrs,
                nodeId: crypto.randomUUID(),
              });
              changed = true;
            }
          });
          return changed ? tr : null;
        },
      }),
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TaskItemView);
  },
}).configure({ nested: true });
