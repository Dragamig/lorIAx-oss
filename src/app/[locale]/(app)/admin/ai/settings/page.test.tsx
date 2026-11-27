// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const toastApi = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastApi }));
vi.mock("next-auth/react", () => ({
  useSession: () => ({ data: { user: { globalRole: "admin" } }, status: "authenticated" }),
}));
vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/components/admin/module-activation-notice", () => ({ ModuleActivationNotice: () => null }));

import { NextIntlClientProvider } from "next-intl";
import fr from "../../../../../../../messages/fr.json";
import { ALL_ON_CHAT_ACTIONS } from "@/lib/ai/chat-actions-settings";
import AdminAISettingsPage from "./page";

type Calls = { url: string; method: string; body?: unknown }[];
const h = { calls: [] as Calls, chatGet: () => Promise.resolve(new Response(JSON.stringify(ALL_ON_CHAT_ACTIONS))) as Promise<Response> };

beforeEach(() => {
  h.calls = [];
  h.chatGet = () => Promise.resolve(new Response(JSON.stringify(ALL_ON_CHAT_ACTIONS)));
  toastApi.success.mockReset();
  toastApi.error.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      h.calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url === "/api/admin/ai/chat-actions" && method === "GET") return h.chatGet();
      if (url === "/api/admin/ai/chat-actions") return new Response(JSON.stringify({ success: true }));
      if (url === "/api/admin/ai/settings" && method === "PUT") return new Response(JSON.stringify({ success: true }));
      if (url === "/api/admin/ai/settings") return new Response(JSON.stringify({}));
      if (url === "/api/help/enabled") return new Response(JSON.stringify({ aiConfigured: true }));
      return new Response(JSON.stringify([]));
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const saveButton = () => screen.getByRole("button", { name: /Enregistrer/ }) as HTMLButtonElement;
const chatPuts = () => h.calls.filter((c) => c.url === "/api/admin/ai/chat-actions" && c.method === "PUT");

describe("page Réglages IA, actions de l'assistant", () => {
  it("chargement : le réglage lu est affiché, enregistrement désactivé tant que rien n'a changé", async () => {
    render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <AdminAISettingsPage />
      </NextIntlClientProvider>,
    );
    await screen.findByTestId("chat-actions-section");
    expect(screen.getByTestId("chat-actions-master").getAttribute("aria-checked")).toBe("true");
    expect(saveButton().disabled).toBe(true);
  });

  it("modification : enregistrement actif, PUT du réglage sans identifiant d'organisation, toast avec Annuler les actions", async () => {
    render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <AdminAISettingsPage />
      </NextIntlClientProvider>,
    );
    await screen.findByTestId("chat-actions-section");
    fireEvent.click(screen.getByTestId("chat-actions-proposeDeletes"));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(chatPuts()).toHaveLength(1));
    expect(chatPuts()[0].body).toEqual({ ...ALL_ON_CHAT_ACTIONS, proposeDeletes: false });
    await waitFor(() =>
      expect(toastApi.success.mock.calls.some(([m, o]) => m === "Réglages IA enregistrés" && o?.action?.label === "Annuler les actions de l'assistant")).toBe(true),
    );
    await waitFor(() => expect(saveButton().disabled).toBe(true));
  });

  it("Annuler après l'enregistrement : le réglage précédent est réécrit et rétabli à l'écran", async () => {
    render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <AdminAISettingsPage />
      </NextIntlClientProvider>,
    );
    await screen.findByTestId("chat-actions-section");
    fireEvent.click(screen.getByTestId("chat-actions-proposeDeletes"));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(toastApi.success.mock.calls.some(([m]) => m === "Réglages IA enregistrés")).toBe(true));
    const [, opts] = toastApi.success.mock.calls.find(([m]) => m === "Réglages IA enregistrés")!;
    await opts.action.onClick();
    await waitFor(() => expect(chatPuts()).toHaveLength(2));
    expect(chatPuts()[1].body).toEqual(ALL_ON_CHAT_ACTIONS);
    await waitFor(() => expect(screen.getByTestId("chat-actions-proposeDeletes").getAttribute("aria-checked")).toBe("true"));
    expect(saveButton().disabled).toBe(true);
  });

  it("sans modification des actions : aucun PUT sur la route des actions", async () => {
    render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <AdminAISettingsPage />
      </NextIntlClientProvider>,
    );
    await screen.findByTestId("chat-actions-section");
    fireEvent.click(screen.getByTestId("chat-actions-master"));
    fireEvent.click(screen.getByTestId("chat-actions-master"));
    expect(saveButton().disabled).toBe(true);
    expect(chatPuts()).toHaveLength(0);
  });

  it("lecture refusée : état d'erreur, rien à éditer, aucun PUT, réessai possible", async () => {
    h.chatGet = () => Promise.resolve(new Response("{}", { status: 404 }));
    render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <AdminAISettingsPage />
      </NextIntlClientProvider>,
    );
    await screen.findByTestId("chat-actions-error");
    expect(screen.queryByTestId("chat-actions-master")).toBeNull();
    expect(saveButton().disabled).toBe(true);
    expect(chatPuts()).toHaveLength(0);

    h.chatGet = () => Promise.resolve(new Response(JSON.stringify({ ...ALL_ON_CHAT_ACTIONS, proposeMerges: false })));
    fireEvent.click(screen.getByRole("button", { name: "Réessayer le chargement" }));
    await screen.findByTestId("chat-actions-section");
    expect(screen.getByTestId("chat-actions-proposeMerges").getAttribute("aria-checked")).toBe("false");
    expect(saveButton().disabled).toBe(true);
  });

  it("échec de l'écriture des actions : erreur annoncée, enregistrement reste possible", async () => {
    render(
      <NextIntlClientProvider locale="fr" messages={fr}>
        <AdminAISettingsPage />
      </NextIntlClientProvider>,
    );
    await screen.findByTestId("chat-actions-section");
    (fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/admin/ai/chat-actions" && init?.method === "PUT") return new Response(JSON.stringify({ error: "Corps invalide" }), { status: 400 });
      return new Response(JSON.stringify({ success: true }));
    });
    fireEvent.click(screen.getByTestId("chat-actions-proposeCreates"));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
    fireEvent.click(saveButton());
    await waitFor(() => expect(toastApi.error).toHaveBeenCalledWith("Corps invalide"));
    await waitFor(() => expect(saveButton().disabled).toBe(false));
  });
});
