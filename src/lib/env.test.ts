import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";

// Le noyau ne dépend pas du baril commercial : le baril env est remplacé.
const extra = vi.hoisted(() => ({ shape: {} as Record<string, unknown> }));
vi.mock("@/lib/modules/hooks.env.generated", () => ({
  collectIncludedEnvShape: () => extra.shape,
}));

const REQUIRED = {
  DATABASE_URL: "postgres://x",
  NEXTAUTH_URL: "http://localhost:3000",
  NEXTAUTH_SECRET: "a".repeat(16),
  ENCRYPTION_KEY: "k",
  S3_ENDPOINT: "localhost",
  S3_ACCESS_KEY: "a",
  S3_SECRET_KEY: "s",
};

const saved = { ...process.env };

async function load() {
  vi.resetModules();
  return import("./env");
}

describe("validateEnv (noyau)", () => {
  beforeEach(() => {
    extra.shape = {};
    process.env = { ...REQUIRED } as unknown as NodeJS.ProcessEnv;
  });
  afterEach(() => {
    process.env = saved;
  });

  it("env_schema_ignores_commercial_variables_when_absent", async () => {
    process.env.LICENSE_MANAGER_URL = "pas une url";
    process.env.VARIABLE_INCONNUE = "x";
    const { validateEnv } = await load();
    expect(() => validateEnv()).not.toThrow();
  });

  it("env_schema_still_requires_base_variables", async () => {
    process.env.DATABASE_URL = "";
    const { validateEnv } = await load();
    expect(() => validateEnv()).toThrow("DATABASE_URL est obligatoire");
  });

  it("env_schema_merges_the_shape_exposed_by_the_env_leaf", async () => {
    extra.shape = { EXTRA_VAR: z.string().min(3, "EXTRA_VAR trop court") };
    process.env.EXTRA_VAR = "ab";
    const { validateEnv } = await load();
    expect(() => validateEnv()).toThrow("EXTRA_VAR trop court");
  });
});
