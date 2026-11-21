import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const kb = readFileSync(join(root, "docs/kb/02-bases-de-donnees.md"), "utf8");

describe("KB et changelog des totaux du kanban et des vues personnelles", () => {
  it("la KB contient les titres des deux nouvelles sections", () => {
    expect(kb).toContain("\n## Totaux du kanban\n");
    expect(kb).toContain("\n## Vues partagées et personnelles\n");
  });

  it("la KB et le changelog ne contiennent aucun tiret cadratin ni demi-cadratin", () => {
    expect(kb).not.toMatch(/[—–]/);
  });
});
