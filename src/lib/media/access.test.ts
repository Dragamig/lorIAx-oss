import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  media,
  mediaUsages,
  publicShares,
  documents,
  spaces,
  users,
  organizationMembers,
} from "@/lib/db/schema";

const ORG = "11111111-1111-4111-8111-111111111111";
const OTHER_ORG = "22222222-2222-4222-8222-222222222222";
const SPACE = "33333333-3333-4333-8333-333333333333";
const DOC = "44444444-4444-4444-8444-444444444444";
const MEDIA_ID = "55555555-5555-4555-8555-555555555555";
const ME = "66666666-6666-4666-8666-666666666666";
const AUTHOR = "77777777-7777-4777-8777-777777777777";
const CREATOR = "88888888-8888-4888-8888-888888888888";

let requestOrg: string | null = ORG;
let spaceRead = true;
let spaceWrite = true;
let orgMemberRows: { role: string }[] = [];
let shareRows: unknown[] = [];
let usageRows: unknown[] = [];
let mediaRows: unknown[] = [];
let documentRows: unknown[] = [];
let spaceRows: unknown[] = [];
let userRows: unknown[] = [];
let creatorIsOrgMember = true;
// Droits distincts du créateur du partage (la requête publique est anonyme).
let creatorSpaceRead = true;
let lastSpaceOrgOpt: string | undefined;

function rowsForTable(table: unknown): unknown[] {
  if (table === organizationMembers) return orgMemberRows;
  if (table === publicShares) return shareRows;
  if (table === mediaUsages) return usageRows;
  if (table === media) return mediaRows;
  if (table === documents) return documentRows;
  if (table === spaces) return spaceRows;
  if (table === users) return userRows;
  return [];
}

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => {
      let rows: unknown[] = [];
      const builder = {
        from: vi.fn((table: unknown) => {
          rows = rowsForTable(table);
          return builder;
        }),
        where: vi.fn(() => builder),
        limit: vi.fn(() => Promise.resolve(rows)),
        then: (resolve: (v: unknown[]) => unknown) => Promise.resolve(rows).then(resolve),
      };
      return builder;
    }),
  },
}));

vi.mock("@/lib/auth/check-access", () => ({
  checkSpaceReadAccess: vi.fn(
    (user: { id: string }, _s: string, opts?: { orgId?: string }) => {
      lastSpaceOrgOpt = opts?.orgId;
      return Promise.resolve(user.id === CREATOR ? creatorSpaceRead : spaceRead);
    }
  ),
  checkSpaceWriteAccess: vi.fn(() => Promise.resolve(spaceWrite)),
}));

vi.mock("@/lib/org/get-request-org", () => ({
  getRequestOrgId: vi.fn(() => Promise.resolve(requestOrg)),
}));

vi.mock("@/lib/org/resolve-request-org", () => ({
  isOrgMember: vi.fn(() => Promise.resolve(creatorIsOrgMember)),
}));

import { resolveMediaAccess, resolvePublicMediaAccess, type MediaAccessRow } from "./access";
import type { SessionUser } from "@/types";

const user = (id = ME, globalRole = "user"): SessionUser =>
  ({ id, email: "", name: "", globalRole, capabilities: [] }) as unknown as SessionUser;

const row = (over: Partial<MediaAccessRow> = {}): MediaAccessRow => ({
  id: MEDIA_ID,
  organizationId: ORG,
  spaceId: SPACE,
  uploadedBy: AUTHOR,
  deletedAt: null,
  origin: "upload",
  mimeType: "image/png",
  ...over,
});

beforeEach(() => {
  requestOrg = ORG;
  spaceRead = true;
  spaceWrite = true;
  creatorSpaceRead = true;
  creatorIsOrgMember = true;
  orgMemberRows = [];
  const m = row();
  mediaRows = [m];
  shareRows = [
    { documentId: DOC, createdBy: CREATOR, expiresAt: null, revokedAt: null },
  ];
  usageRows = [{ id: "u1" }];
  documentRows = [{ spaceId: SPACE }];
  spaceRows = [{ organizationId: ORG }];
  userRows = [{ id: CREATOR, globalRole: "user" }];
});

describe("refus par défaut", () => {
  it("refuse une autre organisation, même pour un admin global", async () => {
    const r = await resolveMediaAccess(user(ME, "admin"), row({ organizationId: OTHER_ORG }), "read");
    expect(r).toEqual({ allowed: false, reason: "org" });
  });
  it("refuse si l'organisation de la requête est introuvable", async () => {
    requestOrg = null;
    expect(await resolveMediaAccess(user(), row(), "read")).toEqual({ allowed: false, reason: "org" });
  });
});

describe("média d'espace", () => {
  it("lecture accordée / refusée selon checkSpaceReadAccess", async () => {
    expect((await resolveMediaAccess(user(), row(), "read")).allowed).toBe(true);
    spaceRead = false;
    expect(await resolveMediaAccess(user(), row(), "read")).toEqual({ allowed: false, reason: "space" });
  });
  it("écriture refusée pour un viewer", async () => {
    spaceWrite = false;
    expect(await resolveMediaAccess(user(), row(), "write")).toEqual({ allowed: false, reason: "space" });
  });
  it("rôles B132 : viewer lit sans écrire, editor écrit", async () => {
    spaceWrite = false;
    expect((await resolveMediaAccess(user(), row(), "read")).allowed).toBe(true);
    expect((await resolveMediaAccess(user(), row(), "write")).allowed).toBe(false);
    spaceWrite = true;
    expect((await resolveMediaAccess(user(), row(), "write")).allowed).toBe(true);
  });
});

describe("hors espace", () => {
  const orphan = () => row({ spaceId: null });
  it("admin d'organisation lit et écrit (reclassement B132)", async () => {
    orgMemberRows = [{ role: "admin" }];
    expect((await resolveMediaAccess(user(), orphan(), "read")).allowed).toBe(true);
    expect((await resolveMediaAccess(user(), orphan(), "write")).allowed).toBe(true);
  });
  it("l'auteur lit et écrit", async () => {
    expect((await resolveMediaAccess(user(AUTHOR), orphan(), "read")).allowed).toBe(true);
    expect((await resolveMediaAccess(user(AUTHOR), orphan(), "write")).allowed).toBe(true);
  });
  it("un éditeur non auteur est refusé", async () => {
    orgMemberRows = [{ role: "member" }];
    expect(await resolveMediaAccess(user(), orphan(), "read")).toEqual({ allowed: false, reason: "orphan" });
  });
  it("un non membre est refusé, même admin global", async () => {
    expect(await resolveMediaAccess(user(ME, "admin"), orphan(), "write")).toEqual({
      allowed: false,
      reason: "orphan",
    });
  });
});

describe("corbeille", () => {
  const trashed = () => row({ deletedAt: new Date() });
  it("refusée à un lecteur sans droit d'écriture", async () => {
    spaceWrite = false;
    expect(await resolveMediaAccess(user(), trashed(), "read")).toEqual({ allowed: false, reason: "trash" });
  });
  it("accordée à un éditeur de l'espace", async () => {
    expect((await resolveMediaAccess(user(), trashed(), "read")).allowed).toBe(true);
  });
  it("hors espace : auteur oui, autre non", async () => {
    const t = row({ deletedAt: new Date(), spaceId: null });
    expect((await resolveMediaAccess(user(AUTHOR), t, "read")).allowed).toBe(true);
    expect(await resolveMediaAccess(user(), t, "read")).toEqual({ allowed: false, reason: "trash" });
  });
});

describe("jamais getSpacePermission seul", () => {
  it("access.ts n'importe ni n'appelle getSpacePermission", () => {
    const src = readFileSync(join(__dirname, "access.ts"), "utf8");
    expect(src).not.toMatch(/getSpacePermission/);
  });
});

describe("partage public (règle 5)", () => {
  const call = (now?: Date) => resolvePublicMediaAccess("tok", MEDIA_ID, now);

  it("accorde pour un partage actif et un usage du bon document", async () => {
    const r = await call();
    expect(r.allowed).toBe(true);
  });
  it("refuse un jeton inconnu", async () => {
    shareRows = [];
    expect((await call()).allowed).toBe(false);
  });
  it("refuse un jeton révoqué", async () => {
    shareRows = [{ documentId: DOC, createdBy: CREATOR, expiresAt: null, revokedAt: new Date() }];
    expect((await call()).allowed).toBe(false);
  });
  it("refuse un partage expiré", async () => {
    shareRows = [
      { documentId: DOC, createdBy: CREATOR, expiresAt: new Date("2026-01-01"), revokedAt: null },
    ];
    expect((await call(new Date("2026-06-01"))).allowed).toBe(false);
  });
  it("refuse un média sans usage sur ce document", async () => {
    usageRows = [];
    expect((await call()).allowed).toBe(false);
  });
  it("refuse un média d'une autre organisation que celle du document", async () => {
    mediaRows = [row({ organizationId: OTHER_ORG })];
    expect((await call()).allowed).toBe(false);
  });
  it("refuse un média en corbeille", async () => {
    mediaRows = [row({ deletedAt: new Date() })];
    expect((await call()).allowed).toBe(false);
  });
  it("refuse un média d'un espace que le créateur ne lit pas", async () => {
    creatorSpaceRead = false;
    expect((await call()).allowed).toBe(false);
  });
  it("accorde de nouveau quand le créateur récupère la lecture", async () => {
    creatorSpaceRead = false;
    expect((await call()).allowed).toBe(false);
    creatorSpaceRead = true;
    expect((await call()).allowed).toBe(true);
  });
  it("refuse si le créateur perd son appartenance à l'organisation", async () => {
    creatorIsOrgMember = false;
    expect((await call()).allowed).toBe(false);
  });
  it("refuse si le créateur est introuvable", async () => {
    userRows = [];
    expect((await call()).allowed).toBe(false);
  });
  it("aucun passe-droit admin : créateur admin global sans droit d'espace refusé", async () => {
    userRows = [{ id: CREATOR, globalRole: "admin" }];
    creatorSpaceRead = false;
    expect((await call()).allowed).toBe(false);
  });
  it("refuse si le document ou son espace est introuvable", async () => {
    documentRows = [];
    expect((await call()).allowed).toBe(false);
  });
  it("sert le partage même si l'organisation de la requête est une autre", async () => {
    requestOrg = OTHER_ORG;
    expect((await call()).allowed).toBe(true);
    expect(lastSpaceOrgOpt).toBe(ORG);
  });
  it("sert le partage même si l'organisation de la requête est nulle", async () => {
    requestOrg = null;
    expect((await call()).allowed).toBe(true);
  });
  it("refuse toujours un média d'une autre organisation que celle du document", async () => {
    requestOrg = OTHER_ORG;
    mediaRows = [row({ organizationId: OTHER_ORG })];
    expect((await call()).allowed).toBe(false);
  });
});
