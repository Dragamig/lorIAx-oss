import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/documents/create-spreadsheet-document", () => ({
  createSpreadsheetDocument: vi.fn(),
  ParentDocumentNotFoundError: class extends Error {},
}));
vi.mock("@/lib/documents/create-document", () => ({ createDocument: vi.fn() }));
vi.mock("@/lib/templates/instantiate", () => ({ instantiateTemplate: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve([{ slug: "acme" }]) }) }),
    })),
  },
}));
vi.mock("@/lib/automations/target-space", async () => {
  const { interpolate } = await vi.importActual<typeof import("@/lib/automations/interpolate")>(
    "@/lib/automations/interpolate"
  );
  class AutomationTargetSpaceError extends Error {}
  return {
    AutomationTargetSpaceError,
    resolveTargetSpaceId: vi.fn(async ({ configSpaceId, automation: a, ctx }: TargetSpaceArgs) => {
      const s = (configSpaceId ? interpolate(configSpaceId, ctx) : undefined) || ctx.spaceId || a.spaceId;
      if (s === "space-other-org") throw new AutomationTargetSpaceError("create_document : espace cible refusé (hors du périmètre de l'automatisation)");
      return s;
    }),
  };
});

import { createDocumentAction } from "../create-document";
import { createSpreadsheetDocument } from "@/lib/documents/create-spreadsheet-document";
import { createDocument } from "@/lib/documents/create-document";
import { interpolate } from "@/lib/automations/interpolate";
import { coerceCellsByColumnType } from "@/lib/automations/cell-coercion";
import type { AutomationRow, ExecutionContext } from "../types";

type TargetSpaceArgs = Parameters<typeof import("@/lib/automations/target-space")["resolveTargetSpaceId"]>[0];
type DemandResult = {
  createdDocument: { id: string; title: string; spaceSlug?: string; link: string };
  simulated?: boolean;
};

const automation: AutomationRow = {
  id: "a1", databaseId: null, spaceId: "space-auto", name: "T", triggerType: "webhook",
  triggerConfig: null, actionType: "create_document", actionConfig: null, enabled: true,
  lastRunAt: null, createdBy: "user-1",
};
const ctx = { event: "manual", cells: { name: "Demande 7" } } as ExecutionContext;
const cfg = { kind: "demand_workbook", title: "Demande {{cells.name}}", parentId: "parent-1", spaceId: "space-auto" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createSpreadsheetDocument).mockResolvedValue({
    document: { id: "doc-1", title: 'Demande 7 "capsule"', spaceId: "space-auto" },
    sheetId: "sheet-1",
  } as never);
});

describe("create_document, mode demand_workbook", () => {
  it("crée le tableur sous le parent et expose id, titre, spaceSlug et lien JSON", async () => {
    const res = (await createDocumentAction.execute(cfg, automation, ctx)) as unknown as DemandResult;
    expect(createDocument).not.toHaveBeenCalled();
    expect(createSpreadsheetDocument).toHaveBeenCalledWith(
      expect.objectContaining({ spaceId: "space-auto", title: "Demande Demande 7", parentId: "parent-1", createdBy: "user-1", activitySource: "automation" })
    );
    expect(res.createdDocument).toMatchObject({ id: "doc-1", spaceSlug: "acme" });
    expect(JSON.parse(res.createdDocument.link)).toEqual({ id: "doc-1", title: 'Demande 7 "capsule"', spaceSlug: "acme" });
  });

  it("le lien traverse l'interpolation et la coercion sans altération (titre avec guillemets)", async () => {
    const res = (await createDocumentAction.execute(cfg, automation, ctx)) as unknown as DemandResult;
    const out = interpolate("{{variables.f.createdDocument.link}}", { ...ctx, variables: { f: res } } as never);
    const cells = coerceCellsByColumnType({ col: out }, { col: "document_link" } as never);
    expect(JSON.parse(cells.col as string)).toEqual({ id: "doc-1", title: 'Demande 7 "capsule"', spaceSlug: "acme" });
  });

  it("simulation : aucune écriture, identifiants fictifs marqués", async () => {
    const res = (await createDocumentAction.simulate!(cfg, automation, ctx)) as unknown as DemandResult;
    expect(createSpreadsheetDocument).not.toHaveBeenCalled();
    expect(res.simulated).toBe(true);
    expect(res.createdDocument.id).toMatch(/^sim_/);
    expect(res.createdDocument.title).toBe("Demande Demande 7");
    expect(JSON.parse(res.createdDocument.link).id).toMatch(/^sim_/);
  });

  it("refuse un espace d'une autre organisation sans rien écrire", async () => {
    await expect(
      createDocumentAction.execute({ ...cfg, spaceId: "space-other-org" }, automation, ctx)
    ).rejects.toThrow(/espace cible refusé/);
    expect(createSpreadsheetDocument).not.toHaveBeenCalled();
  });

  it("un parent introuvable dans l'espace est une erreur sans détail", async () => {
    const { ParentDocumentNotFoundError } = await import("@/lib/documents/create-spreadsheet-document");
    vi.mocked(createSpreadsheetDocument).mockRejectedValue(new ParentDocumentNotFoundError("x"));
    await expect(createDocumentAction.execute(cfg, automation, ctx)).rejects.toThrow(/document parent/i);
  });
});
