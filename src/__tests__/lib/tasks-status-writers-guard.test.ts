import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(process.cwd(), "src");

/**
 * Relevé `grep -rn "update(tasks)" src` (hors tests) du 2026-11-16 :
 * - lib/tasks/update-task.ts : écrivain transactionnel (verrou + événements de tâche de ligne) ;
 * - app/api/tasks/[id]/route.ts : PATCH, ne doit écrire le statut d'une tâche de ligne que via updateTaskWithEvents ;
 * - app/api/tasks/unassign/route.ts : ne touche que assigneeId (tâches de document) ;
 * - app/api/events/[id]/route.ts : ne touche que assigneeId (tâches Gantt).
 * Un nouvel écrivain doit être ajouté ici après revue : il ne doit pas contourner les événements.
 */
const ALLOW_LIST = [
  "lib/tasks/update-task.ts",
  "app/api/tasks/[id]/route.ts",
  "app/api/tasks/unassign/route.ts",
  "app/api/events/[id]/route.ts",
];

/** Fichiers de la liste qui ne doivent jamais écrire `status`. */
const NO_STATUS_WRITERS = ["app/api/tasks/unassign/route.ts", "app/api/events/[id]/route.ts"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "__tests__" || name === "node_modules") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const WRITER = /\.update\(\s*(?:schema\.)?tasks\s*\)/;

describe("écrivains de tasks.status", () => {
  const writers = walk(SRC)
    .filter((f) => WRITER.test(readFileSync(f, "utf8")))
    .map((f) => relative(SRC, f).split("\\").join("/"))
    .sort();

  it("aucun fichier hors de la liste blanche n'écrit dans tasks", () => {
    const unknown = writers.filter((f) => !ALLOW_LIST.includes(f));
    expect(unknown).toEqual([]);
  });

  it("la liste blanche ne contient pas de fichier obsolète", () => {
    expect(ALLOW_LIST.filter((f) => !writers.includes(f))).toEqual([]);
  });

  it("le PATCH des tâches passe par updateTaskWithEvents", () => {
    const src = readFileSync(join(SRC, "app/api/tasks/[id]/route.ts"), "utf8");
    expect(src).toMatch(/updateTaskWithEvents\(/);
    expect(src).toMatch(/kind\s*===\s*"database_row"/);
  });

  it("les écrivains annexes ne touchent jamais au statut", () => {
    for (const f of NO_STATUS_WRITERS) {
      const src = readFileSync(join(SRC, f), "utf8");
      const calls = src.split(/\.update\(\s*tasks\s*\)/).slice(1);
      for (const c of calls) {
        const set = c.slice(0, c.indexOf(".where("));
        expect(set, f).not.toMatch(/\bstatus\b/);
      }
    }
  });
});
