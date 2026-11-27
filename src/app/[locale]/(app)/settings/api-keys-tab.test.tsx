// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import fr from "../../../../../messages/fr.json";
import { API_KEY_SCOPES } from "@/lib/auth/api-key";
import { ApiKeysTab } from "./api-keys-tab";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/db", () => ({ db: {} }));

const KEY = {
  id: "k1",
  name: "Agenda Thunderbird",
  keyPrefix: "lrx_abcd1234",
  scopes: ["calendars:read"],
  lastUsedAt: null,
  revokedAt: null,
  expiresAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") return new Response("{}", { status: 200 });
    return new Response(JSON.stringify([KEY]), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderTab() {
  return render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <ApiKeysTab />
    </NextIntlClientProvider>
  );
}

describe("ApiKeysTab", () => {
  it("api_keys_form_offers_every_server_scope_including_calendar", async () => {
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: /Nouvelle clé/ }));
    expect(screen.getByLabelText("Calendrier (lecture)")).toBeTruthy();
    expect(screen.getByLabelText("Calendrier (écriture)")).toBeTruthy();
    expect(screen.getAllByRole("checkbox")).toHaveLength(API_KEY_SCOPES.length);
  });

  it("api_keys_revoke_asks_confirmation_before_delete", async () => {
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: /Révoquer/ }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);
    expect(screen.getByText("Révoquer la clé « Agenda Thunderbird » ?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "DELETE")).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /Révoquer/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Révoquer la clé" }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/user/api-keys?id=k1", { method: "DELETE" })
    );
  });
});
