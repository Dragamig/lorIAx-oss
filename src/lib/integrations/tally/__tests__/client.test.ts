import { describe, it, expect, vi } from "vitest";
import { createTallyClient, TallyError } from "../client";

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers });

function make(responses: Response[]) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (!r) throw new Error("plus de réponse");
    return r;
  });
  const sleeps: number[] = [];
  const client = createTallyClient({
    apiKey: "tly-secretkey123",
    fetcher,
    minIntervalMs: 0,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { client, calls, sleeps, fetcher };
}

describe("client Tally", () => {
  it("envoie la clé en Bearer vers api.tally.so", async () => {
    const { client, calls } = make([json({ items: [] })]);
    await client.verify();
    expect(calls[0].url.startsWith("https://api.tally.so/")).toBe(true);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bearer tly-secretkey123");
  });

  it("401 -> invalid_key, sans la clé dans le message", async () => {
    const { client } = make([json({}, 401)]);
    const err = await client.verify().catch((e) => e);
    expect(err).toBeInstanceOf(TallyError);
    expect(err.kind).toBe("invalid_key");
    expect(err.message).not.toContain("tly-");
  });

  it("429 -> réessaie en respectant Retry-After puis réussit", async () => {
    const { client, sleeps, fetcher } = make([json({}, 429, { "retry-after": "2" }), json({ items: [{ id: "f1", name: "A" }] })]);
    const forms = await client.listForms();
    expect(forms).toEqual([{ id: "f1", name: "A" }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(sleeps).toContain(2000);
  });

  it("429 persistant -> rate_limited après un nombre borné d'essais", async () => {
    const { client, fetcher } = make([json({}, 429), json({}, 429), json({}, 429), json({}, 429), json({}, 429)]);
    const err = await client.verify().catch((e) => e);
    expect(err.kind).toBe("rate_limited");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("pagine toutes les soumissions", async () => {
    const page = (n: number, hasMore: boolean) =>
      json({ page: n, hasMore, questions: [{ id: "q", type: "INPUT_TEXT", title: "Q" }], submissions: [{ id: `s${n}`, formId: "f", submittedAt: "x", responses: [] }] });
    const { client, calls } = make([page(1, true), page(2, true), page(3, false)]);
    const ids: string[] = [];
    for await (const p of client.iterateSubmissions("f", { startDate: "2026-01-01T00:00:00.000Z" })) {
      ids.push(...p.submissions.map((s) => s.id));
    }
    expect(ids).toEqual(["s1", "s2", "s3"]);
    expect(calls[0].url).toContain("limit=500");
    expect(calls[0].url).toContain("startDate=2026-01-01");
    expect(calls[2].url).toContain("page=3");
  });

  it("crée un webhook avec en-tête et FORM_RESPONSE", async () => {
    const { client, calls } = make([json({ id: "w1" })]);
    await client.createWebhook({ formId: "f", url: "https://x.fr/h", headers: [{ name: "X-Webhook-Secret", value: "s" }] });
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({
      formId: "f",
      eventTypes: ["FORM_RESPONSE"],
      httpHeaders: [{ name: "X-Webhook-Secret", value: "s" }],
    });
  });
});
