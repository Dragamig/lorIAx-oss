import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const root = process.cwd()
const read = (p: string) => readFileSync(join(root, p), "utf8")

describe("AZ-27 : documentation et version", () => {
  it("package.json porte une version semver X.Y.Z", () => {
    const { version } = JSON.parse(read("package.json"))
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
  })

  it("la FAQ traite l'email non vérifié", () => {
    expect(read("docs/kb/09-faq-depannage.md")).toContain("Email non vérifié")
  })
})
