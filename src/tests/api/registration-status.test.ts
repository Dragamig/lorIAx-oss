import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ refusal: null as null | { status: number; error: string } }));
vi.mock("@/lib/auth/registration-policy", () => ({ getRegistrationRefusal: async () => h.refusal }));

import { GET } from "@/app/api/auth/registration-status/route";

describe("GET /api/auth/registration-status", () => {
  it("open false quand l'inscription est fermee", async () => {
    h.refusal = { status: 403, error: "fermee" };
    expect(await (await GET()).json()).toEqual({ open: false });
  });
  it("open true quand la politique ne refuse pas", async () => {
    h.refusal = null;
    expect(await (await GET()).json()).toEqual({ open: true });
  });
});
