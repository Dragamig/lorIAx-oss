// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Toaster } from "sonner";
import { renderWithIntl } from "@/__tests__/components/support/render-intl";
import { MailsTab } from "../mails-tab";
import { MailsPanel } from "../mails-tab";
import { useFicheMails } from "../use-fiche-mails";

vi.mock("@/i18n/routing", () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const context = (over: Record<string, unknown> = {}) => ({
  viewer: { orgId: "o1", userId: "u1" },
  role: "contacts",
  contact: { rowId: "c1", name: "Claire Martin", email: "claire@orange.fr" },
  dossiers: [],
  defaultDossierRowId: null,
  fixedDossierRowId: null,
  mailbox: { configured: true, address: "alice@example.com", signature: "", cancelDelaySeconds: 10 },
  quota: { limit: 50, exceeded: false },
  alert: { pending: 0, crmDisconnected: false },
  ...over,
});

const msg = (over: Record<string, unknown>) => ({
  id: "m1",
  messageId: "<m1@x>",
  direction: "out",
  status: "sent",
  from: "alice@example.com",
  to: ["claire@orange.fr"],
  cc: [],
  bcc: [],
  subject: "Devis cuisine",
  bodyHtml: "<p>Bonjour Claire</p>",
  bodyText: "Bonjour Claire",
  attachments: [],
  date: "2026-11-14T16:40:00.000Z",
  scheduledAt: null,
  sentAt: "2026-11-14T16:40:00.000Z",
  error: null,
  errorReason: null,
  errorDetail: null,
  traced: true,
  ...over,
});

const conversation = (messages: ReturnType<typeof msg>[], key = "t1") => ({
  threadKey: key,
  subject: "Devis cuisine",
  messages,
  lastAt: messages[messages.length - 1].date,
  unread: false,
});

type Routes = { context?: () => Response | Promise<Response>; messages?: () => Response | Promise<Response> };
function mockFetch(routes: Routes) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.startsWith("/api/mail/context")) return routes.context ? routes.context() : json(context());
      if (url.startsWith("/api/mail/messages")) return routes.messages ? routes.messages() : json({ conversations: [] });
      return json({}, 404);
    }),
  );
}

const renderTab = () =>
  renderWithIntl(
    <>
      <Toaster />
      <MailsTab databaseId="d1" rowId="r1" />
    </>,
  );

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MailsTab", () => {
  it("shows the loading state", () => {
    mockFetch({ context: () => new Promise(() => {}) });
    renderTab();
    expect(screen.getByRole("status", { name: "Chargement des mails" })).toBeTruthy();
  });

  it("shows the empty state with Écrire le premier mail", async () => {
    mockFetch({});
    renderTab();
    expect(await screen.findByText("Aucun mail échangé")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Écrire le premier mail" })).toBeTruthy();
  });

  it("shows the unconfigured notice with a link to /settings?tab=mailbox and a disabled Écrire whose tooltip explains why", async () => {
    mockFetch({ context: () => json(context({ mailbox: { configured: false, address: null, signature: "", cancelDelaySeconds: 10 } })) });
    renderTab();
    expect(await screen.findByText(/Aucune boîte mail connectée/)).toBeTruthy();
    const link = screen.getByRole("link", { name: "Ouvrir Ma boîte mail" });
    expect(link.getAttribute("href")).toContain("/settings?tab=mailbox");
    const write = screen.getByRole("button", { name: /^Écrire/ });
    expect(write.getAttribute("aria-disabled")).toBe("true");
    fireEvent.focus(write);
    expect(await screen.findByText("Configurez votre boîte mail pour écrire")).toBeTruthy();
  });

  it("shows the error state with Réessayer", async () => {
    mockFetch({ messages: () => json({ error: "x" }, 500) });
    renderTab();
    expect(await screen.findByText("Impossible de charger les mails")).toBeTruthy();
    mockFetch({});
    fireEvent.click(screen.getByRole("button", { name: "Réessayer" }));
    expect(await screen.findByText("Aucun mail échangé")).toBeTruthy();
  });

  it("groups messages into conversations, replies collapsed, expands on click with aria-expanded", async () => {
    mockFetch({
      messages: () =>
        json({
          conversations: [
            conversation([
              msg({ id: "m1", bodyHtml: "<p>Premier corps</p>", bodyText: "Premier corps" }),
              msg({ id: "m2", direction: "in", from: "claire@orange.fr", to: ["alice@example.com"], bodyHtml: "<p>Réponse corps</p>", bodyText: "Réponse corps", date: "2026-11-15T09:00:00.000Z" }),
            ]),
            conversation([msg({ id: "m3", subject: "Autre sujet", bodyText: "Autre" })], "t2"),
          ],
        }),
    });
    renderTab();
    const toggles = await screen.findAllByRole("button", { expanded: false });
    expect(toggles.length).toBe(2);
    expect(screen.getByText("2 messages")).toBeTruthy();
    expect(screen.queryByText("Réponse corps", { selector: "p" })).toBeNull();
    fireEvent.click(toggles[0]);
    expect(toggles[0].getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Réponse corps", { selector: "p" })).toBeTruthy();
    expect(screen.getByText("Premier corps", { selector: "p" })).toBeTruthy();
  });

  it("the conversation toggle has a tooltip on focus", async () => {
    mockFetch({ messages: () => json({ conversations: [conversation([msg({ id: "m1", subject: "Sujet test" })])] }) });
    renderTab();
    const toggle = (await screen.findAllByRole("button", { expanded: false }))[0];
    fireEvent.focus(toggle);
    await waitFor(() => expect(document.body.textContent).toContain("Déplier la conversation"));
  });

  it("Écrire is the primary button with aria-label and tooltip showing the N shortcut", async () => {
    mockFetch({});
    renderTab();
    const write = await screen.findByRole("button", { name: "Écrire un mail" });
    expect(write.getAttribute("aria-disabled")).toBeNull();
    fireEvent.focus(write);
    expect(await screen.findByText("N", { selector: "kbd" })).toBeTruthy();
  });

  it("shows the trace alert when crmDisconnected is true", async () => {
    mockFetch({ context: () => json(context({ alert: { pending: 0, crmDisconnected: true } })) });
    renderTab();
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/base Interactions n'est pas raccordée/)).toBeTruthy();
  });

  it("outgoing and incoming mails carry distinct icons and accessible names", async () => {
    mockFetch({
      messages: () =>
        json({
          conversations: [
            conversation([msg({ id: "a" }), msg({ id: "b", direction: "in", date: "2026-11-15T09:00:00.000Z" })]),
          ],
        }),
    });
    renderTab();
    fireEvent.click((await screen.findAllByRole("button", { expanded: false }))[0]);
    expect(screen.getAllByRole("img", { name: "Mail envoyé" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("img", { name: "Mail reçu" }).length).toBeGreaterThan(0);
  });

  it("attachment chip has a download button with aria-label", async () => {
    mockFetch({
      messages: () =>
        json({
          conversations: [
            conversation([msg({ id: "m1", attachments: [{ index: 0, fileName: "devis.pdf", mimeType: "application/pdf", size: 1200 }] })]),
          ],
        }),
    });
    renderTab();
    fireEvent.click((await screen.findAllByRole("button", { expanded: false }))[0]);
    const dl = screen.getByRole("link", { name: "Télécharger devis.pdf" });
    expect(dl.getAttribute("href")).toBe("/api/mail/messages/m1/attachments/0");
  });

  it("shows stable error codes as readable states, delivery_unknown as uncertain", async () => {
    mockFetch({
      messages: () =>
        json({ conversations: [conversation([msg({ id: "m1", status: "failed", error: "delivery_unknown" })])] }),
    });
    renderTab();
    expect(await screen.findByText("État incertain, vérifiez votre dossier Envoyés")).toBeTruthy();
  });

  it("shows a readable reason for a failed mail once expanded", async () => {
    mockFetch({
      messages: () =>
        json({
          conversations: [
            conversation([msg({ id: "a1", status: "failed", error: "send_failed", errorReason: "auth_refused" })], "ta"),
            conversation([msg({ id: "b1", status: "failed", error: "send_failed", errorDetail: "Connection closed" })], "tb"),
          ],
        }),
    });
    renderTab();
    for (const b of await screen.findAllByRole("button", { expanded: false })) fireEvent.click(b);
    expect(screen.getByText("Identifiants SMTP refusés par le serveur")).toBeTruthy();
    expect(screen.getByText("Motif : Connection closed")).toBeTruthy();
  });

  it("never labels a failed or scheduled last mail as sent", async () => {
    mockFetch({
      messages: () =>
        json({
          conversations: [
            conversation([msg({ id: "f1", status: "failed", error: "send_failed" })], "tf"),
            conversation([msg({ id: "s1", status: "scheduled", scheduledAt: "2026-11-14T17:00:00.000Z" })], "ts"),
            conversation([msg({ id: "x1", status: "cancelled" })], "tx"),
          ],
        }),
    });
    renderTab();
    expect(await screen.findByText("Échec de l'envoi")).toBeTruthy();
    expect(screen.queryByText("Envoyé")).toBeNull();
    expect(screen.getByText("Programmé")).toBeTruthy();
    expect(screen.getByText("Annulé")).toBeTruthy();
  });

  it("Répondre opens the compose entry point with the message, Copier l'adresse toasts", async () => {
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    mockFetch({
      messages: () =>
        json({ conversations: [conversation([msg({ id: "m2", direction: "in", from: "claire@orange.fr" })])] }),
    });
    const onCompose = vi.fn();
    renderWithIntl(
      <>
        <Toaster />
        <MailsTab databaseId="d1" rowId="r1" onCompose={onCompose} />
      </>,
    );
    fireEvent.click((await screen.findAllByRole("button", { expanded: false }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "Répondre à ce mail" }));
    expect(onCompose).toHaveBeenCalledWith(expect.objectContaining({ replyTo: expect.objectContaining({ id: "m2" }) }));
    fireEvent.click(screen.getByRole("button", { name: "Copier l'adresse du correspondant" }));
    await waitFor(() => expect(write).toHaveBeenCalledWith("claire@orange.fr"));
    expect(await screen.findByText("Adresse copiée")).toBeTruthy();
    expect(within(document.body).queryByText("Transférer")).toBeNull();
  });

  it("Copier l'adresse copies the correspondent: to[0] on an outgoing mail", async () => {
    const write = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText: write }, configurable: true });
    mockFetch({
      messages: () =>
        json({ conversations: [conversation([msg({ id: "m1", direction: "out", from: "alice@example.com", to: ["claire@orange.fr"] })])] }),
    });
    renderTab();
    fireEvent.click((await screen.findAllByRole("button", { expanded: false }))[0]);
    fireEvent.click(screen.getByRole("button", { name: "Copier l'adresse du correspondant" }));
    await waitFor(() => expect(write).toHaveBeenCalledWith("claire@orange.fr"));
  });

  it("has no Relever maintenant button", async () => {
    mockFetch({});
    renderTab();
    await screen.findByText("Aucun mail échangé");
    expect(screen.queryByRole("button", { name: "Relever maintenant" })).toBeNull();
  });

  it("shows a contact pill on each conversation of a dossier fiche", async () => {
    mockFetch({
      context: () => json(context({ role: "dossiers", contact: { rowId: null, name: null, email: null } })),
      messages: () => json({ conversations: [conversation([msg({ id: "m1", to: ["claire.martin@orange.fr"] })])] }),
    });
    renderTab();
    expect(await screen.findByTestId("contact-pill")).toBeTruthy();
    expect(screen.getByTestId("contact-pill").textContent).toContain("claire.martin@orange.fr");
  });

  it("no contact pill on a contact fiche", async () => {
    mockFetch({ messages: () => json({ conversations: [conversation([msg({ id: "m1" })])] }) });
    renderTab();
    await screen.findAllByRole("button", { expanded: false });
    expect(screen.queryByTestId("contact-pill")).toBeNull();
  });

  it("useFicheMails reports available=false on a 404 context", async () => {
    mockFetch({ context: () => json({ error: "x" }, 404) });
    function Probe() {
      const m = useFicheMails("d1", "r1");
      return <span data-testid="p">{String(m.available)}</span>;
    }
    renderWithIntl(<Probe />);
    await waitFor(() => expect(screen.getByTestId("p").textContent).toBe("false"));
  });

  it("useFicheMails reports available=false, without throwing, on a context of unexpected shape", async () => {
    mockFetch({ context: () => json({}) });
    function Probe() {
      const m = useFicheMails("d1", "r1");
      return <span data-testid="p">{String(m.available)}</span>;
    }
    renderWithIntl(<Probe />);
    await waitFor(() => expect(screen.getByTestId("p").textContent).toBe("false"));
  });

  it("MailsPanel renders from a shared hook result without fetching", () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    renderWithIntl(
      <MailsPanel
        mails={{ context: null, conversations: [], status: "loading", available: null, reload: () => {}, openCompose: () => {} }}
      />,
    );
    expect(screen.getByRole("status", { name: "Chargement des mails" })).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
