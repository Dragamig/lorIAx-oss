import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ isMember: vi.fn(), loadConnection: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/auth/check-access", () => ({ checkSpaceReadAccess: vi.fn(async () => false) }));
vi.mock("@/lib/media/access", () => ({
  getMediaByStorageKey: vi.fn(async () => null),
  resolveMediaAccess: vi.fn(),
}));
vi.mock("@/lib/org/resolve-request-org", () => ({ isOrgMember: (...a: unknown[]) => h.isMember(...a) }));
vi.mock("@/lib/crm/connection", () => ({ loadConnection: (...a: unknown[]) => h.loadConnection(...a) }));

import { canReadStorageKey } from "./attachment-access";
import type { SessionUser } from "@/types";

const ORG = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const USER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const user = { id: USER, globalRole: "user" } as unknown as SessionUser;
const key = (org: string) => `mail/${org}/${USER}/file.pdf`;
const conn = (connected: boolean) => ({ enabled: true, roles: { interactions: { connected, databaseId: connected ? "ix" : undefined } } });

beforeEach(() => {
  h.isMember.mockReset();
  h.loadConnection.mockReset();
  h.isMember.mockImplementation(async (_u: string, org: string) => org === ORG);
  h.loadConnection.mockImplementation(async (org: string) => (org === ORG ? conn(true) : null));
});

describe("canReadStorageKey, pièces mail/<org>/", () => {
  it("autorise un membre de l'organisation qui lit la base Interactions", async () => {
    expect(await canReadStorageKey(user, key(ORG))).toBe(true);
    expect(h.loadConnection).toHaveBeenCalledWith(ORG, USER, "viewer");
  });

  it("refuse une autre organisation", async () => {
    expect(await canReadStorageKey(user, key(OTHER))).toBe(false);
  });

  it("refuse sans lecture de la base Interactions", async () => {
    h.loadConnection.mockResolvedValue(conn(false));
    expect(await canReadStorageKey(user, key(ORG))).toBe(false);
    h.loadConnection.mockResolvedValue(null);
    expect(await canReadStorageKey(user, key(ORG))).toBe(false);
  });

  it("refuse un segment d'organisation qui n'est pas un uuid", async () => {
    expect(await canReadStorageKey(user, "mail/not-a-uuid/x/file.pdf")).toBe(false);
  });
});
