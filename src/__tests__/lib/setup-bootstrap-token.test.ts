/**
 * Non-régression AZ-28 (audit du 2026-08-19) : les onze routes de l'assistant
 * d'installation étaient entièrement non authentifiées, gardées par le seul
 * booléen `setup_completed`. Entre le premier démarrage d'une instance et la
 * fin de l'assistant, n'importe qui sur le réseau pouvait se fabriquer un
 * compte `super_admin` via `POST /api/setup/users`, ou détruire toutes les
 * données via `POST /api/setup/purge`.
 *
 * Ces tests exercent les VRAIS gestionnaires de route et la VRAIE garde
 * (`@/lib/setup/guards`, `@/lib/setup/bootstrap-token`), avec un faux client
 * Drizzle qui journalise chaque écriture. Le refus n'est jamais jugé sur le
 * seul code de statut : on exige aussi qu'aucune écriture n'ait eu lieu.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const JETON_DB = "jeton-de-base-de-donnees-aaaaaaaaaaaaaaaaaaaa";
const JETON_ENV = "jeton-de-variable-d-environnement-bbbbbbbbbbbb";

const h = vi.hoisted(() => ({
  state: {
    /** Contenu de `system_settings`, clé -> valeur JSON. */
    settings: new Map<string, unknown>(),
    /** Toutes les écritures tentées, dans l'ordre. */
    writes: [] as Array<{ table: string; values: unknown }>,
    /** Lignes rendues par un select sur `users`. */
    users: [] as Array<Record<string, unknown>>,
    /** Vrai si `purgeAllData` a été appelée. */
    purged: false,
    /** Vrai pour simuler une base illisible en LECTURE (les écritures passent). */
    lectureCassee: false,
  },
}));

// ─── Faux client Drizzle ────────────────────────────────────────────────────

vi.mock("@/lib/db", async () => {
  const schema = await vi.importActual<typeof import("@/lib/db/schema")>("@/lib/db/schema");
  const schemaOrg = await vi.importActual<typeof import("@/lib/db/schema-org")>(
    "@/lib/db/schema-org"
  );
  const s = h.state;

  function tableName(table: unknown): string {
    if (table === schema.systemSettings) return "system_settings";
    if (table === schema.users) return "users";
    if (table === schema.spaces) return "spaces";
    if (table === schema.teams) return "teams";
    if (table === schema.teamMembers) return "team_members";
    if (table === schema.spacePermissions) return "space_permissions";
    if (table === schemaOrg.organizationMembers || table === schema.organizationMembers) {
      return "organization_members";
    }
    return "table_inconnue";
  }

  /** Extrait la valeur littérale d'une condition `eq(colonne, valeur)`. */
  function condValue(cond: unknown): string | null {
    const chunks = (cond as { queryChunks?: unknown[] })?.queryChunks;
    if (!Array.isArray(chunks)) return null;
    for (const chunk of chunks) {
      const o = chunk as Record<string, unknown>;
      if (o && typeof o === "object" && "encoder" in o && typeof o.value === "string") {
        return o.value;
      }
    }
    return null;
  }

  function rowsFor(table: unknown, key: string | null): unknown[] {
    const name = tableName(table);
    if (s.lectureCassee) throw new Error("base illisible");
    if (name === "system_settings") {
      if (key === null || !s.settings.has(key)) return [];
      return [{ key, value: s.settings.get(key) }];
    }
    if (name === "users") return s.users;
    return [];
  }

  function select() {
    let table: unknown = null;
    let key: string | null = null;
    const self = {
      from(t: unknown) {
        table = t;
        return self;
      },
      where(cond: unknown) {
        key = condValue(cond);
        return self;
      },
      limit: () => Promise.resolve(rowsFor(table, key)),
      then: (resolve: (v: unknown[]) => void) => resolve(rowsFor(table, key)),
    };
    return self;
  }

  function returned(name: string, values: Record<string, unknown>) {
    if (name === "users") {
      return [{ id: "u-nouveau", email: values.email, name: values.name }];
    }
    if (name === "teams") return [{ id: "t-nouvelle" }];
    if (name === "spaces") return [{ id: "s-nouvel" }];
    return [{ id: "id-generique" }];
  }

  function insert(table: unknown) {
    const name = tableName(table);
    return {
      values(values: Record<string, unknown>) {
        const commit = (ecraser: boolean) => {
          s.writes.push({ table: name, values });
          if (name === "system_settings") {
            const k = values.key as string;
            if (ecraser || !s.settings.has(k)) s.settings.set(k, values.value);
          }
        };
        const self = {
          returning: () => {
            commit(true);
            return Promise.resolve(returned(name, values));
          },
          onConflictDoNothing: () => {
            commit(false);
            return Promise.resolve([]);
          },
          onConflictDoUpdate: () => {
            commit(true);
            return Promise.resolve([]);
          },
          then: (resolve: (v: unknown) => void) => {
            commit(true);
            return resolve([]);
          },
        };
        return self;
      },
    };
  }

  return { db: { select, insert } };
});

// ─── Effets de bord des routes, neutralisés et espionnés ────────────────────

vi.mock("@/lib/setup/purge", () => ({
  purgeAllData: vi.fn(async () => {
    h.state.purged = true;
  }),
}));

vi.mock("@/lib/git/repository", () => ({ initRepository: vi.fn(async () => {}) }));
vi.mock("@/lib/calendar/auto-provision", () => ({ ensurePersonalCalendar: vi.fn(async () => {}) }));
vi.mock("@/lib/org/get-org-id", () => ({ getDefaultOrgId: vi.fn(async () => "org-defaut") }));
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn(async () => "hash-bidon") } }));
vi.mock("@/lib/logger", () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─── Modules réels sous test ────────────────────────────────────────────────

import { POST as postUsers } from "@/app/api/setup/users/route";
import { POST as postPurge } from "@/app/api/setup/purge/route";
import { POST as postComplete } from "@/app/api/setup/complete/route";
import { POST as postIdentity } from "@/app/api/setup/identity/route";
import {
  GET as getAuthorize,
  POST as postAuthorize,
} from "@/app/api/setup/authorize/route";
import {
  consumeBootstrapToken,
  safeEqualToken,
  SETUP_TOKEN_KEY,
} from "@/lib/setup/bootstrap-token";
import {
  clearSetupToken,
  getSetupToken,
  isSetupAuthorized,
  setSetupToken,
  setupFetch,
} from "@/lib/setup/client";
import { purgeAllData } from "@/lib/setup/purge";
import logger from "@/lib/logger";
import type { NextRequest } from "next/server";

// ─── Outils ─────────────────────────────────────────────────────────────────

let compteurIp = 0;

/** Une IP distincte par requête : le compteur de débit ne doit pas fuiter d'un test à l'autre. */
function nouvelleIp(): string {
  compteurIp += 1;
  return `10.0.${Math.floor(compteurIp / 250)}.${compteurIp % 250}`;
}

function requete(
  chemin: string,
  options: { token?: string; cookie?: string; body?: unknown; ip?: string } = {}
): NextRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": options.ip ?? nouvelleIp(),
  };
  if (options.token) headers["x-setup-token"] = options.token;
  if (options.cookie) headers["cookie"] = options.cookie;
  return new Request(`http://localhost${chemin}`, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body ?? {}),
  }) as unknown as NextRequest;
}

const utilisateurAdmin = {
  users: [
    {
      name: "Attaquant",
      email: "attaquant@example.com",
      role: "super_admin",
      password: "motdepassetreslong",
    },
  ],
};

/** Écritures hors `system_settings` : le jeton lui-même vit dans cette table. */
function ecrituresMetier() {
  return h.state.writes.filter((w) => w.table !== "system_settings");
}

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.SETUP_BOOTSTRAP_TOKEN;
  h.state.settings = new Map<string, unknown>();
  h.state.writes = [];
  h.state.users = [];
  h.state.purged = false;
  h.state.lectureCassee = false;
  clearSetupToken();
});

/** Instance neuve, jeton déjà engendré et persisté. */
function instanceAmorcee(token: string = JETON_DB) {
  h.state.settings.set(SETUP_TOKEN_KEY, { token, consumedAt: null });
}

/**
 * Requête d'une instance auto-hébergée SANS proxy : aucun `x-forwarded-for`,
 * donc aucune adresse cliente déterminable. C'est le cas nominal d'un
 * conteneur exposé directement, et celui que la clé de quota doit traiter
 * comme une ABSENCE d'adresse (constat AZ-25).
 */
function requeteSansAdresse(
  chemin: string,
  options: { token?: string; body?: unknown } = {}
): NextRequest {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.token) headers["x-setup-token"] = options.token;
  return new Request(`http://mon-instance.local${chemin}`, {
    method: "POST",
    headers,
    body: JSON.stringify(options.body ?? {}),
  }) as unknown as NextRequest;
}

/**
 * Bannière d'avertissement « jeton engendré » écrite dans les journaux.
 * Sa présence prouve qu'un jeton NEUF a été fabriqué.
 */
function banniereJournalisee(): boolean {
  return vi
    .mocked(logger.warn)
    .mock.calls.some((appel) => JSON.stringify(appel).includes("ASSISTANT D'INSTALLATION VERROUILL"));
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("AZ-28 : jeton d'amorçage exigé par les routes de l'assistant", () => {
  it("refuse la création d'un compte super_admin sans jeton, et n'écrit rien", async () => {
    instanceAmorcee();

    const res = await postUsers(requete("/api/setup/users", { body: utilisateurAdmin }));

    expect(res.status).toBe(401);
    expect(ecrituresMetier()).toEqual([]);
    expect(h.state.writes.some((w) => w.table === "users")).toBe(false);
  });

  it("refuse la purge sans jeton, et n'appelle pas la purge", async () => {
    instanceAmorcee();

    const res = await postPurge(requete("/api/setup/purge"));

    expect(res.status).toBe(401);
    expect(purgeAllData).not.toHaveBeenCalled();
    expect(h.state.purged).toBe(false);
  });

  it("refuse l'identité de l'organisation sans jeton, et n'écrit rien", async () => {
    instanceAmorcee();

    const res = await postIdentity(
      requete("/api/setup/identity", { body: { name: "Instance pirate" } })
    );

    expect(res.status).toBe(401);
    expect(h.state.settings.has("org_name")).toBe(false);
  });

  it("refuse la finalisation sans jeton : setup_completed n'est pas posé", async () => {
    instanceAmorcee();
    h.state.users = [{ id: "u-1" }];

    const res = await postComplete(requete("/api/setup/complete"));

    expect(res.status).toBe(401);
    expect(h.state.settings.has("setup_completed")).toBe(false);
  });

  it("traite un jeton faux exactement comme un jeton absent", async () => {
    instanceAmorcee();

    const sansJeton = await postUsers(requete("/api/setup/users", { body: utilisateurAdmin }));
    const corpsSansJeton = await sansJeton.json();

    h.state.writes = [];
    const mauvaisJeton = await postUsers(
      requete("/api/setup/users", { token: "jeton-invente", body: utilisateurAdmin })
    );
    const corpsMauvaisJeton = await mauvaisJeton.json();

    expect(mauvaisJeton.status).toBe(sansJeton.status);
    expect(corpsMauvaisJeton).toEqual(corpsSansJeton);
    expect(ecrituresMetier()).toEqual([]);
  });

  it("laisse passer le parcours avec le bon jeton en en-tête", async () => {
    instanceAmorcee();

    const res = await postUsers(
      requete("/api/setup/users", { token: JETON_DB, body: utilisateurAdmin })
    );

    expect(res.status).toBe(200);
    expect(h.state.writes.some((w) => w.table === "users")).toBe(true);
  });

  it("laisse passer la purge avec le bon jeton porté par le cookie", async () => {
    instanceAmorcee();

    const res = await postPurge(
      requete("/api/setup/purge", { cookie: `setup_bootstrap=${JETON_DB}` })
    );

    expect(res.status).toBe(200);
    expect(h.state.purged).toBe(true);
  });

  it("refuse un assistant déjà terminé, même avec le bon jeton", async () => {
    instanceAmorcee();
    h.state.settings.set("setup_completed", true);

    const res = await postUsers(
      requete("/api/setup/users", { token: JETON_DB, body: utilisateurAdmin })
    );

    expect(res.status).toBe(403);
    expect(ecrituresMetier()).toEqual([]);
  });
});

describe("AZ-28 : contrat d'environnement, la variable reste facultative", () => {
  it("engendre un jeton, le persiste et l'affiche dans les journaux quand la variable est absente", async () => {
    expect(h.state.settings.has(SETUP_TOKEN_KEY)).toBe(false);

    const res = await postUsers(requete("/api/setup/users", { body: utilisateurAdmin }));

    expect(res.status).toBe(401);
    const stocke = h.state.settings.get(SETUP_TOKEN_KEY) as { token: string };
    expect(typeof stocke?.token).toBe("string");
    expect(stocke.token.length).toBeGreaterThan(20);

    expect(logger.warn).toHaveBeenCalled();
    const banniere = JSON.stringify(vi.mocked(logger.warn).mock.calls);
    expect(banniere).toContain(stocke.token);
    expect(banniere).toContain("ASSISTANT D'INSTALLATION VERROUILL");
  });

  it("réutilise le jeton persisté au démarrage suivant, sans le régénérer", async () => {
    await postUsers(requete("/api/setup/users", { body: utilisateurAdmin }));
    const premier = (h.state.settings.get(SETUP_TOKEN_KEY) as { token: string }).token;

    await postUsers(requete("/api/setup/users", { body: utilisateurAdmin }));
    const second = (h.state.settings.get(SETUP_TOKEN_KEY) as { token: string }).token;

    expect(second).toBe(premier);

    const accepte = await postUsers(
      requete("/api/setup/users", { token: premier, body: utilisateurAdmin })
    );
    expect(accepte.status).toBe(200);
  });

  it("donne la primauté à la variable d'environnement quand elle est posée", async () => {
    instanceAmorcee();
    process.env.SETUP_BOOTSTRAP_TOKEN = JETON_ENV;

    const avecEnv = await postUsers(
      requete("/api/setup/users", { token: JETON_ENV, body: utilisateurAdmin })
    );
    expect(avecEnv.status).toBe(200);

    h.state.writes = [];
    const avecJetonBase = await postUsers(
      requete("/api/setup/users", { token: JETON_DB, body: utilisateurAdmin })
    );
    expect(avecJetonBase.status).toBe(401);
    expect(ecrituresMetier()).toEqual([]);
  });
});

describe("AZ-28 : usage unique du jeton", () => {
  it("ne consomme pas le jeton en cours de parcours", async () => {
    instanceAmorcee();

    await postUsers(requete("/api/setup/users", { token: JETON_DB, body: utilisateurAdmin }));
    await postIdentity(
      requete("/api/setup/identity", { token: JETON_DB, body: { name: "Acme" } })
    );

    const stocke = h.state.settings.get(SETUP_TOKEN_KEY) as { consumedAt: string | null };
    expect(stocke.consumedAt).toBeNull();
  });

  it("consomme le jeton à la finalisation, et le refuse ensuite", async () => {
    instanceAmorcee();
    h.state.users = [{ id: "u-1" }];

    const fin = await postComplete(requete("/api/setup/complete", { token: JETON_DB }));
    expect(fin.status).toBe(200);

    const stocke = h.state.settings.get(SETUP_TOKEN_KEY) as { consumedAt: string | null };
    expect(stocke.consumedAt).not.toBeNull();

    // Même si le drapeau setup_completed venait à être effacé, le jeton
    // consommé ne rouvre pas l'assistant.
    h.state.settings.delete("setup_completed");
    h.state.writes = [];
    const rejeu = await postUsers(
      requete("/api/setup/users", { token: JETON_DB, body: utilisateurAdmin })
    );
    expect(rejeu.status).toBe(403);
    expect(ecrituresMetier()).toEqual([]);
  });
});

describe("AZ-28 : échange du jeton contre un cookie d'installation", () => {
  it("refuse un mauvais jeton sans poser de cookie", async () => {
    instanceAmorcee();

    const res = await postAuthorize(
      requete("/api/setup/authorize", { body: { token: "pas-le-bon" } })
    );

    expect(res.status).toBe(401);
    expect(res.cookies.get("setup_bootstrap")).toBeUndefined();
  });

  it("pose un cookie httpOnly pour le bon jeton", async () => {
    instanceAmorcee();

    const res = await postAuthorize(
      requete("/api/setup/authorize", { body: { token: JETON_DB } })
    );

    expect(res.status).toBe(200);
    const cookie = res.cookies.get("setup_bootstrap");
    expect(cookie?.value).toBe(JETON_DB);
    expect(cookie?.httpOnly).toBe(true);
  });

  it("ne se laisse pas déverrouiller par un corps vide alors qu'un cookie valide est présent", async () => {
    instanceAmorcee();

    const res = await postAuthorize(
      requete("/api/setup/authorize", { cookie: `setup_bootstrap=${JETON_DB}`, body: {} })
    );

    expect(res.status).toBe(401);
  });
});

describe("AZ-28 : limitation de débit et comparaison en temps constant", () => {
  it("finit par répondre 429 à une énumération depuis la même IP", async () => {
    instanceAmorcee();
    const ip = "203.0.113.77";

    let dernierStatut = 0;
    for (let i = 0; i < 80; i++) {
      const res = await postUsers(
        requete("/api/setup/users", { token: `essai-${i}`, ip, body: utilisateurAdmin })
      );
      dernierStatut = res.status;
      if (dernierStatut === 429) break;
    }

    expect(dernierStatut).toBe(429);
    expect(ecrituresMetier()).toEqual([]);
  });

  it("compare les jetons sans fuiter par la longueur", () => {
    expect(safeEqualToken(JETON_DB, JETON_DB)).toBe(true);
    expect(safeEqualToken("court", JETON_DB)).toBe(false);
    expect(safeEqualToken(`${JETON_DB}x`, JETON_DB)).toBe(false);
  });
});

// ─── Faux navigateur : le pont entre `setupFetch` et les vrais gestionnaires ──

/**
 * Installe un `fetch` global qui achemine les appels de l'assistant vers les
 * VRAIS gestionnaires de route, en simulant un navigateur qui JETTE le cookie
 * d'autorisation : aucun `Set-Cookie` n'est mémorisé, donc aucune requête
 * suivante ne porte de cookie. C'est exactement ce qui se produit sur une
 * instance auto-hébergée ouverte en HTTP nu si le cookie est marqué `secure`.
 *
 * Seul l'en-tête `x-setup-token`, posé par `setupFetch`, peut alors porter
 * l'autorisation. Aucun `x-forwarded-for` n'est ajouté, comme sur une instance
 * sans proxy.
 */
function installerNavigateurSansCookie() {
  const appels: Array<{ chemin: string; jeton: string | null }> = [];

  const routes: Record<
    string,
    Record<string, (r: NextRequest) => Promise<Response>>
  > = {
    "/api/setup/authorize": {
      GET: (r) => getAuthorize(r),
      POST: (r) => postAuthorize(r),
    },
    "/api/setup/users": { POST: (r) => postUsers(r) },
    "/api/setup/identity": { POST: (r) => postIdentity(r) },
    "/api/setup/complete": { POST: (r) => postComplete(r) },
  };

  const faux = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const methode = (init.method ?? "GET").toUpperCase();
    const requeteReelle = new Request(`http://mon-instance.local${input}`, {
      method: methode,
      headers: init.headers,
      body: methode === "GET" ? undefined : ((init.body as string) ?? "{}"),
    });
    appels.push({
      chemin: input,
      jeton: requeteReelle.headers.get("x-setup-token"),
    });
    const gestionnaire = routes[input]?.[methode];
    if (!gestionnaire) throw new Error(`route non simulée : ${methode} ${input}`);
    // Le cookie éventuellement posé par la réponse n'est PAS mémorisé.
    return gestionnaire(requeteReelle as unknown as NextRequest);
  };

  const precedent = globalThis.fetch;
  globalThis.fetch = faux as unknown as typeof fetch;
  return {
    appels,
    restaurer: () => {
      globalThis.fetch = precedent;
    },
  };
}

describe("AZ-28 : l'installation doit aboutir même quand le navigateur jette le cookie", () => {
  it("mène le parcours jusqu'à la finalisation avec le seul en-tête, sans aucun cookie", async () => {
    instanceAmorcee();
    const navigateur = installerNavigateurSansCookie();

    try {
      // 1. Déverrouillage : le jeton est accepté, mais le cookie est jeté.
      const autorisation = await fetch("/api/setup/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: JETON_DB }),
      });
      expect(autorisation.status).toBe(200);

      // 2. Le front conserve le jeton et VÉRIFIE que l'autorisation tient.
      setSetupToken(JETON_DB);
      expect(await isSetupAuthorized()).toBe(true);

      // 3. Chaque étape suivante passe par le point d'appel commun.
      const identite = await setupFetch("/api/setup/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Acme" }),
      });
      expect(identite.status).toBe(200);

      const utilisateurs = await setupFetch("/api/setup/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(utilisateurAdmin),
      });
      expect(utilisateurs.status).toBe(200);

      // Le faux client Drizzle ne relit pas ses propres insertions : on reflète
      // à la main l'administrateur qui vient d'être créé.
      h.state.users = [{ id: "u-1" }];

      const finalisation = await setupFetch("/api/setup/complete", { method: "POST" });
      expect(finalisation.status).toBe(200);
      expect(h.state.settings.get("setup_completed")).toBe(true);

      // Aucun appel de l'assistant n'est parti sans le jeton.
      const appelsAssistant = navigateur.appels.filter(
        (a) => a.chemin !== "/api/setup/authorize" || a.jeton !== null
      );
      const sansJeton = appelsAssistant.filter((a) => a.jeton !== JETON_DB);
      expect(sansJeton).toEqual([]);
    } finally {
      navigateur.restaurer();
    }
  });

  it("refuse de déclarer l'assistant déverrouillé quand rien ne porte le jeton", async () => {
    instanceAmorcee();
    const navigateur = installerNavigateurSansCookie();

    try {
      clearSetupToken();
      // Ni jeton conservé, ni cookie : l'écran de déverrouillage doit rester.
      expect(await isSetupAuthorized()).toBe(false);
    } finally {
      navigateur.restaurer();
    }
  });

  it("conserve le jeton pour l'onglet et le rejoue après un rechargement", async () => {
    instanceAmorcee();
    const navigateur = installerNavigateurSansCookie();

    // `sessionStorage` simulé : ce que le rechargement d'un onglet préserve.
    const memoireOnglet = new Map<string, string>();
    const faussesessionStorage = {
      getItem: (k: string) => memoireOnglet.get(k) ?? null,
      setItem: (k: string, v: string) => void memoireOnglet.set(k, v),
      removeItem: (k: string) => void memoireOnglet.delete(k),
    };
    const global = globalThis as unknown as { window?: unknown };
    const fenetrePrecedente = global.window;
    global.window = { sessionStorage: faussesessionStorage };

    try {
      setSetupToken(JETON_DB);
      expect(memoireOnglet.get("loriax.setup.bootstrapToken")).toBe(JETON_DB);

      // Rechargement : la mémoire du module repart de zéro, pas le stockage.
      clearSetupToken();
      memoireOnglet.set("loriax.setup.bootstrapToken", JETON_DB);
      expect(getSetupToken()).toBe(JETON_DB);
      expect(await isSetupAuthorized()).toBe(true);
    } finally {
      global.window = fenetrePrecedente;
      navigateur.restaurer();
    }
  });

  it("ne marque pas le cookie d'installation `secure` sur une instance servie en HTTP nu", async () => {
    instanceAmorcee();

    const enClair = await postAuthorize(
      requeteSansAdresse("/api/setup/authorize", { body: { token: JETON_DB } })
    );
    expect(enClair.status).toBe(200);
    expect(enClair.cookies.get("setup_bootstrap")?.secure).toBe(false);

    const derriereTls = new Request("http://mon-instance.local/api/setup/authorize", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
      body: JSON.stringify({ token: JETON_DB }),
    }) as unknown as NextRequest;
    const chiffre = await postAuthorize(derriereTls);
    expect(chiffre.status).toBe(200);
    expect(chiffre.cookies.get("setup_bootstrap")?.secure).toBe(true);
  });
});

describe("AZ-25 : la clé de quota ne met pas tout le monde dans le même seau", () => {
  it("laisse l'exploitant installer son instance après une saturation anonyme, sans adresse cliente", async () => {
    const jetonExploitant = "jeton-exploitant-cccccccccccccccccccccccc";
    instanceAmorcee(jetonExploitant);

    // Un tiers matraque l'instance sans présenter de jeton. Aucun
    // `x-forwarded-for` : c'est le cas d'un conteneur exposé sans proxy.
    let dernierStatut = 0;
    for (let i = 0; i < 80; i++) {
      const res = await postUsers(
        requeteSansAdresse("/api/setup/users", { body: utilisateurAdmin })
      );
      dernierStatut = res.status;
      if (dernierStatut === 429) break;
    }
    // Le seau des appelants sans adresse ET sans jeton reste plafonné.
    expect(dernierStatut).toBe(429);
    expect(ecrituresMetier()).toEqual([]);

    // L'exploitant, lui, passe : son seau est le sien.
    const legitime = await postUsers(
      requeteSansAdresse("/api/setup/users", {
        token: jetonExploitant,
        body: utilisateurAdmin,
      })
    );
    expect(legitime.status).toBe(200);
    expect(h.state.writes.some((w) => w.table === "users")).toBe(true);
  });

  it("ne mélange pas les seaux de deux jetons distincts en l'absence d'adresse", async () => {
    const jetonExploitant = "jeton-exploitant-dddddddddddddddddddddddd";
    instanceAmorcee(jetonExploitant);

    for (let i = 0; i < 80; i++) {
      await postUsers(
        requeteSansAdresse("/api/setup/users", {
          token: "jeton-du-tiers-eeeeeeeeeeeeeeeeeeeeeeeeeeee",
          body: utilisateurAdmin,
        })
      );
    }

    const legitime = await postUsers(
      requeteSansAdresse("/api/setup/users", {
        token: jetonExploitant,
        body: utilisateurAdmin,
      })
    );
    expect(legitime.status).toBe(200);
  });
});

describe("AZ-28 : la consommation du jeton ne peut pas rouvrir l'assistant", () => {
  /** Finalisation alors que la base est devenue illisible EN LECTURE. */
  async function consommerAvecRelectureCassee() {
    instanceAmorcee();
    h.state.lectureCassee = true;
    await consumeBootstrapToken();
    h.state.lectureCassee = false;
  }

  it("n'écrit jamais un jeton vide quand la relecture échoue", async () => {
    await consommerAvecRelectureCassee();

    const stocke = h.state.settings.get(SETUP_TOKEN_KEY) as {
      token: string;
      consumedAt: string | null;
    };
    // Un jeton VIDE serait rejeté à l'analyse : l'état repartirait de zéro.
    expect(typeof stocke.token).toBe("string");
    expect(stocke.token.length).toBeGreaterThan(20);
    expect(stocke.consumedAt).not.toBeNull();
  });

  it("laisse l'assistant clos et n'engendre aucun jeton neuf après cet échec", async () => {
    await consommerAvecRelectureCassee();

    vi.mocked(logger.warn).mockClear();
    h.state.writes = [];

    // Même en ayant perdu le drapeau `setup_completed`, l'assistant reste clos.
    const rejeu = await postUsers(
      requete("/api/setup/users", { token: JETON_DB, body: utilisateurAdmin })
    );
    expect(rejeu.status).toBe(403);
    expect(ecrituresMetier()).toEqual([]);
    expect(banniereJournalisee()).toBe(false);
  });
});

describe("AZ-28 : une instance déjà installée n'écrit ni ne journalise pour un anonyme", () => {
  it("répond 401 sans engendrer de jeton ni journaliser de bannière", async () => {
    // Instance configurée de longue date : aucun jeton d'amorçage en base.
    h.state.settings.set("setup_completed", true);
    expect(h.state.settings.has(SETUP_TOKEN_KEY)).toBe(false);

    const res = await postUsers(requete("/api/setup/users", { body: utilisateurAdmin }));

    expect(res.status).toBe(401);
    expect(h.state.settings.has(SETUP_TOKEN_KEY)).toBe(false);
    expect(h.state.writes).toEqual([]);
    expect(banniereJournalisee()).toBe(false);
  });

  it("ne divulgue pas l'état de l'instance : même refus que sur une instance neuve", async () => {
    h.state.settings.set("setup_completed", true);
    const installee = await postUsers(
      requete("/api/setup/users", { body: utilisateurAdmin })
    );
    const corpsInstallee = await installee.json();

    h.state.settings = new Map<string, unknown>();
    const neuve = await postUsers(requete("/api/setup/users", { body: utilisateurAdmin }));
    const corpsNeuve = await neuve.json();

    expect(installee.status).toBe(neuve.status);
    expect(corpsInstallee).toEqual(corpsNeuve);
  });
});
