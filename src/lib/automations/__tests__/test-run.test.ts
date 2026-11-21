/**
 * Mode test du moteur (lot 6) : simulation sans écriture, trace par étape,
 * untilNodeId, branches non prises, erreur au milieu, rédaction, troncature.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { boom } = vi.hoisted(() => ({
  boom: (name: string) => vi.fn(() => { throw new Error(`ECRITURE INTERDITE EN SIMULATION : ${name}`); }),
}));

vi.mock("@/lib/db", () => {
  const self: Record<string, unknown> = {};
  const chain = () => self;
  Object.assign(self, {
    from: chain, where: chain, innerJoin: chain, leftJoin: chain, set: chain,
    limit: () => Promise.resolve([]),
    values: boom("db.insert"),
    then: (res: (v: unknown[]) => void) => Promise.resolve([]).then(res),
  });
  return { db: { select: () => self, insert: () => self, update: boom("db.update") } };
});
vi.mock("@/lib/settings/system-settings", () => ({ getSetting: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/auth/check-access", () => ({ getSpacePermission: vi.fn() }));
vi.mock("@/lib/databases/row-writes", () => ({
  createDatabaseRow: boom("createDatabaseRow"),
  mergeDatabaseRowCells: boom("mergeDatabaseRowCells"),
  loadColumnTypes: vi.fn().mockResolvedValue({ mail: "text", name: "text" }),
  findRowByCellValue: vi.fn(),
}));
vi.mock("@/lib/tasks/create-task", () => ({ createTask: boom("createTask") }));
vi.mock("@/lib/notifications", () => ({ createNotification: boom("createNotification") }));
vi.mock("@/lib/email/send", () => ({ sendEmail: boom("sendEmail") }));
vi.mock("@/lib/security/outbound-fetch", () => ({ safeExternalFetch: boom("safeExternalFetch") }));
vi.mock("@/lib/documents/create-document", () => ({ createDocument: boom("createDocument") }));
vi.mock("@/lib/templates/instantiate", () => ({ instantiateTemplate: boom("instantiateTemplate") }));
vi.mock("@/lib/storage/s3", () => ({ uploadFile: boom("uploadFile") }));
vi.mock("ai", () => ({ generateText: boom("generateText") }));
vi.mock("@/lib/ai/provider-resolver", () => ({ getLanguageModelForUsageInOrg: boom("llm") }));
vi.mock("@/lib/ai/org-scope", () => ({ orgIdForAutomation: vi.fn() }));
vi.mock("@/lib/ai/usage-logger", () => ({ logAIUsage: boom("logAIUsage") }));
vi.mock("@/lib/automations/target-space", async (orig) => ({
  ...(await orig<object>()),
  resolveTargetSpaceId: vi.fn().mockResolvedValue("space-1"),
}));

import { runAutomationTest } from "../executor";
import { ACTION_REGISTRY } from "../actions/registry";
import { capTrace, redact, MASKED, TRACE_MAX_BYTES, type TraceStep } from "../trace";
import { findRowByCellValue, createDatabaseRow, mergeDatabaseRowCells } from "@/lib/databases/row-writes";
import { safeExternalFetch } from "@/lib/security/outbound-fetch";
import type { AutomationRow } from "../actions/types";

const DB = "44444444-4444-4444-8444-444444444444";
const USER = "55555555-5555-4555-8555-555555555555";

function auto(graph: AutomationRow["graph"]): AutomationRow {
  return {
    id: "a1", databaseId: DB, spaceId: null, name: "Test", triggerType: "webhook_inbound",
    triggerConfig: null, actionType: "find_row", actionConfig: null, enabled: false,
    lastRunAt: null, createdBy: "creator", graph,
  };
}

const crmGraph = auto({
  nodes: [
    { id: "n1", kind: "action", actionType: "find_row", storeAs: "crm", actionConfig: { columnId: "mail", value: "{{cells.email}}" } },
    { id: "n2", kind: "condition", condition: { source: "variable", path: "crm.foundRow", columnId: "", operator: "is_empty" } },
    { id: "n3", kind: "action", actionType: "create_row", actionConfig: { match: { columnId: "mail", value: "{{cells.email}}" }, cells: { mail: "{{cells.email}}", name: "{{cells.name}}" } } },
    { id: "n4", kind: "action", actionType: "update_row", actionConfig: { rowId: "{{variables.crm.foundRow.id}}", cells: { name: "{{cells.name}}" } } },
  ],
  edges: [
    { from: "n1", to: "n2" },
    { from: "n2", to: "n3", branch: "true" },
    { from: "n2", to: "n4", branch: "false" },
  ],
});
const sample = { cells: { email: "ada@example.com", name: "Ada" } };

beforeEach(() => {
  vi.mocked(findRowByCellValue).mockReset();
});

describe("registre : contrat de simulation", () => {
  it("chaque action a un comportement simulé défini", () => {
    for (const [type, def] of Object.entries(ACTION_REGISTRY)) {
      expect(typeof def.simulate, type).toBe("function");
    }
  });
  it("seul find_row est une lecture pure", () => {
    const reads = Object.values(ACTION_REGISTRY).filter((d) => d.readOnly).map((d) => d.type);
    expect(reads).toEqual(["find_row"]);
  });
});

/** Étapes du graphe : l'entrée de trace du déclencheur est testée à part. */
const actionSteps = (res: { steps: TraceStep[] }): TraceStep[] =>
  res.steps.filter((s) => s.kind !== "trigger");

describe("runAutomationTest en simulation", () => {
  it("contact inconnu : create_row simulé, sans écriture, id sim_", async () => {
    vi.mocked(findRowByCellValue).mockResolvedValue(undefined);
    const res = await runAutomationTest({ automation: crmGraph, mode: "simulate", sample });
    expect(res.status).toBe("success");
    expect(createDatabaseRow).not.toHaveBeenCalled();
    const byId = Object.fromEntries(actionSteps(res).map((s) => [s.nodeId, s]));
    expect(byId.n1.status).toBe("success"); // lecture réelle
    expect(byId.n2).toMatchObject({ status: "success", output: { branch: "true" } });
    expect(byId.n3.status).toBe("simulated");
    expect(byId.n3.output).toMatchObject({ simulated: true, row: { created: true } });
    expect((byId.n3.output as { createdRow: { id: string } }).createdRow.id).toMatch(/^sim_/);
    expect(byId.n4).toMatchObject({ status: "skipped", durationMs: 0 });
    // Entrées résolues : jeton source -> valeur
    expect(byId.n3.inputs).toMatchObject({
      cells: { mail: { source: "{{cells.email}}", resolved: "ada@example.com" } },
    });
  });

  it("contact connu : l'étape suivante se résout sur la sortie réelle de find_row", async () => {
    vi.mocked(findRowByCellValue).mockResolvedValue({ id: "r1", cells: {} } as never);
    const res = await runAutomationTest({ automation: crmGraph, mode: "simulate", sample });
    const byId = Object.fromEntries(actionSteps(res).map((s) => [s.nodeId, s]));
    expect(byId.n4).toMatchObject({ status: "simulated", output: { updatedRow: { id: "r1" }, simulated: true } });
    expect(byId.n3.status).toBe("skipped");
    expect(mergeDatabaseRowCells).not.toHaveBeenCalled();
  });

  it("create_row avec match : retrouve la ligne existante (mise à jour), sans écrire", async () => {
    vi.mocked(findRowByCellValue).mockResolvedValue({ id: "r9", cells: {} } as never);
    const g = auto({
      nodes: [{ id: "c", kind: "action", actionType: "create_row", actionConfig: { match: { columnId: "mail", value: "{{cells.email}}" }, cells: { mail: "{{cells.email}}" } } }],
      edges: [],
    });
    const res = await runAutomationTest({ automation: g, mode: "simulate", sample });
    expect(actionSteps(res)[0].output).toMatchObject({ row: { id: "r9", created: false } });
    expect(mergeDatabaseRowCells).not.toHaveBeenCalled();
  });

  it("toutes les actions à effet : aucune écriture, sortie simulée", async () => {
    const g = auto({
      nodes: [
        { id: "t", kind: "action", actionType: "create_task", actionConfig: { title: "Rappeler {{cells.name}}" } },
        { id: "u", kind: "action", actionType: "notify_user", actionConfig: { userId: "{{user.id}}", title: "Hello" } },
        { id: "w", kind: "action", actionType: "webhook", actionConfig: { url: "https://example.com/hook", headers: { Authorization: "Bearer SUPERSECRET" } } },
        { id: "a", kind: "action", actionType: "ai", actionConfig: { prompt: "Résume {{cells.name}}" } },
        { id: "d", kind: "action", actionType: "create_document", actionConfig: { title: "Doc {{cells.name}}" } },
        { id: "g", kind: "action", actionType: "create_design", actionConfig: { templateId: "tpl" } },
        { id: "e", kind: "action", actionType: "send_email", actionConfig: { to: "x@example.com", subject: "Yo", text: "Salut" } },
      ],
      edges: [["t","u"],["u","w"],["w","a"],["a","d"],["d","g"],["g","e"]].map(([from, to]) => ({ from, to })),
    });
    const res = await runAutomationTest({ automation: g, mode: "simulate", sample, actor: { id: USER, email: "me@example.com" } });
    expect(res.error).toBeUndefined();
    expect(actionSteps(res).map((s) => s.status)).toEqual(Array(7).fill("simulated"));
    expect(safeExternalFetch).not.toHaveBeenCalled();
    expect(JSON.stringify(res.steps)).not.toContain("SUPERSECRET");
    const byId = Object.fromEntries(actionSteps(res).map((s) => [s.nodeId, s]));
    expect(byId.t.output).toMatchObject({ simulated: true, createdTask: { id: expect.stringMatching(/^sim_/) } });
    expect(byId.d.output).toMatchObject({ createdDocument: { id: expect.stringMatching(/^sim_/), title: "Doc Ada" } });
    expect(byId.w.inputs).toMatchObject({ headers: { Authorization: MASKED } });
  });

  it("le contrôle d'accès s'applique aussi en simulé", async () => {
    const g = auto({
      nodes: [{ id: "c", kind: "action", actionType: "create_row", actionConfig: { databaseId: "99999999-9999-4999-8999-999999999999", cells: { a: "1" } } }],
      edges: [],
    });
    const res = await runAutomationTest({ automation: g, mode: "simulate", sample });
    expect(res.status).toBe("error");
    expect(actionSteps(res)[0].status).toBe("error");
    expect(actionSteps(res)[0].error?.message).toMatch(/base cible refusée/);
  });
});

describe("trace", () => {
  it("erreur au milieu : étapes suivantes skipped, message lisible + détail", async () => {
    const g = auto({
      nodes: [
        { id: "a", kind: "action", actionType: "create_task", actionConfig: { title: "ok" } },
        { id: "b", kind: "action", actionType: "notify_user", actionConfig: { userId: "{{cells.absent}}", title: "x" } },
        { id: "c", kind: "action", actionType: "create_task", actionConfig: { title: "jamais" } },
      ],
      edges: [{ from: "a", to: "b" }, { from: "b", to: "c" }],
    });
    const res = await runAutomationTest({ automation: g, mode: "simulate", actor: { id: USER } });
    expect(res.status).toBe("error");
    expect(actionSteps(res).map((s) => [s.nodeId, s.status])).toEqual([["a", "simulated"], ["b", "error"], ["c", "skipped"]]);
    expect(actionSteps(res)[1].error?.message).toMatch(/destinataire vide/);
    expect(actionSteps(res)[1].error?.detail).toBeTruthy();
    expect(typeof actionSteps(res)[0].durationMs).toBe("number");
  });

  it("untilNodeId : s'arrête au nœud inclus, les suivants sont skipped", async () => {
    vi.mocked(findRowByCellValue).mockResolvedValue(undefined);
    const res = await runAutomationTest({ automation: crmGraph, mode: "simulate", sample, untilNodeId: "n2" });
    const st = Object.fromEntries(actionSteps(res).map((s) => [s.nodeId, s.status]));
    expect(st).toEqual({ n1: "success", n2: "success", n3: "skipped", n4: "skipped" });
    expect(res.status).toBe("success");
  });

  it("le déclencheur a sa propre entrée de trace avec l'échantillon reçu, rédigé", async () => {
    const res = await runAutomationTest({
      automation: crmGraph, mode: "simulate",
      sample: { ...sample, variables: { body: { nom: "Zoé", token: "abc" } } },
    });
    const trig = res.steps[0];
    expect(trig).toMatchObject({ nodeId: "__trigger__", kind: "trigger", status: "success" });
    expect(JSON.stringify(trig.output)).toContain("Zoé");
    expect(JSON.stringify(trig.output)).not.toContain("abc");
  });

  it("sample variables.body alimente {{variables.body...}}", async () => {
    const g = auto({
      nodes: [{ id: "t", kind: "action", actionType: "create_task", actionConfig: { title: "Lead {{variables.body.nom}}" } }],
      edges: [],
    });
    const res = await runAutomationTest({ automation: g, mode: "simulate", sample: { variables: { body: { nom: "Zoé" } } }, actor: { id: USER } });
    expect(actionSteps(res)[0].inputs).toMatchObject({ title: { source: "Lead {{variables.body.nom}}", resolved: "Lead Zoé" } });
  });
});

describe("rédaction et troncature", () => {
  it("masque les secrets par nom de clé, à tout niveau", () => {
    const out = redact({
      password: "p", apiKey: "k", headers: { "X-Webhook-Secret": "s", Authorization: "Bearer t", "Content-Type": "json" },
      nested: [{ access_token: "t" }], author: "ok", msg: "voir https://x.io/?token=abc123&a=1",
    }) as Record<string, unknown>;
    const json = JSON.stringify(out);
    for (const leak of ['"p"', '"k"', '"s"', "Bearer t", "abc123"]) expect(json).not.toContain(leak);
    expect(out.author).toBe("ok");
    expect((out.headers as Record<string, string>)["Content-Type"]).toBe("json");
  });

  it("tronque les longues chaînes", () => {
    const out = redact("x".repeat(5000)) as string;
    expect(out.length).toBeLessThan(600);
    expect(out).toMatch(/tronqué/);
  });

  it("plafonne la trace totale et signale la troncature", () => {
    const big = "y".repeat(400);
    const steps: TraceStep[] = Array.from({ length: 400 }, (_, i) => ({
      nodeId: `n${i}`, kind: "action", status: "success", durationMs: 1, output: { a: big },
    }));
    const { steps: capped, truncated } = capTrace(steps);
    expect(truncated).toBe(true);
    expect(JSON.stringify(capped).length).toBeLessThanOrEqual(TRACE_MAX_BYTES + 400 * 120);
    expect(capped.at(-1)?.truncated).toBe(true);
    expect(capped.at(-1)?.output).toBeUndefined();
    expect(capped[0].truncated).toBeUndefined();
  });
});
