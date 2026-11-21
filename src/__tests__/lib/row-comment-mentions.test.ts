import { describe, it, expect } from "vitest";
import {
  MAX_COMMENT_LENGTH,
  formatMention,
  extractMentionIds,
  parseMentionSegments,
  stripMentions,
  validateCommentBody,
} from "@/lib/databases/row-comment-mentions";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("row-comment-mentions", () => {
  it("extrait les ids dans l'ordre sans doublon", () => {
    const body = `${formatMention("B", B)} puis ${formatMention("A", A)} et ${formatMention("B2", B)}`;
    expect(extractMentionIds(body)).toEqual([B, A]);
  });

  it("ignore un id qui n'est pas un uuid", () => {
    expect(extractMentionIds("@[X](user:pas-un-uuid) @[Y](user:" + A + ")")).toEqual([A]);
  });

  it("un libellé contenant des crochets ne casse pas le balisage", () => {
    const m = formatMention("Jean [x] (y)", A);
    expect(extractMentionIds(`a ${m} b`)).toEqual([A]);
    const segs = parseMentionSegments(m);
    expect(segs).toHaveLength(1);
    expect(segs[0]).toMatchObject({ type: "mention", userId: A });
    expect((segs[0] as { label: string }).label).not.toMatch(/[\[\]()]/);
  });

  it("parseMentionSegments alterne texte et mentions", () => {
    const segs = parseMentionSegments(`Salut ${formatMention("Ana", A)} et ${formatMention("Bob", B)}!`);
    expect(segs).toEqual([
      { type: "text", text: "Salut " },
      { type: "mention", userId: A, label: "Ana" },
      { type: "text", text: " et " },
      { type: "mention", userId: B, label: "Bob" },
      { type: "text", text: "!" },
    ]);
  });

  it("texte sans balisage : un seul segment", () => {
    expect(parseMentionSegments("bonjour")).toEqual([{ type: "text", text: "bonjour" }]);
    expect(parseMentionSegments("")).toEqual([]);
  });

  it("validateCommentBody refuse vide et espaces seuls", () => {
    expect(validateCommentBody("")).toEqual({ ok: false });
    expect(validateCommentBody("  \n ")).toEqual({ ok: false });
    expect(validateCommentBody("  ok ")).toEqual({ ok: true, body: "ok" });
  });

  it("accepte 5000 points de code, refuse 5001", () => {
    expect(MAX_COMMENT_LENGTH).toBe(5000);
    expect(validateCommentBody("a".repeat(5000)).ok).toBe(true);
    expect(validateCommentBody("a".repeat(5001)).ok).toBe(false);
  });

  it("compte un emoji pour un caractère", () => {
    expect(validateCommentBody("😀".repeat(5000)).ok).toBe(true);
    expect(validateCommentBody("😀".repeat(5001)).ok).toBe(false);
  });

  it("refuse un non-texte", () => {
    expect(validateCommentBody(42)).toEqual({ ok: false });
    expect(validateCommentBody(null)).toEqual({ ok: false });
    expect(validateCommentBody(undefined)).toEqual({ ok: false });
  });

  it("stripMentions", () => {
    expect(stripMentions(`Salut ${formatMention("Ana", A)}, ok`)).toBe("Salut @Ana, ok");
  });
});
