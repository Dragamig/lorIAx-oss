import { readFileSync, readdirSync } from "fs"
import { resolve } from "path"
import { describe, expect, it } from "vitest"
import { LIBRARY_ACTIONS, paletteActions } from "./actions"

const dir = resolve(__dirname, "../../../messages")
const locales = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""))

function get(obj: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], obj)
}

describe("LIBRARY_ACTIONS", () => {
  it("couvre les 7 locales", () => {
    expect(locales.sort()).toEqual(["br", "de", "en", "es", "fr", "ja", "zh"])
  })

  it.each(Object.values(LIBRARY_ACTIONS))("$id : icône et libellé dans chaque locale", (a) => {
    expect(a.icon).toBeTruthy()
    for (const loc of locales) {
      const msgs = JSON.parse(readFileSync(resolve(dir, `${loc}.json`), "utf-8"))
      const v = get(msgs, a.labelKey)
      expect(typeof v === "string" && v.length > 0, `${loc}:${a.labelKey}`).toBe(true)
    }
  })

  it("n'a pas de raccourci en double", () => {
    const keys = Object.values(LIBRARY_ACTIONS).map((a) => a.shortcut).filter(Boolean)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("les libellés ne sont pas des copies du français hors noms identiques", () => {
    const fr = JSON.parse(readFileSync(resolve(dir, "fr.json"), "utf-8")).library.actions
    for (const loc of ["de", "es", "ja", "zh", "br"]) {
      const m = JSON.parse(readFileSync(resolve(dir, `${loc}.json`), "utf-8")).library.actions
      expect(m.trash).not.toBe(fr.trash)
    }
  })

  it("la palette contient openLibrary et upload", () => {
    expect(paletteActions().map((a) => a.id)).toEqual(["openLibrary", "upload"])
  })
})
