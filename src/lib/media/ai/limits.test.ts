import { describe, it, expect } from "vitest";
import * as L from "./limits";

describe("limits", () => {
  it("valeurs figées par le plan", () => {
    expect(L.MAX_EXTRACT_BYTES).toBe(52428800);
    expect(L.MAX_TEXT_CHARS).toBe(200000);
    expect(L.MAX_CHUNKS).toBe(200);
    expect(L.MAX_PDF_PAGES).toBe(300);
    expect(L.MAX_SHEET_CELLS).toBe(20000);
    expect(L.MAX_SHEET_COUNT).toBe(10);
    expect(L.MAX_UNZIPPED_BYTES).toBe(104857600);
    expect(L.MAX_TRANSCRIBE_SECONDS).toBe(3600);
    expect(L.MAX_TRANSCRIBE_BYTES).toBe(524288000);
    expect(L.ORG_DAILY_MEDIA_MAX).toBe(300);
    expect(L.ORG_DAILY_TRANSCRIBE_MINUTES).toBe(120);
    expect(L.MAX_ATTEMPTS).toBe(3);
    expect(L.RETRY_DELAYS_MS).toEqual([600000, 3600000, 21600000]);
  });
  it("une attente par tentative, croissante", () => {
    expect(L.RETRY_DELAYS_MS).toHaveLength(L.MAX_ATTEMPTS);
    expect([...L.RETRY_DELAYS_MS]).toEqual([...L.RETRY_DELAYS_MS].sort((a, b) => a - b));
  });
});
