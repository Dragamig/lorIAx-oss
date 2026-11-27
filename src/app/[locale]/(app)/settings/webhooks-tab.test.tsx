// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WebhooksTab } from "./webhooks-tab";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const HOOK = {
  id: "w1",
  url: "https://exemple.test/hook",
  events: ["document.created"],
  spaceId: null,
  active: true,
  failureCount: 0,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") return new Response("{}", { status: 200 });
    if (url.startsWith("/api/v1/webhooks")) {
      return new Response(JSON.stringify({ data: [HOOK] }), { status: 200 });
    }
    return new Response(JSON.stringify([]), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const deleteCalls = () => fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE");

describe("WebhooksTab", () => {
  it("webhooks_delete_asks_confirmation_before_delete", async () => {
    render(<WebhooksTab />);
    fireEvent.click(await screen.findByTitle("Supprimer"));
    expect(deleteCalls()).toHaveLength(0);
    expect(screen.getByText("Supprimer ce webhook ?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Annuler" }));
    expect(deleteCalls()).toHaveLength(0);

    fireEvent.click(screen.getByTitle("Supprimer"));
    fireEvent.click(await screen.findByRole("button", { name: "Supprimer le webhook" }));
    await waitFor(() => expect(deleteCalls()).toHaveLength(1));
    expect(deleteCalls()[0][0]).toBe("/api/v1/webhooks/w1");
  });
});
