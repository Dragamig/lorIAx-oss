import { describe, it, expect, vi } from "vitest";
vi.mock("next-intl/middleware", () => ({ default: () => () => undefined }));
vi.mock("next-auth/jwt", () => ({ getToken: vi.fn(async () => null) }));
vi.mock("@/lib/meet/livekit-config", () => ({ getLiveKitUrlForCsp: vi.fn(async () => "") }));
vi.mock("@/i18n/routing", () => ({ routing: {} }));
import { isPublicPagePath } from "@/proxy";

describe("AZ-27 proxy public paths", () => {
  it("accepts /check-email and /verify-email without session", () => {
    expect(isPublicPagePath("/check-email")).toBe(true);
    expect(isPublicPagePath("/verify-email")).toBe(true);
    expect(isPublicPagePath("/verify-email/x")).toBe(true);
  });

  it("still refuses protected pages", () => {
    expect(isPublicPagePath("/documents")).toBe(false);
    expect(isPublicPagePath("/verify-emailx")).toBe(false);
  });
});
