import { readFileSync, readdirSync } from "fs"
import { resolve } from "path"
import { describe, expect, it } from "vitest"

/** Lignes contenant un `<button` brut hors éléments marqués data-action-exempt. */
export function findRawButtons(name: string, content: string): string[] {
  if (name === "action-button.tsx") return []
  const lines = content.split("\n")
  const out: string[] = []
  lines.forEach((line, i) => {
    if (!/<button\b/.test(line)) return
    const block = lines.slice(i, i + 6).join("\n")
    if (/data-action-exempt/.test(block)) return
    out.push(`${name}:${i + 1}`)
  })
  return out
}

describe("couverture du registre d'actions", () => {
  it("aucun <button> brut dans src/components/media", () => {
    const dir = resolve(__dirname)
    const found = readdirSync(dir)
      .filter((f) => f.endsWith(".tsx") && !f.endsWith(".test.tsx"))
      .flatMap((f) => findRawButtons(f, readFileSync(resolve(dir, f), "utf-8")))
    expect(found).toEqual([])
  })

  it("détecte un <button> brut", () => {
    expect(findRawButtons("x.tsx", "<div>\n<button onClick={f}>a</button>\n</div>")).toEqual(["x.tsx:2"])
  })

  it("tolère un bouton marqué data-action-exempt", () => {
    expect(
      findRawButtons("x.tsx", "{/* tuile sélectionnable */}\n<button\n data-action-exempt\n>a</button>"),
    ).toEqual([])
  })
})
