import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  media: null as Record<string, unknown> | null,
  existing: null as { version: number; status?: string } | null,
  statements: [] as string[],
  fail: false,
}));
const render = (q: unknown) =>
  ((q as { queryChunks?: unknown[] }).queryChunks ?? [])
    .map((c) => (typeof c === "object" && c && "value" in (c as object) ? String((c as { value: unknown }).value) : ""))
    .join("");

vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => (h.fail ? Promise.reject(new Error("db")) : Promise.resolve(h.media ? [h.media] : [])) }) }),
    }),
    transaction: (fn: (t: unknown) => Promise<unknown>) =>
      fn({
        execute: (q: unknown) => {
          const t = render(q);
          h.statements.push(t);
          return Promise.resolve({ rows: t.includes("FOR UPDATE") && h.existing ? [h.existing] : [] });
        },
      }),
  },
}));

import { enqueueMediaIndex } from "./enqueue";

const pdf = { id: "m1", organizationId: "o1", mimeType: "application/pdf", filename: "a.pdf", currentVersion: 2, deletedAt: null };
const kinds = () => h.statements.map((s) => s.trim().split(/\s+/)[0]);

beforeEach(() => {
  h.media = { ...pdf };
  h.existing = null;
  h.statements = [];
  h.fail = false;
});

describe("enqueueMediaIndex", () => {
  it("PDF : crée une ligne pending à la version courante", async () => {
    await enqueueMediaIndex("m1", "ingest");
    expect(h.statements.some((s) => s.includes("INSERT INTO media_texts") && s.includes("'pending'"))).toBe(true);
  });

  it("archive : aucune ligne", async () => {
    h.media = { ...pdf, mimeType: "application/zip", filename: "a.zip" };
    await enqueueMediaIndex("m1", "ingest");
    expect(h.statements).toEqual([]);
  });

  it("média introuvable ou en corbeille : rien", async () => {
    h.media = null;
    await enqueueMediaIndex("m1", "ingest");
    h.media = { ...pdf, deletedAt: new Date() };
    await enqueueMediaIndex("m1", "ingest");
    expect(h.statements).toEqual([]);
  });

  it("remplacement : supprime vecteurs puis remet pending, avec effacement du texte", async () => {
    h.existing = { version: 1 };
    await enqueueMediaIndex("m1", "replace");
    expect(kinds()).toEqual(["SELECT", "DELETE", "UPDATE"]);
    expect(h.statements[2]).toContain("text = NULL");
  });

  it("restauration à version identique : réinitialise quand même", async () => {
    h.existing = { version: 2 };
    await enqueueMediaIndex("m1", "restore");
    expect(kinds()).toEqual(["SELECT", "DELETE", "UPDATE"]);
  });

  it("ingest ou backfill sur une ligne à jour : sans effet", async () => {
    h.existing = { version: 2 };
    await enqueueMediaIndex("m1", "backfill");
    await enqueueMediaIndex("m1", "ingest");
    expect(kinds()).toEqual(["SELECT", "SELECT"]);
  });

  it("backfill sur une ligne d'une autre version : réinitialise", async () => {
    h.existing = { version: 1 };
    await enqueueMediaIndex("m1", "backfill");
    expect(kinds()).toContain("DELETE");
  });

  it("manual : pending sans effacer le texte ni les vecteurs", async () => {
    h.existing = { version: 2 };
    await enqueueMediaIndex("m1", "manual");
    expect(kinds()).toEqual(["SELECT", "UPDATE"]);
    expect(h.statements[1]).not.toContain("text = NULL");
  });

  it("ne lève jamais, même base en erreur", async () => {
    h.fail = true;
    await expect(enqueueMediaIndex("m1", "ingest")).resolves.toBeUndefined();
  });

  it("manual sur une ligne running : sans effet (pas de reprise en parallèle)", async () => {
    h.existing = { version: 2, status: "running" };
    await enqueueMediaIndex("m1", "manual");
    expect(h.statements.some((s) => s.includes("UPDATE media_texts"))).toBe(false);
  });

  it("manual sur une ligne done : remise à pending", async () => {
    h.existing = { version: 2, status: "done" };
    await enqueueMediaIndex("m1", "manual");
    expect(h.statements.some((s) => s.includes("UPDATE media_texts") && s.includes("'pending'"))).toBe(true);
  });
});
