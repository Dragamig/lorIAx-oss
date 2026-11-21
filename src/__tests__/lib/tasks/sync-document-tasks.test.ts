import { describe, it, expect } from "vitest";
import { extractTaskItems } from "@/lib/tasks/sync-document-tasks";

describe("extractTaskItems", () => {
  it("extrait une tâche simple avec texte", () => {
    const doc = {
      type: "doc",
      content: [{
        type: "taskList",
        content: [{
          type: "taskItem",
          attrs: { nodeId: "abc-123", checked: false, assigneeId: null, assigneeName: null },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Ma tâche" }] }],
        }],
      }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = extractTaskItems(doc as any);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      nodeId: "abc-123",
      title: "Ma tâche",
      checked: false,
      status: "open",
      assigneeId: null,
    });
  });

  it("ignore les tâches sans nodeId", () => {
    const doc = {
      type: "doc",
      content: [{
        type: "taskList",
        content: [{
          type: "taskItem",
          attrs: { nodeId: null, checked: false },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Tâche sans id" }] }],
        }],
      }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(extractTaskItems(doc as any)).toHaveLength(0);
  });

  it("auto-assigne au premier @mention si assigneeId est null", () => {
    const doc = {
      type: "doc",
      content: [{
        type: "taskList",
        content: [{
          type: "taskItem",
          attrs: { nodeId: "task-1", checked: false, assigneeId: null },
          content: [{
            type: "paragraph",
            content: [
              { type: "mention", attrs: { id: "user-uuid-1", label: "Alice" } },
              { type: "text", text: " corriger le bug" },
            ],
          }],
        }],
      }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = extractTaskItems(doc as any);
    expect(items[0].assigneeId).toBe("user-uuid-1");
    expect(items[0].title).toBe("@Alice corriger le bug");
  });

  it("respecte assigneeId explicite (priorité sur la mention)", () => {
    const doc = {
      type: "doc",
      content: [{
        type: "taskList",
        content: [{
          type: "taskItem",
          attrs: { nodeId: "task-2", checked: false, assigneeId: "explicit-user-id" },
          content: [{
            type: "paragraph",
            content: [
              { type: "mention", attrs: { id: "other-user", label: "Bob" } },
            ],
          }],
        }],
      }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = extractTaskItems(doc as any);
    expect(items[0].assigneeId).toBe("explicit-user-id");
  });

  it("marque comme done si checked = true", () => {
    const doc = {
      type: "doc",
      content: [{
        type: "taskList",
        content: [{
          type: "taskItem",
          attrs: { nodeId: "done-1", checked: true, assigneeId: null },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Faite" }] }],
        }],
      }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(extractTaskItems(doc as any)[0].checked).toBe(true);
  });

  it("gère plusieurs tâches dans un même document", () => {
    const doc = {
      type: "doc",
      content: [{
        type: "taskList",
        content: [
          {
            type: "taskItem",
            attrs: { nodeId: "t1", checked: false, assigneeId: null },
            content: [{ type: "paragraph", content: [{ type: "text", text: "Tâche 1" }] }],
          },
          {
            type: "taskItem",
            attrs: { nodeId: "t2", checked: true, assigneeId: "u1" },
            content: [{ type: "paragraph", content: [{ type: "text", text: "Tâche 2" }] }],
          },
        ],
      }],
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const items = extractTaskItems(doc as any);
    expect(items).toHaveLength(2);
    expect(items[1].nodeId).toBe("t2");
    expect(items[1].assigneeId).toBe("u1");
  });
});
