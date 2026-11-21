import { describe, expect, it } from "vitest";
import { formatHistoryValue, groupRowActivity, groupRowHistory } from "@/components/bases/row-activity-model";
import type { RowHistoryItem } from "@/lib/databases/row-history-types";

let n = 0;
function item(over: Partial<RowHistoryItem> & { at: string }): RowHistoryItem {
  n += 1;
  const { at, ...rest } = over;
  return {
    id: `i${n}`,
    kind: "updated",
    source: "ui",
    actor: { id: "u1", name: "Ana" },
    actorLabel: null,
    automationId: null,
    batchId: `b${n}`,
    changes: [{ columnId: "c", columnName: "Nom", columnType: "text", before: "a", after: "b" }],
    createdAt: at,
    ...rest,
  };
}

const T = (s: number) => new Date(Date.UTC(2026, 10, 14, 10, 0, 0) + s * 1000).toISOString();

describe("groupRowHistory", () => {
  it("regroupe 3 modifications du même acteur à moins de 2 minutes", () => {
    const g = groupRowHistory([item({ at: T(100) }), item({ at: T(50) }), item({ at: T(0) })]);
    expect(g).toHaveLength(1);
    expect(g[0].changes).toHaveLength(3);
    expect(g[0].items).toHaveLength(3);
  });

  it("ne regroupe pas des acteurs ou des sources différents", () => {
    const g = groupRowHistory([
      item({ at: T(30) }),
      item({ at: T(20), actor: { id: "u2", name: "Bob" } }),
      item({ at: T(10), source: "import" }),
    ]);
    expect(g).toHaveLength(3);
  });

  it("ne regroupe pas au-delà de la fenêtre", () => {
    expect(groupRowHistory([item({ at: T(300) }), item({ at: T(0) })])).toHaveLength(2);
  });

  it("created et deleted ne sont jamais regroupés", () => {
    const g = groupRowHistory([
      item({ at: T(30), kind: "created" }),
      item({ at: T(20), kind: "created" }),
      item({ at: T(10), kind: "updated" }),
    ]);
    expect(g).toHaveLength(3);
  });

  it("deleted masqué sans restauration ultérieure, affiché après", () => {
    const del = item({ at: T(10), kind: "deleted" });
    expect(groupRowHistory([del, item({ at: T(0) })]).map((x) => x.kind)).toEqual(["updated"]);
    const restore = item({ at: T(20), kind: "created", source: "restore" });
    expect(groupRowHistory([restore, del, item({ at: T(0) })]).map((x) => x.kind)).toEqual([
      "created",
      "deleted",
      "updated",
    ]);
  });
});

describe("formatHistoryValue", () => {
  const labels = { locale: "fr", empty: "vide", yes: "oui", no: "non", files: (c: number) => `${c} fichiers`,
    linked: (c: number) => `${c} liés`,
    people: (c: number) => `${c} personnes`,
    relationLabel: (col: string, id: string) => (col === "rel" && id === "r1" ? "Acme" : null),
    personName: (id: string) => (id === "u1" ? "Ana" : null),
  };
  it("formate chaque type", () => {
    expect(formatHistoryValue(true, "checkbox", labels)).toBe("oui");
    expect(formatHistoryValue(false, "checkbox", labels)).toBe("non");
    expect(formatHistoryValue("2026-11-14", "date", labels)).toMatch(/14/);
    expect(formatHistoryValue("A", "select", labels)).toBe("A");
    expect(formatHistoryValue(["x", "y"], "select", labels)).toBe("x, y");
    expect(formatHistoryValue([{}, {}], "attachment", labels)).toBe("2 fichiers");
    expect(formatHistoryValue(null, "text", labels)).toBe("vide");
    expect(formatHistoryValue("", "text", labels)).toBe("vide");
  });

  it("relation : titres résolus, repli par compte, jamais un identifiant", () => {
    expect(formatHistoryValue(["r1"], "relation", labels, "rel")).toBe("Acme");
    expect(formatHistoryValue(["r1", "uuid-2"], "relation", labels, "rel")).toBe("Acme, 1 liés");
    expect(formatHistoryValue(["uuid-1", "uuid-2"], "relation", labels, "rel")).toBe("2 liés");
    expect(formatHistoryValue(["uuid-1"], "relation", labels)).toBe("1 liés");
  });

  it("person : noms résolus, repli par compte", () => {
    expect(formatHistoryValue(["u1"], "person", labels)).toBe("Ana");
    expect(formatHistoryValue(["u1", "u9"], "person", labels)).toBe("Ana, 1 personnes");
    expect(formatHistoryValue(["u9"], "person", labels)).toBe("1 personnes");
  });

  it("document_link : titre du document, repli si valeur illisible", () => {
    expect(formatHistoryValue('{"id":"d1","title":"Contrat","spaceSlug":"s"}', "document_link", labels)).toBe("Contrat");
    expect(formatHistoryValue("d1", "document_link", labels)).toBe("1 liés");
  });
});

describe("groupRowActivity", () => {
  const ch = (at: string, over: Partial<RowHistoryItem> = {}) => ({ ...item({ at, ...over }), type: "change" as const });
  const cm = (at: string) => ({
    type: "comment" as const,
    id: `c${at}`,
    createdAt: at,
    actor: { id: "u1", name: "Ana" },
    body: "x",
    mentions: [],
    editedAt: null,
    deleted: false,
  });
  const ev = (at: string) => ({
    type: "task_created" as const,
    id: `e${at}`,
    createdAt: at,
    actor: { id: "u1", name: "Ana" },
    taskId: "t",
    taskTitle: "T",
  });

  it("un commentaire entre deux modifications du même acteur coupe le regroupement", () => {
    const g = groupRowActivity([ch(T(30)), cm(T(20)), ch(T(10))]);
    expect(g.map((e) => e.type)).toEqual(["change-group", "comment", "change-group"]);
  });

  it("trois modifications contiguës à moins de 2 minutes restent regroupées", () => {
    const g = groupRowActivity([ch(T(100)), ch(T(50)), ch(T(0))]);
    expect(g).toHaveLength(1);
    expect(g[0].type).toBe("change-group");
    if (g[0].type === "change-group") expect(g[0].changes).toHaveLength(3);
  });

  it("un événement de tâche coupe le regroupement", () => {
    const g = groupRowActivity([ch(T(30)), ev(T(20)), ch(T(10))]);
    expect(g.map((e) => e.type)).toEqual(["change-group", "task_created", "change-group"]);
  });

  it("deleted masqué sans restauration, affiché après", () => {
    const hidden = groupRowActivity([ch(T(30), { kind: "deleted" }), ch(T(0), { kind: "created" })]);
    expect(hidden).toHaveLength(1);
    const shown = groupRowActivity([
      ch(T(60), { kind: "created", source: "restore" }),
      cm(T(40)),
      ch(T(30), { kind: "deleted" }),
    ]);
    expect(shown.map((e) => e.type)).toEqual(["change-group", "comment", "change-group"]);
  });
});
