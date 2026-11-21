import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  written: [] as unknown[],
  guard: vi.fn(),
}));

vi.mock("@/lib/databases/row-change-context", () => ({ setRowChangeContext: vi.fn(async () => undefined) }));
vi.mock("@/lib/automations/dispatch-row-events", () => ({ dispatchRowEvents: vi.fn() }));
vi.mock("@/lib/bases/public-form-rate-limit", () => ({ tryAllowSubmission: async () => true }));
vi.mock("@/lib/bases/public-form-captcha", () => ({ isCaptchaEnabled: () => false, verifyHCaptcha: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ getClientIpOrNull: () => "203.0.113.4" }));
vi.mock("@/lib/databases/attachment-cell-guard", () => {
  class MediaCellError extends Error {
    status = 400;
  }
  return { MediaCellError, assertMediaCells: h.guard };
});
vi.mock("@/lib/db", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(h.selects.shift() ?? []),
    values: (v: unknown) => {
      h.written.push(v);
      return chain;
    },
    returning: () => Promise.resolve([{ id: "row1" }]),
    then: (res: (v: unknown) => void) => res(h.selects.shift() ?? []),
  };
  const db = {
    select: () => chain,
    insert: () => chain,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db };
});

import { NextRequest } from "next/server";
import { POST } from "@/app/api/public/views/[token]/submit/route";
import { MediaCellError } from "@/lib/databases/attachment-cell-guard";

const M = "11111111-1111-4111-8111-111111111111";

async function submit(cells: Record<string, unknown>) {
  h.selects.length = 0;
  h.selects.push(
    [{ databaseId: "d1", type: "form" }],
    [
      { id: "t", type: "text" },
      { id: "img", type: "image" },
      { id: "att", type: "attachment" },
    ],
    [{ max: 0 }]
  );
  const req = new NextRequest("http://localhost/api/public/views/x/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cells }),
  });
  return POST(req, { params: Promise.resolve({ token: "t".repeat(40) }) });
}

beforeEach(() => {
  h.written.length = 0;
  h.guard.mockReset();
});

describe("formulaire public : garde des cellules médias", () => {
  it("ne retient aucune référence à un média existant (colonnes image et pièces jointes ignorées)", async () => {
    const res = await submit({ t: "bonjour", img: `/api/media/${M}`, att: [{ mediaId: M }] });
    expect(res.status).toBe(200);
    expect(h.written).toEqual([expect.objectContaining({ cells: { t: "bonjour" } })]);
    expect(h.guard).toHaveBeenCalledWith("d1", { t: "bonjour" }, { user: null, orgId: "" });
  });

  it("le garde sans utilisateur qui refuse renvoie 400 sans écriture", async () => {
    h.guard.mockRejectedValue(new MediaCellError("Média introuvable"));
    const res = await submit({ t: "x" });
    expect(res.status).toBe(400);
    expect(h.written).toHaveLength(0);
  });
});
