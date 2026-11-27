import { afterEach, describe, expect, it, vi } from "vitest";

const toast = vi.hoisted(() => ({ success: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

import { notifySaveOutcome } from "./save-toasts";

const t = (k: string) => k;
afterEach(() => vi.clearAllMocks());

describe("notifySaveOutcome", () => {
  it("une erreur produit le message de son code", () => {
    notifySaveOutcome({ kind: "error", status: 507, message: "" }, t);
    expect(toast.error).toHaveBeenCalledWith("save.errQuota");
  });

  it("le toast de succès propose Annuler, qui exécute undo puis confirme", async () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    notifySaveOutcome({ kind: "created", mediaId: "m", undo }, t);
    const opts = toast.success.mock.calls[0][1] as { action: { label: string; onClick: () => void } };
    expect(opts.action.label).toBe("save.undo");
    opts.action.onClick();
    await Promise.resolve();
    await Promise.resolve();
    expect(undo).toHaveBeenCalledOnce();
    expect(toast.info).toHaveBeenCalledWith("save.undone");
  });

  it("annulation expirée ou échouée : message dédié", async () => {
    const undo = vi.fn().mockRejectedValue(new Error("expired"));
    notifySaveOutcome({ kind: "versioned", undo }, t);
    (toast.success.mock.calls[0][1] as { action: { onClick: () => void } }).action.onClick();
    await new Promise((r) => setTimeout(r, 0));
    expect(toast.error).toHaveBeenCalledWith("save.undoExpired");
  });

  it("doublon : information sans action", () => {
    notifySaveOutcome({ kind: "duplicate", mediaId: "m" }, t);
    expect(toast.info).toHaveBeenCalledWith("save.duplicateToast");
    expect(toast.success).not.toHaveBeenCalled();
  });
});
