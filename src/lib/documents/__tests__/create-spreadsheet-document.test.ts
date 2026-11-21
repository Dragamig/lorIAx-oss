import { describe, it, expect, vi, beforeEach } from "vitest";

const inserted: Array<Record<string, unknown>> = [];
const deleted: unknown[] = [];
let parentRows: Array<{ id: string }> = [];
const createDocument = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      const b = {
        from: vi.fn(() => b),
        where: vi.fn(() => b),
        limit: vi.fn(async () => parentRows),
      };
      return b;
    }),
    insert: vi.fn(() => ({
      values: vi.fn(async (v: Record<string, unknown>) => {
        inserted.push(v);
      }),
    })),
    delete: vi.fn(() => ({
      where: vi.fn(async (c: unknown) => {
        deleted.push(c);
      }),
    })),
  },
}));
vi.mock("../create-document", () => ({
  createDocument: (...a: unknown[]) => createDocument(...a),
}));

import { createSpreadsheetDocument } from "../create-spreadsheet-document";

const base = {
  spaceId: "11111111-1111-4111-8111-111111111111",
  title: "Demande Acme",
  createdBy: "user-1",
  authorName: "A",
  authorEmail: "a@b.c",
};

beforeEach(() => {
  inserted.length = 0;
  deleted.length = 0;
  parentRows = [];
  createDocument.mockReset();
  createDocument.mockImplementation(async (i: { title: string }) => ({ id: "doc-1", title: i.title }));
});

describe("createSpreadsheetDocument", () => {
  it("rattache le tableur à l'espace et écrit le bloc dans le markdown", async () => {
    const r = await createSpreadsheetDocument(base);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].spaceId).toBe(base.spaceId);
    const sheetId = inserted[0].sheetId as string;
    expect(r.sheetId).toBe(sheetId);
    const call = createDocument.mock.calls[0][0];
    expect(call.content).toContain('data-type="spreadsheet-block"');
    expect(call.content).toContain(`sheetid="${sheetId}"`);
    expect(call.content).toContain('title="Demande Acme"');
    const wb = JSON.parse(inserted[0].data as string);
    expect(wb.sheetOrder).toHaveLength(2);
  });

  it("transmet la source d'activité et le parent après contrôle de l'espace", async () => {
    const parentId = "22222222-2222-4222-8222-222222222222";
    parentRows = [{ id: parentId }];
    await createSpreadsheetDocument({ ...base, parentId, activitySource: "automation" });
    const call = createDocument.mock.calls[0][0];
    expect(call.parentId).toBe(parentId);
    expect(call.activitySource).toBe("automation");
  });

  it("refuse un parent absent de l'espace, sans rien écrire", async () => {
    parentRows = [];
    await expect(
      createSpreadsheetDocument({ ...base, parentId: "22222222-2222-4222-8222-222222222222" }),
    ).rejects.toThrow(/parent/i);
    expect(inserted).toHaveLength(0);
    expect(createDocument).not.toHaveBeenCalled();
  });

  it("nettoie le tableur si la création du document échoue", async () => {
    createDocument.mockRejectedValue(new Error("boom"));
    await expect(createSpreadsheetDocument(base)).rejects.toThrow("boom");
    expect(inserted).toHaveLength(1);
    expect(deleted).toHaveLength(1);
  });

  it("échappe le titre dans l'attribut HTML", async () => {
    await createSpreadsheetDocument({ ...base, title: 'A "B" <c>' });
    expect(createDocument.mock.calls[0][0].content).toContain('title="A &quot;B&quot; &lt;c&gt;"');
  });
});
