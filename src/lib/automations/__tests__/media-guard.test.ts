import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ anchor: vi.fn() }));
vi.mock("@/lib/automations/target-space", () => ({ resolveAutomationAnchor: h.anchor }));

import { automationMediaGuard } from "../media-guard";

const M = "11111111-1111-4111-8111-111111111111";
const auto = { id: "a", createdBy: "owner" } as never;

beforeEach(() => {
  h.anchor.mockReset();
  h.anchor.mockResolvedValue({ spaceId: "s", organizationId: "o1" });
});

describe("automationMediaGuard", () => {
  it("aucune référence de média : pas de garde, aucune requête", async () => {
    expect(await automationMediaGuard(auto, { user: { id: "t" } } as never, { c: "texte", d: [1] })).toBeUndefined();
    expect(h.anchor).not.toHaveBeenCalled();
  });

  it("le propriétaire de l'automatisme prime sur l'utilisateur déclencheur", async () => {
    const g = await automationMediaGuard(auto, { user: { id: "trigger" } } as never, { c: `/api/media/${M}` });
    expect(g?.user?.id).toBe("owner");
    expect(g?.orgId).toBe("o1");
  });

  it("repli sur l'utilisateur déclencheur sans propriétaire", async () => {
    const g = await automationMediaGuard({ id: "a", createdBy: null } as never, { user: { id: "trigger" } } as never, {
      c: [{ mediaId: M }],
    });
    expect(g?.user?.id).toBe("trigger");
  });

  it("sans acteur ou sans ancre : garde sans utilisateur (refus des médias)", async () => {
    const g = await automationMediaGuard({ id: "a", createdBy: null } as never, {} as never, { c: `/api/media/${M}` });
    expect(g?.user).toBeNull();
    h.anchor.mockResolvedValue(null);
    expect((await automationMediaGuard(auto, {} as never, { c: `/api/media/${M}` }))?.user).toBeNull();
  });
});
