import { describe, it, expect } from "vitest";
import {
  composeInputSchema,
  sanitizeMailHtml,
  htmlToText,
  computeThreadKey,
  buildMimeOptions,
} from "../compose";

const uuid = "11111111-1111-4111-8111-111111111111";
const base = {
  clientKey: "22222222-2222-4222-8222-222222222222",
  databaseId: uuid,
  rowId: uuid,
  to: ["a@b.fr"],
  subject: "Bonjour",
  bodyHtml: "<p>Salut</p>",
  attachments: [],
};

describe("composeInputSchema", () => {
  it("accepts a valid input", () => {
    expect(composeInputSchema.safeParse(base).success).toBe(true);
  });
  it("rejects an empty to list", () => {
    expect(composeInputSchema.safeParse({ ...base, to: [] }).success).toBe(false);
  });
  it("rejects an invalid address", () => {
    expect(composeInputSchema.safeParse({ ...base, to: ["pas-une-adresse"] }).success).toBe(false);
  });
  it("dedupes and lowercases recipients across to, cc and bcc", () => {
    const r = composeInputSchema.parse({
      ...base,
      to: ["A@B.fr", "a@b.fr"],
      cc: ["a@b.fr", "C@d.fr"],
      bcc: ["c@d.fr", "E@f.fr"],
    });
    expect(r.to).toEqual(["a@b.fr"]);
    expect(r.cc).toEqual(["c@d.fr"]);
    expect(r.bcc).toEqual(["e@f.fr"]);
  });
  it("rejects more than 50 recipients", () => {
    const to = Array.from({ length: 51 }, (_, i) => `u${i}@b.fr`);
    expect(composeInputSchema.safeParse({ ...base, to }).success).toBe(false);
    expect(composeInputSchema.safeParse({ ...base, to: to.slice(0, 50) }).success).toBe(true);
  });
  it("rejects an empty body", () => {
    expect(composeInputSchema.safeParse({ ...base, bodyHtml: "" }).success).toBe(false);
    expect(composeInputSchema.safeParse({ ...base, bodyHtml: "<p> </p>" }).success).toBe(false);
  });
  it("rejects an empty or too long subject", () => {
    expect(composeInputSchema.safeParse({ ...base, subject: "" }).success).toBe(false);
    expect(composeInputSchema.safeParse({ ...base, subject: "x".repeat(256) }).success).toBe(false);
  });
  it("requires a uuid clientKey and rejects unknown keys", () => {
    const { clientKey: _c, ...noKey } = base;
    void _c;
    expect(composeInputSchema.safeParse(noKey).success).toBe(false);
    expect(composeInputSchema.safeParse({ ...base, clientKey: "abc" }).success).toBe(false);
    expect(composeInputSchema.safeParse({ ...base, organizationId: uuid }).success).toBe(false);
  });
  it("sanitizes the stored body", () => {
    const r = composeInputSchema.parse({ ...base, bodyHtml: '<p onclick="x()">a</p><script>x()</script>' });
    expect(r.bodyHtml).toBe("<p>a</p>");
  });
});

describe("sanitizeMailHtml", () => {
  it("strips script, style, onclick and remote img but keeps links and lists", () => {
    const out = sanitizeMailHtml(
      '<p onclick="x()">a <a href="https://x.fr/p" onclick="y()">lien</a></p><script>alert(1)</script>' +
        '<style>p{}</style><img src="https://evil.fr/t.png"><ul><li>un</li></ul><a href="javascript:alert(1)">bad</a>' +
        '<a href="mailto:z@x.fr">m</a><blockquote>q</blockquote>',
    );
    expect(out).not.toMatch(/script|style|onclick|<img|javascript:/i);
    expect(out).toContain('href="https://x.fr/p"');
    expect(out).toContain('href="mailto:z@x.fr"');
    expect(out).toContain("<ul><li>un</li></ul>");
    expect(out).toContain("<blockquote>q</blockquote>");
  });

  it("opens links in a new tab with noopener noreferrer, overriding any target", () => {
    const out = sanitizeMailHtml('<a href="https://x.fr" target="_self" rel="opener">l</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).not.toContain("_self");
  });
});

describe("htmlToText", () => {
  it("converts blocks to lines and decodes entities", () => {
    expect(htmlToText("<p>a &amp; b</p><p>c<br>d</p>")).toBe("a & b\n\nc\nd");
  });
});

describe("computeThreadKey", () => {
  it("prefers first References id", () => {
    expect(
      computeThreadKey({ inReplyTo: "<b@x>", references: ["<root@x>", "<b@x>"], messageId: "<me@x>" }),
    ).toBe("root@x");
  });
  it("falls back to In-Reply-To then to the own Message-ID", () => {
    expect(computeThreadKey({ inReplyTo: "<b@x>", references: [], messageId: "<me@x>" })).toBe("b@x");
    expect(computeThreadKey({ messageId: "<me@x>" })).toBe("me@x");
  });
});

describe("buildMimeOptions", () => {
  const account = { address: "Moi@B.fr", displayName: "Moi Même", signature: "Cordialement\nMoi" };
  const msg = {
    to: ["a@x.fr"],
    cc: ["c@x.fr"],
    bcc: ["secret@x.fr"],
    subject: "Hello",
    bodyHtml: "<p>Corps</p>",
  };
  it("sets From, a generated Message-ID on the address domain and the signature", () => {
    const o = buildMimeOptions(account, msg, []);
    expect(o.from).toBe('"Moi Même" <moi@b.fr>');
    expect(o.messageId).toMatch(/^<[0-9a-f-]{36}@b\.fr>$/);
    expect(String(o.html)).toContain("<p>Corps</p>");
    expect(String(o.html)).toContain("Cordialement");
    expect(String(o.text)).toContain("Corps");
    expect(String(o.text)).toContain("Cordialement");
  });
  it("sets In-Reply-To and References", () => {
    const o = buildMimeOptions(account, { ...msg, inReplyTo: "<p@x>", references: ["<r@x>", "<p@x>"] }, []);
    expect(o.inReplyTo).toBe("<p@x>");
    expect(o.references).toEqual(["<r@x>", "<p@x>"]);
  });
  it("bcc is not leaked in headers, only in the envelope", () => {
    const o = buildMimeOptions(account, msg, []);
    expect(o.bcc).toBeUndefined();
    expect(o.to).toEqual(["a@x.fr"]);
    expect(o.cc).toEqual(["c@x.fr"]);
    expect(o.envelope).toEqual({ from: "moi@b.fr", to: ["a@x.fr", "c@x.fr", "secret@x.fr"] });
    expect(JSON.stringify(o.headers ?? {})).not.toContain("secret@x.fr");
  });
  it("maps attachments to nodemailer attachments", () => {
    const o = buildMimeOptions(account, msg, [
      { fileName: "a.pdf", mimeType: "application/pdf", size: 3, content: Buffer.from("abc") },
    ]);
    expect(o.attachments).toEqual([
      { filename: "a.pdf", contentType: "application/pdf", content: Buffer.from("abc") },
    ]);
  });
});
