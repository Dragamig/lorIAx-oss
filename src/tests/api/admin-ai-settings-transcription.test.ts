/**
 * Non-régression sur le cloisonnement de la clé `transcription` (lot 6).
 *
 * La liste des clés d'INFRASTRUCTURE avait été bâtie sur le critère « porte un
 * identifiant ou un relais ». `whisper` et `voxtral` y figuraient donc, mais
 * pas `transcription`, qui pourtant DESIGNE lequel des deux moteurs traite les
 * audios : `getTranscriptionEngine` et `getTranscriptionVocabulary`
 * (src/lib/meet/transcribe.ts) lisent une ligne unique, sans aucune notion
 * d'organisation. Protéger l'adresse des deux services sans protéger le
 * commutateur qui les désigne laissait un administrateur d'organisation
 * rebasculer la transcription de TOUS les tenants.
 *
 * Le bon critère est la portée instance au sens fort : la clé oriente un
 * service partagé qui traite les données de tous les tenants.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const h = vi.hoisted(() => ({
  getSessionUser: vi.fn(),
  rows: [] as { key: string; value: unknown }[],
  written: [] as { key: string; value: unknown }[],
}));

vi.mock("@/lib/auth/get-user", () => ({ getSessionUser: h.getSessionUser }));
vi.mock("@/lib/db/schema", () => ({ systemSettings: { key: "key" } }));
vi.mock("@/lib/settings/module-toggles", () => ({
  stripModuleToggleFields: (_key: string, value: unknown) => ({
    skip: false,
    value,
  }),
}));
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({ from: () => Promise.resolve(h.rows) })),
    insert: vi.fn(() => ({
      values: (v: { key: string; value: unknown }) => {
        h.written.push(v);
        return { onConflictDoUpdate: () => Promise.resolve(undefined) };
      },
    })),
  },
}));

import { GET, PUT } from "@/app/api/admin/ai/settings/route";
import { INFRASTRUCTURE_KEYS } from "@/lib/settings/secrets";

const ADMIN_ORG = { id: "admin-org", email: "a@acme.tld", globalRole: "admin" };
const SUPER_ADMIN = { id: "sa", email: "sa@acme.tld", globalRole: "super_admin" };

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
  h.written = [];
  h.rows = [
    { key: "transcription", value: { engine: "whisper", vocabulary: "LorIAx" } },
    { key: "ai_global", value: { aiEnabled: true } },
    { key: "rerank", value: { enabled: true, search: true } },
  ];
});

describe("clé `transcription` : portée instance", () => {
  it("est classée dans les clés d'infrastructure", () => {
    expect(INFRASTRUCTURE_KEYS.has("transcription")).toBe(true);
  });

  it("reste hors des clés d'infrastructure pour les réglages d'IA proprement dits", () => {
    for (const cle of [
      "ai_global",
      "ai_alerts",
      "rolePermissions",
      "help_assistant_enabled",
      "rerank",
      "general",
      "collab",
      "automations",
      "meeting_rooms_enabled",
    ]) {
      expect(INFRASTRUCTURE_KEYS.has(cle), cle).toBe(false);
    }
  });

  it("n'est pas rendue à un administrateur d'organisation", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN_ORG);
    const body = await (await GET()).json();

    expect(body).not.toHaveProperty("transcription");
    // Les réglages d'IA qui lui reviennent restent lisibles.
    expect(body.ai_global).toEqual({ aiEnabled: true });
    expect(body.rerank).toBeDefined();
  });

  it("n'est pas écrite par un administrateur d'organisation, et il en est averti", async () => {
    h.getSessionUser.mockResolvedValue(ADMIN_ORG);
    const res = await put({
      transcription: { engine: "voxtral" },
      ai_global: { aiEnabled: false },
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ignored).toEqual(["transcription"]);

    expect(h.written.map((w) => w.key)).not.toContain("transcription");
    // La clé licite du même corps est bien écrite : l'écran reste utilisable.
    expect(h.written.map((w) => w.key)).toContain("ai_global");
  });

  it("reste lisible et modifiable par l'administration d'instance", async () => {
    h.getSessionUser.mockResolvedValue(SUPER_ADMIN);

    const lu = await (await GET()).json();
    expect(lu.transcription).toEqual({ engine: "whisper", vocabulary: "LorIAx" });

    const res = await put({ transcription: { engine: "voxtral" } });
    expect(res.status).toBe(200);

    const ecrit = h.written.find((w) => w.key === "transcription")!
      .value as Record<string, unknown>;
    expect(ecrit.engine).toBe("voxtral");
    // La fusion préserve le vocabulaire métier non réémis.
    expect(ecrit.vocabulary).toBe("LorIAx");
  });
});
