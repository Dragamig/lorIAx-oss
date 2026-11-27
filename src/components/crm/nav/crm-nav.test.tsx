// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

const h = vi.hoisted(() => ({ count: 0, countCalls: 0 }))

vi.mock("next-intl", async () => (await import("@/components/media/test-fixtures")).intlMock())
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode } & Record<string, unknown>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))
vi.mock("@/lib/crm/use-crm-data", () => ({
  useCrmRelancesCount: () => {
    h.countCalls += 1
    return { data: { count: h.count } }
  },
}))

import { CrmNav, CRM_NAV_STORAGE_KEY } from "./crm-nav"

const full = { enabled: true, complete: true, canAdmin: true }

beforeEach(() => {
  h.count = 0
  h.countCalls = 0
  window.localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe("CrmNav", () => {
  it("replié hors /crm, déplié d'office sous /crm", () => {
    render(<CrmNav pathname="/" status={full} />)
    expect(screen.getByRole("button", { name: /CRM/ }).getAttribute("aria-expanded")).toBe("false")
    cleanup()
    render(<CrmNav pathname="/crm/relances" status={full} />)
    expect(screen.getByRole("button", { name: /CRM/ }).getAttribute("aria-expanded")).toBe("true")
  })

  it("liste les cinq entrées et marque la page courante", () => {
    render(<CrmNav pathname="/crm/relances" status={full} />)
    for (const n of ["Pipeline", "Dossiers", "Contacts", "Raccordement"]) {
      expect(screen.getByRole("link", { name: n })).toBeTruthy()
    }
    const current = screen.getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page")
    expect(current).toHaveLength(1)
    expect(current[0].getAttribute("href")).toBe("/crm/relances")
  })

  it("Pipeline n'est courant que sur /crm exact", () => {
    render(<CrmNav pathname="/crm" status={full} />)
    expect(screen.getByRole("link", { name: "Pipeline" }).getAttribute("aria-current")).toBe("page")
    expect(screen.getByRole("link", { name: "Dossiers" }).getAttribute("aria-current")).toBeNull()
  })

  it("Raccordement absent pour un non-admin", () => {
    render(<CrmNav pathname="/crm" status={{ ...full, canAdmin: false }} />)
    expect(screen.queryByRole("link", { name: "Raccordement" })).toBeNull()
    expect(screen.getByRole("link", { name: "Pipeline" })).toBeTruthy()
  })

  it("badge 3 avec nom accessible, absent à 0, 99+ au-delà de 99", () => {
    h.count = 3
    render(<CrmNav pathname="/crm" status={full} />)
    const link = screen.getByRole("link", { name: "À relancer, 3 relances" })
    expect(link.textContent).toContain("3")
    cleanup()
    h.count = 0
    render(<CrmNav pathname="/crm" status={full} />)
    const plain = screen.getByRole("link", { name: "À relancer" })
    expect(plain.textContent).toBe("À relancer")
    cleanup()
    h.count = 100
    render(<CrmNav pathname="/crm" status={full} />)
    const big = screen.getByRole("link", { name: "À relancer, 100 relances" })
    expect(big.textContent).toContain("99+")
  })

  it("non raccordé : badge ! et Raccordement seul, aucune requête de compteur", () => {
    render(<CrmNav pathname="/crm" status={{ enabled: true, complete: false, canAdmin: true }} />)
    expect(screen.getByRole("img", { name: "CRM non raccordé" })).toBeTruthy()
    expect(screen.getByRole("link", { name: "Raccordement" })).toBeTruthy()
    for (const n of ["Pipeline", "Dossiers", "Contacts", "À relancer"]) {
      expect(screen.queryByRole("link", { name: n })).toBeNull()
    }
    expect(h.countCalls).toBe(0)
  })

  it("non raccordé : le nom accessible du bouton porte le badge", () => {
    render(<CrmNav pathname="/" status={{ enabled: true, complete: false, canAdmin: true }} />)
    const btn = screen.getByRole("button", { name: /CRM non raccordé/ })
    expect(btn.getAttribute("aria-expanded")).toBe("false")
  })

  it("sous /crm, un état mémorisé replié n'ôte pas l'ouverture", () => {
    window.localStorage.setItem(CRM_NAV_STORAGE_KEY, "0")
    render(<CrmNav pathname="/crm" status={full} />)
    expect(screen.getByRole("button", { name: /CRM/ }).getAttribute("aria-expanded")).toBe("true")
  })

  it("non raccordé et non admin : simple lien vers /crm", () => {
    render(<CrmNav pathname="/" status={{ enabled: true, complete: false, canAdmin: false }} />)
    expect(screen.getByRole("link", { name: /CRM/ }).getAttribute("href")).toBe("/crm")
    expect(screen.queryByRole("button")).toBeNull()
  })

  it("clic, Entrée et flèches sur le bouton ; état mémorisé", () => {
    render(<CrmNav pathname="/" status={full} />)
    const btn = screen.getByRole("button", { name: /CRM/ })
    fireEvent.click(btn)
    expect(btn.getAttribute("aria-expanded")).toBe("true")
    expect(window.localStorage.getItem(CRM_NAV_STORAGE_KEY)).toBe("1")
    fireEvent.keyDown(btn, { key: "ArrowLeft" })
    expect(btn.getAttribute("aria-expanded")).toBe("false")
    expect(window.localStorage.getItem(CRM_NAV_STORAGE_KEY)).toBe("0")
    fireEvent.keyDown(btn, { key: "ArrowRight" })
    expect(btn.getAttribute("aria-expanded")).toBe("true")
    expect(btn.getAttribute("aria-controls")).toBeTruthy()
    expect(btn.tagName).toBe("BUTTON")
  })

  it("relit l'état mémorisé", () => {
    window.localStorage.setItem(CRM_NAV_STORAGE_KEY, "1")
    render(<CrmNav pathname="/" status={full} />)
    expect(screen.getByRole("button", { name: /CRM/ }).getAttribute("aria-expanded")).toBe("true")
  })

  it("stockage indisponible : se rend et se déplie sans exception", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied")
    })
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied")
    })
    render(<CrmNav pathname="/" status={full} />)
    const btn = screen.getByRole("button", { name: /CRM/ })
    expect(() => fireEvent.click(btn)).not.toThrow()
    expect(btn.getAttribute("aria-expanded")).toBe("true")
  })
})
