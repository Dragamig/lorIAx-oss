import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  reserve: true,
  exec: "success" as string,
  calls: [] as string[],
}));

vi.mock("@/lib/settings/system-settings", () => ({ getSetting: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/automations/executor", () => ({
  executeAutomation: vi.fn(async () => (h.calls.push("exec"), { status: h.exec })),
}));
vi.mock("@/lib/integrations/tally/submission-claims", () => {
  return {
    tallyResponseIdFromBody: (b: { eventType?: string; data?: { responseId?: string } }) =>
      b?.eventType === "FORM_RESPONSE" ? (b.data?.responseId ?? null) : null,
    reserveSubmission: vi.fn(async () => (h.calls.push("reserve"), h.reserve)),
    markSubmissionDone: vi.fn(async () => void h.calls.push("done")),
    releaseSubmission: vi.fn(async () => void h.calls.push("release")),
  };
});
vi.mock("@/lib/db", () => {
  const self: Record<string, unknown> = {
    from: () => self,
    where: () => self,
    set: () => self,
    limit: async () => [{ id: "a1", enabled: true, triggerType: "webhook_inbound", triggerConfig: { token: "t" }, spaceId: null, databaseId: "d" }],
    then: (res: (v: unknown) => void) => res([]),
  };
  return { db: { select: () => self, update: () => self } };
});

import { POST } from "@/app/api/automations/hook/[token]/route";

const TOKEN = "a".repeat(48);
const post = (body: unknown) => POST(new Request("http://x", { method: "POST", body: JSON.stringify(body) }), { params: Promise.resolve({ token: TOKEN }) });
const tally = { eventType: "FORM_RESPONSE", data: { responseId: "r1" } };

beforeEach(() => {
  h.reserve = true;
  h.exec = "success";
  h.calls = [];
});

describe("webhook entrant : réservation des réponses Tally", () => {
  it("réponse déjà traitée (import en cours) : non rejouée", async () => {
    h.reserve = false;
    const res = await post(tally);
    expect(await res.json()).toEqual({ status: "duplicate" });
    expect(h.calls).toEqual(["reserve"]);
  });
  it("succès : réserve, exécute, marque traitée", async () => {
    await post(tally);
    expect(h.calls).toEqual(["reserve", "exec", "done"]);
  });
  it("échec d'exécution : réservation libérée", async () => {
    h.exec = "error";
    expect((await post(tally)).status).toBe(502);
    expect(h.calls).toEqual(["reserve", "exec", "release"]);
  });
  it("autre webhook : aucune réservation", async () => {
    await post({ hello: "world" });
    expect(h.calls).toEqual(["exec"]);
  });
});
