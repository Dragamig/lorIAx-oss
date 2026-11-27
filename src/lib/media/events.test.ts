import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  executeAutomation: vi.fn(async () => ({ status: "success" })),
  getSpacePermission: vi.fn(async () => "editor" as string | null),
  organizationOfSpace: vi.fn(async (id: string) => (id === OTHER ? "org-b" : "org-a") as string | null),
  enabled: true,
  warn: vi.fn(),
  users: [{ id: "creator", email: "c@x.fr", name: "C", globalRole: "editor", capabilities: [] }] as Array<Record<string, unknown>>,
  resolveMediaAccess: vi.fn(async () => ({ allowed: true }) as { allowed: boolean }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: () => Promise.resolve(h.rows) }),
        where: () => ({ limit: () => Promise.resolve(h.users) }),
      }),
    }),
  },
}));
vi.mock("@/lib/logger", () => ({ default: { warn: h.warn } }));
vi.mock("@/lib/settings/system-settings", () => ({
  getSetting: vi.fn(async () => ({ enabled: h.enabled })),
}));
vi.mock("./access", () => ({ resolveMediaAccess: h.resolveMediaAccess }));
vi.mock("@/lib/automations/executor", () => ({ executeAutomation: h.executeAutomation }));
vi.mock("@/lib/auth/check-access", () => ({ getSpacePermission: h.getSpacePermission }));
vi.mock("@/lib/automations/target-space", () => ({ organizationOfSpace: h.organizationOfSpace }));

import { emitMediaUploaded, matchesMediaScope, parseMediaScopeConfig, validateMediaTriggerConfig } from "./events";

const S1 = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-000000000002";

const media = {
  id: "m1",
  organizationId: "org-a",
  spaceId: null as string | null,
  uploadedBy: "u1",
  origin: "upload" as const,
  filename: "logo.png",
};

function auto(over: Record<string, unknown>) {
  return {
    id: "a1",
    databaseId: null,
    spaceId: "space-1",
    name: "A",
    triggerType: "media_uploaded",
    triggerConfig: { scope: "any" },
    actionType: "create_task",
    actionConfig: {},
    enabled: true,
    lastRunAt: null,
    createdBy: "creator",
    ...over,
  };
}

beforeEach(() => {
  h.rows = [];
  h.enabled = true;
  h.executeAutomation.mockClear();
  h.getSpacePermission.mockClear();
  h.getSpacePermission.mockResolvedValue("editor");
  h.warn.mockClear();
  h.resolveMediaAccess.mockClear();
  h.resolveMediaAccess.mockResolvedValue({ allowed: true });
});

describe("matchesMediaScope", () => {
  it("any accepte tout", () => {
    expect(matchesMediaScope({ scope: "any" }, { spaceId: null })).toBe(true);
    expect(matchesMediaScope({ scope: "any" }, { spaceId: "s" })).toBe(true);
  });
  it("orphan accepte seulement spaceId null", () => {
    expect(matchesMediaScope({ scope: "orphan" }, { spaceId: null })).toBe(true);
    expect(matchesMediaScope({ scope: "orphan" }, { spaceId: "s" })).toBe(false);
  });
  it("space exige le même spaceId", () => {
    expect(matchesMediaScope({ scope: "space", spaceId: "s" }, { spaceId: "s" })).toBe(true);
    expect(matchesMediaScope({ scope: "space", spaceId: "s" }, { spaceId: "t" })).toBe(false);
    expect(matchesMediaScope({ scope: "space", spaceId: "s" }, { spaceId: null })).toBe(false);
    expect(matchesMediaScope({ scope: "space" }, { spaceId: "s" })).toBe(false);
  });
});

describe("parseMediaScopeConfig", () => {
  it("défaut any, rejette une portée inconnue", () => {
    expect(parseMediaScopeConfig({})).toEqual({ scope: "any" });
    expect(parseMediaScopeConfig({ scope: "orphan" })).toEqual({ scope: "orphan" });
    expect(parseMediaScopeConfig({ scope: "space", spaceId: "00000000-0000-4000-8000-000000000001" })).toEqual({
      scope: "space",
      spaceId: "00000000-0000-4000-8000-000000000001",
    });
    expect(parseMediaScopeConfig({ scope: "x" })).toBeNull();
    expect(parseMediaScopeConfig({ scope: "space" })).toBeNull();
  });
});

describe("emitMediaUploaded : lecture du créateur", () => {
  it.each(["any", "orphan"])("portée %s : ignoré si le créateur ne peut pas lire le média", async (scope) => {
    h.rows = [{ automation: auto({ triggerConfig: { scope } }), organizationId: "org-a" }];
    h.resolveMediaAccess.mockResolvedValueOnce({ allowed: false });
    await emitMediaUploaded(media);
    expect(h.executeAutomation).not.toHaveBeenCalled();
    expect(h.resolveMediaAccess).toHaveBeenCalledWith(
      expect.objectContaining({ id: "creator" }),
      expect.objectContaining({ id: "m1", spaceId: null }),
      "read",
      { orgId: "org-a" }
    );
  });
  it("sans créateur connu : ignoré", async () => {
    h.rows = [{ automation: auto({ createdBy: null }), organizationId: "org-a" }];
    await emitMediaUploaded(media);
    expect(h.executeAutomation).not.toHaveBeenCalled();
  });
});

describe("emitMediaUploaded", () => {
  it("ne déclenche que les automatismes de la même organisation", async () => {
    h.rows = [
      { automation: auto({ id: "same" }), organizationId: "org-a" },
      { automation: auto({ id: "other" }), organizationId: "org-b" },
    ];
    await emitMediaUploaded(media);
    expect(h.executeAutomation).toHaveBeenCalledTimes(1);
    expect((h.executeAutomation.mock.calls[0] as unknown[])[0]).toMatchObject({ id: "same" });
  });

  it("un média créé par une automatisation ne redéclenche pas", async () => {
    h.rows = [{ automation: auto({}), organizationId: "org-a" }];
    await emitMediaUploaded({ ...media, origin: "automation" });
    expect(h.executeAutomation).not.toHaveBeenCalled();
  });

  it("filtre par portée orphan", async () => {
    h.rows = [{ automation: auto({ triggerConfig: { scope: "orphan" } }), organizationId: "org-a" }];
    await emitMediaUploaded({ ...media, spaceId: "s" });
    expect(h.executeAutomation).not.toHaveBeenCalled();
    await emitMediaUploaded(media);
    expect(h.executeAutomation).toHaveBeenCalledTimes(1);
  });

  it("portée space : le créateur doit avoir accès à l'espace et l'espace être de la même organisation", async () => {
    const cfg = { scope: "space", spaceId: S1 };
    h.rows = [{ automation: auto({ triggerConfig: cfg }), organizationId: "org-a" }];
    h.getSpacePermission.mockResolvedValueOnce(null);
    await emitMediaUploaded({ ...media, spaceId: S1 });
    expect(h.executeAutomation).not.toHaveBeenCalled();

    await emitMediaUploaded({ ...media, spaceId: S1 });
    expect(h.executeAutomation).toHaveBeenCalledTimes(1);

    h.executeAutomation.mockClear();
    h.rows = [
      { automation: auto({ triggerConfig: { scope: "space", spaceId: OTHER } }), organizationId: "org-a" },
    ];
    await emitMediaUploaded({ ...media, spaceId: OTHER });
    expect(h.executeAutomation).not.toHaveBeenCalled();
  });

  it("expose les variables du média et ne bloque pas si l'exécution échoue", async () => {
    h.rows = [{ automation: auto({}), organizationId: "org-a" }];
    h.executeAutomation.mockRejectedValueOnce(new Error("boom"));
    await expect(emitMediaUploaded(media)).resolves.toBeUndefined();
    const ctx = (h.executeAutomation.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(ctx).toMatchObject({
      event: "media_uploaded",
      spaceId: "space-1",
      media: { id: "m1", filename: "logo.png", spaceId: "", url: "/api/media/m1" },
    });
  });

  it("kill-switch global : rien d'exécuté", async () => {
    h.enabled = false;
    h.rows = [{ automation: auto({}), organizationId: "org-a" }];
    await emitMediaUploaded(media);
    expect(h.executeAutomation).not.toHaveBeenCalled();
  });

  it("une erreur de lecture est absorbée", async () => {
    h.rows = null as never;
    await expect(emitMediaUploaded(media)).resolves.toBeUndefined();
  });
});

describe("validateMediaTriggerConfig", () => {
  const actor = { userId: "u1", orgId: "org-a" };
  it("accepte any et orphan", async () => {
    expect(await validateMediaTriggerConfig({ scope: "orphan" }, actor)).toEqual({ ok: true, config: { scope: "orphan" } });
    expect((await validateMediaTriggerConfig({}, actor)).ok).toBe(true);
  });
  it("refuse une portée invalide", async () => {
    expect((await validateMediaTriggerConfig({ scope: "space" }, actor)).ok).toBe(false);
  });
  it("refuse un espace d'une autre organisation ou sans accès", async () => {
    expect((await validateMediaTriggerConfig({ scope: "space", spaceId: OTHER }, actor)).ok).toBe(false);
    h.getSpacePermission.mockResolvedValueOnce(null);
    expect((await validateMediaTriggerConfig({ scope: "space", spaceId: S1 }, actor)).ok).toBe(false);
    expect((await validateMediaTriggerConfig({ scope: "space", spaceId: S1 }, actor)).ok).toBe(true);
  });
});
