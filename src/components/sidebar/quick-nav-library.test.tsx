// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { cleanup, render, screen } from "@testing-library/react"

const h = vi.hoisted(() => ({ modules: ["library"] as string[] }))

vi.mock("next-intl", async () => (await import("@/components/media/test-fixtures")).intlMock())
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, className }: { href: string; children: React.ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}))
vi.mock("swr", () => ({
  default: (key: string) => ({
    data: key === "/api/modules/active" ? { modules: h.modules } : { tasks: [] },
  }),
}))

import { QuickNav } from "./quick-nav"

afterEach(cleanup)

describe("QuickNav, Médiathèque", () => {
  it("lien présent et actif sur /mediatheque/x", () => {
    h.modules = ["library"]
    render(<QuickNav pathname="/mediatheque/x" user={null} />)
    const link = screen.getByRole("link", { name: "Médiathèque" })
    expect(link.getAttribute("href")).toBe("/mediatheque")
    expect(link.className).toContain("bg-sidebar-accent font-medium")
  })

  it("inactif ailleurs", () => {
    h.modules = ["library"]
    render(<QuickNav pathname="/bases" user={null} />)
    expect(screen.getByRole("link", { name: "Médiathèque" }).className).not.toContain("font-medium")
  })

  it("absent quand le module library n'est pas actif", () => {
    h.modules = ["tasks"]
    render(<QuickNav pathname="/" user={null} />)
    expect(screen.queryByRole("link", { name: "Médiathèque" })).toBeNull()
  })

  it("clé shell.quickNav.library présente dans les 7 locales", () => {
    const files = readdirSync("messages").filter((f) => f.endsWith(".json"))
    expect(files.length).toBeGreaterThanOrEqual(7)
    for (const f of files) {
      const m = JSON.parse(readFileSync(`messages/${f}`, "utf8"))
      expect(typeof m.shell?.quickNav?.library, f).toBe("string")
    }
  })
})
