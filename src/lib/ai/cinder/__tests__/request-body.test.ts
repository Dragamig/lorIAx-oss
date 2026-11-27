import { describe, it, expect } from "vitest";
import type { UIMessage } from "ai";
import { parseCinderBody, lastUserText } from "../request-body";

const userMsg = {
  role: "user",
  parts: [{ type: "text", text: "x" }],
};

describe("parseCinderBody", () => {
  it("accepts a valid body", () => {
    const r = parseCinderBody({ messages: [userMsg], context: "/bases" }, "full");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.body.messages.length).toBe(1);
      expect(r.body.context).toBe("/bases");
    }
  });

  it("rejects empty or missing messages", () => {
    const expected = { ok: false, status: 400, message: "Messages array required" };
    expect(parseCinderBody({ messages: [] }, "full")).toEqual(expected);
    expect(parseCinderBody({}, "full")).toEqual(expected);
    expect(parseCinderBody(null, "full")).toEqual(expected);
  });

  it("rejects conversationId together with messages", () => {
    const r = parseCinderBody({ messages: [userMsg], conversationId: "c1" }, "full");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("rejects conversationId alone and newConversation alone", () => {
    for (const raw of [{ conversationId: "c1" }, { newConversation: true }]) {
      const r = parseCinderBody(raw, "full");
      expect(r).toEqual({ ok: false, status: 400, message: "Historique non disponible" });
    }
  });

  it("help-alias scope ignores context", () => {
    const r = parseCinderBody({ messages: [userMsg], context: "/bases" }, "help-alias");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.body.context).toBe("");
  });
});

describe("lastUserText", () => {
  it("reads text parts", () => {
    const m = [
      { role: "user", parts: [{ type: "text", text: "a" }, { type: "step-start" }, { type: "text", text: "b" }] },
    ] as unknown as UIMessage[];
    expect(lastUserText(m)).toBe("ab");
  });

  it("reads legacy content", () => {
    const m = [{ role: "user", content: "legacy", parts: [] }] as unknown as UIMessage[];
    expect(lastUserText(m)).toBe("legacy");
  });

  it("returns empty string when nothing", () => {
    expect(lastUserText([{ role: "user", parts: [] }] as unknown as UIMessage[])).toBe("");
    expect(lastUserText([])).toBe("");
  });
});
