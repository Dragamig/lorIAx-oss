// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react"
import { useState } from "react"
import { makeItems } from "./test-fixtures"

vi.mock("next-intl", async () => (await import("./test-fixtures")).intlMock())
vi.mock("@/i18n/routing", () => ({ Link: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }))

import { PreviewDialog } from "./preview-dialog"

afterEach(cleanup)

function Harness({ items, start = 0, onClose = vi.fn() }: { items: ReturnType<typeof makeItems>; start?: number; onClose?: () => void }) {
  const [index, setIndex] = useState<number | null>(start)
  return (
    <>
      {items.map((i) => (
        <div key={i.id} data-media-id={i.id} tabIndex={0}>
          tuile {i.id}
        </div>
      ))}
      <PreviewDialog
        items={items}
        index={index}
        onIndexChange={setIndex}
        onClose={() => {
          onClose()
          setIndex(null)
        }}
      />
    </>
  )
}

describe("PreviewDialog", () => {
  it("flèche droite avance et s'arrête à la fin, flèche gauche recule", () => {
    render(<Harness items={makeItems(3)} />)
    expect(screen.getByText("1 sur 3")).toBeTruthy()
    const dlg = screen.getByRole("dialog")
    fireEvent.keyDown(dlg, { key: "ArrowRight" })
    expect(screen.getByText("2 sur 3")).toBeTruthy()
    fireEvent.keyDown(dlg, { key: "ArrowRight" })
    fireEvent.keyDown(dlg, { key: "ArrowRight" })
    expect(screen.getByText("3 sur 3")).toBeTruthy()
    fireEvent.keyDown(dlg, { key: "ArrowLeft" })
    expect(screen.getByText("2 sur 3")).toBeTruthy()
  })

  it("boutons précédent et suivant désactivés aux extrémités avec raison", () => {
    render(<Harness items={makeItems(2)} />)
    expect((screen.getByRole("button", { name: "Précédent" }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "Suivant" }))
    expect((screen.getByRole("button", { name: "Suivant" }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("Échap ferme et rend le focus à la tuile d'origine", async () => {
    const onClose = vi.fn()
    render(<Harness items={makeItems(3)} start={1} onClose={onClose} />)
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('[data-media-id="m1"]')))
  })

  it("image : balise img sur l'URL du média", () => {
    render(<Harness items={makeItems(1)} />)
    expect(document.querySelector("img")?.getAttribute("src")).toBe("/api/media/m0")
  })

  it("PDF : iframe sur /api/media/<id>", () => {
    const items = makeItems(1).map((i) => ({ ...i, kind: "pdf" as const, mimeType: "application/pdf", filename: "a.pdf" }))
    render(<Harness items={items} />)
    const frame = document.querySelector("iframe")!
    expect(frame.getAttribute("src")).toBe("/api/media/m0")
  })

  it("vidéo et audio : balises natives", () => {
    const v = makeItems(1).map((i) => ({ ...i, kind: "video" as const, mimeType: "video/mp4" }))
    render(<Harness items={v} />)
    expect(document.querySelector("video")?.getAttribute("src")).toBe("/api/media/m0")
    cleanup()
    const a = makeItems(1).map((i) => ({ ...i, kind: "audio" as const, mimeType: "audio/mpeg" }))
    render(<Harness items={a} />)
    expect(document.querySelector("audio")?.getAttribute("src")).toBe("/api/media/m0")
  })

  it("zip : carte de téléchargement, aucun iframe ni img", () => {
    const items = makeItems(1).map((i) => ({ ...i, kind: "other" as const, mimeType: "application/zip", filename: "a.zip" }))
    render(<Harness items={items} />)
    expect(screen.getByText("Aucun aperçu pour ce type de fichier")).toBeTruthy()
    expect(document.querySelector("iframe")).toBeNull()
    expect(screen.getByRole("link", { name: "Télécharger" }).getAttribute("href")).toBe("/api/media/m0")
  })

  it("rien n'est rendu quand l'index est nul", () => {
    render(<Harness items={makeItems(2)} start={null as unknown as number} />)
    expect(screen.queryByRole("dialog")).toBeNull()
  })
})

describe("PreviewDialog : flèches sur un lecteur", () => {
  it("ne change pas de média quand la cible est une vidéo ou un audio", () => {
    const items = makeItems(3).map((i, k) => (k === 0 ? { ...i, kind: "video" as const, mimeType: "video/mp4", filename: "v.mp4" } : i))
    render(<Harness items={items} />)
    const video = document.querySelector("video")!
    fireEvent.keyDown(video, { key: "ArrowRight" })
    expect(screen.getByText("1 sur 3")).toBeTruthy()
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" })
    expect(screen.getByText("2 sur 3")).toBeTruthy()
  })
})
