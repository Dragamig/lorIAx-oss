import { describe, expect, it } from "vitest";
// @ts-expect-error pas de déclaration de types pour le module compilé de Next
import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import { legacyStudioImageRedirect } from "./legacy-redirects";

const ID = "11111111-1111-4111-8111-111111111111";
const re = pathToRegexp(legacyStudioImageRedirect.source);

describe("redirection des anciennes images studio", () => {
  it("redirige définitivement /api/studio/images/<uuid> vers /api/media/<uuid>", () => {
    expect(re.test(`/api/studio/images/${ID}`)).toBe(true);
    expect(legacyStudioImageRedirect.destination).toBe("/api/media/:id");
    expect(legacyStudioImageRedirect.permanent).toBe(true);
  });
  it("ne masque pas la collection (POST/GET /api/studio/images) ni un segment non UUID", () => {
    expect(re.test("/api/studio/images")).toBe(false);
    expect(re.test("/api/studio/images/")).toBe(false);
    expect(re.test("/api/studio/images/abc")).toBe(false);
    expect(re.test(`/api/studio/images/${ID}/x`)).toBe(false);
  });
});
