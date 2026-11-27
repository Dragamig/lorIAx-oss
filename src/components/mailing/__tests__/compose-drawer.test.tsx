// @vitest-environment jsdom
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Toaster, toast } from "sonner";
import { renderWithIntl } from "@/__tests__/components/support/render-intl";
import { ComposeDrawer } from "../compose-drawer";
import { purgeMailDrafts } from "../use-compose-draft";
import type { ComposeOptions, FicheMailContext } from "../use-fiche-mails";

// TipTap is exercised in the browser; here the editor is a plain textarea with the same contract.
vi.mock("../body-editor", () => ({
  BodyEditor: ({ value, onChange, label }: { value: string; onChange: (html: string) => void; label: string }) => (
    <textarea aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const UUID = "123e4567-e89b-42d3-a456-426614174000";
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const baseContext = (over: Partial<FicheMailContext> = {}): FicheMailContext => ({
  viewer: { orgId: "o1", userId: "u1" },
  role: "contacts",
  contact: { rowId: "c1", name: "Claire Martin", email: "claire@orange.fr" },
  dossiers: [],
  defaultDossierRowId: null,
  fixedDossierRowId: null,
  mailbox: { configured: true, address: "alice@example.com", signature: "Alice Martin\nExample Corp", cancelDelaySeconds: 10 },
  quota: { limit: 50, exceeded: false },
  alert: { pending: 0, crmDisconnected: false },
  ...over,
});

const reply = {
  id: "m9",
  messageId: "<abc@orange.fr>",
  direction: "in" as const,
  status: "received" as never,
  from: "claire@orange.fr",
  to: ["alice@example.com"],
  cc: [],
  bcc: [],
  subject: "Devis cuisine",
  bodyHtml: "<p>Bonjour</p>",
  bodyText: "Bonjour",
  attachments: [],
  date: "2026-11-15T09:00:00.000Z",
  scheduledAt: null,
  sentAt: null,
  error: null,
  errorReason: null,
  errorDetail: null,
  traced: true,
};

let posts: { url: string; body: Record<string, unknown> }[] = [];
let sendResponse: () => Response = () => json({ id: "mail-1", scheduledAt: "2026-11-18T10:00:10.000Z", cancelDelaySeconds: 10 }, 201);
let cancelResponse: () => Response = () => json({ id: "mail-1", status: "cancelled" });

function Host({ context = baseContext(), replyTo, resume }: { context?: FicheMailContext; replyTo?: ComposeOptions["replyTo"]; resume?: ComposeOptions["resume"] }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <Toaster />
      <button type="button" aria-label="ouvrir" onClick={() => setOpen(true)} />
      <ComposeDrawer
        open={open}
        onClose={() => setOpen(false)}
        onReopen={() => setOpen(true)}
        onSent={() => {}}
        databaseId="d1"
        rowId="r1"
        context={context}
        replyTo={replyTo}
        resume={resume}
      />
    </>
  );
}

const renderHost = (props: Parameters<typeof Host>[0] = {}) => renderWithIntl(<Host {...props} />);

beforeEach(() => {
  posts = [];
  sendResponse = () => json({ id: "mail-1", scheduledAt: "2026-11-18T10:00:10.000Z", cancelDelaySeconds: 10 }, 201);
  cancelResponse = () => json({ id: "mail-1", status: "cancelled" });
  window.localStorage.clear();
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  vi.stubGlobal("crypto", { ...globalThis.crypto, randomUUID: () => UUID });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith("/api/mail/messages/") && url.endsWith("/cancel")) {
        posts.push({ url, body: {} });
        return cancelResponse();
      }
      if (url === "/api/mail/messages" && init?.method === "POST") {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return sendResponse();
      }
      return json({}, 404);
    }),
  );
});
afterEach(() => {
  cleanup();
  toast.dismiss();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const dialog = () => screen.getByRole("dialog");
const fillSubjectAndBody = () => {
  fireEvent.change(screen.getByLabelText("Objet"), { target: { value: "Devis" } });
  fireEvent.change(screen.getByLabelText("Corps du mail"), { target: { value: "<p>Bonjour Claire</p>" } });
};
const sendBtn = () => screen.getByRole("button", { name: "Envoyer" });

describe("ComposeDrawer", () => {
  it("prefills To with the contact email and the signature", () => {
    renderHost();
    expect(within(dialog()).getByText("claire@orange.fr")).toBeTruthy();
    expect(within(dialog()).getByText("alice@example.com")).toBeTruthy();
    expect(dialog().textContent).toContain("Alice Martin");
  });

  it("leaves To empty when the contact has no email", () => {
    renderHost({ context: baseContext({ contact: { rowId: "c1", name: "Claire", email: null } }) });
    expect(screen.queryByRole("button", { name: /^Retirer/ })).toBeNull();
  });

  it("adds and removes recipient chips and marks an invalid address as bad", () => {
    renderHost({ context: baseContext({ contact: { rowId: "c1", name: "C", email: null } }) });
    const input = screen.getByLabelText("Ajouter un destinataire");
    fireEvent.change(input, { target: { value: "bob@x.fr" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("bob@x.fr")).toBeTruthy();
    fireEvent.change(input, { target: { value: "pas-une-adresse" } });
    fireEvent.keyDown(input, { key: "," });
    const bad = screen.getByText("pas-une-adresse").closest("[data-invalid]");
    expect(bad?.getAttribute("data-invalid")).toBe("true");
    // Visible, announced text so the error does not rely on colour alone.
    expect(screen.getByRole("alert").textContent).toBe("adresse invalide");
    fireEvent.click(screen.getByRole("button", { name: "Retirer bob@x.fr" }));
    expect(screen.queryByText("bob@x.fr")).toBeNull();
  });

  it("Cc and Cci rows toggle with buttons that have tooltips", async () => {
    renderHost();
    const cc = screen.getByRole("button", { name: "Ajouter Cc" });
    expect(screen.queryByLabelText("Ajouter une adresse en copie")).toBeNull();
    fireEvent.focus(cc);
    expect(await screen.findByText("Ajouter des destinataires en copie")).toBeTruthy();
    fireEvent.click(cc);
    expect(screen.getByLabelText("Ajouter une adresse en copie")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Ajouter Cci" }));
    expect(screen.getByLabelText("Ajouter une adresse en copie cachée")).toBeTruthy();
  });

  it("dossier select appears only when the contact has several dossiers and defaults to the most recent", () => {
    const d = (rowId: string, title: string) => ({ rowId, title, updatedAt: "2026-11-01T00:00:00.000Z" });
    const a = "11111111-1111-4111-8111-111111111111";
    const b = "22222222-2222-4222-8222-222222222222";
    const { unmount } = renderHost({ context: baseContext({ dossiers: [d(a, "Cuisine"), d(b, "Salle de bain")], defaultDossierRowId: a }) });
    const select = screen.getByRole("combobox", { name: "Dossier" }) as HTMLSelectElement;
    expect(select.value).toBe(a);
    unmount();
    renderHost({ context: baseContext({ dossiers: [d(a, "Cuisine")], defaultDossierRowId: a }) });
    expect(screen.queryByRole("combobox", { name: "Dossier" })).toBeNull();
  });

  it("dossier is fixed and not selectable on a dossier fiche", async () => {
    const a = "11111111-1111-4111-8111-111111111111";
    renderHost({
      context: baseContext({ role: "dossiers", dossiers: [{ rowId: a, title: "Cuisine Martin", updatedAt: "2026-11-01T00:00:00.000Z" }], fixedDossierRowId: a, defaultDossierRowId: a }),
    });
    expect(screen.queryByRole("combobox", { name: "Dossier" })).toBeNull();
    expect(screen.getByText(/Cuisine Martin/)).toBeTruthy();
  });

  it("Envoyer is disabled with an explaining tooltip while To is empty or subject empty", async () => {
    renderHost({ context: baseContext({ contact: { rowId: "c1", name: "C", email: null } }) });
    expect(sendBtn().getAttribute("aria-disabled")).toBe("true");
    fireEvent.focus(sendBtn());
    expect(await screen.findByText("Ajoutez un destinataire pour envoyer")).toBeTruthy();
    fireEvent.click(sendBtn());
    expect(posts.length).toBe(0);
  });

  it("explains a missing subject", async () => {
    renderHost();
    fireEvent.focus(sendBtn());
    expect(await screen.findByText("Renseignez l'objet pour envoyer")).toBeTruthy();
  });

  it("double click on Envoyer posts once", async () => {
    renderHost();
    fillSubjectAndBody();
    fireEvent.click(sendBtn());
    fireEvent.click(sendBtn());
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0].body).toMatchObject({ clientKey: UUID, databaseId: "d1", rowId: "r1", to: ["claire@orange.fr"], subject: "Devis", bodyHtml: "<p>Bonjour Claire</p>", attachments: [] });
  });

  it("after send, shows a toast \"Mail programmé\" with an Annuler button and role status", async () => {
    renderHost();
    fillSubjectAndBody();
    fireEvent.click(sendBtn());
    expect(await screen.findByText(/Mail programmé/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Annuler l'envoi/ })).toBeTruthy();
    expect(screen.getAllByRole("status").some((n) => /Mail programmé/.test(n.textContent ?? ""))).toBe(true);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("clicking Annuler posts /cancel and restores the draft in the drawer", async () => {
    renderHost();
    fillSubjectAndBody();
    fireEvent.click(sendBtn());
    fireEvent.click(await screen.findByRole("button", { name: /Annuler l'envoi/ }));
    await waitFor(() => expect(posts.some((p) => p.url === "/api/mail/messages/mail-1/cancel")).toBe(true));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeTruthy());
    expect((screen.getByLabelText("Objet") as HTMLInputElement).value).toBe("Devis");
    expect((screen.getByLabelText("Corps du mail") as HTMLTextAreaElement).value).toBe("<p>Bonjour Claire</p>");
  });

  it("with delay 0 the toast has no Annuler", async () => {
    sendResponse = () => json({ id: "mail-1", scheduledAt: "2026-11-18T10:00:00.000Z", cancelDelaySeconds: 0 }, 201);
    renderHost({ context: baseContext({ mailbox: { configured: true, address: "alice@example.com", signature: "", cancelDelaySeconds: 0 } }) });
    fillSubjectAndBody();
    fireEvent.click(sendBtn());
    expect(await screen.findByText("Mail envoyé")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Annuler/ })).toBeNull();
  });

  it("a 429 quota_plan response keeps the drawer open and shows an error toast naming the limit", async () => {
    sendResponse = () => json({ error: "Quota", code: "quota_plan", limit: 50 }, 429);
    renderHost();
    fillSubjectAndBody();
    fireEvent.click(sendBtn());
    expect(await screen.findByText(/50 mails par jour/)).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("a 409 account_unverified explains the mailbox was never verified", async () => {
    sendResponse = () => json({ error: "x", code: "account_unverified" }, 409);
    renderHost();
    fillSubjectAndBody();
    fireEvent.click(sendBtn());
    expect(await screen.findByText(/Boîte mail non vérifiée/)).toBeTruthy();
  });

  it("a 409 account_error shows the reason of the last failed test", async () => {
    sendResponse = () => json({ error: "x", code: "account_error", detail: "smtp: authentification refusée" }, 409);
    renderHost();
    fillSubjectAndBody();
    fireEvent.click(sendBtn());
    expect(await screen.findByText(/Dernier test de la boîte en échec : smtp: authentification refusée/)).toBeTruthy();
  });

  it("a server failure keeps the drawer, shows a persistent toast with Réessayer that reposts with the same key", async () => {
    let n = 0;
    sendResponse = () => (++n === 1 ? json({ error: "x", code: "send_failed" }, 500) : json({ id: "mail-2", scheduledAt: "2026-11-18T10:00:10.000Z", cancelDelaySeconds: 10 }, 201));
    renderHost();
    fillSubjectAndBody();
    fireEvent.click(sendBtn());
    fireEvent.click(await screen.findByRole("button", { name: /Réessayer/ }));
    await waitFor(() => expect(posts.length).toBe(2));
    expect(posts[1].body.clientKey).toBe(posts[0].body.clientKey);
  });

  it("an upload above 20 Mo is refused client side with a message", async () => {
    renderHost();
    const input = screen.getByLabelText("Choisir un fichier à téléverser") as HTMLInputElement;
    const big = new File(["x"], "gros.pdf", { type: "application/pdf" });
    Object.defineProperty(big, "size", { value: 21 * 1024 * 1024 });
    fireEvent.change(input, { target: { files: [big] } });
    expect(await screen.findByText(/dépasse 20 Mo/)).toBeTruthy();
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.some((c) => String(c[0]).includes("attachments"))).toBe(false);
  });

  it("draft survives close and reopen", async () => {
    renderHost();
    fillSubjectAndBody();
    fireEvent.click(screen.getByRole("button", { name: "Fermer" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "ouvrir" }));
    expect((await screen.findByLabelText("Objet") as HTMLInputElement).value).toBe("Devis");
  });

  it("Échap closes with the draft kept", async () => {
    renderHost();
    fillSubjectAndBody();
    fireEvent.keyDown(dialog(), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(window.localStorage.getItem("loriax:mail-draft:o1:u1:d1:r1")).toContain("Devis");
  });

  it("reply prefills To, a single Re: prefix, and sends In-Reply-To", async () => {
    renderHost({ replyTo: { ...reply, subject: "Re: Devis cuisine" } });
    expect((screen.getByLabelText("Objet") as HTMLInputElement).value).toBe("Re: Devis cuisine");
    fireEvent.change(screen.getByLabelText("Corps du mail"), { target: { value: "<p>Merci</p>" } });
    fireEvent.click(sendBtn());
    await waitFor(() => expect(posts.length).toBe(1));
    expect(posts[0].body.inReplyToMessageId).toBe("<abc@orange.fr>");
    expect(posts[0].body.to).toEqual(["claire@orange.fr"]);
  });

  it("no native alert, confirm or prompt is called", async () => {
    const a = vi.spyOn(window, "alert").mockImplementation(() => {});
    const c = vi.spyOn(window, "confirm").mockImplementation(() => true);
    const p = vi.spyOn(window, "prompt").mockImplementation(() => null);
    renderHost();
    fillSubjectAndBody();
    fireEvent.click(sendBtn());
    await screen.findByText(/Mail programmé/);
    fireEvent.click(screen.getByRole("button", { name: /Annuler l'envoi/ }));
    await act(async () => {});
    expect(a).not.toHaveBeenCalled();
    expect(c).not.toHaveBeenCalled();
    expect(p).not.toHaveBeenCalled();
  });

  it("every button has an aria-label", () => {
    renderHost();
    const buttons = within(dialog()).getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(3);
    for (const b of buttons) expect(b.getAttribute("aria-label"), b.outerHTML).toBeTruthy();
  });

  it("stores the draft under a key scoped by organization and user, and purges drafts on sign out", () => {
    renderHost();
    fillSubjectAndBody();
    expect(window.localStorage.getItem("loriax:mail-draft:o1:u1:d1:r1")).toContain("Devis");
    expect(window.localStorage.getItem("loriax:mail-draft:d1:r1")).toBeNull();
    window.localStorage.setItem("autre", "garde");
    purgeMailDrafts();
    expect(window.localStorage.getItem("loriax:mail-draft:o1:u1:d1:r1")).toBeNull();
    expect(window.localStorage.getItem("autre")).toBe("garde");
  });

  it("does not show another user's draft", () => {
    window.localStorage.setItem(
      "loriax:mail-draft:o1:u2:d1:r1",
      JSON.stringify({ to: ["x@y.fr"], cc: [], bcc: [], subject: "Secret", bodyHtml: "<p>s</p>", attachments: [], dossierRowId: null, clientKey: UUID }),
    );
    renderHost();
    expect((screen.getByLabelText("Objet") as HTMLInputElement).value).toBe("");
  });

  it("opening a reply does not store a draft until the user edits", () => {
    renderHost({ replyTo: { ...reply, subject: "Devis cuisine" } });
    expect(window.localStorage.length).toBe(0);
    fireEvent.change(screen.getByLabelText("Corps du mail"), { target: { value: "<p>Merci</p>" } });
    expect(window.localStorage.length).toBe(1);
  });

  it("resume prefills the failed mail and warns about the attachments to add again", () => {
    renderHost({
      resume: {
        ...reply,
        id: "m7",
        direction: "out",
        status: "failed",
        from: "alice@example.com",
        to: ["claire@orange.fr"],
        cc: ["paul@x.fr"],
        subject: "Devis cuisine",
        bodyHtml: "<p>Voici</p>",
        error: "send_failed",
        attachments: [{ index: 0, fileName: "devis.pdf", mimeType: "application/pdf", size: 10 }],
      },
    });
    expect((screen.getByLabelText("Objet") as HTMLInputElement).value).toBe("Devis cuisine");
    expect((screen.getByLabelText("Corps du mail") as HTMLTextAreaElement).value).toBe("<p>Voici</p>");
    expect(screen.getByText("paul@x.fr")).toBeTruthy();
    const warning = screen.getByRole("alert");
    expect(warning.textContent).toContain("devis.pdf");
    expect(warning.textContent).toContain("joignez-les à nouveau");
  });

  it("blocks Envoyer while typed text in To is not validated, with an explanation", async () => {
    renderHost({ context: baseContext({ contact: { rowId: "c1", name: "C", email: null } }) });
    fireEvent.change(screen.getByLabelText("Ajouter un destinataire"), { target: { value: "bob@x.fr" } });
    expect(sendBtn().getAttribute("aria-disabled")).toBe("true");
    fireEvent.focus(sendBtn());
    expect(await screen.findByText("Validez l'adresse saisie (Entrée) pour envoyer")).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText("Ajouter un destinataire"), { key: "Enter" });
    expect(screen.getByText("bob@x.fr")).toBeTruthy();
    fillSubjectAndBody();
    expect(sendBtn().getAttribute("aria-disabled")).toBeNull();
  });

  it("cancelling too late (409 already_sent) shows the undoLate toast and keeps the drawer closed", async () => {
    cancelResponse = () => json({ error: "x", code: "already_sent" }, 409);
    renderHost();
    fillSubjectAndBody();
    fireEvent.click(sendBtn());
    fireEvent.click(await screen.findByRole("button", { name: /Annuler l'envoi/ }));
    expect(await screen.findByText("Le mail est déjà parti, impossible de l'annuler")).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
