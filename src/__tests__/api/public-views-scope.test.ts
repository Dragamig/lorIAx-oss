import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { userDatabaseViews, userDatabaseColumns, userDatabaseRows, userDatabases } from "@/lib/db/schema";

const h = vi.hoisted(() => ({
  views: [] as Record<string, unknown>[],
  inserts: 0,
  conditions: [] as unknown[],
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/components/bases/public-form", () => ({ PublicForm: () => null }));
vi.mock("@/lib/bases/public-form-rate-limit", () => ({ tryAllowSubmission: async () => true }));
vi.mock("@/lib/bases/public-form-captcha", () => ({ isCaptchaEnabled: () => false, verifyHCaptcha: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ getClientIpOrNull: () => "203.0.113.4" }));
vi.mock("@/lib/automations/dispatch-row-events", () => ({ dispatchRowEvents: vi.fn() }));
vi.mock("@/lib/databases/row-change-context", () => ({ setRowChangeContext: vi.fn(async () => {}) }));
vi.mock("@/lib/databases/attachment-cell-guard", () => ({
  assertMediaCells: vi.fn(async () => {}),
  MediaCellError: class extends Error {},
}));

vi.mock("@/lib/db", () => {
  // Simule la base : la condition de la lecture de vue est rendue en SQL, et le filtre de portée
  // n'est appliqué que si la condition l'exige réellement.
  function rowsFor(table: unknown, cond: unknown): unknown[] {
    if (table === userDatabaseViews) {
      const q = new PgDialect().sqlToQuery(cond as never);
      const requiresShared = q.params.includes("shared");
      return h.views.filter((v) => (requiresShared ? v.scope === "shared" : true));
    }
    if (table === userDatabases) return [{ name: "Base" }];
    if (table === userDatabaseColumns) return [{ id: "c1", type: "text", name: "Nom", config: {}, position: 0 }];
    if (table === userDatabaseRows) return [{ max: 0 }];
    return [];
  }
  function chain() {
    let table: unknown;
    let cond: unknown;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const c: any = {
      from: (t: unknown) => ((table = t), c),
      where: (w: unknown) => ((cond = w), c),
      orderBy: () => c,
      limit: () => Promise.resolve(rowsFor(table, cond)),
      returning: () => {
        h.inserts++;
        return Promise.resolve([{ id: "row1" }]);
      },
      values: () => c,
      then: (res: (v: unknown) => void, rej?: (e: unknown) => void) =>
        Promise.resolve(rowsFor(table, cond)).then(res, rej),
    };
    return c;
  }
  const db = {
    select: () => chain(),
    insert: () => chain(),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(db),
  };
  return { db };
});

import { NextRequest } from "next/server";
import { POST } from "@/app/api/public/views/[token]/submit/route";
import PublicFormPage from "@/app/[locale]/(public)/f/[token]/page";

const token = "t".repeat(40);
const formView = (scope: string) => ({
  id: "v1",
  databaseId: "d1",
  name: "F",
  type: "form",
  config: {},
  isPublic: true,
  publicToken: token,
  scope,
});

function submit() {
  const req = new NextRequest("http://localhost/api/public/views/x/submit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cells: {} }),
  });
  return POST(req, { params: Promise.resolve({ token }) });
}

async function renderPage(): Promise<string> {
  try {
    await PublicFormPage({ params: Promise.resolve({ token }) });
    return "OK";
  } catch (e) {
    return (e as Error).message;
  }
}

describe("lectures par jeton public : portée des vues", () => {
  beforeEach(() => {
    h.views = [];
    h.inserts = 0;
  });

  it("f/[token] : un jeton dont la vue est personal répond notFound", async () => {
    h.views = [formView("personal")];
    expect(await renderPage()).toBe("NOT_FOUND");
  });

  it("f/[token] : un jeton d'une vue shared publique s'affiche", async () => {
    h.views = [formView("shared")];
    expect(await renderPage()).toBe("OK");
  });

  it("submit : un jeton dont la vue est personal répond comme un jeton inconnu, aucune ligne insérée", async () => {
    h.views = [formView("personal")];
    const res = await submit();
    expect(res.status).toBe(410);
    expect(await res.json()).toEqual({ error: "Formulaire indisponible" });
    expect(h.inserts).toBe(0);
  });

  it("submit : un jeton d'une vue shared publique fonctionne comme avant", async () => {
    h.views = [formView("shared")];
    const res = await submit();
    expect(res.status).toBe(200);
    expect(h.inserts).toBe(1);
  });
});
