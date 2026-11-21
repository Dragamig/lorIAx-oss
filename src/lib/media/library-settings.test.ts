import { describe, it, expect, vi, beforeEach } from "vitest";

const getSetting = vi.fn();
const setSetting = vi.fn();
vi.mock("@/lib/settings/system-settings", () => ({
  getSetting: (...a: unknown[]) => getSetting(...a),
  setSetting: (...a: unknown[]) => setSetting(...a),
}));

import {
  getTrashRetentionPolicy,
  getLibrarySettings,
  setLibrarySettings,
  LibrarySettingsError,
} from "./library-settings";

describe("library-settings", () => {
  beforeEach(() => {
    getSetting.mockReset();
    setSetting.mockReset();
  });

  it("renvoie 30 jours quand rien n'est stocké", async () => {
    getSetting.mockResolvedValue(null);
    expect(await getLibrarySettings()).toEqual({ trashRetentionDays: 30 });
  });

  it.each([6, 366, 10.5])("rejette %s", async (days) => {
    getSetting.mockResolvedValue(null);
    await expect(setLibrarySettings({ trashRetentionDays: days })).rejects.toBeInstanceOf(
      LibrarySettingsError
    );
    expect(setSetting).not.toHaveBeenCalled();
  });

  it("écrit 45", async () => {
    getSetting.mockResolvedValue(null);
    const out = await setLibrarySettings({ trashRetentionDays: 45 });
    expect(out).toEqual({ trashRetentionDays: 45 });
    expect(setSetting).toHaveBeenCalledWith("media.library", { trashRetentionDays: 45 });
  });

  describe("préavis de réduction du délai", () => {
    const NOW = new Date("2026-11-15T10:00:00Z");

    it("une réduction mémorise l'ancien délai et la date du changement", async () => {
      getSetting.mockResolvedValue({ trashRetentionDays: 30 });
      vi.useFakeTimers();
      vi.setSystemTime(NOW);
      const out = await setLibrarySettings({ trashRetentionDays: 10 });
      vi.useRealTimers();
      expect(out).toEqual({ trashRetentionDays: 10 });
      expect(setSetting).toHaveBeenCalledWith("media.library", {
        trashRetentionDays: 10,
        previousRetentionDays: 30,
        retentionChangedAt: NOW.toISOString(),
      });
    });

    it("une augmentation efface le préavis", async () => {
      getSetting.mockResolvedValue({
        trashRetentionDays: 10,
        previousRetentionDays: 30,
        retentionChangedAt: NOW.toISOString(),
      });
      await setLibrarySettings({ trashRetentionDays: 45 });
      expect(setSetting).toHaveBeenCalledWith("media.library", { trashRetentionDays: 45 });
    });

    it("pendant le préavis, le délai effectif est le plus grand des deux", async () => {
      getSetting.mockResolvedValue({
        trashRetentionDays: 10,
        previousRetentionDays: 30,
        retentionChangedAt: NOW.toISOString(),
      });
      const p = await getTrashRetentionPolicy(new Date(NOW.getTime() + 3 * 86_400_000));
      expect(p).toMatchObject({ trashRetentionDays: 10, effectiveDays: 30, previousDays: 30 });
      expect(p.noticeEndsAt?.toISOString()).toBe(new Date(NOW.getTime() + 7 * 86_400_000).toISOString());
    });

    it("après 7 jours, le nouveau délai s'applique seul", async () => {
      getSetting.mockResolvedValue({
        trashRetentionDays: 10,
        previousRetentionDays: 30,
        retentionChangedAt: NOW.toISOString(),
      });
      const p = await getTrashRetentionPolicy(new Date(NOW.getTime() + 7 * 86_400_000));
      expect(p).toMatchObject({ trashRetentionDays: 10, effectiveDays: 10, previousDays: null, noticeEndsAt: null });
    });

    it("une seconde réduction pendant le préavis garde le plus grand ancien délai", async () => {
      getSetting.mockResolvedValue({
        trashRetentionDays: 10,
        previousRetentionDays: 30,
        retentionChangedAt: new Date().toISOString(),
      });
      await setLibrarySettings({ trashRetentionDays: 8 });
      expect(setSetting).toHaveBeenCalledWith(
        "media.library",
        expect.objectContaining({ trashRetentionDays: 8, previousRetentionDays: 30 })
      );
    });
  });
});
