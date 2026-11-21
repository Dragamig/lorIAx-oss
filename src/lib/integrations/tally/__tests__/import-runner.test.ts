import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({
  job: { id: "imp1", status: "running", organizationId: "org1", automationId: "auto1", formId: "frm", mode: "real", since: null as Date | null, cap: 2000, cancelRequested: false },
  imported: [] as { id: string }[],
  runIds: [] as { id: string }[],
  inserts: [] as unknown[],
  updates: [] as Record<string, unknown>[],
  execCalls: [] as unknown[][],
  simCalls: 0,
  items: [] as Record<string, unknown>[],
  wheres: [] as unknown[],
  claims: [] as string[],
  claimTaken: new Set<string>(),
  insertError: null as unknown,
  execThrows: false,
  execResult: { status: "success", trace: [{ output: { row: { outcome: "created" } } }] } as Record<string, unknown>,
}));

vi.mock("@/lib/db/schema", () => ({
  userDatabaseAutomations: { __t: "auto", id: "id", triggerConfig: "tc" },
  userDatabaseAutomationRuns: { __t: "runs", payload: "p", automationId: "a", status: "s" },
  tallyImports: { __t: "imports", id: "id", cancelRequested: "c", automationId: "a", status: "s", updatedAt: "u" },
  tallyImportedSubmissions: { __t: "imported", submissionId: "sid", automationId: "a", state: "st" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => a, eq: () => 0, inArray: (_c: unknown, v: unknown) => ({ in: v }), lt: () => 0,
  sql: Object.assign((..._a: unknown[]) => 0, {}),
}));
vi.mock("@/lib/db", () => {
  const select = () => {
    let table: { __t?: string } | undefined;
    const self: Record<string, unknown> = {
      from: (t: { __t?: string }) => ((table = t), self),
      where: () => self,
      limit: () => {
        const k = table?.__t;
        if (k === "imports") return Promise.resolve([{ ...h.job, c: h.job.cancelRequested }]);
        if (k === "imported") return Promise.resolve(h.imported);
        if (k === "runs") return Promise.resolve(h.runIds);
        return Promise.resolve([]);
      },
      then: (res: (v: unknown) => void) => res(table?.__t === "imported" ? h.imported : []),
    };
    return self;
  };
  return {
    db: {
      select,
      insert: () => ({
        values: (v: unknown) => {
          if (h.insertError) throw h.insertError;
          return { returning: async () => [{ id: "imp1" }], onConflictDoNothing: async () => void h.inserts.push(v) };
        },
      }),
      update: () => ({ set: (s: Record<string, unknown>) => ({ where: async (w: unknown) => (h.updates.push(s), h.wheres.push(w)) }) }),
    },
  };
});
vi.mock("@/lib/automations/executor", () => ({
  buildTestPayload: (_a: unknown, s: unknown) => s,
  executeAutomation: vi.fn(async (...a: unknown[]) => {
    h.execCalls.push(a);
    if (h.execThrows) throw new Error("boom");
    return h.execResult;
  }),
  runAutomationTest: vi.fn(async () => ((h.simCalls += 1), { status: "success", steps: [{ output: { row: { outcome: "ignored" } } }] })),
}));
vi.mock("../import-items", () => ({
  createColumnNamer: () => async () => [],
  dropOldSimulatedTraces: vi.fn(async () => {}),
  recordImportItem: vi.fn(async (a: Record<string, unknown>) => void h.items.push(a)),
}));
vi.mock("../submission-claims", () => ({
  reserveSubmission: vi.fn(async (_a: string, id: string) => {
    if (h.claimTaken.has(id)) return false;
    h.claimTaken.add(id);
    h.claims.push(`reserve:${id}`);
    return true;
  }),
  markSubmissionDone: vi.fn(async (_a: string, id: string) => void h.claims.push(`done:${id}`)),
  releaseSubmission: vi.fn(async (_a: string, id: string) => {
    h.claims.push(`release:${id}`);
    h.claimTaken.delete(id);
  }),
}));
vi.mock("../key-store", () => ({ getTallyClientForOrg: vi.fn(async () => null) }));

import { runImport, outcomeFromSteps, startImport, countSubmissions, ActiveImportError, HEARTBEAT_MS } from "../import-runner";

const q = [{ id: "q1", type: "INPUT_TEXT", title: "Nom" }];
const sub = (id: string) => ({ id, formId: "frm", submittedAt: "2026-10-01T00:00:00Z", responses: [{ questionId: "q1", answer: id }] });
function fakeClient(subs: string[]) {
  return {
    getForm: async () => ({ id: "frm", name: "F" }),
    iterateSubmissions: async function* () {
      yield { page: 1, hasMore: false, total: subs.length, questions: q, submissions: subs.map(sub) };
    },
  } as never;
}
const automation = { id: "auto1", databaseId: "d", name: "n", triggerType: "webhook_inbound" } as never;
const actor = { id: "u1" };
const lastFlush = () => h.updates[h.updates.length - 1];

beforeEach(() => {
  Object.assign(h.job, { mode: "real", cancelRequested: false, cap: 2000 });
  h.imported = []; h.runIds = []; h.inserts = []; h.updates = []; h.execCalls = []; h.simCalls = 0; h.items = [];
  h.wheres = []; h.claims = []; h.claimTaken = new Set(); h.insertError = null; h.execThrows = false; h.job.status = "running";
  h.execResult = { status: "success", trace: [{ output: { row: { outcome: "created" } } }] };
});

describe("outcomeFromSteps", () => {
  it("lit row.outcome, défensif si absent", () => {
    expect(outcomeFromSteps([{ output: { row: { outcome: "completed" } } } as never])).toBe("completed");
    expect(outcomeFromSteps([{ output: { row: { created: true } } } as never])).toBe("created");
    expect(outcomeFromSteps([{ output: {} } as never, { } as never])).toBe("unknown");
    expect(outcomeFromSteps(undefined)).toBe("unknown");
  });
});

describe("runImport", () => {
  it("réel : exécute chaque soumission avec source import, sans quota d'organisation", async () => {
    await runImport("imp1", automation, actor, { client: fakeClient(["a", "b"]), pause: false });
    expect(h.execCalls).toHaveLength(2);
    expect(h.execCalls[0][2]).toMatchObject({ source: "import", skipOrgQuota: true, skipLastRunUpdate: true });
    expect(h.claims).toEqual(["reserve:a", "done:a", "reserve:b", "done:b"]);
    expect(h.items).toHaveLength(2);
    expect(h.items[0]).toMatchObject({ importId: "imp1", submissionId: "a", position: 0, ok: true, real: true });
    expect(h.items[1]).toMatchObject({ submissionId: "b", position: 1 });
    expect(lastFlush()).toMatchObject({ status: "completed", created: 2, processed: 2, total: 2 });
  });

  it("le total attendu est persisté dès la première page, sans croître pendant l'import", async () => {
    await runImport("imp1", automation, actor, { client: fakeClient(["a", "b", "c"]), pause: false });
    const totals = h.updates.filter((u) => "total" in u).map((u) => u.total);
    expect(totals[0]).toBe(3);
    expect(totals.every((t) => t === 3)).toBe(true);
  });

  it("total borné au plafond d'import", async () => {
    h.job.cap = 2;
    await runImport("imp1", automation, actor, { client: fakeClient(["a", "b", "c"]), pause: false });
    expect(h.updates.find((u) => "total" in u)?.total).toBe(2);
    h.job.cap = 2000;
  });

  it("idempotence : une soumission déjà importée ou reçue par webhook n'est pas rejouée", async () => {
    h.imported = [{ id: "a" }];
    h.runIds = [{ id: "b" }];
    await runImport("imp1", automation, actor, { client: fakeClient(["a", "b", "c"]), pause: false });
    expect(h.execCalls).toHaveLength(1);
    expect(lastFlush()).toMatchObject({ skipped: 2, processed: 1, total: 1 });
  });

  it("simulé : rien n'est écrit (ni exécution réelle, ni marque d'import)", async () => {
    h.job.mode = "simulate";
    await runImport("imp1", automation, actor, { client: fakeClient(["a", "b"]), pause: false });
    expect(h.simCalls).toBe(2);
    expect(h.execCalls).toHaveLength(0);
    expect(h.claims).toHaveLength(0);
    expect(h.items).toHaveLength(2);
    expect(h.items[0]).toMatchObject({ real: false });
    expect(lastFlush()).toMatchObject({ status: "completed", ignored: 2 });
  });

  it("une erreur d'étape compte en erreurs et n'est pas marquée importée", async () => {
    h.execResult = { status: "error", trace: [] };
    await runImport("imp1", automation, actor, { client: fakeClient(["a"]), pause: false });
    expect(lastFlush()).toMatchObject({ errors: 1, created: 0 });
    expect(h.claims).toEqual(["reserve:a", "release:a"]);
    expect(h.items[0]).toMatchObject({ ok: false });
  });

  it("plafond par import", async () => {
    h.job.cap = 1;
    await runImport("imp1", automation, actor, { client: fakeClient(["a", "b", "c"]), pause: false });
    expect(h.execCalls).toHaveLength(1);
    expect(lastFlush()).toMatchObject({ skipped: 2, status: "completed" });
  });

  it("annulation demandée : arrêt avant toute exécution", async () => {
    h.job.cancelRequested = true;
    await runImport("imp1", automation, actor, { client: fakeClient(["a", "b"]), pause: false });
    expect(h.execCalls).toHaveLength(0);
    expect(lastFlush()).toMatchObject({ status: "cancelled" });
  });

  it("sans clé Tally : échec explicite", async () => {
    await runImport("imp1", automation, actor, { client: null, pause: false });
    expect(lastFlush()).toMatchObject({ status: "failed" });
  });

  it("réservation prise ailleurs (webhook concurrent) : la réponse n'est pas rejouée", async () => {
    h.claimTaken.add("b");
    await runImport("imp1", automation, actor, { client: fakeClient(["a", "b"]), pause: false });
    expect(h.execCalls).toHaveLength(1);
    expect(lastFlush()).toMatchObject({ skipped: 1, processed: 1 });
  });

  it("exécution qui lève : réservation libérée, import en échec", async () => {
    h.execThrows = true;
    await runImport("imp1", automation, actor, { client: fakeClient(["a"]), pause: false });
    expect(h.claims).toEqual(["reserve:a", "release:a"]);
    expect(lastFlush()).toMatchObject({ status: "failed" });
  });

  it("message d'erreur générique côté client, jamais le texte brut", async () => {
    h.execThrows = true;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await runImport("imp1", automation, actor, { client: fakeClient(["a"]), pause: false });
    expect(JSON.stringify(lastFlush())).not.toContain("boom");
    expect(lastFlush().errorMessage).toBe("Erreur pendant l'import");
    spy.mockRestore();
  });

  it("flush final : n'écrit que sur un import encore pending/running", async () => {
    await runImport("imp1", automation, actor, { client: fakeClient(["a"]), pause: false });
    const where = h.wheres[h.wheres.length - 1] as unknown[];
    expect(where).toContainEqual({ in: ["pending", "running"] });
  });

  it("import déclaré mort pendant la boucle : arrêt sans exécution", async () => {
    h.job.status = "failed";
    await runImport("imp1", automation, actor, { client: fakeClient(["a", "b"]), pause: false });
    expect(h.execCalls).toHaveLength(0);
  });

  it("battement de coeur : updated_at avance même sans traiter de réponse", async () => {
    vi.useFakeTimers();
    try {
      const slow = {
        getForm: async () => ({ id: "frm", name: "F" }),
        iterateSubmissions: async function* () {
          await new Promise((r) => setTimeout(r, HEARTBEAT_MS * 2 + 1000));
          yield { page: 1, hasMore: false, total: 0, questions: q, submissions: [] };
        },
      } as never;
      const done = runImport("imp1", automation, actor, { client: slow, pause: false });
      await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 2 + 2000);
      await done;
      const beats = h.updates.filter((u) => Object.keys(u).length === 1 && "updatedAt" in u);
      expect(beats.length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("startImport : un seul import actif", () => {
  const args = { organizationId: "org1", automation, formId: "frm", mode: "real" as const, actor };
  it("conflit d'unicité -> ActiveImportError", async () => {
    h.insertError = Object.assign(new Error("dup"), { code: "23505" });
    await expect(startImport(args)).rejects.toBeInstanceOf(ActiveImportError);
  });
  it("conflit encapsulé (cause) reconnu aussi", async () => {
    h.insertError = Object.assign(new Error("wrapped"), { cause: { code: "23505" } });
    await expect(startImport(args)).rejects.toBeInstanceOf(ActiveImportError);
  });
  it("autre erreur : relancée telle quelle", async () => {
    h.insertError = new Error("autre");
    await expect(startImport(args)).rejects.toThrow("autre");
  });
});

describe("countSubmissions", () => {
  it("lit le total renvoyé par Tally en une seule page, sans parcours", async () => {
    const listSubmissionsPage = vi.fn(async () => ({ page: 1, hasMore: true, total: 1234, questions: [], submissions: [] }));
    const iterateSubmissions = vi.fn();
    const r = await countSubmissions({ listSubmissionsPage, iterateSubmissions } as never, "frm", {});
    expect(r).toEqual({ total: 1234, imported: 0, toImport: 1234 });
    expect(listSubmissionsPage).toHaveBeenCalledTimes(1);
    expect(iterateSubmissions).not.toHaveBeenCalled();
  });
});
