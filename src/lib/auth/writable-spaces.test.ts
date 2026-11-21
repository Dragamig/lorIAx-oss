import { describe, expect, it, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ queue: [] as unknown[][], calls: 0, member: true }));

function chain(): unknown {
  const self: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (res: (v: unknown) => void) => {
            h.calls++;
            res(h.queue.shift() ?? []);
          };
        }
        return () => self;
      },
    }
  );
  return self;
}
vi.mock("@/lib/db", () => ({ db: { select: () => chain() } }));
vi.mock("@/lib/org/get-request-org", () => ({ getRequestOrgId: () => Promise.resolve("o1") }));
vi.mock("@/lib/org/resolve-request-org", () => ({ hasOrgMembershipRow: () => Promise.resolve(h.member) }));

import { getWritableSpaceIds } from "./check-access";

const sp = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  ownerUserId: "someone",
  ownerTeamId: null,
  type: "team",
  classification: "internal",
  ...extra,
});
const editor = { id: "u1", globalRole: "editor" } as never;

beforeEach(() => {
  h.queue = [];
  h.calls = 0;
  h.member = true;
});

describe("getWritableSpaceIds", () => {
  it("matrice : propriétaire, viewer, editor, équipe, org, secret, sans ligne", async () => {
    h.queue = [
      [
        sp("own", { ownerUserId: "u1" }),
        sp("viewer"),
        sp("editor"),
        sp("viewerThenTeamEditor"),
        sp("teamOwned", { ownerTeamId: "t1" }),
        sp("orgSpace", { type: "organization" }),
        sp("secretOrg", { type: "organization", classification: "secret" }),
        sp("none"),
      ],
      [{ teamId: "t1", role: "member" }],
      [
        { spaceId: "viewer", level: "viewer" },
        { spaceId: "editor", level: "editor" },
        { spaceId: "viewerThenTeamEditor", level: "viewer" },
        { spaceId: "viewerThenTeamEditor", level: "editor" },
      ],
      [{ role: "member" }],
    ];
    const ids = [
      "own", "viewer", "editor", "viewerThenTeamEditor", "teamOwned", "orgSpace", "secretOrg", "none",
    ];
    const out = await getWritableSpaceIds(editor, "o1", ids);
    expect(out.sort()).toEqual(["editor", "orgSpace", "own", "teamOwned", "viewerThenTeamEditor"]);
  });
  it("nombre de requêtes constant, quel que soit le nombre d'espaces", async () => {
    const many = Array.from({ length: 50 }, (_, i) => sp(`s${i}`, { type: "organization" }));
    h.queue = [many, [], [], [{ role: "member" }]];
    await getWritableSpaceIds(editor, "o1", many.map((m) => m.id));
    expect(h.calls).toBeLessThanOrEqual(4);
  });
  it("super_admin : tout l'org ; admin sans appartenance réelle : repli sur la matrice", async () => {
    h.queue = [[sp("a"), sp("b")]];
    expect(await getWritableSpaceIds({ id: "u", globalRole: "super_admin" } as never, "o1", ["a", "b"])).toEqual(["a", "b"]);
    h.queue = [[sp("a")]];
    expect(await getWritableSpaceIds({ id: "u", globalRole: "admin" } as never, "o1", ["a"])).toEqual(["a"]);
    h.member = false;
    h.queue = [[sp("a")], [], [], []];
    expect(await getWritableSpaceIds({ id: "u", globalRole: "admin" } as never, "o1", ["a"])).toEqual([]);
  });
  it("liste vide : aucune requête", async () => {
    expect(await getWritableSpaceIds(editor, "o1", [])).toEqual([]);
    expect(h.calls).toBe(0);
  });
});
