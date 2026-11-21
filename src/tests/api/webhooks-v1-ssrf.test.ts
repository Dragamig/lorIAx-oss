/**
 * Non-régression INJ-07 (audit du 2026-08-19).
 *
 * `POST /api/v1/webhooks` et `PATCH /api/v1/webhooks/:id` stockaient l'URL
 * fournie par l'appelant avec une simple validation de syntaxe
 * (`z.string().url()`), sans exclure le réseau interne. Une URL interne
 * posée en base y dort jusqu'au jour où `dispatchWebhookEvent` l'appelle.
 *
 * Motif de vérification : une URL interne doit être refusée AVANT toute
 * écriture, donc l'absence d'effet de bord se prouve sur `db.insert` /
 * `db.update`, pas seulement sur le code de statut.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  authenticateApiRequest: vi.fn(),
  requireScope: vi.fn(),
  select: vi.fn(),
  insertValues: vi.fn(),
  insertReturning: vi.fn(),
  updateSet: vi.fn(),
  updateWhere: vi.fn(),
  updateReturning: vi.fn(),
}));

vi.mock("@/lib/api/auth-api", () => ({
  authenticateApiRequest: h.authenticateApiRequest,
  requireScope: h.requireScope,
}));

vi.mock("@/lib/db", () => ({
  db: {
    select: h.select,
    insert: vi.fn(() => ({ values: h.insertValues })),
    update: vi.fn(() => ({ set: h.updateSet })),
  },
}));

const AUTH_USER = {
  user: { id: "user-1", orgId: "org-1", email: "u@exemple.tld", name: "U" },
};

/** Chaîne `select().from().where()...`, thenable quelle que soit sa longueur. */
function selectChain(rows: unknown[]) {
  const chain: Record<string, unknown> = {
    from: vi.fn(() => chain),
    where: vi.fn(() => chain),
    orderBy: vi.fn(() => chain),
    limit: vi.fn(() => chain),
    then: (resolve: (v: unknown[]) => void, reject?: (e: unknown) => void) =>
      Promise.resolve(rows).then(resolve, reject),
  };
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.authenticateApiRequest.mockResolvedValue(AUTH_USER);
  h.requireScope.mockReturnValue(null);
  // db.insert(webhooks).values({...}).returning() -> [webhook créé]
  h.insertValues.mockReturnValue({ returning: h.insertReturning });
  h.insertReturning.mockResolvedValue([{ id: "wh-1", url: "https://exemple.tld/hook" }]);
  // db.update(webhooks).set({...}).where(...).returning() -> [webhook mis à jour]
  h.updateSet.mockReturnValue({ where: h.updateWhere });
  h.updateWhere.mockReturnValue({ returning: h.updateReturning });
  h.updateReturning.mockResolvedValue([{ id: "wh-1", url: "https://exemple.tld/hook" }]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/v1/webhooks", () => {
  it("refuse une URL du réseau interne et n'insère rien en base", async () => {
    h.select.mockReturnValue(selectChain([])); // compteur de webhooks existants

    const { POST } = await import("@/app/api/v1/webhooks/route");
    const res = await POST(
      new Request("http://acme.example.com/api/v1/webhooks", {
        method: "POST",
        body: JSON.stringify({
          url: "http://169.254.169.254/latest/meta-data/",
          events: ["document.created"],
        }),
      })
    );

    expect(res.status).toBe(400);
    expect(h.insertValues).not.toHaveBeenCalled();
  });

  it("refuse une URL localhost et n'insère rien en base", async () => {
    h.select.mockReturnValue(selectChain([]));

    const { POST } = await import("@/app/api/v1/webhooks/route");
    const res = await POST(
      new Request("http://acme.example.com/api/v1/webhooks", {
        method: "POST",
        body: JSON.stringify({
          url: "http://localhost:4000/hook",
          events: ["document.created"],
        }),
      })
    );

    expect(res.status).toBe(400);
    expect(h.insertValues).not.toHaveBeenCalled();
  });

  it("accepte une URL publique et l'insère en base", async () => {
    h.select.mockReturnValue(selectChain([]));

    const { POST } = await import("@/app/api/v1/webhooks/route");
    const res = await POST(
      new Request("http://acme.example.com/api/v1/webhooks", {
        method: "POST",
        body: JSON.stringify({
          url: "https://exemple.tld/hook",
          events: ["document.created"],
        }),
      })
    );

    expect(res.status).toBe(201);
    expect(h.insertValues).toHaveBeenCalledTimes(1);
    const inserted = h.insertValues.mock.calls[0][0] as { url: string };
    expect(inserted.url).toBe("https://exemple.tld/hook");
  });

  // Non-régression : exception `WEBHOOK_ALLOW_PRIVATE_TARGETS` (décision du
  // 20/08/2026), pour les instances auto-hébergées dont les webhooks visent
  // un service interne. Sans la variable, le test précédent ("refuse une URL
  // du réseau interne") prouve que le comportement d'aujourd'hui ne change
  // pas.
  it("accepte une URL du réseau interne et l'insère quand WEBHOOK_ALLOW_PRIVATE_TARGETS=true", async () => {
    vi.stubEnv("WEBHOOK_ALLOW_PRIVATE_TARGETS", "true");
    h.select.mockReturnValue(selectChain([]));

    const { POST } = await import("@/app/api/v1/webhooks/route");
    const res = await POST(
      new Request("http://acme.example.com/api/v1/webhooks", {
        method: "POST",
        body: JSON.stringify({
          url: "http://n8n:5678/webhook/abc",
          events: ["document.created"],
        }),
      })
    );

    expect(res.status).toBe(201);
    expect(h.insertValues).toHaveBeenCalledTimes(1);
    const inserted = h.insertValues.mock.calls[0][0] as { url: string };
    expect(inserted.url).toBe("http://n8n:5678/webhook/abc");
  });

  it("refuse toujours un protocole non http/https même avec WEBHOOK_ALLOW_PRIVATE_TARGETS=true", async () => {
    vi.stubEnv("WEBHOOK_ALLOW_PRIVATE_TARGETS", "true");
    h.select.mockReturnValue(selectChain([]));

    const { POST } = await import("@/app/api/v1/webhooks/route");
    const res = await POST(
      new Request("http://acme.example.com/api/v1/webhooks", {
        method: "POST",
        body: JSON.stringify({
          url: "file:///etc/passwd",
          events: ["document.created"],
        }),
      })
    );

    expect(res.status).toBe(400);
    expect(h.insertValues).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/v1/webhooks/:id", () => {
  it("refuse une URL du réseau interne et ne modifie rien en base", async () => {
    const { PATCH } = await import("@/app/api/v1/webhooks/[id]/route");
    const res = await PATCH(
      new Request("http://acme.example.com/api/v1/webhooks/wh-1", {
        method: "PATCH",
        body: JSON.stringify({ url: "http://169.254.169.254/latest/meta-data/" }),
      }),
      { params: Promise.resolve({ id: "wh-1" }) }
    );

    expect(res.status).toBe(400);
    expect(h.updateSet).not.toHaveBeenCalled();
  });

  it("accepte une URL publique et modifie le webhook", async () => {
    const { PATCH } = await import("@/app/api/v1/webhooks/[id]/route");
    const res = await PATCH(
      new Request("http://acme.example.com/api/v1/webhooks/wh-1", {
        method: "PATCH",
        body: JSON.stringify({ url: "https://exemple.tld/nouveau-hook" }),
      }),
      { params: Promise.resolve({ id: "wh-1" }) }
    );

    expect(res.status).toBe(200);
    expect(h.updateSet).toHaveBeenCalledTimes(1);
    const updated = h.updateSet.mock.calls[0][0] as { url?: string };
    expect(updated.url).toBe("https://exemple.tld/nouveau-hook");
  });

  it("accepte une URL du réseau interne quand WEBHOOK_ALLOW_PRIVATE_TARGETS=true", async () => {
    vi.stubEnv("WEBHOOK_ALLOW_PRIVATE_TARGETS", "true");

    const { PATCH } = await import("@/app/api/v1/webhooks/[id]/route");
    const res = await PATCH(
      new Request("http://acme.example.com/api/v1/webhooks/wh-1", {
        method: "PATCH",
        body: JSON.stringify({ url: "http://n8n:5678/webhook/abc" }),
      }),
      { params: Promise.resolve({ id: "wh-1" }) }
    );

    expect(res.status).toBe(200);
    expect(h.updateSet).toHaveBeenCalledTimes(1);
    const updated = h.updateSet.mock.calls[0][0] as { url?: string };
    expect(updated.url).toBe("http://n8n:5678/webhook/abc");
  });
});
