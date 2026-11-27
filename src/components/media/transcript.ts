/** Ligne de transcription : `[mm:ss] texte` (voir `transcribe.ts`). */
const LINE_RE = /^\[(\d{2,}):(\d{2})\]\s?(.*)$/

export type TextLine = { stamp: string | null; seconds: number | null; text: string }

export function parseLines(text: string, transcript: boolean): TextLine[] {
  return text.split("\n").map((raw) => {
    if (!transcript) return { stamp: null, seconds: null, text: raw }
    const m = LINE_RE.exec(raw)
    if (!m) return { stamp: null, seconds: null, text: raw }
    return { stamp: `${m[1]}:${m[2]}`, seconds: Number(m[1]) * 60 + Number(m[2]), text: m[3] }
  })
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Découpe `text` en segments alternés (hors correspondance, correspondance, ...). */
export function splitMatches(text: string, query: string): { value: string; match: boolean }[] {
  const q = query.trim()
  if (!q) return [{ value: text, match: false }]
  const re = new RegExp(`(${escapeRe(q)})`, "gi")
  return text
    .split(re)
    .filter((v) => v !== "")
    .map((value) => ({ value, match: value.toLowerCase() === q.toLowerCase() }))
}

export function countMatches(lines: TextLine[], query: string): number {
  if (!query.trim()) return 0
  return lines.reduce((n, l) => n + splitMatches(l.text, query).filter((p) => p.match).length, 0)
}
