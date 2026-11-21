import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

/** Racine `src/` de l'application. */
export const SRC = resolve(__dirname, "../../..");

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = resolve(SRC, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (existsSync(c) && /\.tsx?$/.test(c)) return c;
  }
  return null;
}

/** Fichiers atteignables depuis `entry` par imports statiques et dynamiques (hors `import type`). */
export function reachable(entry: string): Set<string> {
  const seen = new Set<string>();
  const stack = [entry];
  while (stack.length) {
    const f = stack.pop()!;
    if (seen.has(f)) continue;
    seen.add(f);
    const src = readFileSync(f, "utf8");
    const re = /(?:^|\n)\s*(?:import|export)\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)/g;
    for (const m of src.matchAll(re)) {
      const r = resolveImport(f, m[1] ?? m[2]);
      if (r) stack.push(r);
    }
  }
  return seen;
}
