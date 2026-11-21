// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { intlMock } from "./test-fixtures"
import { LibraryLayout } from "./library-page"

const toastError = vi.hoisted(() => vi.fn())
vi.mock("sonner", () => ({ toast: { error: toastError } }))
vi.mock("next-intl", () => intlMock())
vi.mock("@/i18n/routing", () => ({ Link: ({ href, children, ...r }: { href: string; children: React.ReactNode }) => <a href={href} {...r}>{children}</a> }))
vi.mock("./use-library-filters", () => ({ useLibraryFilters: () => ({}) }))
afterEach(cleanup)

const file = new File(["a"], "a.png", { type: "image/png" })
const dt = { types: ["Files"], files: [file] }

describe("LibraryLayout dépôt", () => {
  it("surcouche avec le dossier courant, puis remise des fichiers", () => {
    const onDrop = vi.fn()
    render(<LibraryLayout onFilesDropped={onDrop} dropFolderLabel="Direction" />)
    const center = screen.getByTestId("library-center")
    fireEvent.dragOver(center, { dataTransfer: dt })
    expect(screen.getByTestId("drop-overlay").textContent).toContain("Direction")
    fireEvent.drop(center, { dataTransfer: dt })
    expect(onDrop).toHaveBeenCalledWith([file])
    expect(screen.queryByTestId("drop-overlay")).toBeNull()
  })

  it("quota atteint : le dépôt est ignoré", () => {
    const onDrop = vi.fn()
    render(<LibraryLayout onFilesDropped={onDrop} dropDisabledReason="plein" />)
    const center = screen.getByTestId("library-center")
    fireEvent.dragOver(center, { dataTransfer: dt })
    expect(screen.queryByTestId("drop-overlay")).toBeNull()
    fireEvent.drop(center, { dataTransfer: dt })
    expect(onDrop).not.toHaveBeenCalled()
    expect(toastError).toHaveBeenCalledWith("plein")
  })
})

vi.mock("./use-library-deeplink", () => ({ useLibraryDeeplink: () => {} }))
