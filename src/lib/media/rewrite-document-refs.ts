export type LookupResult =
  | { status: "found"; id: string }
  | { status: "missing" }
  | { status: "ambiguous" };

export type RewriteResult = { markdown: string; rewritten: number; skipped: number };

// Même garde que l'extraction des usages : exclut les URL absolues et les chemins imbriqués.
export const NOT_AFTER = "(?<![A-Za-z0-9._~%:\\-])";
export const ATTACHMENT_RE = new RegExp(`${NOT_AFTER}/api/attachments/([^"'()\\s?#<>\\\\\\]]+)`, "g");
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Blocs de code clôturés (``` ou ~~~, jusqu'à la clôture ou la fin) puis code en ligne.
const CODE_RE = /^[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]{0,3}\1[`~]*[ \t]*(?=\n|$)|(?![\s\S]))|(`+)[^`\n][^\n]*?\2(?!`)/gm;

const STUDIO_RE = new RegExp(
  `${NOT_AFTER}/api/studio/images/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})(?![0-9A-Za-z-])`,
  "g",
);

/** Remplace `/api/studio/images/<uuid>` par `/api/media/<uuid>` (même identifiant). Autre domaine inchangé. */
export function rewriteStudioRefs(text: string): string {
  return text.replace(STUDIO_RE, (_whole, id: string) => `/api/media/${id.toLowerCase()}`);
}

export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Remplace `/api/attachments/<clé>` par `/api/media/<id>` quand la clé résout à un
 * média unique de l'organisation. Le reste (data:, URL externes, code, clés
 * introuvables ou ambiguës) est laissé tel quel. Idempotent : une seconde passe ne
 * trouve plus rien à remplacer. Texte sans référence : même chaîne, aucune lecture.
 */
export async function rewriteDocumentRefs(
  markdown: string,
  orgId: string,
  lookup: (keys: string[]) => Promise<Map<string, LookupResult>>,
): Promise<RewriteResult> {
  if (!markdown.includes("/api/attachments/")) return { markdown, rewritten: 0, skipped: 0 };

  // Segments hors code, avec leur position.
  const proseSegments: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const m of markdown.matchAll(CODE_RE)) {
    const idx = m.index ?? 0;
    if (idx > cursor) proseSegments.push({ start: cursor, end: idx });
    cursor = idx + m[0].length;
  }
  if (cursor < markdown.length) proseSegments.push({ start: cursor, end: markdown.length });

  const keys = new Set<string>();
  for (const seg of proseSegments) {
    for (const m of markdown.slice(seg.start, seg.end).matchAll(ATTACHMENT_RE)) {
      const key = safeDecode(m[1]);
      if (key) keys.add(key);
    }
  }
  if (keys.size === 0) return { markdown, rewritten: 0, skipped: 0 };

  const resolved = new Map<string, string | null>();
  let found: Map<string, LookupResult> | null = null;
  try {
    found = await lookup([...keys]);
  } catch {
    found = null;
  }
  for (const key of keys) {
    const r = found?.get(key);
    resolved.set(key, r && r.status === "found" && UUID_RE.test(r.id) ? r.id.toLowerCase() : null);
  }
  void orgId; // la résolution est faite dans l'organisation par `lookup`

  let rewritten = 0;
  let skipped = 0;
  let out = "";
  let last = 0;
  for (const seg of proseSegments) {
    out += markdown.slice(last, seg.start);
    out += markdown.slice(seg.start, seg.end).replace(ATTACHMENT_RE, (whole, raw: string) => {
      const id = resolved.get(safeDecode(raw));
      if (id) {
        rewritten += 1;
        return `/api/media/${id}`;
      }
      skipped += 1;
      return whole;
    });
    last = seg.end;
  }
  out += markdown.slice(last);
  return { markdown: out, rewritten, skipped };
}
