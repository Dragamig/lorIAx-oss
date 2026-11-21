import { describe, it, expect } from "vitest";
import {
  getAction,
  validateActionConfig,
  ACTION_REGISTRY,
} from "@/lib/automations/actions/registry";

describe("registre d'actions", () => {
  it("expose toutes les actions attendues", () => {
    const types = Object.keys(ACTION_REGISTRY).sort();
    expect(types).toEqual(
      [
        "ai",
        "create_design",
        "create_document",
        "create_row",
        "create_task",
        "find_row",
        "notify_user",
        "send_email",
        "update_row",
        "webhook",
      ].sort()
    );
  });

  it("getAction renvoie la définition pour un type connu", () => {
    const def = getAction("send_email");
    expect(def?.type).toBe("send_email");
    expect(typeof def?.execute).toBe("function");
  });

  it("getAction renvoie undefined pour un type inconnu", () => {
    expect(getAction("type_bidon")).toBeUndefined();
  });

  it("create_row/update_row sont marquées requiresDatabase", () => {
    expect(getAction("create_row")?.requiresDatabase).toBe(true);
    expect(getAction("update_row")?.requiresDatabase).toBe(true);
  });

  it("les actions autonomes ne requièrent pas de base", () => {
    expect(getAction("create_document")?.requiresDatabase).toBeFalsy();
    expect(getAction("create_task")?.requiresDatabase).toBeFalsy();
    expect(getAction("send_email")?.requiresDatabase).toBeFalsy();
  });
});

describe("validateActionConfig", () => {
  it("rejette un type d'action inconnu", () => {
    expect(validateActionConfig("inconnu", {})).toMatch(/inconnu/i);
  });

  it("rejette une config invalide (champ requis manquant)", () => {
    // send_email exige subject + (html|text) + destinataire.
    const err = validateActionConfig("send_email", { subject: "" });
    expect(err).toBeTruthy();
  });

  it("accepte une config send_email valide", () => {
    expect(
      validateActionConfig("send_email", {
        to: "alice@exemple.com",
        subject: "Bonjour",
        html: "<p>Salut</p>",
      })
    ).toBeNull();
  });

  it("accepte send_email avec toUserId au lieu de to", () => {
    expect(
      validateActionConfig("send_email", {
        toUserId: "{{user.id}}",
        subject: "Bonjour",
        text: "Salut",
      })
    ).toBeNull();
  });

  it("rejette create_row en contexte autonome (requiresDatabase)", () => {
    const err = validateActionConfig(
      "create_row",
      { cells: { c1: "v" } },
      { autonomous: true }
    );
    expect(err).toMatch(/base de données/i);
  });

  it("accepte create_document en contexte autonome", () => {
    expect(
      validateActionConfig("create_document", { title: "Doc" }, { autonomous: true })
    ).toBeNull();
  });

  it("accepte create_task en contexte autonome", () => {
    expect(
      validateActionConfig("create_task", { title: "Tâche" }, { autonomous: true })
    ).toBeNull();
  });
});
