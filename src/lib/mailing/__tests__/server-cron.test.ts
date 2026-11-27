import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("server.ts cron du tick mailing", () => {
  it("le Cron minute qui porte le tick est protégé contre le chevauchement", () => {
    const src = readFileSync(join(process.cwd(), "server.ts"), "utf8");
    const m = src.match(/new Cron\("\* \* \* \* \*",([^]*?)automationSchedulerTick/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/protect:\s*true/);
  });
});
