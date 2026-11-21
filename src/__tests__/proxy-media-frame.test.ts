import { describe, it, expect, vi } from "vitest";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn(async () => null) }));
vi.mock("@/lib/meet/livekit-config", () => ({ getLiveKitUrlForCsp: vi.fn(async () => "") }));
vi.mock("next-intl/middleware", () => ({ default: () => () => undefined }));
vi.mock("@/i18n/routing", () => ({ routing: {} }));

import { NextResponse } from "next/server";
import { addApiSecurityHeaders, isMediaReadPath } from "@/proxy";
import { frameHeaderRules } from "@/lib/media/frame-policy";

const ID = "11111111-1111-4111-8111-111111111111";

describe("encadrement de la lecture des médias (aperçu PDF)", () => {
  it("reconnait uniquement /api/media/<id>", () => {
    expect(isMediaReadPath(`/api/media/${ID}`)).toBe(true);
    expect(isMediaReadPath(`/api/media/${ID}/meta`)).toBe(false);
    expect(isMediaReadPath("/api/media/folders")).toBe(false);
    expect(isMediaReadPath("/api/media")).toBe(false);
    expect(isMediaReadPath(`/api/attachments/${ID}`)).toBe(false);
  });

  it("autorise la même origine seulement sur la lecture", () => {
    const read = addApiSecurityHeaders(NextResponse.next(), `/api/media/${ID}`);
    expect(read.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'self'");
    const other = addApiSecurityHeaders(NextResponse.next(), `/api/media/${ID}/meta`);
    expect(other.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
    const unrelated = addApiSecurityHeaders(NextResponse.next(), "/api/documents/x");
    expect(unrelated.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
  });

  it("next.config : SAMEORIGIN pour la lecture, DENY ailleurs", () => {
    const rules = frameHeaderRules();
    const xfo = (path: string) =>
      rules
        .filter((r) => new RegExp(`^${r.source.replace(/:id\(.*?\)\)?/, "[0-9a-fA-F-]{36}")}$`).test(path))
        .map((r) => r.headers.find((h) => h.key === "X-Frame-Options")?.value);
    expect(xfo(`/api/media/${ID}`)).toEqual(["SAMEORIGIN"]);
    expect(xfo(`/api/media/${ID}/meta`)).toEqual(["DENY"]);
    expect(xfo("/fr/documents")).toEqual(["DENY"]);
  });

  it("l'alias permanent /api/attachments/<clé> n'est jamais encadrable : l'aperçu passe par l'ID", () => {
    for (const p of [`/api/attachments/${ID}`, "/api/attachments/org/space/doc.pdf", "/api/attachments/signed"]) {
      expect(isMediaReadPath(p)).toBe(false);
      const res = addApiSecurityHeaders(NextResponse.next(), p);
      expect(res.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
    expect(frameHeaderRules().every((r) => !r.source.includes("attachments"))).toBe(true);
  });
});
