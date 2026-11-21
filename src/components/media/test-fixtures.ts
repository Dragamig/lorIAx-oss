import { vi } from "vitest"
import fr from "../../../messages/fr.json"
import type { MediaListItem } from "@/lib/media/list"

/** Moteur de traduction minimal pour les tests de composants. */
export const intlMock = () => ({
  useLocale: () => "fr",
  useTranslations: (ns?: string) => {
    const lookup = (key: string) => {
      const full = ns ? `${ns}.${key}` : key
      return full.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown>)?.[k], fr)
    }
    const t = (key: string, vars?: Record<string, string>) =>
      String(lookup(key)).replace(/\{(\w+)\}/g, (_, k) => vars?.[k] ?? "")
    t.has = (key: string) => typeof lookup(key) === "string"
    return t
  },
})

export function makeItems(n: number, nameOf: (i: number) => string = (i) => `media-${i}.png`): MediaListItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `m${i}`,
    filename: nameOf(i),
    title: null,
    altText: null,
    kind: "image",
    mimeType: "image/png",
    sizeBytes: 1000 * (i + 1),
    width: 10,
    height: 10,
    spaceId: "s1",
    spaceName: "Direction",
    folderId: null,
    uploadedBy: "u1",
    uploaderName: "Claire",
    createdAt: "2026-11-01T10:00:00.000Z",
    deletedAt: null,
    purgeAt: null,
    url: `/api/media/m${i}`,
    thumbnailUrl: null,
    usageCount: i,
    tags: [],
    canWrite: true,
    publicShared: false,
  }))
}

/** jsdom n'a pas de mise en page : impose une taille au conteneur défilant. */
export function mockLayout(width = 1000, height = 600) {
  const proto = HTMLElement.prototype
  const defs: [string, number][] = [
    ["offsetWidth", width],
    ["offsetHeight", height],
    ["clientWidth", width],
    ["clientHeight", height],
  ]
  for (const [k, v] of defs) Object.defineProperty(proto, k, { configurable: true, get: () => v })
  Element.prototype.scrollTo = vi.fn() as never
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
}
