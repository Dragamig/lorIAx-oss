import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { AI_CREDIT } from "@/components/layout/ai-credit";

const dir = resolve(__dirname, "../../../messages");

describe("ai credit messages", () => {
  it("all_locales_carry_exact_credit", () => {
    const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
    expect(files.length).toBe(7);
    for (const f of files) {
      const json = JSON.parse(readFileSync(resolve(dir, f), "utf-8"));
      expect(json.shell.aiCredit, f).toBe(AI_CREDIT);
    }
  });
});
