import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type MockDb = {
  select: ReturnType<typeof vi.fn>;
  from: ReturnType<typeof vi.fn>;
  where: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
};

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    limit: vi.fn(),
  },
}));

const mockCookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: mockCookieGet }),
}));

const mockGetSessionUser = vi.fn();
vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: () => mockGetSessionUser(),
}));

vi.mock("@/lib/logger", () => ({
  default: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { guardSetupAccess } from "@/lib/setup/guards";
import { db } from "@/lib/db";

const mockDb = db as unknown as MockDb;

const INSTALL_TOKEN = "jeton-installation-de-test";

/** Réponses successives de system_settings : setup_completed, puis setup_install_token. */
function queueSettings(setupCompleted: unknown, installToken?: string) {
  mockDb.limit.mockResolvedValueOnce(
    setupCompleted === undefined ? [] : [{ value: setupCompleted }]
  );

  // La garde s'arrête avant de lire le jeton si l'instance est déjà configurée.
  if (setupCompleted === true) return;

  mockDb.limit.mockResolvedValueOnce(
    installToken === undefined
      ? []
      : [{ value: { token: installToken, createdAt: "2026-07-27T00:00:00.000Z" } }]
  );
}

describe("guardSetupAccess", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.select.mockReturnThis();
    mockDb.from.mockReturnThis();
    mockDb.where.mockReturnThis();
    // Purge la file d'attente d'un test précédent, puis valeur par défaut vide.
    mockDb.limit.mockReset();
    mockDb.limit.mockResolvedValue([]);
    mockCookieGet.mockReturnValue(undefined);
    mockGetSessionUser.mockResolvedValue(null);
  });

  it("refuse tout le monde en 403 quand l'instance est déjà configurée", async () => {
    queueSettings(true);

    const access = await guardSetupAccess();

    expect(access.allowed).toBe(false);
    if (access.allowed) return;
    expect(access.response.status).toBe(403);
    await expect(access.response.json()).resolves.toEqual({
      error: "L'instance est déjà configurée",
    });
  });

  it("accorde le mode installateur sur présentation de la clé d'installation", async () => {
    queueSettings(undefined, INSTALL_TOKEN);
    mockCookieGet.mockReturnValue({ value: INSTALL_TOKEN });

    const access = await guardSetupAccess();

    expect(access).toEqual({ allowed: true, mode: "installer" });
    expect(mockGetSessionUser).not.toHaveBeenCalled();
  });

  it("ignore une clé d'installation erronée et retombe sur la session", async () => {
    queueSettings(undefined, INSTALL_TOKEN);
    mockCookieGet.mockReturnValue({ value: "mauvaise-cle" });

    const access = await guardSetupAccess();

    expect(access.allowed).toBe(false);
    if (access.allowed) return;
    expect(access.response.status).toBe(401);
  });

  it("répond 401 à un anonyme sans clé sur une instance non configurée", async () => {
    queueSettings(undefined, INSTALL_TOKEN);

    const access = await guardSetupAccess();

    expect(access.allowed).toBe(false);
    if (access.allowed) return;
    expect(access.response.status).toBe(401);
    await expect(access.response.json()).resolves.toEqual({
      error: "Non authentifié",
    });
  });

  it("répond 403 à un utilisateur authentifié sans le rôle super_admin", async () => {
    queueSettings(undefined, INSTALL_TOKEN);
    mockGetSessionUser.mockResolvedValue({ id: "u1", globalRole: "editor" });

    const access = await guardSetupAccess();

    expect(access.allowed).toBe(false);
    if (access.allowed) return;
    expect(access.response.status).toBe(403);
    await expect(access.response.json()).resolves.toEqual({
      error: "Accès refusé : réservé aux super administrateurs",
    });
  });

  it("accorde le mode super_admin à une session super administrateur", async () => {
    queueSettings(undefined, INSTALL_TOKEN);
    mockGetSessionUser.mockResolvedValue({ id: "u1", globalRole: "super_admin" });

    const access = await guardSetupAccess();

    expect(access).toEqual({ allowed: true, mode: "super_admin" });
  });

  describe("clé imposée par SETUP_INSTALL_TOKEN", () => {
    const CONFIGURED = "cle-imposee-par-l-exploitant";

    afterEach(() => {
      delete process.env.SETUP_INSTALL_TOKEN;
    });

    it("fait autorité sans jamais lire la clé stockée en base", async () => {
      process.env.SETUP_INSTALL_TOKEN = CONFIGURED;
      // Seul setup_completed est lu : une deuxième lecture signalerait que la
      // clé de la base est encore consultée, donc encore exposée.
      queueSettings(undefined, INSTALL_TOKEN);
      mockCookieGet.mockReturnValue({ value: CONFIGURED });

      const access = await guardSetupAccess();

      expect(access).toEqual({ allowed: true, mode: "installer" });
      expect(mockDb.limit).toHaveBeenCalledTimes(1);
    });

    it("rend la clé stockée en base inopérante", async () => {
      process.env.SETUP_INSTALL_TOKEN = CONFIGURED;
      queueSettings(undefined, INSTALL_TOKEN);
      mockCookieGet.mockReturnValue({ value: INSTALL_TOKEN });

      const access = await guardSetupAccess();

      expect(access.allowed).toBe(false);
      if (access.allowed) return;
      expect(access.response.status).toBe(401);
    });

    it("ignore une valeur trop courte et revient à la clé de la base", async () => {
      process.env.SETUP_INSTALL_TOKEN = "trop-court";
      queueSettings(undefined, INSTALL_TOKEN);
      mockCookieGet.mockReturnValue({ value: INSTALL_TOKEN });

      const access = await guardSetupAccess();

      expect(access).toEqual({ allowed: true, mode: "installer" });
    });
  });
});
