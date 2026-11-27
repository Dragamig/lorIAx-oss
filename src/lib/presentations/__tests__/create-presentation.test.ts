import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  ordre: [] as string[],
  values: vi.fn(),
  returning: vi.fn(),
  uploadFile: vi.fn(),
  record: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: (v: unknown) => {
        h.values(v);
        return {
          returning: () => {
            h.ordre.push("insert");
            return h.returning();
          },
        };
      },
    }),
  },
}));
vi.mock("@/lib/storage/s3", () => ({
  uploadFile: (...a: unknown[]) => {
    h.ordre.push("upload");
    return h.uploadFile(...a);
  },
}));
vi.mock("@/lib/onboarding/progress", () => ({ recordIfRealSpace: h.record }));

import { createPresentation, PresentationStorageError } from "../create-presentation";
import { createEmptyDeck, countSlides } from "../deck";

const ROW = { id: "11111111-1111-4111-8111-111111111111", title: "T" };
const SPACE = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  vi.clearAllMocks();
  h.ordre.length = 0;
  h.returning.mockResolvedValue([ROW]);
  h.uploadFile.mockResolvedValue("clé");
  h.record.mockResolvedValue(undefined);
});

describe("createPresentation", () => {
  it("insère la ligne puis écrit l'objet S3, avec le compteur de diapositives", async () => {
    const deck = createEmptyDeck("T");
    const out = await createPresentation({ spaceId: SPACE, title: "T", deck, createdBy: "u1" });
    expect(out).toBe(ROW);
    expect(h.ordre).toEqual(["insert", "upload"]);
    expect(h.values).toHaveBeenCalledWith({
      title: "T",
      spaceId: SPACE,
      documentId: null,
      createdBy: "u1",
      slideCount: countSlides(deck),
    });
    expect(h.uploadFile.mock.calls[0][0]).toBe(`presentations/${ROW.id}.json`);
    expect(JSON.parse(h.uploadFile.mock.calls[0][1].toString())).toEqual(deck);
    expect(h.uploadFile.mock.calls[0][2]).toBe("application/json");
    expect(h.record).toHaveBeenCalledWith("u1", "presentation", SPACE);
  });

  it("transmet documentId quand fourni", async () => {
    const d = "33333333-3333-4333-8333-333333333333";
    await createPresentation({ spaceId: SPACE, title: "T", deck: createEmptyDeck("T"), createdBy: "u1", documentId: d });
    expect(h.values.mock.calls[0][0].documentId).toBe(d);
  });

  it("échec S3 : erreur typée, pas de badge d'onboarding", async () => {
    h.uploadFile.mockRejectedValue(new Error("s3"));
    await expect(
      createPresentation({ spaceId: SPACE, title: "T", deck: createEmptyDeck("T"), createdBy: "u1" })
    ).rejects.toMatchObject({ presentationId: ROW.id });
    expect(h.record).not.toHaveBeenCalled();
  });
});
