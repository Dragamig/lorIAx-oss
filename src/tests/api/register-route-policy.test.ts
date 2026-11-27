import { describe, it, expect, vi } from "vitest";

const h = vi.hoisted(() => ({ refusal: null as null | { status: number; error: string } }));

vi.mock("@/lib/auth/registration-policy", () => ({ getRegistrationRefusal: async () => h.refusal }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => {
      throw new Error("la base ne doit pas etre lue apres un refus");
    },
    insert: () => {
      throw new Error("aucune ecriture apres un refus");
    },
  },
}));
vi.mock("@/lib/git/repository", () => ({ initRepository: vi.fn() }));
vi.mock("@/lib/calendar/auto-provision", () => ({ ensurePersonalCalendar: vi.fn() }));
vi.mock("@/lib/org/get-org-id", () => ({ getDefaultOrgId: async () => "org-1" }));
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn() }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "hash") } }));
vi.mock("@/lib/logger", () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { POST } from "@/app/api/auth/register/route";

describe("POST /api/auth/register et politique d'inscription", () => {
  it("renvoie le refus de la politique sans toucher la base", async () => {
    h.refusal = { status: 403, error: "L'inscription est fermee sur cette instance." };
    const res = await POST(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Test", email: "a@example.test", password: "motdepasse123" }),
      }),
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: "registration_closed" });
  });
});
