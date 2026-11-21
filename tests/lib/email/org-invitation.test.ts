import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/email/templates/base-layout", () => ({ wrapInLayout: (s: string) => `<layout>${s}</layout>` }));

import { orgInvitationEmail } from "@/lib/email/templates/org-invitation";

describe("orgInvitationEmail", () => {
  it("contient l'URL d'invitation, le nom de l'org et l'inviteur", () => {
    const tpl = orgInvitationEmail({
      inviteUrl: "https://app.example.com/invite?token=abc123",
      orgName: "Acme",
      inviterName: "Alice",
    });
    expect(tpl.subject).toContain("Acme");
    expect(tpl.html).toContain("https://app.example.com/invite?token=abc123");
    expect(tpl.html).toContain("Acme");
    expect(tpl.text).toContain("Alice");
    expect(tpl.text).toContain("https://app.example.com/invite?token=abc123");
  });
});
