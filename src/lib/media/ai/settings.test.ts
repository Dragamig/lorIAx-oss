import { describe, it, expect, vi, beforeEach } from "vitest";

const h = vi.hoisted(() => ({ row: undefined as unknown, upsert: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: {
    select: () => ({
      from: () => ({ where: () => ({ limit: () => Promise.resolve(h.row ? [h.row] : []) }) }),
    }),
    insert: () => ({
      values: (v: unknown) => ({
        onConflictDoUpdate: (o: unknown) => {
          h.upsert(v, o);
          return Promise.resolve();
        },
      }),
    }),
  },
}));

import { getMediaAiSettings, setMediaAiSettings, MediaAiSettingsError } from "./settings";

beforeEach(() => {
  h.row = undefined;
  h.upsert.mockReset();
});

describe("réglages IA des médias", () => {
  it("sans ligne : deux interrupteurs faux", async () => {
    expect(await getMediaAiSettings("o1")).toEqual({ indexEnabled: false, transcribeEnabled: false });
  });

  it("active l'indexation seule et trace l'auteur", async () => {
    const out = await setMediaAiSettings("o1", "u1", { indexEnabled: true });
    expect(out).toEqual({ indexEnabled: true, transcribeEnabled: false });
    expect(h.upsert.mock.calls[0][0]).toMatchObject({ organizationId: "o1", updatedBy: "u1", indexEnabled: true });
  });

  it("refuse la transcription sans indexation", async () => {
    await expect(setMediaAiSettings("o1", "u1", { transcribeEnabled: true })).rejects.toBeInstanceOf(
      MediaAiSettingsError,
    );
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it("accepte la transcription quand l'indexation est déjà active", async () => {
    h.row = { indexEnabled: true, transcribeEnabled: false };
    expect(await setMediaAiSettings("o1", "u1", { transcribeEnabled: true })).toEqual({
      indexEnabled: true,
      transcribeEnabled: true,
    });
  });

  it("désactiver l'indexation coupe aussi la transcription", async () => {
    h.row = { indexEnabled: true, transcribeEnabled: true };
    expect(await setMediaAiSettings("o1", "u1", { indexEnabled: false })).toEqual({
      indexEnabled: false,
      transcribeEnabled: false,
    });
  });
});
