/**
 * Usage IA « chat_database_actions » : repli sur « chat » sans assignation
 * active, cloisonnement par organisation inchangé. Même faux client SQL que
 * `ai-provider-resolver-org-scope.test.ts`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", async () => {
  const { drizzle } = await import("drizzle-orm/pg-proxy");
  const schema = await import("@/lib/db/schema");
  const { executerSql } = await import("./ai-provider-resolver-moteur-sql");
  const db = drizzle(
    async (sql: string, params: unknown[]) => ({ rows: executerSql(sql, params) }),
    { schema }
  );
  return { db };
});

import { getLanguageModelForUsageWithFallbackInOrg } from "@/lib/ai/provider-resolver";
import {
  assigner,
  reinitialiser,
  FOURNISSEUR_ACME,
  FOURNISSEUR_VICTIME,
  ORG_ACME,
} from "./ai-provider-resolver-moteur-sql";

beforeEach(() => reinitialiser());

describe("usage chat_database_actions", () => {
  it("sans assignation : retombe sur le modèle de « chat »", async () => {
    assigner({ usageType: "chat", providerId: FOURNISSEUR_ACME, model: "modele-chat" });

    const r = await getLanguageModelForUsageWithFallbackInOrg(
      "chat_database_actions",
      "chat",
      ORG_ACME
    );

    expect(r.usageType).toBe("chat");
    expect(r.model).toBe("modele-chat");
  });

  it("avec assignation active : utilise le modèle dédié", async () => {
    assigner({ usageType: "chat", providerId: FOURNISSEUR_ACME, model: "modele-chat" });
    assigner({
      usageType: "chat_database_actions",
      providerId: FOURNISSEUR_ACME,
      model: "modele-fiable",
    });

    const r = await getLanguageModelForUsageWithFallbackInOrg(
      "chat_database_actions",
      "chat",
      ORG_ACME
    );

    expect(r.usageType).toBe("chat_database_actions");
    expect(r.model).toBe("modele-fiable");
  });

  it("assignation désactivée : retombe sur « chat »", async () => {
    assigner({ usageType: "chat", providerId: FOURNISSEUR_ACME, model: "modele-chat" });
    assigner({
      usageType: "chat_database_actions",
      providerId: FOURNISSEUR_ACME,
      model: "modele-fiable",
      isEnabled: false,
    });

    const r = await getLanguageModelForUsageWithFallbackInOrg(
      "chat_database_actions",
      "chat",
      ORG_ACME
    );

    expect(r.model).toBe("modele-chat");
  });

  it("cloisonnement : une assignation vers le fournisseur d'un autre tenant n'est jamais servie", async () => {
    assigner({
      usageType: "chat_database_actions",
      providerId: FOURNISSEUR_VICTIME,
      model: "modele-vole",
    });

    const r = await getLanguageModelForUsageWithFallbackInOrg(
      "chat_database_actions",
      "chat",
      ORG_ACME
    );

    expect(r.providerId).not.toBe(FOURNISSEUR_VICTIME);
    expect(r.model).not.toBe("modele-vole");
  });

  it("assignation dédiée hors portée : repli sur le modèle de l'usage chat, pas sur le défaut", async () => {
    assigner({ usageType: "chat", providerId: FOURNISSEUR_ACME, model: "modele-chat" });
    assigner({
      usageType: "chat_database_actions",
      providerId: FOURNISSEUR_VICTIME,
      model: "modele-vole",
    });

    const r = await getLanguageModelForUsageWithFallbackInOrg(
      "chat_database_actions",
      "chat",
      ORG_ACME
    );

    expect(r.usageType).toBe("chat");
    expect(r.model).toBe("modele-chat");
  });
});
