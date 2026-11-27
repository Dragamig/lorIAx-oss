// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithIntl } from "@/__tests__/components/support/render-intl";
import { ConversationList } from "../conversation-list";
import type { ConversationView, MailDto } from "../use-fiche-mails";

afterEach(cleanup);

const msg = (over: Partial<MailDto>): MailDto =>
  ({
    id: "m1",
    messageId: "<m1@x>",
    direction: "out",
    status: "sent",
    from: "alice@example.com",
    to: ["claire@orange.fr"],
    cc: [],
    bcc: [],
    subject: "Devis cuisine",
    bodyHtml: "<p>Bonjour Claire</p>",
    bodyText: "Bonjour Claire",
    attachments: [],
    date: "2026-11-14T16:40:00.000Z",
    scheduledAt: null,
    sentAt: "2026-11-14T16:40:00.000Z",
    error: null,
    errorReason: null,
    errorDetail: null,
    traced: true,
    ...over,
  }) as MailDto;

const conversation = (messages: MailDto[], key = "t1"): ConversationView =>
  ({
    threadKey: key,
    subject: "Devis cuisine",
    messages,
    lastAt: messages[messages.length - 1].date,
    unread: false,
  }) as ConversationView;

const renderList = (conversations: ConversationView[]) =>
  renderWithIntl(
    <ConversationList
      conversations={conversations}
      contactName="Claire Martin"
      contactEmail="claire@orange.fr"
      mailbox="alice@example.com"
      showContact={false}
      onCompose={() => {}}
    />,
  );

describe("ConversationList, variante du statut", () => {
  it("le statut Envoyé porte la variante verte (clair et sombre)", () => {
    renderList([conversation([msg({ id: "s1", status: "sent" })])]);
    const chip = screen.getByText("Envoyé");
    expect(chip.className).toContain("bg-emerald-100");
    expect(chip.className).toContain("text-emerald-900");
    expect(chip.className).toContain("dark:bg-emerald-900/40");
    expect(chip.className).toContain("dark:text-emerald-200");
  });

  it("le statut Reçu garde la variante neutre", () => {
    renderList([conversation([msg({ id: "r1", direction: "in", status: "sent" })])]);
    const chip = screen.getByText("Reçu");
    expect(chip.className).not.toContain("emerald");
    expect(chip.className).toContain("bg-muted");
  });

  it("le statut Programmé garde la variante neutre", () => {
    renderList([conversation([msg({ id: "p1", status: "scheduled", scheduledAt: "2026-11-30T09:00:00.000Z" })])]);
    const chip = screen.getByText("Programmé");
    expect(chip.className).not.toContain("emerald");
  });
});
