import { describe, it, expect } from "vitest";
import { rowBatchErrorResponse } from "@/lib/databases/row-batch-http";
import { RowBatchError } from "@/lib/databases/row-batch";

const pgErr = (code: string) => Object.assign(new Error("pg"), { code });

describe("rowBatchErrorResponse", () => {
  it("40P01 (deadlock), y compris enveloppé : 409", () => {
    expect(rowBatchErrorResponse(pgErr("40P01"))?.status).toBe(409);
    expect(rowBatchErrorResponse(Object.assign(new Error("w"), { cause: pgErr("40P01") }))?.status).toBe(409);
  });
  it("23505 : 409, mais 400 générique pour la restauration", async () => {
    expect(rowBatchErrorResponse(pgErr("23505"))?.status).toBe(409);
    const r = rowBatchErrorResponse(pgErr("23505"), { restore: true })!;
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "Restauration impossible" });
  });
  it("restauration : jamais 409, même pour un conflict", () => {
    expect(rowBatchErrorResponse(new RowBatchError("conflict", "x"), { restore: true })?.status).toBe(400);
  });
  it("not_found : 404 ; erreur inconnue : null", () => {
    expect(rowBatchErrorResponse(new RowBatchError("not_found", "x"))?.status).toBe(404);
    expect(rowBatchErrorResponse(new Error("boom"))).toBeNull();
  });
});
