/**
 * Non-régression sur `src/app/api/admin/ai/settings/route.ts` (audit du
 * 2026-08-19, constat AZ-08, porte dérobée relevée au lot 6).
 *
 * Le correctif AZ-08 réserve neuf clés d'infrastructure à l'administration
 * d'instance dans /api/admin/settings. Deux d'entre elles, `whisper` et
 * `ollama`, sont aussi servies par cet écran d'IA, qui les rendait en clair et
 * les réécrivait pour tout `globalRole=admin`. L'administrateur d'une seule
 * organisation contournait donc le correctif par une autre porte : lire les
 * URL des services auto-hébergés de l'instance, puis les pointer vers son
 * propre point d'écoute, et récolter ce que tous les tenants font transcrire
 * ou inférer.
 *
 * Deux gestes vérifiés ici :
 *  1. lecture et écriture des clés d'infrastructure réservées à
 *     `super_admin`, l'écriture refusée ne touchant PAS la base (prouvé par le
 *     non-appel de `db.insert`) ;
 *  2. la configuration d'IA proprement dite reste ouverte au rôle `admin`,
 *     l'écran n'est pas cassé.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  rows: [] as { key: string; value: unknown }[],
  written: [] as { key: string; value: unknown }[],
  insertCalls: { count: 0 },
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/db/schema", () => ({ systemSettings: { key: "key" } }));
// Dépendances de /api/admin/settings, dont ce module importe les constantes
// partagées : passe-plat, elles ne sont pas le sujet ici.
vi.mock("@/lib/crypto", () => ({ encrypt: (v: string) => v }));
vi.mock("@/lib/audit/log", () => ({ auditLog: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ getClientIp: () => "127.0.0.1" }));
vi.mock("@/lib/settings/module-toggles", () => ({
  stripModuleToggleFields: (_key: string, value: unknown) => ({
    skip: false,
    value,
  }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({ from: () => Promise.resolve(h.rows) })),
    insert: vi.fn(() => {
      h.insertCalls.count += 1;
      return {
        values: (v: { key: string; value: unknown }) => {
          h.written.push(v);
          return { onConflictDoUpdate: () => Promise.resolve(undefined) };
        },
      };
    }),
  },
}));

import { GET, PUT } from "@/app/api/admin/ai/settings/route";

/** Administrateur d'une organisation : rôle global `admin`, pas d'instance. */
const ADMIN_ORG = { id: "admin-org", email: "a@acme.tld", globalRole: "admin" };
/** Administration d'instance. */
const SUPER_ADMIN = { id: "sa", email: "sa@acme.tld", globalRole: "super_admin" };

const URL_WHISPER = "http://whisper.interne:8000";
const URL_OLLAMA = "http://ollama.interne:11434";

function seed() {
  h.rows = [
    { key: "whisper", value: { whisperApiUrl: URL_WHISPER, whisperEnabled: true } },
    { key: "ollama", value: { ollamaBaseUrl: URL_OLLAMA } },
    { key: "ai_global", value: { enabled: true } },
    { key: "ai_alerts", value: { monthlyBudget: 100 } },
    { key: "rolePermissions", value: { editor: { canUseAI: true } } },
    { key: "transcription", value: { engine: "whisper" } },
    { key: "rerank", value: { enabled: false } },
    // Clé hors périmètre de cet écran : ne doit jamais sortir.
    { key: "ldap", value: { ldapBindPassword: "secretAnnuaire" } },
  ];
}

function put(body: unknown) {
  return PUT(
    new NextRequest("http://localhost/api/admin/ai/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  seed();
  h.written = [];
  h.insertCalls.count = 0;
});

describe("GET /api/admin/ai/settings : clés d'infrastructure", () => {
  it("ne rend ni whisper ni ollama à un admin d'organisation", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN_ORG);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).not.toHaveProperty("whisper");
    expect(body).not.toHaveProperty("ollama");
    // Les URL des services de l'instance ne transitent nulle part dans le corps.
    expect(JSON.stringify(body)).not.toContain("whisper.interne");
    expect(JSON.stringify(body)).not.toContain("ollama.interne");
  });

  it("laisse la configuration d'IA lisible par l'admin d'organisation", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN_ORG);
    const body = await (await GET()).json();

    expect(body.ai_global).toEqual({ enabled: true });
    expect(body.ai_alerts).toEqual({ monthlyBudget: 100 });
    expect(body.rolePermissions).toBeDefined();
    expect(body.rerank).toBeDefined();
    // `transcription` a rejoint les clés d'infrastructure au lot 6 : c'est le
    // commutateur du moteur de transcription de TOUTE l'instance, il ne
    // revient donc pas à l'administration d'une organisation. Détail du
    // raisonnement et couverture dans admin-ai-settings-transcription.test.ts.
    expect(body).not.toHaveProperty("transcription");
  });

  it("rend whisper et ollama à l'administration d'instance", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    const body = await (await GET()).json();

    expect(body.whisper.whisperApiUrl).toBe(URL_WHISPER);
    expect(body.ollama.ollamaBaseUrl).toBe(URL_OLLAMA);
  });

  it("ne rend jamais les clés hors périmètre de l'écran (annuaire)", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    const body = await (await GET()).json();
    expect(body).not.toHaveProperty("ldap");
    expect(JSON.stringify(body)).not.toContain("secretAnnuaire");
  });

  it("refuse 403 à un utilisateur sans rôle admin", async () => {
    h.getSessionUser.mockResolvedValue({ id: "u", globalRole: "editor" });
    expect((await GET()).status).toBe(403);
  });
});

describe("PUT /api/admin/ai/settings : écriture d'infrastructure", () => {
  it("n'écrit pas le détournement de whisper demandé par un admin d'organisation", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN_ORG);
    const res = await put({
      whisper: { whisperApiUrl: "http://ecoute.pirate.tld" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ignored).toEqual(["whisper"]);
    expect(h.insertCalls.count).toBe(0);
    expect(h.written).toHaveLength(0);
  });

  it("n'écrit pas le détournement d'ollama demandé par un admin d'organisation", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN_ORG);
    const res = await put({
      ollama: { ollamaBaseUrl: "http://ecoute.pirate.tld" },
    });

    expect(res.status).toBe(200);
    expect(h.insertCalls.count).toBe(0);
    expect(h.written.map((w) => w.key)).not.toContain("ollama");
  });

  it("écrit quand même les clés d'IA du même corps, l'écran reste utilisable", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN_ORG);
    const res = await put({
      whisper: { whisperApiUrl: "http://ecoute.pirate.tld" },
      ollama: { ollamaBaseUrl: "http://ecoute.pirate.tld" },
      ai_alerts: { monthlyBudget: 200 },
      rerank: { enabled: true },
    });

    expect(res.status).toBe(200);
    const ecrites = h.written.map((w) => w.key);
    expect(ecrites).toContain("ai_alerts");
    expect(ecrites).toContain("rerank");
    expect(ecrites).not.toContain("whisper");
    expect(ecrites).not.toContain("ollama");
  });

  it("laisse l'administration d'instance écrire whisper et ollama", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);
    const res = await put({
      whisper: { whisperApiUrl: "http://whisper.neuf:8000" },
      ollama: { ollamaBaseUrl: "http://ollama.neuf:11434" },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ignored).toBeUndefined();
    expect(h.written.map((w) => w.key)).toEqual(["whisper", "ollama"]);
  });
});

describe("PUT /api/admin/ai/settings : compte rendu des clés ignorées", () => {
  /**
   * Divergence assumée avec /api/admin/settings, qui refuse le corps entier en
   * 403 : cet écran renvoie systématiquement `whisper` et `ollama` à chaque
   * enregistrement, même intouchés, si bien qu'un refus en bloc interdirait à
   * l'administrateur d'organisation d'enregistrer quoi que ce soit. Les clés
   * infrastructure sont donc ignorées en silence côté base, mais PAS en
   * silence côté réponse : l'écran doit pouvoir dire à l'utilisateur ce qui
   * n'a pas été pris, sans quoi un « Enregistré » ment sur la moitié du
   * formulaire.
   */
  it("rend TOUTES les clés ignorées, pas seulement la première", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN_ORG);
    const res = await put({
      whisper: { whisperApiUrl: "http://ecoute.pirate.tld" },
      ollama: { ollamaBaseUrl: "http://ecoute.pirate.tld" },
      ai_alerts: { monthlyBudget: 200 },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.ignored).toEqual(["whisper", "ollama"]);
    // Les clés réellement écrites ne figurent jamais dans le compte rendu.
    expect(body.ignored).not.toContain("ai_alerts");
  });

  it("accompagne les clés ignorées d'un message exploitable par l'écran", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN_ORG);
    const res = await put({ whisper: { whisperApiUrl: "http://ecoute.pirate.tld" } });

    const body = await res.json();
    expect(body.message).toBe("Action réservée à l'administration d'instance");
    // Le compte rendu ne se déguise pas en erreur : le reste du corps a bien
    // été enregistré, l'écran doit donc informer sans faire échouer la page.
    expect(body.error).toBeUndefined();
  });

  it("n'ajoute ni `ignored` ni `message` quand rien n'a été écarté", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN_ORG);
    const res = await put({ ai_alerts: { monthlyBudget: 200 } });

    const body = await res.json();
    expect(body).toEqual({ success: true });
  });
});
