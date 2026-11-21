import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { API_KEY_SCOPES } from "./api-key";

describe("API_KEY_SCOPES", () => {
  it("contient les portées média et rien d'inconnu en trop", () => {
    expect(API_KEY_SCOPES).toContain("media:read");
    expect(API_KEY_SCOPES).toContain("media:write");
    expect(API_KEY_SCOPES as readonly string[]).not.toContain("media:delete");
  });
});
