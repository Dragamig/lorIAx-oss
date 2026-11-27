// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { globalRole: "super_admin" } }, status: "authenticated" }),
}));

import AdminAIProvidersPage from "@/app/[locale]/(app)/admin/ai/providers/page";

const json = (b: unknown) =>
  Promise.resolve(new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } }));
const provider = { id: "p1", name: "p", displayName: "Prov", connectorType: "openai_compatible", apiBaseUrl: null, defaultModel: null, isEnabled: true, isDefault: true, pricing: null, icon: null, color: null, config: null, createdAt: "" };
const row = { id: "e", usageType: "embeddings", providerId: "p1", model: "text-embedding-3-small", fallbackProviderId: null, fallbackModel: null, timeoutSeconds: 30, maxRetries: 1, isEnabled: true };
const idle = { running: false, phase: "idle", total: 0, done: 0, startedAt: null, finishedAt: null };

let reindex: unknown;
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url === "/api/admin/ai/embeddings/reindex") return json(reindex);
    if (url === "/api/admin/ai/assignments") return json([row]);
    if (url === "/api/admin/ai/providers") return json([provider]);
    return json({});
  }));
});
afterEach(() => cleanup());

describe("panneau embeddings", () => {
  it("modèle assigné différent de l'index : deux lignes et alerte", async () => {
    reindex = { ...idle, current: { providerId: "p1", model: "mistral-embed", dimensions: 1024 } };
    render(<AdminAIProvidersPage />);
    const box = await screen.findByTestId("embedding-models");
    await screen.findByText(/Index actuel/);
    expect(box.textContent).toContain("Modèle assigné : text-embedding-3-small (Prov), 1536 dimensions");
    expect(box.textContent).toContain("mistral-embed (Prov), 1024 dimensions");
    expect(screen.getByRole("alert").textContent).toContain("Réindexation nécessaire pour appliquer le nouveau modèle");
  });
  it("identique : ligne Modèle actif, sans alerte", async () => {
    reindex = { ...idle, current: { providerId: "p1", model: "text-embedding-3-small", dimensions: 1536 } };
    render(<AdminAIProvidersPage />);
    await screen.findByText(/Modèle actif/);
    expect(screen.getByTestId("embedding-models").textContent).toContain("(Prov), 1536 dimensions");
    expect(screen.queryByRole("alert")).toBeNull();
  });
  it("aucun index", async () => {
    reindex = { ...idle, current: null };
    render(<AdminAIProvidersPage />);
    await screen.findByText("Aucun index");
  });
});
