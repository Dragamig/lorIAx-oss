// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor, fireEvent } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
let mockRole = "super_admin";
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { globalRole: mockRole } }, status: "authenticated" }),
}));

import AdminAIProvidersPage from "@/app/[locale]/(app)/admin/ai/providers/page";

const json = (b: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json" } }));

const provider = { id: "p1", name: "p", displayName: "Prov", connectorType: "openai_compatible", apiBaseUrl: null, defaultModel: null, isEnabled: true, isDefault: true, pricing: null, icon: null, color: null, config: null, createdAt: "" };
const row = (usageType: string, model: string) => ({ id: usageType, usageType, providerId: "p1", model, fallbackProviderId: null, fallbackModel: null, timeoutSeconds: 30, maxRetries: 1, isEnabled: true });

const fetchMock = vi.fn();
let assignmentFetches = 0;
let releasePut: () => void = () => {};

beforeEach(() => {
  mockRole = "super_admin";
  assignmentFetches = 0;
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (url === "/api/admin/ai/assignments" && init?.method === "PUT") {
      return new Promise((resolve) => {
        releasePut = () => resolve(new Response("{}", { status: 200 }));
      });
    }
    if (url === "/api/admin/ai/assignments") {
      assignmentFetches++;
      return json([row("chat", "m-chat"), row("help", "m-help")]);
    }
    if (url === "/api/admin/ai/providers/test") return json({ success: true, latency: 12, response: "ok" });
    if (url === "/api/admin/ai/providers") return json([provider]);
    return json({});
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => cleanup());

describe("assignations : brouillons", () => {
  it("modifier B pendant l'enregistrement de A conserve la saisie de B", async () => {
    render(<AdminAIProvidersPage />);
    await screen.findByText("Assignation modèle par usage");
    const a = (await screen.findByDisplayValue("m-chat")) as HTMLInputElement;
    const b = (await screen.findByDisplayValue("m-help")) as HTMLInputElement;

    fireEvent.change(a, { target: { value: "m-chat-2" } });
    fireEvent.click(screen.getByRole("button", { name: /^Enregistrer$/ }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.filter((c) => c[1]?.method === "PUT")).toHaveLength(1)
    );
    fireEvent.change(b, { target: { value: "m-help-brouillon" } });
    releasePut();

    await waitFor(() => expect(screen.getByText(/1 modification non enregistrée/)).toBeTruthy());
    expect(screen.getByDisplayValue("m-help-brouillon")).toBeTruthy();
    expect(screen.getByDisplayValue("m-chat-2")).toBeTruthy();
    expect(assignmentFetches).toBe(1);
  });
  it("affiche le badge Modifié sur une ligne modifiée", async () => {
    render(<AdminAIProvidersPage />);
    const a = await screen.findByDisplayValue("m-chat");
    expect(screen.queryByText("Modifié")).toBeNull();
    fireEvent.change(a, { target: { value: "autre" } });
    expect(screen.getByText("Modifié")).toBeTruthy();
  });

  it("l'annulation de ligne restaure la valeur d'origine", async () => {
    render(<AdminAIProvidersPage />);
    const a = await screen.findByDisplayValue("m-chat");
    fireEvent.change(a, { target: { value: "autre" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Annuler les modifications de cette ligne" })[0]);
    expect(screen.getByDisplayValue("m-chat")).toBeTruthy();
    expect(screen.queryByText("Modifié")).toBeNull();
  });

  it("Tester envoie providerId et model du brouillon", async () => {
    render(<AdminAIProvidersPage />);
    const a = await screen.findByDisplayValue("m-chat");
    fireEvent.change(a, { target: { value: "brouillon" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Tester ce modèle" })[0]);
    await waitFor(() => {
      const call = fetchMock.mock.calls.find((c) => c[0] === "/api/admin/ai/providers/test");
      expect(call).toBeTruthy();
      expect(JSON.parse(call![1].body)).toEqual({ providerId: "p1", model: "brouillon" });
    });
  });

  it("Tester est désactivé sans modèle", async () => {
    render(<AdminAIProvidersPage />);
    const a = await screen.findByDisplayValue("m-chat");
    fireEvent.change(a, { target: { value: "" } });
    const btn = screen.getAllByRole("button", { name: "Tester ce modèle" })[0] as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
