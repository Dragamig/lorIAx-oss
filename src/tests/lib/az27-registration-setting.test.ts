import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  fail: false,
  emailConfig: {} as Record<string, unknown>,
}));

vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const self: any = {
    select: vi.fn(() => self),
    from: vi.fn(() => self),
    where: vi.fn(() => self),
    limit: vi.fn(() =>
      state.fail ? Promise.reject(new Error("db down")) : Promise.resolve(state.rows)
    ),
  };
  return { db: self };
});

vi.mock("@/lib/email/provider", () => ({
  getEmailConfig: vi.fn(async () => state.emailConfig),
}));

import { isRegistrationOpen } from "@/lib/auth/registration-setting";
import { isEmailConfigured } from "@/lib/email/email-configured";

describe("isRegistrationOpen (fail-closed)", () => {
  beforeEach(() => {
    state.rows = [];
    state.fail = false;
  });
  it("ligne absente => false", async () => {
    expect(await isRegistrationOpen()).toBe(false);
  });
  it("allowRegistration true => true", async () => {
    state.rows = [{ value: { allowRegistration: true } }];
    expect(await isRegistrationOpen()).toBe(true);
  });
  it('"true" (chaîne) => false', async () => {
    state.rows = [{ value: { allowRegistration: "true" } }];
    expect(await isRegistrationOpen()).toBe(false);
  });
  it("db qui lève => false", async () => {
    state.fail = true;
    expect(await isRegistrationOpen()).toBe(false);
  });
});

describe("isEmailConfigured", () => {
  it("emailEnabled false => false", async () => {
    state.emailConfig = { emailEnabled: false, emailProvider: "smtp", smtpHost: "h" };
    expect(await isEmailConfigured()).toBe(false);
  });
  it("smtp sans smtpHost => false", async () => {
    state.emailConfig = { emailEnabled: true, emailProvider: "smtp" };
    expect(await isEmailConfigured()).toBe(false);
  });
  it("smtp avec hôte => true", async () => {
    state.emailConfig = { emailEnabled: true, emailProvider: "smtp", smtpHost: "smtp.x" };
    expect(await isEmailConfigured()).toBe(true);
  });
  it("resend sans clé => false", async () => {
    state.emailConfig = { emailEnabled: true, emailProvider: "resend" };
    expect(await isEmailConfigured()).toBe(false);
  });
  it("resend avec clé => true", async () => {
    state.emailConfig = { emailEnabled: true, emailProvider: "resend", resendApiKey: "re_x" };
    expect(await isEmailConfigured()).toBe(true);
  });
});
