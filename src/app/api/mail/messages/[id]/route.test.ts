import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({ visible: vi.fn() }));
vi.mock("@/lib/crm/access", () => ({
  requireCrm: async () => ({ ok: true, user: { id: "u1" }, orgId: "org1", isAdmin: false, enabled: true }),
}));
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/mailing/threads", async (orig) => ({
  ...(await orig<typeof import("@/lib/mailing/threads")>()),
  getVisibleMail: (...a: unknown[]) => h.visible(...a),
}));

import { GET } from "./route";

const ID = "44444444-4444-4444-8444-444444444444";
const call = () => GET(new NextRequest(`http://x/api/mail/messages/${ID}`), { params: Promise.resolve({ id: ID }) });

beforeEach(() => h.visible.mockReset());

describe("GET /api/mail/messages/[id]", () => {
  it("returns 404 when the mail is not visible to the session user in the session org", async () => {
    h.visible.mockResolvedValue(null);
    expect((await call()).status).toBe(404);
    expect(h.visible).toHaveBeenCalledWith("org1", "u1", ID);
  });
  it("returns the sanitized dto without storage keys", async () => {
    h.visible.mockResolvedValue({
      id: ID, direction: "out", status: "sent", messageId: "<m@x>", fromAddress: "a@x.fr", toAddresses: [], ccAddresses: [],
      bccAddresses: [], subject: "S", bodyHtml: "<p>a</p><script>x</script>", bodyText: "a", sentAt: null, scheduledAt: null,
      createdAt: new Date(), lastError: null, interactionRowId: null,
      attachments: [{ source: "upload", storageKey: "mail/org1/u1/k", fileName: "f", mimeType: "t", size: 1 }],
    });
    const text = JSON.stringify(await (await call()).json());
    expect(text).not.toContain("script");
    expect(text).not.toContain("mail/org1/u1/k");
  });
});
