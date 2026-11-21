/**
 * Balisage des mentions d'un commentaire de ligne : `@[Nom](user:<uuid>)`.
 * Module pur (ni base, ni React) : importable côté serveur et côté client.
 */

export const MAX_COMMENT_LENGTH = 5000;

/** Plafond de mentions prises en compte par commentaire (troncature silencieuse côté serveur). */
export const MAX_MENTIONS_PER_COMMENT = 100;

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/** Expression unique partagée (drapeau g : toujours recréer via `new RegExp(MENTION_PATTERN.source, "g")`). */
export const MENTION_PATTERN = new RegExp(`@\\[([^\\[\\]()]*)\\]\\(user:(${UUID})\\)`, "g");

export type MentionSegment =
  | { type: "text"; text: string }
  | { type: "mention"; userId: string; label: string };

function neutralizeName(name: string): string {
  return name.replace(/[[\]()]/g, "").replace(/\s+/g, " ").trim();
}

export function formatMention(name: string, userId: string): string {
  return `@[${neutralizeName(name)}](user:${userId})`;
}

function matches(body: string): RegExpMatchArray[] {
  return Array.from(body.matchAll(new RegExp(MENTION_PATTERN.source, "g")));
}

export function extractMentionIds(body: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const m of matches(body)) {
    const id = m[2].toLowerCase();
    if (!seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
}

export function parseMentionSegments(body: string): MentionSegment[] {
  const segments: MentionSegment[] = [];
  let last = 0;
  for (const m of matches(body)) {
    const start = m.index ?? 0;
    if (start > last) segments.push({ type: "text", text: body.slice(last, start) });
    segments.push({ type: "mention", userId: m[2].toLowerCase(), label: m[1] });
    last = start + m[0].length;
  }
  if (last < body.length) segments.push({ type: "text", text: body.slice(last) });
  return segments;
}

export function stripMentions(body: string): string {
  return body.replace(new RegExp(MENTION_PATTERN.source, "g"), (_m, label: string) => `@${label}`);
}

export function validateCommentBody(raw: unknown): { ok: true; body: string } | { ok: false } {
  if (typeof raw !== "string") return { ok: false };
  const body = raw.trim();
  if (body.length === 0) return { ok: false };
  if ([...body].length > MAX_COMMENT_LENGTH) return { ok: false };
  return { ok: true, body };
}
