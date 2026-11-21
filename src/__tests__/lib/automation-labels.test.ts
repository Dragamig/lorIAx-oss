import { describe, it, expect } from "vitest";
import { TRIGGER_LABELS, ACTION_LABELS } from "@/app/[locale]/(app)/automations/automation-labels";
import { automationTriggerEnum, automationActionEnum } from "@/lib/db/schema";

describe("libellés d'automatisation", () => {
  it("couvre tous les déclencheurs de l'enum", () => {
    for (const t of automationTriggerEnum.enumValues) {
      expect(TRIGGER_LABELS[t], `trigger ${t}`).toBeTruthy();
    }
  });
  it("couvre toutes les actions de l'enum", () => {
    for (const a of automationActionEnum.enumValues) {
      expect(ACTION_LABELS[a], `action ${a}`).toBeTruthy();
    }
  });
});
