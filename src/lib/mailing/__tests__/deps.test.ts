import { describe, it, expect } from "vitest";

describe("mailing dependencies", () => {
  it("resolves imapflow and sanitize-html", async () => {
    const imap = await import("imapflow");
    const sanitize = await import("sanitize-html");
    expect(typeof imap.ImapFlow).toBe("function");
    expect(typeof sanitize.default).toBe("function");
  });
});
