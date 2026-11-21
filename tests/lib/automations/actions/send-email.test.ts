import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  sent: [] as { to: string; subject: string }[],
  userRow: [] as { email: string }[],
}));

vi.mock("@/lib/email/send", () => ({
  sendEmail: vi.fn(async (args: { to: string; subject: string }) => {
    h.sent.push({ to: args.to, subject: args.subject });
    return { success: true };
  }),
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue(h.userRow),
    })),
  },
}));

import { sendEmailAction } from "@/lib/automations/actions/send-email";
import type { AutomationRow, ExecutionContext } from "@/lib/automations/actions/types";

const automation = {} as AutomationRow;

beforeEach(() => {
  h.sent = [];
  h.userRow = [];
  vi.clearAllMocks();
});

describe("action send_email", () => {
  it("envoie à un destinataire littéral `to`", async () => {
    await sendEmailAction.execute(
      { to: "alice@exemple.com", subject: "Bonjour", html: "<p>Salut</p>" },
      automation,
      {} as ExecutionContext
    );
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].to).toBe("alice@exemple.com");
  });

  it("résout l'email via toUserId et le fait primer", async () => {
    h.userRow = [{ email: "bob@exemple.com" }];
    await sendEmailAction.execute(
      { to: "ignore@exemple.com", toUserId: "{{user.id}}", subject: "Hey", text: "Coucou" },
      automation,
      { user: { id: "11111111-1111-4111-8111-111111111111" } }
    );
    expect(h.sent).toHaveLength(1);
    expect(h.sent[0].to).toBe("bob@exemple.com");
  });

  it("échoue si toUserId interpolé n'est pas un UUID", async () => {
    await expect(
      sendEmailAction.execute(
        { toUserId: "{{user.id}}", subject: "x", text: "y" },
        automation,
        { user: { id: "pas-un-uuid" } }
      )
    ).rejects.toThrow(/invalide/i);
  });

  it("échoue si l'utilisateur toUserId est introuvable", async () => {
    h.userRow = [];
    await expect(
      sendEmailAction.execute(
        { toUserId: "{{user.id}}", subject: "x", text: "y" },
        automation,
        { user: { id: "22222222-2222-4222-8222-222222222222" } }
      )
    ).rejects.toThrow(/introuvable/i);
  });

  it("rejette un destinataire `to` invalide après interpolation", async () => {
    await expect(
      sendEmailAction.execute(
        { to: "pas-un-email", subject: "x", text: "y" },
        automation,
        {} as ExecutionContext
      )
    ).rejects.toThrow(/invalide/i);
  });

  it("échoue si aucun destinataire n'est fourni", async () => {
    await expect(
      sendEmailAction.execute(
        { subject: "x", text: "y" },
        automation,
        {} as ExecutionContext
      )
    ).rejects.toThrow(/destinataire/i);
  });
});
