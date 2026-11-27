import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi } from "vitest"

vi.mock("swr", () => ({ default: () => ({ data: undefined }) }))
vi.mock("@/i18n/routing", () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock("next-intl", () => ({ useTranslations: () => (k: string) => k }))

import { parseMediaFilters } from "@/lib/media/filters"
import { LIBRARY_ROUTES, mediaHref } from "./command-palette"

const root = process.cwd()
const page = join(root, "src/app/[locale]/(app)/mediatheque/page.tsx")

describe("liens de la médiathèque", () => {
  it("produit /mediatheque, ?upload=1 et ?id=<uuid>", () => {
    expect(LIBRARY_ROUTES).toEqual(expect.arrayContaining(["/mediatheque", "/mediatheque?upload=1"]))
    expect(mediaHref("abc")).toBe("/mediatheque?id=abc")
  })

  it("aucun lien ne vise une route absente", () => {
    const paths = [...LIBRARY_ROUTES, mediaHref("00000000-0000-0000-0000-000000000000")].map((h) => h.split("?")[0])
    for (const p of paths) {
      expect(p).toBe("/mediatheque")
      expect(existsSync(page)).toBe(true)
    }
  })

  it("le deeplink comprend upload et id", () => {
    const deeplink = readFileSync(join(root, "src/components/media/use-library-deeplink.ts"), "utf8")
    expect(deeplink).toContain('searchParams.get("upload")')
    const uuid = "00000000-0000-4000-8000-000000000000"
    const parsed = parseMediaFilters(new URLSearchParams(mediaHref(uuid).split("?")[1]))
    expect(parsed.ids).toEqual([uuid])
  })
})
