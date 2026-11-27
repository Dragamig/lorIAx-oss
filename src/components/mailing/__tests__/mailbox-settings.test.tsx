// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Toaster } from "sonner";
import { renderWithIntl } from "@/__tests__/components/support/render-intl";
import { MailboxSettings } from "../mailbox-settings";

const MASK = "••••••••";
const account = {
  id: "a1",
  organizationId: "o1",
  userId: "u1",
  address: "alice@example.com",
  displayName: "Alice",
  smtpHost: "mail.infomaniak.com",
  smtpPort: 465,
  smtpSecurity: "ssl",
  imapHost: "mail.infomaniak.com",
  imapPort: 993,
  imapSecurity: "ssl",
  signature: "Alice",
  cancelDelaySeconds: 10,
  pollIntervalMinutes: 5,
  lastPollAt: null,
  status: "ok",
  statusMessage: null,
  createdAt: "2026-11-18T10:00:00.000Z",
  updatedAt: "2026-11-18T10:00:00.000Z",
  hasPassword: true,
  password: MASK,
};

type Handler = (url: string, init?: RequestInit) => Response | Promise<Response>;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
let calls: { url: string; init?: RequestInit }[] = [];

function mockFetch(handler: Handler) {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      return handler(url, init);
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const withAccount = () =>
  mockFetch((url, init) => {
    if (url === "/api/mail/account" && (!init || !init.method || init.method === "GET")) return json({ account });
    if (url === "/api/mail/account" && init?.method === "PUT") return json({ account });
    return json({ error: "x" }, 500);
  });

describe("MailboxSettings", () => {
  it("shows the loading skeleton then the form", async () => {
    withAccount();
    renderWithIntl(<MailboxSettings />);
    expect(screen.getByRole("status", { name: "Chargement de la boîte mail" })).toBeTruthy();
    expect(await screen.findByLabelText("Adresse mail")).toBeTruthy();
    expect((screen.getByLabelText("Adresse mail") as HTMLInputElement).value).toBe("alice@example.com");
  });

  it("shows the error state with a Réessayer button when GET fails", async () => {
    mockFetch(() => json({ error: "boom" }, 500));
    renderWithIntl(<MailboxSettings />);
    expect(await screen.findByRole("alert")).toBeTruthy();
    mockFetch(() => json({ account: null }));
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByLabelText("Adresse mail")).toBeTruthy();
  });

  it("choosing Infomaniak prefills hosts and ports", async () => {
    mockFetch(() => json({ account: null }));
    renderWithIntl(<MailboxSettings />);
    await screen.findByLabelText("Adresse mail");
    expect(screen.getByText("Aucune boîte mail connectée. L'envoi et la relève sont désactivés.")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Fournisseur Infomaniak" }));
    expect((screen.getByLabelText("Serveur SMTP (envoi)") as HTMLInputElement).value).toBe("mail.infomaniak.com");
    expect((screen.getByLabelText("Serveur IMAP (réception)") as HTMLInputElement).value).toBe("mail.infomaniak.com");
    const ports = screen.getAllByLabelText("Port") as HTMLInputElement[];
    expect(ports.map((p) => p.value)).toEqual(["465", "993"]);
  });

  it("with a stored password the eye is disabled and explains why", async () => {
    withAccount();
    renderWithIntl(<MailboxSettings />);
    const pw = (await screen.findByLabelText("Mot de passe")) as HTMLInputElement;
    expect(pw.type).toBe("password");
    const toggle = screen.getByRole("button", { name: "Afficher le mot de passe" });
    expect(toggle.getAttribute("aria-disabled")).toBe("true");
    fireEvent.focus(toggle);
    await waitFor(() => expect(document.body.textContent).toContain("Le mot de passe enregistré n'est jamais réaffiché"));
    fireEvent.click(toggle);
    expect(pw.type).toBe("password");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("once the user types a password the eye toggles password and text", async () => {
    withAccount();
    renderWithIntl(<MailboxSettings />);
    const pw = (await screen.findByLabelText("Mot de passe")) as HTMLInputElement;
    fireEvent.change(pw, { target: { value: "secret1" } });
    const toggle = screen.getByRole("button", { name: "Afficher le mot de passe" });
    expect(toggle.getAttribute("aria-disabled")).toBeNull();
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(pw.type).toBe("text");
    expect(pw.value).toBe("secret1");
    const hide = screen.getByRole("button", { name: "Masquer le mot de passe" });
    expect(hide.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(hide);
    expect(pw.type).toBe("password");
  });

  it("hides the poll selector and the poll panel until L3, keeping the stored interval", async () => {
    withAccount();
    renderWithIntl(<MailboxSettings />);
    await screen.findByLabelText("Adresse mail");
    expect(screen.queryByLabelText("Fréquence de relève")).toBeNull();
    expect(screen.queryByText("Dernière relève")).toBeNull();
    expect(screen.queryByText("Relève")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PUT")).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.init?.method === "PUT")!.init?.body)).pollIntervalMinutes).toBe(5);
  });

  it("submitting with the masked password sends no new password", async () => {
    withAccount();
    renderWithIntl(<MailboxSettings />);
    await screen.findByLabelText("Adresse mail");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PUT")).toBe(true));
    const put = calls.find((c) => c.init?.method === "PUT")!;
    const body = JSON.parse(String(put.init?.body));
    expect(body.password == null || body.password === "").toBe(true);
    expect(JSON.stringify(body)).not.toContain(MASK);
    expect(body.smtpHost).toBe("mail.infomaniak.com");
  });

  it("a typed password is sent", async () => {
    withAccount();
    renderWithIntl(<MailboxSettings />);
    const pw = await screen.findByLabelText("Mot de passe");
    fireEvent.change(pw, { target: { value: "nouveau-secret" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    await waitFor(() => expect(calls.some((c) => c.init?.method === "PUT")).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.init?.method === "PUT")!.init?.body)).password).toBe("nouveau-secret");
  });

  it("Tester la connexion shows the SMTP and IMAP results and an alert role on failure", async () => {
    let result: unknown = {
      smtp: { ok: true, message: "authentification acceptée" },
      imap: { ok: true, message: "connecté", inboxCount: 12 },
    };
    mockFetch((url) => {
      if (url === "/api/mail/account/test") return json(result);
      return json({ account });
    });
    renderWithIntl(<MailboxSettings />);
    await screen.findByLabelText("Adresse mail");
    fireEvent.click(screen.getByRole("button", { name: "Tester la connexion" }));
    expect(await screen.findByText("Connexion réussie")).toBeTruthy();
    expect(screen.getByText(/SMTP mail\.infomaniak\.com:465/)).toBeTruthy();
    expect(screen.getByText(/IMAP mail\.infomaniak\.com:993/)).toBeTruthy();
    expect(screen.getByText(/12 messages/)).toBeTruthy();
    const testCall = calls.find((c) => c.url === "/api/mail/account/test")!;
    expect(JSON.stringify(JSON.parse(String(testCall.init?.body)))).not.toContain(MASK);

    result = {
      smtp: { ok: false, message: "authentification refusée" },
      imap: { ok: false, message: "non testé" },
    };
    fireEvent.click(screen.getByRole("button", { name: "Tester la connexion" }));
    const alert = await screen.findByText("Connexion impossible");
    expect(alert.closest('[role="alert"]')).not.toBeNull();
  });

  it("test errors are announced (rate limit)", async () => {
    mockFetch((url) =>
      url === "/api/mail/account/test" ? json({ error: "x", code: "rate_limited" }, 429) : json({ account }),
    );
    renderWithIntl(<MailboxSettings />);
    await screen.findByLabelText("Adresse mail");
    fireEvent.click(screen.getByRole("button", { name: "Tester la connexion" }));
    const msg = await screen.findAllByText("Trop de tests, réessayez plus tard.");
    expect(msg.some((m) => m.closest('[role="alert"]'))).toBe(true);
  });

  it("save rate limit shows a dedicated message, not the generic failure", async () => {
    mockFetch((url, init) =>
      init?.method === "PUT" ? json({ error: "x", code: "rate_limited" }, 429) : json({ account }),
    );
    renderWithIntl(<><Toaster /><MailboxSettings /></>);
    const host = await screen.findByLabelText("Serveur SMTP (envoi)");
    fireEvent.change(host, { target: { value: "autre.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    expect(await screen.findByText("Trop de tentatives d'enregistrement : rien n'a été modifié, réessayez plus tard.")).toBeTruthy();
  });

  it("asks to retype the password and focuses the field on password_required", async () => {
    mockFetch((url, init) => {
      if (init?.method === "PUT") return json({ error: "password_required", code: "password_required" }, 400);
      return json({ account });
    });
    renderWithIntl(<MailboxSettings />);
    const host = await screen.findByLabelText("Serveur SMTP (envoi)");
    fireEvent.change(host, { target: { value: "autre.example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    const alerts = await screen.findAllByText("L'adresse ou un serveur a changé : saisissez à nouveau le mot de passe.");
    expect(alerts.some((a) => a.getAttribute("role") === "alert")).toBe(true);
    expect(document.activeElement?.id).toBe("mail-password");
  });

  it("Enregistrer emits a toast announced in an aria-live region", async () => {
    withAccount();
    renderWithIntl(
      <>
        <Toaster />
        <MailboxSettings />
      </>,
    );
    await screen.findByLabelText("Adresse mail");
    fireEvent.click(screen.getByRole("button", { name: "Enregistrer" }));
    const toastText = (await screen.findAllByText("Boîte mail enregistrée"))[0];
    expect(toastText.closest('[aria-live="polite"], [role="status"]')).not.toBeNull();
  });

  it("cancel delay select offers exactly 0, 5, 10, 20, 30", async () => {
    withAccount();
    renderWithIntl(<MailboxSettings />);
    const select = (await screen.findByLabelText("Délai d'annulation de l'envoi")) as HTMLSelectElement;
    expect([...select.options].map((o) => o.value)).toEqual(["0", "5", "10", "20", "30"]);
    expect(select.value).toBe("10");
  });

  it("has no Relever maintenant button", async () => {
    withAccount();
    renderWithIntl(<MailboxSettings />);
    await screen.findByLabelText("Adresse mail");
    expect(screen.queryByRole("button", { name: "Relever maintenant" })).toBeNull();
  });

  it("every button has an aria-label", async () => {
    withAccount();
    renderWithIntl(<MailboxSettings />);
    await screen.findByLabelText("Adresse mail");
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(3);
    for (const b of buttons) expect(b.getAttribute("aria-label"), b.outerHTML).toBeTruthy();
  });

  it("shows the verified status", async () => {
    withAccount();
    renderWithIntl(<MailboxSettings />);
    expect(await screen.findByText("Boîte vérifiée")).toBeTruthy();
  });

  it("shows the unverified status with the action to take", async () => {
    mockFetch(() => json({ account: { ...account, status: "unverified" } }));
    renderWithIntl(<MailboxSettings />);
    expect(await screen.findByText(/Boîte non vérifiée/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tester la connexion" })).toBeTruthy();
  });

  it("shows the last test failure reason", async () => {
    mockFetch(() => json({ account: { ...account, status: "error", statusMessage: "smtp: authentification refusée" } }));
    renderWithIntl(<MailboxSettings />);
    const node = await screen.findByText(/Dernier test en échec : smtp: authentification refusée/);
    expect(node).toBeTruthy();
  });

  it("refreshes the status after a connection test", async () => {
    let current = { ...account, status: "unverified" };
    mockFetch((url) => {
      if (url === "/api/mail/account/test") {
        current = { ...account, status: "ok" };
        return json({ smtp: { ok: true, message: "ok" }, imap: { ok: true, message: "ok", inboxCount: 1 } });
      }
      return json({ account: current });
    });
    renderWithIntl(<MailboxSettings />);
    await screen.findByText(/Boîte non vérifiée/);
    fireEvent.click(screen.getByRole("button", { name: "Tester la connexion" }));
    expect(await screen.findByText("Boîte vérifiée")).toBeTruthy();
  });
});
