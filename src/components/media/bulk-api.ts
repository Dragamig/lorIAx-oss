import type { BatchAction, BatchItemResult } from "@/lib/media/batch"

/** Au plus 200 ids par appel côté serveur (BATCH_MAX_IDS). */
const CHUNK = 200

type Body = BatchAction extends infer A ? (A extends { ids: string[] } ? Omit<A, "ids"> : never) : never

/** Envoie une action de lot, découpée si besoin, et rend un résultat par id. */
export async function postBatch(body: Body, ids: string[]): Promise<BatchItemResult[]> {
  const out: BatchItemResult[] = []
  for (let i = 0; i < ids.length; i += CHUNK) {
    const res = await fetch("/api/media/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ids: ids.slice(i, i + CHUNK) }),
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    out.push(...(((await res.json()) as { results?: BatchItemResult[] }).results ?? []))
  }
  return out
}

/** Libellé comparable d'un tag (casse, accents et espaces ignorés). */
export function normalizeTag(label: string): string {
  return label
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .trim()
}
