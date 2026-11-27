import { describe, expect, it } from "vitest";
import { automationActionEnum } from "@/lib/db/schema";
import { validateActionConfig } from "@/lib/automations/actions/registry";
import { validateGraph } from "@/lib/automations/automation-graph";
import { CRM_FIELDS, CRM_ROLES, type CrmRole } from "../fields";
import {
  buildSampleAutomations,
  statusOptionsToAdd,
  type SampleAutomationInput,
  type SampleAutomationMessages,
} from "../sample-automations";

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

let n = 0;
const uid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function fullInput(): SampleAutomationInput & {
  roleDb: Record<CrmRole, string>;
  fieldIds: Record<CrmRole, Record<string, string | null>>;
} {
  n = 0;
  const roleDb = { contacts: uid(), dossiers: uid(), interactions: uid() } as Record<CrmRole, string>;
  const fieldIds = Object.fromEntries(
    CRM_ROLES.map((r) => [r, Object.fromEntries(CRM_FIELDS[r].map((f) => [f.key, uid()]))]),
  ) as Record<CrmRole, Record<string, string | null>>;
  return {
    roleDb,
    fieldIds,
    relationIds: { dossiersContact: uid(), interactionsDossier: uid(), interactionsContact: uid() },
  };
}

const m: SampleAutomationMessages = {
  statusOptions: ["Nouveau", "Qualification", "Devis envoyé", "En attente client", "Chez l'industriel", "Échantillon en cours", "Gagnée", "Perdue", "Sans suite"],
  typeOptions: ["Appel", "E-mail", "Rendez-vous", "Note"],
  automations: {
    quoteFollowUp: { name: "A" },
    waitingFollowUp: { name: "B" },
    wonClose: { name: "C" },
    lostClose: { name: "D" },
    dailyReminders: { name: "E" },
    receptionTally: { name: "NOM-TALLY" },
  },
};

const tally = (i = fullInput()) => buildSampleAutomations(i, m).automations.find((a) => a.key === "receptionTally");

describe("exemple Réception Tally", () => {
  it("(a) est le 6e exemple, déclencheur webhook entrant, sans formulaire choisi", () => {
    const r = buildSampleAutomations(fullInput(), m);
    expect(r.automations.map((a) => a.key).at(-1)).toBe("receptionTally");
    const a = tally()!;
    expect(a.name).toBe("NOM-TALLY");
    expect(a.triggerType).toBe("webhook_inbound");
    expect(a.triggerConfig).toEqual({ tallyFormId: null });
    expect("enabled" in a).toBe(false);
  });

  it("(b) ne porte ni jeton, ni secret, ni identifiant de formulaire", () => {
    const a = tally()!;
    const blob = JSON.stringify([a.triggerConfig, a.actionConfig, a.graph]);
    expect(blob).not.toMatch(/"(token|secret|lastReceived)"/);
    const keys = Object.keys(a.triggerConfig);
    expect(keys).toEqual(["tallyFormId"]);
  });

  it("(e) n'embarque aucun uuid hors des ids fournis", () => {
    const input = fullInput();
    const ok = new Set<string>([
      ...Object.values(input.roleDb),
      ...Object.values(input.fieldIds).flatMap((f) => Object.values(f)).filter((x): x is string => !!x),
    ]);
    const blob = JSON.stringify([tally(input)!.triggerConfig, tally(input)!.actionConfig, tally(input)!.graph]);
    const found = blob.match(UUID_RE) ?? [];
    expect(found.length).toBeGreaterThan(0);
    for (const id of found) expect(ok.has(id)).toBe(true);
  });

  it("(f) graphe valide, config des actions valide, couple historique stockable", () => {
    const a = tally()!;
    expect(validateGraph(a.graph)).toEqual({ ok: true });
    for (const node of a.graph.nodes) {
      if (node.kind === "action") expect(validateActionConfig(node.actionType!, node.actionConfig ?? {})).toBeNull();
    }
    expect(automationActionEnum.enumValues).toContain(a.actionType);
    expect(validateActionConfig(a.actionType, a.actionConfig)).toBeNull();
  });

  it("crée la fiche Dossiers (titre, contact, statut Nouveau) et trouve ou crée le contact", () => {
    const input = fullInput();
    const a = tally(input)!;
    const [contact, dossier] = a.graph.nodes;
    expect(contact.actionConfig!.databaseId).toBe(input.roleDb.contacts);
    expect(contact.actionConfig!.match).toMatchObject({ columnId: input.fieldIds.contacts.email });
    expect(dossier.actionConfig!.databaseId).toBe(input.roleDb.dossiers);
    const cells = dossier.actionConfig!.cells as Record<string, unknown>;
    expect(cells[input.fieldIds.dossiers.statut!]).toBe("Nouveau");
    expect(cells[input.fieldIds.dossiers.contact!]).toEqual([`{{variables.${contact.storeAs}.row.id}}`]);
    expect(Object.keys(cells)).toContain(input.fieldIds.dossiers.titre);
    expect(cells[input.fieldIds.dossiers.titre!]).toBe("{{variables.tally.title}}");
  });

  it("(g) est sauté si le rôle Contacts ou Dossiers n'est pas raccordé", () => {
    for (const role of ["contacts", "dossiers"] as const) {
      const input = fullInput();
      const r = buildSampleAutomations({ ...input, roleDb: { ...input.roleDb, [role]: null } }, m);
      expect(r.automations.some((a) => a.key === "receptionTally")).toBe(false);
      expect(r.skipped.find((s) => s.key === "receptionTally")!.missing).toContain(role);
    }
  });

  it("signale « Nouveau » via statusOptionsToAdd s'il manque à la colonne existante", () => {
    const r = buildSampleAutomations({ ...fullInput(), existingStatusOptions: ["Gagnée"] }, m);
    expect(statusOptionsToAdd(r.automations, ["Gagnée"])).toContain("Nouveau");
  });
});
