/**
 * Écriture versionnée (revue finale, I3) : un échec S3 après l'incrément de
 * version ne doit pas laisser la ligne en avance sur l'objet courant, sinon le
 * client (qui garde `expectedVersion`) prend un 409 définitif.
 *
 * Preuve par mutation : la compensation retirée du `catch` fait échouer
 * « échec S3 : la version est remise ».
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  miseAJour: vi.fn(),
  sets: vi.fn(),
  uploadFile: vi.fn(),
}));

vi.mock("@/lib/db", () => {
  const chaine = (fin: () => unknown) => {
    const obj: Record<string, unknown> = {
      set: (v: unknown) => {
        h.sets(v);
        return obj;
      },
      where: () => obj,
      returning: () => Promise.resolve(fin()),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve(fin()).then(res, rej),
    };
    return obj;
  };
  return { db: { update: () => chaine(() => h.miseAJour()) } };
});
vi.mock("@/lib/storage/s3", () => ({ uploadFile: h.uploadFile }));

import { writeVersionedDeck } from "@/lib/presentations/versioned-write";
import { createEmptyDeck } from "@/lib/presentations/deck";

const DECK = createEmptyDeck("T");

beforeEach(() => {
  vi.clearAllMocks();
  h.miseAJour.mockReturnValue([{ id: "p1", version: 4 }]);
  h.uploadFile.mockResolvedValue(undefined);
});

describe("writeVersionedDeck", () => {
  it("succès : version incrémentée, deux objets écrits, aucune compensation", async () => {
    const r = await writeVersionedDeck({ id: "p1", version: 3 }, DECK, "{}", 3);
    expect(r.status).toBe("ok");
    expect(h.uploadFile).toHaveBeenCalledTimes(2);
    expect(h.sets).toHaveBeenCalledTimes(1);
  });

  it("la révision est nommée par la version qu'elle contient (N+1)", async () => {
    await writeVersionedDeck({ id: "p1", version: 3 }, DECK, "{}", 3);
    expect(h.uploadFile.mock.calls[0][0]).toBe("presentations/p1/v4.json");
    expect(h.uploadFile.mock.calls[1][0]).toBe("presentations/p1.json");
  });

  it("échec S3 : la version est remise", async () => {
    h.uploadFile.mockRejectedValue(new Error("S3 en panne"));
    const r = await writeVersionedDeck({ id: "p1", version: 3 }, DECK, "{}", 3);
    expect(r.status).toBe("storage-error");
    expect(h.sets).toHaveBeenCalledTimes(2);
    expect(h.sets.mock.calls[1][0]).toMatchObject({ version: 3 });
  });

  it("échec S3 : tous les champs écrits reviennent à l'état initial", async () => {
    h.uploadFile.mockRejectedValue(new Error("S3 en panne"));
    const avant = new Date("2026-01-01T00:00:00Z");
    const masque = new Date("2026-02-02T00:00:00Z");
    const row = {
      id: "p1",
      version: 3,
      title: "Ancien",
      slideCount: 2,
      updatedAt: avant,
      templateHiddenAt: masque,
    };
    const r = await writeVersionedDeck(row, DECK, "{}", 3, "Nouveau", { templateHiddenAt: null });
    expect(r.status).toBe("storage-error");
    expect(h.sets.mock.calls[0][0]).toMatchObject({ title: "Nouveau", templateHiddenAt: null });
    expect(h.sets.mock.calls[1][0]).toEqual({
      version: 3,
      title: "Ancien",
      slideCount: 2,
      updatedAt: avant,
      templateHiddenAt: masque,
    });
  });

  it("échec S3 et compensation en échec : l'erreur de stockage est tout de même rendue", async () => {
    h.uploadFile.mockRejectedValue(new Error("S3 en panne"));
    h.miseAJour
      .mockReturnValueOnce([{ id: "p1", version: 4 }])
      .mockImplementationOnce(() => {
        throw new Error("base en panne");
      });
    const r = await writeVersionedDeck({ id: "p1", version: 3 }, DECK, "{}", 3);
    expect(r.status).toBe("storage-error");
  });
});
