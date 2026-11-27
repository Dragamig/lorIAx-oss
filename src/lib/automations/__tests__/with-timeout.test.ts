import { describe, it, expect, vi, afterEach } from "vitest";
import { withTimeout } from "@/lib/automations/with-timeout";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("withTimeout", () => {
  it("rend la valeur d'une étape rapide", async () => {
    await expect(withTimeout("rapide", () => Promise.resolve(42), 1000)).resolves.toBe(42);
  });

  it("journalise un avertissement nommant l'étape au dépassement et rend la main", async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const p = withTimeout("etape-lente", () => new Promise<void>(() => {}), 50_000);
    await vi.advanceTimersByTimeAsync(50_000);
    await expect(p).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("etape-lente"));
  });

  it("propage l'erreur d'une étape qui échoue", async () => {
    await expect(withTimeout("x", () => Promise.reject(new Error("boom")), 1000)).rejects.toThrow("boom");
  });
});
