import { describe, it, expect, vi, beforeEach } from "vitest";

// Mocks des dépendances lourdes (BDD, rendu natif canvas, S3).
vi.mock("@/lib/studio/instantiate-design-template", () => ({
  instantiateDesignTemplate: vi.fn(),
}));
vi.mock("@/lib/studio/render-design", () => ({
  renderDesign: vi.fn(),
}));
vi.mock("@/lib/storage/s3", () => ({
  uploadFile: vi.fn(),
}));
vi.mock("@/lib/media/ingest", () => ({
  ingestMedia: vi.fn(),
}));
// Le cloisonnement de l'espace cible (constat INJ-12) a sa propre suite,
// `target-space.test.ts`, qui simule la base. Ici on ne teste que la chaîne
// instantiate → render → upload : le résolveur est réduit à sa cascade de
// priorité, sans lecture en base.
vi.mock("@/lib/automations/target-space", async () => {
  const { interpolate } = await vi.importActual<
    typeof import("@/lib/automations/interpolate")
  >("@/lib/automations/interpolate");
  return {
    resolveAutomationAnchor: vi.fn(async () => ({
      spaceId: "space-auto",
      organizationId: "org-1",
    })),
    resolveTargetSpaceId: vi.fn(
      async ({
        configSpaceId,
        automation: auto,
        ctx,
      }: {
        configSpaceId?: string;
        automation: { spaceId?: string | null };
        ctx: { spaceId?: string };
      }) =>
        (configSpaceId ? interpolate(configSpaceId, ctx as never) : undefined) ||
        ctx.spaceId ||
        auto.spaceId ||
        undefined
    ),
  };
});

import { createDesignAction } from "../create-design";
import { instantiateDesignTemplate } from "@/lib/studio/instantiate-design-template";
import { renderDesign } from "@/lib/studio/render-design";
import { uploadFile } from "@/lib/storage/s3";
import { ingestMedia } from "@/lib/media/ingest";
import { resolveAutomationAnchor } from "@/lib/automations/target-space";
import type { AutomationRow, ExecutionContext } from "../types";

const mockedInstantiate = vi.mocked(instantiateDesignTemplate);
const mockedRender = vi.mocked(renderDesign);
const mockedUpload = vi.mocked(uploadFile);
const mockedIngest = vi.mocked(ingestMedia);
const mockedAnchor = vi.mocked(resolveAutomationAnchor);
const MEDIA_ID = "11111111-1111-4111-8111-111111111111";

const automation: AutomationRow = {
  id: "auto-1",
  databaseId: null,
  spaceId: "space-auto",
  name: "Test",
  triggerType: "manual",
  triggerConfig: null,
  actionType: "create_design",
  actionConfig: null,
  enabled: true,
  lastRunAt: null,
  createdBy: "user-1",
};

const fakeDesign = { pages: [] } as unknown;

beforeEach(() => {
  vi.clearAllMocks();
  mockedInstantiate.mockResolvedValue({ name: "Affiche", design: fakeDesign as never });
  mockedRender.mockResolvedValue({
    buffer: Buffer.from("PNGDATA"),
    contentType: "image/png",
    ext: "png",
  });
  mockedUpload.mockImplementation(async (key: string) => key);
  mockedAnchor.mockResolvedValue({ spaceId: "space-auto", organizationId: "org-1" });
  mockedIngest.mockImplementation((async (input: { file: { name: string }; spaceId: string | null }) => ({
    ok: true,
    media: { id: MEDIA_ID, storageKey: `${input.spaceId ?? "org-org-1"}/k.png` },
    quota: {},
    hasLocationExif: false,
  })) as never);
});

describe("createDesignAction", () => {
  it("enchaîne instantiate → render → ingestMedia et retourne /api/media/<uuid>", async () => {
    const ctx: ExecutionContext = { event: "manual", spaceId: "space-ctx" };
    const res = await createDesignAction.execute({ templateId: "tpl-1" }, automation, ctx);

    expect(mockedInstantiate).toHaveBeenCalledWith("tpl-1", {}, { spaceId: "space-ctx" });
    expect(mockedRender).toHaveBeenCalledWith(fakeDesign, { format: "png" });
    expect(mockedUpload).not.toHaveBeenCalled();
    const input = mockedIngest.mock.calls[0][0];
    expect(input.origin).toBe("automation");
    expect(input.allowOrgLevel).toBe(true);
    expect(input.spaceId).toBe("space-ctx");
    expect(input.orgId).toBe("org-1");
    expect(input.user.id).toBe("user-1");
    expect(input.file.name).toBe("Affiche.png");
    expect(input.file.type).toBe("image/png");
    expect(Buffer.isBuffer(input.buffer)).toBe(true);

    const out = res as {
      createdDesign: { url: string; mediaId: string; key: string; contentType: string; ext: string };
    };
    expect(out.createdDesign.url).toBe(`/api/media/${MEDIA_ID}`);
    expect(out.createdDesign.mediaId).toBe(MEDIA_ID);
    expect(out.createdDesign.ext).toBe("png");
    expect(out.createdDesign.contentType).toBe("image/png");
    expect(out.createdDesign.key).toBeTruthy();
    expect(out.createdDesign.url).not.toMatch(/X-Amz|Signature|Expires/);
  });

  it("automatisme de base (spaceId nul) : l'espace de l'ancre est utilisé", async () => {
    const auto: AutomationRow = { ...automation, spaceId: null };
    await createDesignAction.execute({ templateId: "t" }, auto, { event: "manual" });
    const input = mockedIngest.mock.calls[0][0];
    expect(input.spaceId).toBe("space-auto");
    expect(input.allowOrgLevel).toBe(true);
  });

  it("sans espace ni ancre d'espace : spaceId null", async () => {
    mockedAnchor.mockResolvedValue({ spaceId: null, organizationId: "org-1" } as never);
    const auto: AutomationRow = { ...automation, spaceId: null };
    await createDesignAction.execute({ templateId: "t" }, auto, { event: "manual" });
    expect(mockedIngest.mock.calls[0][0].spaceId).toBeNull();
  });

  it("acteur : le propriétaire de l'automatisme prime sur ctx.user", async () => {
    await createDesignAction.execute({ templateId: "t" }, automation, {
      event: "manual",
      user: { id: "someone-else", name: "X" },
    });
    expect(mockedIngest.mock.calls[0][0].user.id).toBe("user-1");
  });

  it("acteur : repli sur ctx.user sans propriétaire", async () => {
    await createDesignAction.execute({ templateId: "t" }, { ...automation, createdBy: null }, {
      event: "manual",
      user: { id: "someone-else", name: "X" },
    });
    expect(mockedIngest.mock.calls[0][0].user.id).toBe("someone-else");
  });

  it("quota atteint : l'étape échoue avec « Quota atteint »", async () => {
    mockedIngest.mockResolvedValue({ ok: false, status: 507, error: "Quota de stockage atteint" } as never);
    await expect(
      createDesignAction.execute({ templateId: "t" }, automation, { event: "manual", spaceId: "space-ctx" })
    ).rejects.toThrow(/Quota atteint/);
  });

  it("autre refus d'ingestion : erreur claire", async () => {
    mockedIngest.mockResolvedValue({ ok: false, status: 403, error: "Accès refusé" } as never);
    await expect(
      createDesignAction.execute({ templateId: "t" }, automation, { event: "manual", spaceId: "space-ctx" })
    ).rejects.toThrow(/médiathèque refusé/);
  });

  it("simulation : URL /api/media/<simId>, aucune écriture", async () => {
    const res = (await createDesignAction.simulate!(
      { templateId: "t" },
      automation,
      { event: "manual", spaceId: "space-ctx" }
    )) as { createdDesign: { url: string; mediaId: string } };
    expect(res.createdDesign.url).toMatch(/^\/api\/media\/sim_/);
    expect(res.createdDesign.mediaId).toMatch(/^sim_/);
    expect(mockedIngest).not.toHaveBeenCalled();
    expect(mockedUpload).not.toHaveBeenCalled();
  });

  it("résout les bindings via buildBindingPayload et transmet les valeurs à instantiate", async () => {
    const ctx: ExecutionContext = {
      event: "manual",
      spaceId: "space-ctx",
      cells: { title: "Bonjour" },
      user: { id: "u1", name: "Alice" },
    };
    await createDesignAction.execute(
      {
        templateId: "tpl-1",
        bindings: {
          heading: { kind: "cells", ref: "title" },
          author: { kind: "user", ref: "name" },
          tag: { kind: "static", ref: "PROMO" },
        },
      },
      automation,
      ctx
    );

    expect(mockedInstantiate).toHaveBeenCalledWith(
      "tpl-1",
      { heading: "Bonjour", author: "Alice", tag: "PROMO" },
      { spaceId: "space-ctx" }
    );
  });

  it("priorise cfg.spaceId interpolé sur ctx.spaceId puis automation.spaceId", async () => {
    const ctx: ExecutionContext = {
      event: "manual",
      spaceId: "space-ctx",
      cells: { sid: "space-from-cell" },
    };
    await createDesignAction.execute(
      { templateId: "tpl-1", spaceId: "{{cells.sid}}" },
      automation,
      ctx
    );
    expect(mockedInstantiate).toHaveBeenCalledWith("tpl-1", {}, { spaceId: "space-from-cell" });
  });

  it("laisse spaceId indéfini si aucune source (template global géré en aval)", async () => {
    const auto: AutomationRow = { ...automation, spaceId: null };
    const ctx: ExecutionContext = { event: "manual" };
    await createDesignAction.execute({ templateId: "tpl-global" }, auto, ctx);
    expect(mockedInstantiate).toHaveBeenCalledWith("tpl-global", {}, { spaceId: undefined });
  });

  it("format pdf → ext/contentType pdf et clé .pdf", async () => {
    mockedRender.mockResolvedValue({
      buffer: Buffer.from("%PDF"),
      contentType: "application/pdf",
      ext: "pdf",
    });
    const ctx: ExecutionContext = { event: "manual", spaceId: "space-ctx" };
    const res = await createDesignAction.execute(
      { templateId: "tpl-1", format: "pdf" },
      automation,
      ctx
    );
    expect(mockedRender).toHaveBeenCalledWith(fakeDesign, { format: "pdf" });
    const input = mockedIngest.mock.calls[0][0];
    expect(input.file.name).toMatch(/\.pdf$/);
    expect(input.file.type).toBe("application/pdf");
    const out = res as { createdDesign: { ext: string; contentType: string } };
    expect(out.createdDesign.ext).toBe("pdf");
    expect(out.createdDesign.contentType).toBe("application/pdf");
  });

  it("throw si templateId manquant (config invalide)", async () => {
    const ctx: ExecutionContext = { event: "manual", spaceId: "space-ctx" };
    await expect(
      createDesignAction.execute({}, automation, ctx)
    ).rejects.toThrow(/create_design invalide/);
    expect(mockedInstantiate).not.toHaveBeenCalled();
  });

  it("storeAs : dépose la sortie dans ctx.variables sous le nom donné", async () => {
    const ctx: ExecutionContext = { event: "manual", spaceId: "space-ctx", variables: {} };
    const res = await createDesignAction.execute(
      { templateId: "tpl-1", storeAs: "poster", filename: "affiche.png" },
      automation,
      ctx
    );
    const out = res as { createdDesign: { url: string; filename?: string } };
    expect(ctx.variables?.poster).toEqual(out.createdDesign);
    expect(out.createdDesign.filename).toBe("affiche.png");
  });
});
