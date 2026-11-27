// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { renderWithIntl } from "@/__tests__/components/support/render-intl";
import fr from "../../../../messages/fr.json";
import { AttachmentPicker } from "../attachment-picker";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AttachmentPicker", () => {
  it("affiche le message de limite quand le téléversement répond 429", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ code: "upload_rate_limited" }), { status: 429 })),
    );
    renderWithIntl(<AttachmentPicker attachments={[]} onChange={() => {}} />);
    const input = screen.getByLabelText(fr.mailing.compose.attach.fileInput) as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "a.pdf", { type: "application/pdf" })] } });
    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toBe(fr.mailing.compose.attach.uploadRateLimited),
    );
  });

  it("le bouton de retrait d'une pièce mesure au moins 24 px", () => {
    renderWithIntl(
      <AttachmentPicker
        attachments={[{ source: "upload", storageKey: "mail/o/u/k-a.pdf", fileName: "a.pdf", mimeType: "application/pdf", size: 3 }]}
        onChange={() => {}}
      />,
    );
    const btn = screen.getByRole("button", { name: /a\.pdf/ });
    expect(btn.className).toMatch(/\bsize-6\b/);
  });
});
