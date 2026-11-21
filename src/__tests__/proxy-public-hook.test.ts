import { describe, it, expect, vi } from "vitest";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn(async () => null) }));
vi.mock("@/lib/meet/livekit-config", () => ({ getLiveKitUrlForCsp: vi.fn(async () => "") }));
vi.mock("next-intl/middleware", () => ({ default: () => () => undefined }));
vi.mock("@/i18n/routing", () => ({ routing: {} }));

import { NextRequest } from "next/server";
import proxy, { isPublicAutomationHookPath, isPublicCronPath } from "@/proxy";

const TOKEN = "a".repeat(48);

describe("webhook entrant des automatismes dans le proxy", () => {
  it("reconnait uniquement /api/automations/hook/<jeton>", () => {
    expect(isPublicAutomationHookPath(`/api/automations/hook/${TOKEN}`)).toBe(true);
    expect(isPublicAutomationHookPath("/api/automations/hook/")).toBe(false);
    expect(isPublicAutomationHookPath(`/api/automations/hook/${TOKEN}/x`)).toBe(false);
    expect(isPublicAutomationHookPath("/api/automations")).toBe(false);
    expect(isPublicAutomationHookPath("/api/automations/run")).toBe(false);
  });

  it("ne redirige pas le hook sans session", async () => {
    const res = await proxy(new NextRequest(`http://localhost/api/automations/hook/${TOKEN}`, { method: "POST" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("redirige toujours une route d'API protegee sans session", async () => {
    const res = await proxy(new NextRequest("http://localhost/api/automations", { method: "POST" }));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });
});

describe("routes planifiees (secret CRON_SECRET) dans le proxy", () => {
  it("reconnait uniquement les routes cron déclarées", () => {
    expect(isPublicCronPath("/api/cron/kb-index")).toBe(true);
    expect(isPublicCronPath("/api/cron/row-history-purge")).toBe(true);
    expect(isPublicCronPath("/api/calendar-reminders")).toBe(true);
    expect(isPublicCronPath("/api/cron/media-purge")).toBe(true);
    expect(isPublicCronPath("/api/cron/media-usages")).toBe(true);
    expect(isPublicCronPath("/api/cron/media-purge/x")).toBe(false);
    expect(isPublicCronPath("/api/cron/autre")).toBe(false);
    expect(isPublicCronPath("/api/calendar-reminders/x")).toBe(false);
  });

  it("ne redirige pas un appel cron sans session", async () => {
    const res = await proxy(new NextRequest("http://localhost/api/cron/kb-index", { method: "POST" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });

  it("ne redirige pas un appel cron média sans session", async () => {
    for (const path of ["/api/cron/media-purge", "/api/cron/media-usages"]) {
      const res = await proxy(new NextRequest(`http://localhost${path}`, { method: "POST" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("location")).toBeNull();
    }
  });
});
