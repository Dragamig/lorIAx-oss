import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// sw.ts ne s'importe pas hors navigateur : test statique du bloc NetworkOnly des contenus.
const src = readFileSync(join(process.cwd(), "src/sw.ts"), "utf8");
const block = src.slice(
  src.indexOf("Document content APIs"),
  src.indexOf("Navigation (pages HTML)")
);

describe("service worker : médias jamais mis en cache", () => {
  it("/api/media/ est en NetworkOnly", () => {
    expect(block).toContain('url.pathname.startsWith("/api/media/")');
    expect(block).toContain("new NetworkOnly()");
  });
  it("/api/public/<token>/media/ est en NetworkOnly", () => {
    expect(block).toContain('url.pathname.startsWith("/api/public/")');
    expect(block).toContain('url.pathname.includes("/media/")');
  });
  it("l'alias permanent /api/attachments/ (dont /signed) est en NetworkOnly", () => {
    expect(block).toContain('url.pathname.startsWith("/api/attachments/")');
    expect(block).toContain("new NetworkOnly()");
  });
  it("aucune route médias n'est dans une stratégie de cache", () => {
    for (const re of [/CacheFirst|StaleWhileRevalidate/]) {
      expect(block).not.toMatch(re);
    }
  });
});
