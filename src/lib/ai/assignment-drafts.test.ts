import { describe, it, expect } from "vitest";
import {
  buildPristine,
  isRowDirty,
  countDirty,
  dirtyUsages,
  applySavedRows,
  resetRow,
  resetAll,
  validateDraft,
} from "./assignment-drafts";

const base = (usageType: string) => ({
  usageType,
  providerId: "p1",
  model: "m1",
  fallbackProviderId: null,
  fallbackModel: null,
  timeoutSeconds: 30,
  maxRetries: 1,
  isEnabled: true,
});

describe("assignment-drafts", () => {
  it("buildPristine indexe par usage", () => {
    const p = buildPristine([base("chat"), base("rag")]);
    expect(Object.keys(p)).toEqual(["chat", "rag"]);
    expect(p.chat.model).toBe("m1");
  });

  it("normalise vide / null / undefined et timeout par défaut", () => {
    const p = buildPristine([{ ...base("chat"), fallbackModel: null }]);
    expect(isRowDirty(p.chat, { ...p.chat, fallbackModel: "" })).toBe(false);
    expect(
      isRowDirty(p.chat, { ...p.chat, fallbackModel: undefined as never })
    ).toBe(false);
    const sansTimeout = buildPristine([
      { usageType: "x", providerId: "p", model: "m" },
    ]);
    expect(sansTimeout.x.timeoutSeconds).toBe(30);
    expect(isRowDirty(sansTimeout.x, { ...sansTimeout.x, timeoutSeconds: 60 })).toBe(true);
    expect(isRowDirty(p.chat, { ...p.chat, isEnabled: false })).toBe(true);
  });

  it("countDirty et dirtyUsages", () => {
    const p = buildPristine([base("a"), base("b")]);
    const d = { ...p, b: { ...p.b, model: "m2" } };
    expect(countDirty(p, d)).toBe(1);
    expect(dirtyUsages(p, d)).toEqual(["b"]);
  });

  it("sauvegarde partielle : A réussit, B échoue et reste dirty", () => {
    const p = buildPristine([base("a"), base("b")]);
    const d = {
      a: { ...p.a, model: "ma" },
      b: { ...p.b, model: "mb" },
    };
    const np = applySavedRows(p, d, [
      { usageType: "a", ok: true, sent: d.a },
      { usageType: "b", ok: false, sent: d.b },
    ]);
    expect(dirtyUsages(np, d)).toEqual(["b"]);
    expect(np.a.model).toBe("ma");
  });

  it("course : A modifiée pendant l'envoi reste dirty", () => {
    const p = buildPristine([base("a")]);
    const sent = { ...p.a, model: "v1" };
    const current = { a: { ...p.a, model: "v2" } };
    const np = applySavedRows(p, current, [{ usageType: "a", ok: true, sent }]);
    expect(np.a.model).toBe("m1");
    expect(isRowDirty(np.a, current.a)).toBe(true);
  });

  it("enregistrer A ne touche pas le brouillon de B", () => {
    const p = buildPristine([base("a"), base("b")]);
    const d = { a: { ...p.a, model: "ma" }, b: { ...p.b, model: "mb" } };
    const before = JSON.stringify(d);
    const np = applySavedRows(p, d, [{ usageType: "a", ok: true, sent: d.a }]);
    expect(JSON.stringify(d)).toBe(before);
    expect(np.b).toEqual(p.b);
    expect(isRowDirty(np.b, d.b)).toBe(true);
  });

  it("resetRow et resetAll", () => {
    const p = buildPristine([base("a"), base("b")]);
    const d = { a: { ...p.a, model: "x" }, b: { ...p.b, model: "y" } };
    const r = resetRow(p, d, "a");
    expect(r.a).toEqual(p.a);
    expect(r.b.model).toBe("y");
    expect(resetAll(p, d)).toEqual(p);
  });

  it("validateDraft exige providerId et model", () => {
    const p = buildPristine([base("a")]);
    expect(validateDraft(p.a).valid).toBe(true);
    expect(validateDraft({ ...p.a, model: " " }).errors).toEqual(["model"]);
    expect(validateDraft({ ...p.a, providerId: "", model: "" }).errors).toEqual([
      "providerId",
      "model",
    ]);
  });
});
