import { describe, it, expect, vi } from "vitest";

vi.hoisted(() => {
  process.env.S3_PUBLIC_URL = "https://files.loriax.example";
});
vi.mock("next-auth/jwt", () => ({ getToken: vi.fn(async () => null) }));
vi.mock("@/lib/meet/livekit-config", () => ({ getLiveKitUrlForCsp: vi.fn(async () => "") }));
vi.mock("next-intl/middleware", () => ({ default: () => () => undefined }));
vi.mock("@/i18n/routing", () => ({ routing: {} }));

import { buildCsp } from "@/proxy";

describe("CSP et envoi direct S3", () => {
  const csp = buildCsp("abc", "");
  const directive = (name: string) => csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(name + " "))!;

  it("connect-src contient S3_PUBLIC_URL, sans joker", () => {
    const connect = directive("connect-src");
    expect(connect).toContain("https://files.loriax.example");
    expect(connect.split(/\s+/)).not.toContain("*");
    expect(connect).not.toMatch(/https:\/\/\*(\s|$)/);
    expect(connect).not.toContain("https://*.amazonaws.com");
  });
});
