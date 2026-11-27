// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import fr from "../../../../../messages/fr.json";
import { toMailActivity, type MailActivity } from "@/lib/crm/activity-model";
import type { MailMessageDto } from "@/lib/mailing/threads";
import { MailCard } from "./mail-card";

const toastApi = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastApi }));
const actions = vi.hoisted(() => ({ cancelMail: vi.fn(), retryMail: vi.fn() }));
vi.mock("@/lib/crm/activity-actions", () => actions);

const KEY = "/api/crm/activity?databaseId=d&rowId=r";

function make(over: Partial<MailMessageDto> = {}): MailActivity {
  const mail: MailMessageDto = {
    id: "m1",
    messageId: null,
    direction: "out",
    status: "sent",
    from: "moi@x.fr",
    to: ["claire@cabinet.fr"],
    cc: ["cc@cabinet.fr"],
    bcc: [],
    subject: "Devis v2",
    bodyHtml: "",
    bodyText: "Bonjour Claire, voici le devis.",
    attachments: [],
    date: "2026-11-25T10:42:00Z",
    scheduledAt: null,
    sentAt: null,
    error: null,
    errorReason: null,
    errorDetail: null,
    traced: false,
    ...over,
  };
  return toMailActivity(mail)!;
}

function setup(over: Partial<MailMessageDto> = {}) {
  render(
    <NextIntlClientProvider locale="fr" messages={fr}>
      <ul>
        <MailCard item={make(over)} activityKey={KEY} />
      </ul>
    </NextIntlClientProvider>,
  );
}

beforeEach(() => {
  actions.cancelMail.mockReset().mockResolvedValue({ ok: true });
  actions.retryMail.mockReset().mockResolvedValue({ ok: true });
  for (const f of [toastApi.success, toastApi.error]) f.mockClear();
});
afterEach(cleanup);

const cancelBtn = () => screen.queryByRole("button", { name: "Annuler l'envoi" });
const retryBtn = () => screen.queryByRole("button", { name: "Réessayer" });

describe("MailCard", () => {
  it("scheduled : badge Programmé, Annuler seulement", () => {
    setup({ status: "scheduled" });
    expect(screen.getByText("Programmé")).toBeTruthy();
    expect(cancelBtn()).toBeTruthy();
    expect(retryBtn()).toBeNull();
  });

  it("sending : méta propre à l'envoi en cours", () => {
    setup({ status: "sending" });
    expect(screen.getByText(/Envoi en cours depuis le/)).toBeTruthy();
    expect(screen.queryByText(/Mail envoyé le/)).toBeNull();
  });

  it("sending : badge, aucune action, info-bulle d'explication", () => {
    setup({ status: "sending" });
    expect(screen.getByText("Envoi en cours")).toBeTruthy();
    expect(cancelBtn()).toBeNull();
    expect(retryBtn()).toBeNull();
  });

  it("sent : badge Envoyé, aucune action", () => {
    setup({ status: "sent" });
    expect(screen.getByText("Envoyé")).toBeTruthy();
    expect(cancelBtn()).toBeNull();
    expect(retryBtn()).toBeNull();
  });

  it("failed : badge, motif en clair, Réessayer", () => {
    setup({ status: "failed", error: "send_failed" });
    expect(screen.getByText("Échec")).toBeTruthy();
    expect(screen.getByText(fr.crm.fiche.activity.mail.errors.send_failed)).toBeTruthy();
    expect(retryBtn()).toBeTruthy();
    expect(cancelBtn()).toBeNull();
  });

  it("failed delivery_unknown : motif, pas de Réessayer", () => {
    setup({ status: "failed", error: "delivery_unknown" });
    expect(screen.getByText(fr.crm.fiche.activity.mail.errors.delivery_unknown)).toBeTruthy();
    expect(retryBtn()).toBeNull();
  });

  it("aperçu dépliable : une seule cible, clic puis clavier Entrée et Espace", async () => {
    const user = userEvent.setup();
    setup();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    const toggle = screen.getByRole("button", { name: /Déplier l'aperçu/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain("Devis v2");
    expect(screen.queryByText("claire@cabinet.fr")).toBeNull();
    await user.click(toggle);
    expect(screen.getByText("claire@cabinet.fr")).toBeTruthy();
    expect(screen.getByText("cc@cabinet.fr")).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await user.tab();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(toggle);
    await user.keyboard("{Enter}");
    expect(screen.queryByText("claire@cabinet.fr")).toBeNull();
    await user.keyboard(" ");
    expect(screen.getByText("claire@cabinet.fr")).toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("info-bulle du dépliage au focus clavier", async () => {
    const user = userEvent.setup();
    setup();
    await user.tab();
    expect((await screen.findAllByText("Déplier l'aperçu")).length).toBeGreaterThan(0);
  });

  it("sending : l'info-bulle explique que l'annulation est impossible", async () => {
    const user = userEvent.setup();
    setup({ status: "sending" });
    await user.tab();
    await user.tab();
    expect(await screen.findByText(fr.crm.fiche.activity.mail.sendingTip)).toBeTruthy();
  });

  it("failed avec code inconnu : repli générique", () => {
    setup({ status: "failed", error: "code_invente_xyz" as never });
    expect(screen.getByText(fr.crm.fiche.activity.mail.errors.unknown)).toBeTruthy();
  });

  it("action en cours : aria-busy et info-bulle de désactivation", async () => {
    const user = userEvent.setup();
    let release: (v: { ok: boolean }) => void = () => {};
    actions.cancelMail.mockReturnValue(new Promise((r) => (release = r)));
    setup({ status: "scheduled" });
    await user.click(cancelBtn()!);
    const btn = cancelBtn()!;
    expect(btn.getAttribute("aria-busy")).toBe("true");
    expect(btn.getAttribute("aria-disabled")).toBe("true");
    await user.tab({ shift: true });
    await user.tab();
    expect(document.activeElement).toBe(btn);
    expect(await screen.findByText(fr.crm.fiche.activity.mail.busyTip)).toBeTruthy();
    release({ ok: true });
    await waitFor(() => expect(cancelBtn()!.getAttribute("aria-busy")).toBeNull());
  });

  it("clic sur Annuler : action avec id et clé, toast de succès", async () => {
    setup({ status: "scheduled" });
    fireEvent.click(cancelBtn()!);
    await waitFor(() => expect(toastApi.success).toHaveBeenCalledWith(fr.crm.fiche.activity.mail.cancelled));
    expect(actions.cancelMail).toHaveBeenCalledWith("m1", KEY);
  });

  it("clic sur Réessayer : action avec id et clé, toast de succès", async () => {
    setup({ status: "failed", error: "send_failed" });
    fireEvent.click(retryBtn()!);
    await waitFor(() => expect(toastApi.success).toHaveBeenCalledWith(fr.crm.fiche.activity.mail.retried));
    expect(actions.retryMail).toHaveBeenCalledWith("m1", KEY);
  });

  it("échec de Réessayer : toast d'erreur", async () => {
    actions.retryMail.mockResolvedValue({ ok: false, code: "no_account" });
    setup({ status: "failed", error: "send_failed" });
    fireEvent.click(retryBtn()!);
    await waitFor(() => expect(toastApi.error).toHaveBeenCalledWith(fr.crm.fiche.activity.mail.retryNoAccount));
  });

  it("échec d'Annuler : toast d'erreur", async () => {
    actions.cancelMail.mockResolvedValue({ ok: false, code: "http_500" });
    setup({ status: "scheduled" });
    fireEvent.click(cancelBtn()!);
    await waitFor(() => expect(toastApi.error).toHaveBeenCalledWith(fr.crm.fiche.activity.mail.cancelError));
    expect(toastApi.error).not.toHaveBeenCalledWith(fr.crm.fiche.activity.mail.retryError);
  });
});
