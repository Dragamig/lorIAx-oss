// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen, waitFor } from "@testing-library/react"
import { SWRConfig } from "swr"
import { mediaIdFromUrl, useMediaPresence } from "./use-media-presence"

const ID = "0b1c2d3e-0000-4000-8000-000000000000"

function Probe({ id }: { id: string | null }) {
  const { missing } = useMediaPresence(id)
  return <span data-testid="p">{missing ? "missing" : "ok"}</span>
}

function mount(id: string | null) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 2000 }}>
      <Probe id={id} />
      <Probe id={id} />
    </SWRConfig>,
  )
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe("mediaIdFromUrl", () => {
  it("ne retient que /api/media/<uuid>", () => {
    expect(mediaIdFromUrl(`/api/media/${ID}`)).toBe(ID)
    expect(mediaIdFromUrl(`/api/media/${ID}/meta`)).toBeNull()
    expect(mediaIdFromUrl("https://x/y.png")).toBeNull()
    expect(mediaIdFromUrl("data:image/png;base64,AA")).toBeNull()
    expect(mediaIdFromUrl(null)).toBeNull()
  })
})

describe("useMediaPresence", () => {
  it("deletedAt non nul : manquant, une seule requête pour deux consommateurs", async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ media: { deletedAt: "2026-01-01" } }), { status: 200 }))
    vi.stubGlobal("fetch", f)
    mount(ID)
    await waitFor(() => expect(screen.getAllByTestId("p")[0].textContent).toBe("missing"))
    expect(f).toHaveBeenCalledTimes(1)
  })

  it.each([404, 403])("statut %s : manquant", async (status) => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status })))
    mount(ID)
    await waitFor(() => expect(screen.getAllByTestId("p")[0].textContent).toBe("missing"))
  })

  it("média présent ou erreur réseau : pas manquant", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ media: { deletedAt: null } }), { status: 200 })))
    mount(ID)
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.getAllByTestId("p")[0].textContent).toBe("ok")
  })

  it("sans id : aucune requête", async () => {
    const f = vi.fn()
    vi.stubGlobal("fetch", f)
    mount(null)
    await new Promise((r) => setTimeout(r, 20))
    expect(f).not.toHaveBeenCalled()
  })
})
