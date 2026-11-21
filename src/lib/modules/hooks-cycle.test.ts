import { describe, it, expect, vi } from "vitest";
import { registerIncludedModuleHooks as fixtureRegister } from "./__fixtures__/register-fixture";
import { getHooks } from "./hooks";

// Le baril généré est remplacé par un baril qui délègue au fichier `register` de test.
// La fixture importe `registerHooks` depuis hooks.ts, qui importe le baril : cycle réel.
vi.mock("./hooks.server.generated", () => ({
  registerIncludedModuleHooks: () => fixtureRegister(),
}));

describe("cycle hooks.ts <-> baril <-> register", () => {
  it("register_file_using_registerHooks_in_function_body_works_via_barrel", async () => {
    expect(await getHooks().usage.getOrgStorageLimitBytes("o")).toBe(7);
  });
});
