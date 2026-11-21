import { describe, it, expect, vi, beforeEach } from "vitest";

// --- mocks hoistés ---

// vi.hoisted() est évalué avant les imports, ce qui permet de partager l'état du mock
const _dbMock = vi.hoisted(() => {
  const whereImpl = vi.fn().mockResolvedValue(undefined);
  const mock = {
    _whereImpl: whereImpl,
    update: vi.fn(),
    set: vi.fn(),
    where: vi.fn().mockImplementation((...args: unknown[]) => whereImpl(...args)),
  };
  mock.update.mockReturnValue(mock);
  mock.set.mockReturnValue(mock);
  return mock;
});

vi.mock("next/headers", () => ({
  cookies: vi.fn().mockResolvedValue({ set: vi.fn() }),
}));

vi.mock("@/lib/db", () => ({
  db: _dbMock,
}));

vi.mock("@/lib/auth/get-user", () => ({
  getSessionUser: vi.fn(),
}));

vi.mock("@/lib/logger", () => ({
  default: { error: vi.fn() },
}));

import { setUserLocale } from "@/lib/actions/user-locale";
import { getSessionUser } from "@/lib/auth/get-user";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import logger from "@/lib/logger";

const mockGetSessionUser = vi.mocked(getSessionUser);
const mockCookies = vi.mocked(cookies);

// Helper : résout le type du store cookie
type CookieStore = ReturnType<typeof cookies> extends Promise<infer T> ? T : never;

function makeCookieStore() {
  const mockSet = vi.fn();
  mockCookies.mockResolvedValue({ set: mockSet } as unknown as CookieStore);
  return mockSet;
}

describe("setUserLocale", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Réinitialiser le chaînage mock db
    _dbMock.update.mockReturnValue(_dbMock);
    _dbMock.set.mockReturnValue(_dbMock);
    _dbMock._whereImpl.mockResolvedValue(undefined);
    _dbMock.where.mockImplementation((...args: unknown[]) => _dbMock._whereImpl(...args));
    mockGetSessionUser.mockResolvedValue(null);
    makeCookieStore();
  });

  it("lève une erreur pour une locale invalide", async () => {
    await expect(setUserLocale("invalid")).rejects.toThrow("Locale invalide");
    await expect(setUserLocale("")).rejects.toThrow("Locale invalide");
    await expect(setUserLocale("pt")).rejects.toThrow("Locale invalide");
  });

  it("accepte toutes les 7 locales valides sans lever d'erreur", async () => {
    for (const locale of ["fr", "en", "es", "de", "ja", "zh", "br"] as const) {
      await expect(setUserLocale(locale)).resolves.toBeUndefined();
    }
  });

  it("pose le cookie NEXT_LOCALE pour un utilisateur non authentifié", async () => {
    mockGetSessionUser.mockResolvedValue(null);
    const mockSet = makeCookieStore();

    await setUserLocale("en");

    expect(mockSet).toHaveBeenCalledWith(
      "NEXT_LOCALE",
      "en",
      expect.objectContaining({ path: "/", sameSite: "lax" })
    );
  });

  it("ne met pas à jour la BDD quand la session user est null", async () => {
    mockGetSessionUser.mockResolvedValue(null);
    makeCookieStore();

    await setUserLocale("es");

    expect(db.update).not.toHaveBeenCalled();
  });

  it("met à jour la BDD pour un utilisateur authentifié", async () => {
    mockGetSessionUser.mockResolvedValue({
      id: "user-42",
      email: "test@example.com",
      name: "Test",
      globalRole: "editor",
      capabilities: [],
    });
    const mockSet = makeCookieStore();

    await setUserLocale("es");

    expect(db.update).toHaveBeenCalled();
    // .set() reçoit la bonne locale
    expect(_dbMock.set).toHaveBeenCalledWith({ locale: "es" });
    // .where() est appelé (condition eq)
    expect(_dbMock.where).toHaveBeenCalled();
    // Le cookie est aussi posé
    expect(mockSet).toHaveBeenCalledWith(
      "NEXT_LOCALE",
      "es",
      expect.objectContaining({ path: "/", sameSite: "lax" })
    );
  });

  it("DB failure is swallowed (best-effort)", async () => {
    mockGetSessionUser.mockResolvedValue({
      id: "user-99",
      email: "fail@example.com",
      name: "Failing User",
      globalRole: "editor",
      capabilities: [],
    });
    const mockSet = makeCookieStore();
    // Faire rejeter l'appel terminal .where()
    _dbMock._whereImpl.mockRejectedValue(new Error("DB connection lost"));

    // Ne doit pas lever d'exception
    await expect(setUserLocale("fr")).resolves.toBeUndefined();

    // Le cookie doit tout de même être posé
    expect(mockSet).toHaveBeenCalledWith(
      "NEXT_LOCALE",
      "fr",
      expect.objectContaining({ path: "/", sameSite: "lax" })
    );

    // L'erreur doit être loguée par le logger du projet
    expect(logger.error).toHaveBeenCalled();
  });
});
