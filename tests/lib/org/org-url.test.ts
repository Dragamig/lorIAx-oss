import { describe, it, expect, afterEach } from "vitest";
import { buildOrgUrl } from "@/lib/org/org-url";

const ORIGINAL = process.env.NEXT_PUBLIC_ROOT_DOMAIN;
afterEach(() => { process.env.NEXT_PUBLIC_ROOT_DOMAIN = ORIGINAL; });

describe("buildOrgUrl", () => {
  it("retourne un sous-domaine en prod quand ROOT_DOMAIN est défini", () => {
    process.env.NEXT_PUBLIC_ROOT_DOMAIN = "example.com";
    expect(buildOrgUrl("acme")).toBe("https://acme.example.com");
  });

  it("retourne un chemin /org/<slug> en dev quand ROOT_DOMAIN est absent", () => {
    delete process.env.NEXT_PUBLIC_ROOT_DOMAIN;
    expect(buildOrgUrl("acme")).toBe("/org/acme");
  });
});
