import { describe, it, expect, vi } from "vitest";
import {
  checkAssignmentPayload,
  submitAssignment,
  type AssignmentPayload,
} from "./assignment-form";

function payload(overrides: Partial<AssignmentPayload> = {}): AssignmentPayload {
  return {
    usageType: "automation_ai",
    providerId: "provider-1",
    model: "mistral-small-latest",
    fallbackProviderId: null,
    fallbackModel: null,
    timeoutSeconds: 30,
    maxRetries: 1,
    isEnabled: true,
    ...overrides,
  };
}

describe("checkAssignmentPayload", () => {
  it("accepte une affectation complète", () => {
    expect(checkAssignmentPayload("Chat RAG", payload())).toEqual({ ok: true });
  });

  it("nomme le fournisseur manquant, pas l'identifiant technique", () => {
    const check = checkAssignmentPayload(
      "Action IA des automatisations",
      payload({ providerId: null }),
    );
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.message).toContain("fournisseur");
    expect(check.message).toContain("Action IA des automatisations");
    expect(check.message).not.toContain("providerId");
    expect(check.message).not.toContain("automation_ai");
  });

  it("nomme le modèle manquant", () => {
    const check = checkAssignmentPayload("Chat RAG", payload({ model: "  " }));
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.message).toContain("modèle");
    expect(check.message).not.toContain("model");
  });

  it("signale les deux manques d'un coup", () => {
    const check = checkAssignmentPayload(
      "Chat RAG",
      payload({ providerId: "", model: "" }),
    );
    expect(check.ok).toBe(false);
    if (check.ok) return;
    expect(check.message).toContain("fournisseur");
    expect(check.message).toContain("modèle");
  });
});

describe("submitAssignment", () => {
  it("prévient l'utilisateur et n'appelle pas le serveur si l'affectation est incomplète", async () => {
    // Régression : l'écran abandonnait en silence, le travail de l'utilisateur
    // était perdu sans le moindre message.
    const send = vi.fn();
    const onError = vi.fn();
    const onSuccess = vi.fn();

    const saved = await submitAssignment(
      "Synthèse note vocale",
      payload({ providerId: null }),
      { send, onError, onSuccess },
    );

    expect(saved).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toContain("fournisseur");
  });

  it("confirme visuellement une affectation enregistrée", async () => {
    const send = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const onError = vi.fn();
    const onSuccess = vi.fn();

    const saved = await submitAssignment("Chat RAG", payload(), {
      send,
      onError,
      onSuccess,
    });

    expect(saved).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onSuccess.mock.calls[0][0]).toContain("Chat RAG");
  });

  it("signale un refus du serveur", async () => {
    const send = vi.fn().mockResolvedValue({ ok: false, status: 400 });
    const onError = vi.fn();
    const onSuccess = vi.fn();

    const saved = await submitAssignment("Chat RAG", payload(), {
      send,
      onError,
      onSuccess,
    });

    expect(saved).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toContain("échoué");
  });

  it("distingue un refus de droits", async () => {
    const onError = vi.fn();
    const saved = await submitAssignment("Chat RAG", payload(), {
      send: vi.fn().mockResolvedValue({ ok: false, status: 403 }),
      onError,
      onSuccess: vi.fn(),
    });

    expect(saved).toBe(false);
    expect(onError.mock.calls[0][0]).toContain("droits");
  });

  it("signale une panne réseau sans laisser croire à un enregistrement", async () => {
    const onError = vi.fn();
    const onSuccess = vi.fn();
    const saved = await submitAssignment("Chat RAG", payload(), {
      send: vi.fn().mockRejectedValue(new Error("network down")),
      onError,
      onSuccess,
    });

    expect(saved).toBe(false);
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onError.mock.calls[0][0]).toContain("injoignable");
  });
});
