import { DEFAULT_LOCALE, LOCALES } from "@/i18n/config";
import { CRM_FIELDS, CRM_ROLES, type CrmRole } from "./fields";

export interface AutomationTexts {
  name: string;
  taskTitle?: string;
  interactionSubject?: string;
  reminderText?: string;
}

const AUTOMATION_KEYS = [
  "quoteFollowUp", "waitingFollowUp", "wonClose", "lostClose", "dailyReminders", "receptionTally",
] as const;
export type AutomationTextKey = (typeof AUTOMATION_KEYS)[number];
const AUTOMATION_OPTIONAL = ["taskTitle", "interactionSubject", "reminderText"] as const;

export interface TemplateMessages {
  space: string;
  databases: Record<CrmRole, string>;
  fields: Record<CrmRole, Record<string, string>>;
  statusOptions: string[];
  typeOptions: string[];
  views: { pipeline: string; followUps: string; all: string; mine: string; wonThisQuarter: string };
  inverseNames: { contactDossiers: string; dossierInteractions: string };
  automations: Record<AutomationTextKey, AutomationTexts>;
}

const STATUS_KEYS = [
  "new", "qualify", "quoteSent", "waitingClient", "atManufacturer",
  "sampleInProgress", "won", "lost", "dropped",
] as const;
const TYPE_KEYS = ["call", "mail", "meeting", "note"] as const;

type Dict = Record<string, unknown>;

async function readMessages(locale: string): Promise<Dict> {
  return (await import(`../../../messages/${locale}.json`)).default as Dict;
}

function str(node: unknown, ...path: string[]): string {
  let cur: unknown = node;
  for (const p of path) cur = (cur as Dict | undefined)?.[p];
  if (typeof cur !== "string" || cur.length === 0) throw new Error(`crm.${path.join(".")} manquant`);
  return cur;
}

/** Libellés du modèle CRM dans la locale demandée (repli fr si elle est inconnue). */
export async function loadTemplateMessages(locale: string): Promise<TemplateMessages> {
  const code = (LOCALES as readonly string[]).includes(locale) ? locale : DEFAULT_LOCALE;
  const crm = ((await readMessages(code)).crm ?? {}) as Dict;
  const tpl = (...p: string[]) => str(crm, "template", ...p);
  const optional = (key: string, field: string): string | undefined => {
    const v = ((crm.template as Dict | undefined)?.automations as Dict | undefined)?.[key] as Dict | undefined;
    const t = v?.[field];
    return typeof t === "string" && t.length > 0 ? t : undefined;
  };
  const automations = Object.fromEntries(
    AUTOMATION_KEYS.map((k) => {
      const texts: AutomationTexts = { name: tpl("automations", k, "name") };
      for (const f of AUTOMATION_OPTIONAL) {
        const v = optional(k, f);
        if (v !== undefined) texts[f] = v;
      }
      return [k, texts];
    }),
  ) as Record<AutomationTextKey, AutomationTexts>;
  return {
    space: tpl("space"),
    databases: Object.fromEntries(CRM_ROLES.map((r) => [r, tpl("databases", r)])) as Record<CrmRole, string>,
    fields: Object.fromEntries(
      CRM_ROLES.map((r) => [r, Object.fromEntries(CRM_FIELDS[r].map((f) => [f.key, str(crm, "fields", r, f.key)]))]),
    ) as Record<CrmRole, Record<string, string>>,
    statusOptions: STATUS_KEYS.map((k) => tpl("statusOptions", k)),
    typeOptions: TYPE_KEYS.map((k) => tpl("typeOptions", k)),
    views: {
      pipeline: tpl("views", "pipeline"),
      followUps: tpl("views", "followUps"),
      all: tpl("views", "all"),
      mine: tpl("views", "mine"),
      wonThisQuarter: tpl("views", "wonThisQuarter"),
    },
    inverseNames: { contactDossiers: tpl("inverseNames", "contactDossiers"), dossierInteractions: tpl("inverseNames", "dossierInteractions") },
    automations,
  };
}
