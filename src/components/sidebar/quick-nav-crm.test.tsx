// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"

const h = vi.hoisted(() => ({
  modules: ["crm"] as string[],
  status: { enabled: true, complete: false, canAdmin: true } as unknown,
  keys: [] as (string | null)[],
}))

vi.mock("next-intl", async () => (await import("@/components/media/test-fixtures")).intlMock())
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock("swr", () => ({
  default: (key: string | null) => {
    h.keys.push(key)
    if (key === "/api/modules/active") return { data: { modules: h.modules } }
    if (key === "/api/crm/status") return { data: h.status }
    return { data: { tasks: [] } }
  },
}))

import { QuickNav } from "./quick-nav"

beforeEach(() => {
  h.modules = ["crm"]
  h.status = { enabled: true, complete: false, canAdmin: true }
  h.keys = []
})
afterEach(cleanup)

describe("QuickNav, CRM", () => {
  it("absente quand le module crm n'est pas actif sur l'instance (aucune requête status)", () => {
    h.modules = ["library"]
    render(<QuickNav pathname="/" user={null} />)
    expect(screen.queryByRole("button", { name: /CRM/ })).toBeNull()
    expect(h.keys).not.toContain("/api/crm/status")
  })

  it("absente quand actif sur l'instance mais enabled faux", () => {
    h.status = { enabled: false, complete: false, canAdmin: true }
    render(<QuickNav pathname="/" user={null} />)
    expect(screen.queryByRole("button", { name: /CRM/ })).toBeNull()
  })

  it("présente en bouton dépliable, Raccordement actif sur /crm/raccordement", () => {
    render(<QuickNav pathname="/crm/raccordement" user={null} />)
    const btn = screen.getByRole("button", { name: /CRM/ })
    expect(btn.getAttribute("aria-expanded")).toBe("true")
    const link = screen.getByRole("link", { name: "Raccordement" })
    expect(link.getAttribute("href")).toBe("/crm/raccordement")
    expect(link.getAttribute("aria-current")).toBe("page")
  })

  it("badge Non raccordé quand complete est faux, absent quand vrai", () => {
    render(<QuickNav pathname="/" user={null} />)
    expect(screen.getByRole("img", { name: "CRM non raccordé" })).toBeTruthy()
    cleanup()
    h.status = { enabled: true, complete: true, canAdmin: true }
    render(<QuickNav pathname="/" user={null} />)
    expect(screen.queryByRole("img", { name: "CRM non raccordé" })).toBeNull()
  })

  it("le badge a un nom accessible", () => {
    render(<QuickNav pathname="/" user={null} />)
    expect(screen.getByLabelText("CRM non raccordé")).toBeTruthy()
  })
})
