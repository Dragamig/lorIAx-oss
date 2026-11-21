/**
 * findRowById : lecture d'une ligne par identifiant, bornée à la base cible.
 * L'exécuteur est simulé : on relève les valeurs de la condition `where`.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: { select: vi.fn() } }));

import { findRowById } from "../row-writes";

const DB_A = "44444444-4444-4444-8444-444444444444";
const DB_B = "55555555-5555-4555-8555-555555555555";
const ROW_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ROW_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const stored = [
  { id: ROW_A, databaseId: DB_A, cells: {} },
  { id: ROW_B, databaseId: DB_B, cells: {} },
];

function collectValues(node: unknown, out: string[] = [], seen = new Set<unknown>()): string[] {
  if (!node || typeof node !== "object" || seen.has(node)) return out;
  seen.add(node);
  const record = node as Record<string, unknown>;
  if (typeof record.value === "string") out.push(record.value);
  for (const child of Object.values(record)) collectValues(child, out, seen);
  return out;
}

function fakeExecutor() {
  const select = vi.fn(() => {
    let values: string[] = [];
    const builder = {
      from: vi.fn(() => builder),
      where: vi.fn((cond: unknown) => {
        values = collectValues(cond);
        return builder;
      }),
      limit: vi.fn(() =>
        Promise.resolve(stored.filter((r) => values.includes(r.id) && values.includes(r.databaseId)))
      ),
    };
    return builder;
  });
  return { select } as never;
}

describe("findRowById", () => {
  it("renvoie la ligne de la base", async () => {
    const row = await findRowById(DB_A, ROW_A, fakeExecutor());
    expect(row).toMatchObject({ id: ROW_A });
  });

  it("id inconnu : undefined", async () => {
    const row = await findRowById(DB_A, "cccccccc-cccc-4ccc-8ccc-cccccccccccc", fakeExecutor());
    expect(row).toBeUndefined();
  });

  it("id d'une autre base : undefined", async () => {
    expect(await findRowById(DB_A, ROW_B, fakeExecutor())).toBeUndefined();
  });

  it("id qui n'est pas un uuid : undefined sans requête", async () => {
    const executor = fakeExecutor();
    expect(await findRowById(DB_A, "pas-un-uuid", executor)).toBeUndefined();
    expect(await findRowById(DB_A, "", executor)).toBeUndefined();
    expect((executor as unknown as { select: ReturnType<typeof vi.fn> }).select).not.toHaveBeenCalled();
  });
});
