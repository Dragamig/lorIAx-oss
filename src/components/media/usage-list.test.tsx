// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"

vi.mock("next-intl", async () => (await import("./test-fixtures")).intlMock())
vi.mock("@/i18n/routing", () => ({ Link: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }))

import { UsageList } from "./usage-list"

const entry = (i: number) => ({
  targetType: "document",
  targetId: `d${i}`,
  context: null,
  title: `Doc ${i}`,
  href: `/s/x/d${i}`,
  source: "editor",
})
const stub = (body: unknown, status = 200) =>
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("UsageList", () => {
  it("7 emplacements : 5 liens puis « et 2 autres » dépliable", async () => {
    stub({ entries: Array.from({ length: 7 }, (_, i) => entry(i)), hiddenCount: 0 })
    render(<UsageList mediaId="m1" />)
    await screen.findByText("Doc 0")
    expect(screen.getAllByRole("link")).toHaveLength(5)
    fireEvent.click(screen.getByText("et 2 autres"))
    expect(screen.getAllByRole("link")).toHaveLength(7)
  })

  it("emplacements masqués : ligne non cliquable avec le compte", async () => {
    stub({ entries: [entry(0)], hiddenCount: 2 })
    render(<UsageList mediaId="m1" />)
    const hidden = await screen.findByText("2 emplacements auxquels vous n'avez pas accès")
    expect(hidden.closest("a")).toBeNull()
    expect(screen.getAllByRole("link")).toHaveLength(1)
  })

  it("vide et erreur", async () => {
    stub({ entries: [], hiddenCount: 0 })
    render(<UsageList mediaId="m1" />)
    expect(await screen.findByText("Aucun contenu n'utilise ce média.")).toBeTruthy()
    cleanup()
    stub({}, 500)
    render(<UsageList mediaId="m1" />)
    expect(await screen.findByRole("alert")).toBeTruthy()
  })
})
