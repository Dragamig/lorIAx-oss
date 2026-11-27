import { describe, it, expect } from "vitest";
import type { InteractionDto } from "../deal-model";
import type { MailMessageDto } from "@/lib/mailing/threads";
import {
  mergeActivity,
  filterActivity,
  mailBadge,
  toMailActivity,
  toInteractionActivity,
  toTaskActivity,
  type ActivityItem,
} from "../activity-model";

const interaction = (id: string, date: string | null, extra: Partial<InteractionDto> = {}): InteractionDto => ({
  id,
  date,
  type: "appel",
  title: `i-${id}`,
  note: null,
  dealId: null,
  ...extra,
});

const mailDto = (id: string, date: string, extra: Partial<MailMessageDto> = {}): MailMessageDto => ({
  id,
  messageId: null,
  direction: "out",
  status: "sent",
  from: "a@x.fr",
  to: ["b@x.fr"],
  cc: [],
  bcc: [],
  subject: `m-${id}`,
  bodyHtml: "",
  bodyText: "",
  attachments: [],
  date,
  scheduledAt: null,
  sentAt: date,
  error: null,
  errorReason: null,
  errorDetail: null,
  traced: false,
  ...extra,
});

describe("mergeActivity", () => {
  it("entrelace trois sources par date décroissante, sans date en dernier", () => {
    const items = mergeActivity({
      interactions: [interaction("i1", "2026-11-10T10:00:00.000Z"), interaction("i0", null)],
      tasks: [{ id: "t1", title: "Relancer", dueAt: "2026-11-12T08:00:00.000Z" }],
      mails: [mailDto("m1", "2026-11-11T09:00:00.000Z")],
    });
    expect(items.map((i) => i.id)).toEqual(["t1", "m1", "i1", "i0"]);
  });

  it("départage stable par kind puis id à date égale", () => {
    const d = "2026-11-10T10:00:00.000Z";
    const items = mergeActivity({
      interactions: [interaction("b", d), interaction("a", d)],
      tasks: [{ id: "z", title: "t", dueAt: d }],
      mails: [mailDto("y", d)],
    });
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual([
      "interaction:a",
      "interaction:b",
      "mail:y",
      "task:z",
    ]);
  });

  it("liste vide", () => {
    expect(mergeActivity({ interactions: [], tasks: [], mails: [] })).toEqual([]);
    expect(filterActivity([], "mail")).toEqual([]);
  });

  it("mail et interaction liée coexistent, aucun dédoublonnage", () => {
    const items = mergeActivity({
      interactions: [interaction("i1", "2026-11-11T09:00:00.000Z", { title: "Mail envoyé : m-m1" })],
      tasks: [],
      mails: [mailDto("m1", "2026-11-11T09:00:00.000Z", { traced: true })],
    });
    expect(items.map((i) => i.kind).sort()).toEqual(["interaction", "mail"]);
  });
});

describe("toMailActivity", () => {
  it("ne produit jamais un mail annulé", () => {
    expect(toMailActivity(mailDto("m", "2026-11-11T09:00:00.000Z", { status: "cancelled" }))).toBeNull();
    const items = mergeActivity({
      interactions: [],
      tasks: [],
      mails: [mailDto("m", "2026-11-11T09:00:00.000Z", { status: "cancelled" })],
    });
    expect(items).toEqual([]);
  });

  it("marque delivery_unknown non réessayable, les autres échecs réessayables", () => {
    const retry = (error: MailMessageDto["error"]) => {
      const a = toMailActivity(mailDto("m", "2026-11-11T09:00:00.000Z", { status: "failed", error }));
      return a?.retryable;
    };
    expect(retry("delivery_unknown")).toBe(false);
    expect(retry("send_failed")).toBe(true);
    expect(retry("quota_exceeded")).toBe(true);
    expect(retry("account_missing")).toBe(true);
  });

  it("un mail non échoué n'est pas réessayable", () => {
    expect(toMailActivity(mailDto("m", "2026-11-11T09:00:00.000Z"))?.retryable).toBe(false);
  });
});

describe("filterActivity", () => {
  const all: ActivityItem[] = mergeActivity({
    interactions: [interaction("i1", "2026-11-10T10:00:00.000Z")],
    tasks: [{ id: "t1", title: "x", dueAt: null }],
    mails: [mailDto("m1", "2026-11-11T09:00:00.000Z")],
  });

  it("mail ne renvoie que des mails", () => {
    const r = filterActivity(all, "mail");
    expect(r.length).toBe(1);
    expect(r.every((i) => i.kind === "mail")).toBe(true);
  });

  it("all renvoie tout, task et interaction filtrent", () => {
    expect(filterActivity(all, "all")).toHaveLength(3);
    expect(filterActivity(all, "task").map((i) => i.id)).toEqual(["t1"]);
    expect(filterActivity(all, "interaction").map((i) => i.id)).toEqual(["i1"]);
  });
});

describe("mailBadge", () => {
  it("renvoie une clé i18n par statut affichable", () => {
    expect(mailBadge("scheduled")).toBe("fiche.activity.mail.badge.scheduled");
    expect(mailBadge("sending")).toBe("fiche.activity.mail.badge.sending");
    expect(mailBadge("sent")).toBe("fiche.activity.mail.badge.sent");
    expect(mailBadge("failed")).toBe("fiche.activity.mail.badge.failed");
  });
});

describe("adaptateurs", () => {
  it("conservent id et date", () => {
    expect(toInteractionActivity(interaction("i", "2026-01-01T00:00:00.000Z")).date).toBe("2026-01-01T00:00:00.000Z");
    expect(toTaskActivity({ id: "t", title: "x", dueAt: null }).date).toBeNull();
  });
});

describe("mergeActivity mixed date formats", () => {
  it("orders YYYY-MM-DD and full ISO dates by instant", () => {
    const items = mergeActivity({
      interactions: [interaction("i1", "2026-11-20")],
      tasks: [
        { id: "t1", title: "a", dueAt: "2026-11-20T08:00:00.000Z" },
        { id: "t2", title: "b", dueAt: "2026-11-19T23:00:00.000Z" },
      ],
      mails: [],
    });
    expect(items.map((i) => i.id)).toEqual(["t1", "i1", "t2"]);
  });
});
