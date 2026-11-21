import { describe, it, expect } from "vitest";
import { pathMatchesPattern, shouldPrune } from "./owned-paths";

describe("pathMatchesPattern", () => {
  it("`dir/**` matche en profondeur", () => {
    expect(pathMatchesPattern("src/app/api/meet/token/route.ts", "src/app/api/meet/**")).toBe(true);
  });
  it("`dir/**` ne matche pas un autre dossier", () => {
    expect(pathMatchesPattern("src/app/api/meeting-rooms/route.ts", "src/app/api/meet/**")).toBe(false);
  });
  it("`prefixe-*` matche un seul segment", () => {
    expect(pathMatchesPattern("src/components/editor/extensions/design-block.tsx", "src/components/editor/extensions/design-*")).toBe(true);
    expect(pathMatchesPattern("src/components/editor/extensions/design/x.tsx", "src/components/editor/extensions/design-*")).toBe(false);
  });
  it("chemin exact", () => {
    expect(pathMatchesPattern("src/lib/auth/ldap.ts", "src/lib/auth/ldap.ts")).toBe(true);
    expect(pathMatchesPattern("src/lib/auth/ldap-sync.ts", "src/lib/auth/ldap.ts")).toBe(false);
  });
  it("les parenthèses des route groups sont littérales", () => {
    expect(pathMatchesPattern("src/app/(app)/meet/page.tsx", "src/app/(app)/meet/**")).toBe(true);
  });
  it("les crochets du segment [locale] sont littéraux", () => {
    expect(pathMatchesPattern("src/app/[locale]/(app)/meet/page.tsx", "src/app/[locale]/(app)/meet/**")).toBe(true);
    expect(pathMatchesPattern("src/app/locale/(app)/meet/page.tsx", "src/app/[locale]/(app)/meet/**")).toBe(false);
  });
});

describe("shouldPrune (ref-count)", () => {
  const livekit = ["src/lib/meet/**", "src/app/api/meet/**"];
  const whisper = ["src/lib/meet/transcribe.ts"];
  it("prune un chemin possédé uniquement par un module exclu", () => {
    expect(shouldPrune("src/app/api/meet/token/route.ts", [], livekit)).toBe(true);
  });
  it("conserve un chemin partagé si un module inclus le possède", () => {
    // whisper inclus possède transcribe.ts qui matche aussi le glob exclu livekit
    expect(shouldPrune("src/lib/meet/transcribe.ts", whisper, livekit)).toBe(false);
  });
  it("ne prune jamais un fichier que personne ne possède (core/partagé)", () => {
    expect(shouldPrune("src/lib/db/schema.ts", [], livekit)).toBe(false);
  });
});
