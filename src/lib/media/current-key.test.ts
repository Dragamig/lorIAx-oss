import { describe, it, expect, vi } from "vitest";
import { withCurrentKey } from "./current-key";

describe("withCurrentKey", () => {
  it("lit la clé résolue sans second essai", async () => {
    const resolve = vi.fn(async () => "k1");
    const use = vi.fn(async (k: string) => k);
    expect(await withCurrentKey(resolve, use)).toBe("k1");
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it("relit avec la nouvelle clé quand le fichier a changé pendant l'usage", async () => {
    const resolve = vi.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("new");
    const use = vi.fn(async (k: string) => {
      if (k === "old") throw new Error("NoSuchKey");
      return k;
    });
    expect(await withCurrentKey(resolve, use)).toBe("new");
  });

  it("relance l'erreur d'origine si la clé n'a pas changé", async () => {
    const err = new Error("boom");
    await expect(
      withCurrentKey(async () => "k", async () => { throw err; })
    ).rejects.toBe(err);
  });

  it("relance l'erreur d'origine si la nouvelle résolution échoue (média supprimé)", async () => {
    const err = new Error("boom");
    const resolve = vi.fn().mockResolvedValueOnce("k").mockRejectedValueOnce(new Error("gone"));
    await expect(withCurrentKey(resolve, async () => { throw err; })).rejects.toBe(err);
  });
});
