// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const toastApi = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastApi }));

import { NextIntlClientProvider } from "next-intl";
import fr from "../../../../../../../messages/fr.json";
import { toDraft } from "@/lib/ai/assignment-drafts";
import { CreationUsageFallback } from "./creation-usage-fallback";

const draft = toDraft({ providerId: "p1", model: "m1" });
const fetchMock = vi.fn();

beforeEach(() => {
  toastApi.success.mockReset();
  toastApi.error.mockReset();
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("repli de l'usage Création sur le Chat", () => {
  it("explique le repli", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <CreationUsageFallback assigned={draft} onRemoved={vi.fn()} onRestored={vi.fn()} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId("creation-fallback-note").textContent).toMatch(/modèle du Chat/);
  });

  it("sans assignation : bouton désactivé avec motif", () => {
    render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <CreationUsageFallback assigned={undefined} onRemoved={vi.fn()} onRestored={vi.fn()} />
      </NextIntlClientProvider>,
    );
    const b = screen.getByRole("button", { name: "Utiliser le modèle du Chat" }) as HTMLButtonElement;
    expect(b.disabled).toBe(true);
    fireEvent.mouseEnter(b.parentElement as HTMLElement);
    expect(screen.getByRole("tooltip").textContent).toMatch(/déjà/);
  });

  it("retirer l'assignation supprime côté serveur et propose Annuler qui la rétablit", async () => {
    const onRemoved = vi.fn();
    const onRestored = vi.fn();
    render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <CreationUsageFallback assigned={draft} onRemoved={onRemoved} onRestored={onRestored} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Utiliser le modèle du Chat" }));
    await waitFor(() => expect(onRemoved).toHaveBeenCalled());
    expect(fetchMock.mock.calls[0][0]).toBe("/api/admin/ai/assignments?usageType=creation");
    expect(fetchMock.mock.calls[0][1].method).toBe("DELETE");
    const action = toastApi.success.mock.calls[0][1].action;
    expect(action.label).toBe("Annuler");
    await action.onClick();
    expect(fetchMock.mock.calls[1][1].method).toBe("PUT");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ usageType: "creation", providerId: "p1", model: "m1" });
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(draft));
  });

  it("échec serveur : toast d'erreur, rien n'est retiré", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const onRemoved = vi.fn();
    render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <CreationUsageFallback assigned={draft} onRemoved={onRemoved} onRestored={vi.fn()} />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Utiliser le modèle du Chat" }));
    await waitFor(() => expect(toastApi.error).toHaveBeenCalled());
    expect(onRemoved).not.toHaveBeenCalled();
  });
});
