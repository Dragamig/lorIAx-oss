// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { renderWithIntl } from "@/__tests__/components/support/render-intl";
import { LibraryAdminClient } from "./library-admin-client";

vi.mock("./ai-settings", () => ({ MediaAiSettings: () => null }));

vi.mock("sonner", () => {
  const fn = Object.assign(vi.fn(), { info: vi.fn(), success: vi.fn(), error: vi.fn() });
  return { toast: fn };
});

const DATA = {
  settings: { trashRetentionDays: 30 },
  storage: { usedBytes: 512 * 1024 ** 2, limitBytes: 1024 ** 3, percent: 50 },
  counts: { media: 12, trash: 3, orphan: 2, unused: 5 },
  canEdit: true,
};

const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("LibraryAdminClient", () => {
  it("affiche le chargement puis l'usage et les comptes", async () => {
    fetchMock.mockReturnValueOnce(json(DATA));
    renderWithIntl(<LibraryAdminClient />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(await screen.findByRole("progressbar")).toBeTruthy();
    expect(screen.getByText("12")).toBeTruthy();
  });

  it("lecture en échec : message, aucun champ éditable, nouvel essai possible", async () => {
    fetchMock.mockReturnValueOnce(json({}, 500)).mockReturnValueOnce(json(DATA));
    renderWithIntl(<LibraryAdminClient />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.queryByLabelText(/Délai de purge/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByLabelText(/Délai de purge/)).toBeTruthy();
  });

  it("enregistre, toast avec Annuler qui remet l'ancienne valeur", async () => {
    fetchMock
      .mockReturnValueOnce(json(DATA))
      .mockReturnValueOnce(json({ settings: { trashRetentionDays: 45 } }))
      .mockReturnValueOnce(json({ settings: { trashRetentionDays: 30 } }));
    renderWithIntl(<LibraryAdminClient />);
    const input = (await screen.findByLabelText(/Délai de purge/)) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const [msg, opts] = (toast.success as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(msg).toBe("Délai de purge enregistré");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ trashRetentionDays: 45 });
    opts.action.onClick();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    expect(JSON.parse(fetchMock.mock.calls[2][1].body)).toEqual({ trashRetentionDays: 30 });
    await waitFor(() => expect(input.value).toBe("30"));
  });

  it("écriture refusée : pas de toast de succès", async () => {
    fetchMock.mockReturnValueOnce(json(DATA)).mockReturnValueOnce(json({ error: "x" }, 500));
    renderWithIntl(<LibraryAdminClient />);
    const input = await screen.findByLabelText(/Délai de purge/);
    fireEvent.change(input, { target: { value: "45" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("valeur hors bornes ou inchangée : bouton désactivé", async () => {
    fetchMock.mockReturnValueOnce(json(DATA));
    renderWithIntl(<LibraryAdminClient />);
    const input = await screen.findByLabelText(/Délai de purge/);
    const btn = screen.getByRole("button", { name: "Enregistrer" }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "400" } });
    expect(btn.disabled).toBe(true);
    fireEvent.change(input, { target: { value: "45" } });
    expect(btn.disabled).toBe(false);
  });

  it("sans droit d'écriture : champ en lecture seule avec explication", async () => {
    fetchMock.mockReturnValueOnce(json({ ...DATA, canEdit: false }));
    renderWithIntl(<LibraryAdminClient />);
    const input = (await screen.findByLabelText(/Délai de purge/)) as HTMLInputElement;
    expect(input.disabled).toBe(true);
    expect(screen.getAllByText(/super administrateur/).length).toBeGreaterThan(0);
  });
});
