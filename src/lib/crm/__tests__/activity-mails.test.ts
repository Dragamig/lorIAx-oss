import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MailMessageRow } from "@/lib/db/schema-mailing";

const { listFicheMails } = vi.hoisted(() => ({ listFicheMails: vi.fn() }));
vi.mock("@/lib/mailing/threads", async (orig) => ({
  ...(await orig<typeof import("@/lib/mailing/threads")>()),
  listFicheMails,
}));

import { toMailActivity } from "../activity-model";
import { loadActivityMails, MAIL_PREVIEW_LENGTH } from "../activity";

const UUID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const mail = (n: number, over: Partial<MailMessageRow> = {}): MailMessageRow =>
  ({
    id: UUID(n),
    organizationId: "org",
    userId: "u",
    direction: "out",
    status: "sent",
    messageId: null,
    threadKey: null,
    fromAddress: "me@x.fr",
    toAddresses: ["a@x.fr"],
    ccAddresses: [],
    bccAddresses: ["secret@x.fr"],
    subject: `Sujet ${n}`,
    bodyHtml: "<p>HTML-SECRET</p>",
    bodyText: "corps",
    attachments: [],
    scheduledAt: null,
    sentAt: new Date("2026-11-01T10:00:00Z"),
    lastError: null,
    interactionRowId: null,
    createdAt: new Date("2026-11-01T09:00:00Z"),
    ...over,
  }) as unknown as MailMessageRow;

beforeEach(() => listFicheMails.mockReset());

describe("loadActivityMails", () => {
  it("appelle listFicheMails avec orgId ET userId, scope deal vers dossier", async () => {
    listFicheMails.mockResolvedValue([]);
    await loadActivityMails("org", "u", { kind: "deal", rowId: UUID(9) });
    expect(listFicheMails).toHaveBeenCalledWith("org", "u", { kind: "dossier", dossierRowId: UUID(9) });
    await loadActivityMails("org", "u", { kind: "contact", rowId: UUID(8) });
    expect(listFicheMails).toHaveBeenLastCalledWith("org", "u", { kind: "contact", contactRowId: UUID(8) });
  });

  it("limite aux 200 mails les plus récents", async () => {
    listFicheMails.mockResolvedValue(Array.from({ length: 250 }, (_, i) => mail(i + 1)));
    const out = await loadActivityMails("org", "u", { kind: "deal", rowId: UUID(9) });
    expect(out).toHaveLength(200);
    expect(out[0].id).toBe(UUID(51));
    expect(out[199].id).toBe(UUID(250));
  });

  it("masque cancelled et les mails entrants", async () => {
    listFicheMails.mockResolvedValue([
      mail(1, { status: "cancelled" }),
      mail(2, { direction: "in", status: "received" }),
      mail(3, { direction: "in", status: "sent" }),
      mail(4),
    ]);
    const out = await loadActivityMails("org", "u", { kind: "deal", rowId: UUID(9) });
    expect(out.map((m) => m.id)).toEqual([UUID(4)]);
  });

  it("garde sending, badge En cours", async () => {
    listFicheMails.mockResolvedValue([mail(1, { status: "sending", sentAt: null })]);
    const [m] = await loadActivityMails("org", "u", { kind: "deal", rowId: UUID(9) });
    expect(m.status).toBe("sending");
  });

  it("failed porte le code lisible et retryable", async () => {
    listFicheMails.mockResolvedValue([
      mail(1, { status: "failed", lastError: "quota" }),
      mail(2, { status: "failed", lastError: "delivery_unknown" }),
    ]);
    const out = await loadActivityMails("org", "u", { kind: "deal", rowId: UUID(9) });
    expect(toMailActivity(out[0])).toMatchObject({ error: "quota_exceeded", retryable: true });
    expect(toMailActivity(out[1])).toMatchObject({ error: "delivery_unknown", retryable: false });
  });

  it("n'expose jamais le corps HTML ni bcc, tronque le texte", async () => {
    listFicheMails.mockResolvedValue([mail(1, { bodyText: "x".repeat(MAIL_PREVIEW_LENGTH + 50) })]);
    const out = await loadActivityMails("org", "u", { kind: "deal", rowId: UUID(9) });
    expect(out[0].bodyHtml).toBe("");
    expect(out[0].bcc).toEqual([]);
    expect(out[0].bodyText).toHaveLength(MAIL_PREVIEW_LENGTH);
    expect(JSON.stringify(out)).not.toContain("HTML-SECRET");
  });
});
