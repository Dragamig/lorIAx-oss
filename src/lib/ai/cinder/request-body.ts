import type { UIMessage } from "ai";
import type { CinderBody, CinderScope } from "./types";

export type ParseResult =
  | { ok: true; body: CinderBody }
  | { ok: false; status: 400; message: string };

const fail = (message: string): ParseResult => ({ ok: false, status: 400, message });

export function parseCinderBody(raw: unknown, scope: CinderScope): ParseResult {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const hasMessages = Array.isArray(o.messages) && o.messages.length > 0;
  const hasHistoryKey = o.conversationId !== undefined || o.newConversation !== undefined;

  if (hasHistoryKey) return fail("Historique non disponible");
  if (!hasMessages) return fail("Messages array required");

  const context = scope === "full" && typeof o.context === "string" ? o.context : "";
  return { ok: true, body: { messages: o.messages as UIMessage[], context } };
}

/** Text of the last message: legacy `content`, else concatenated text parts. */
export function lastUserText(messages: UIMessage[]): string {
  const last = messages[messages.length - 1] as
    | { content?: string; parts?: { type: string; text?: string }[] }
    | undefined;
  return (
    last?.content ||
    (last?.parts ?? [])
      .filter((p) => p.type === "text")
      .map((p) => p.text ?? "")
      .join("") ||
    ""
  );
}
