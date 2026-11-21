import { describe, it, expect } from "vitest";
import { getTableName } from "drizzle-orm";
import {
  userDatabaseAutomations,
  userDatabaseAutomationRuns,
  automations,
  automationRuns,
  automationTriggerEnum,
  notificationTypeEnum,
} from "@/lib/db/schema";

describe("renommage des tables d'automatisation", () => {
  it("mappe les exports historiques sur les tables physiques renommées", () => {
    expect(getTableName(userDatabaseAutomations)).toBe("automations");
    expect(getTableName(userDatabaseAutomationRuns)).toBe("automation_runs");
  });

  it("expose des alias canoniques identiques aux exports historiques", () => {
    expect(automations).toBe(userDatabaseAutomations);
    expect(automationRuns).toBe(userDatabaseAutomationRuns);
  });

  it("ajoute la valeur d'enum webhook_inbound au déclencheur", () => {
    expect(automationTriggerEnum.enumValues).toContain("webhook_inbound");
  });

  it("ajoute la valeur d'enum automation au type de notification", () => {
    expect(notificationTypeEnum.enumValues).toContain("automation");
  });
});
