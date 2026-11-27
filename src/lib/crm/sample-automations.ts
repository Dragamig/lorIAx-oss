/**
 * Constructeur pur des automatismes d'exemple de la base Dossiers (CRM lot 8).
 *
 * Aucune dépendance base de données : reçoit les ids réels (bases par rôle,
 * colonnes par champ, relations) et les libellés localisés, renvoie les
 * définitions prêtes à insérer. Aucun id n'est écrit en dur ; `enabled` n'est
 * jamais porté (l'insertion les crée désactivés). Réception Tally ne porte ni
 * jeton ni secret (générés par le serveur à l'insertion, voir
 * `sanitizeWebhookTriggerConfig`) et son formulaire est choisi à l'activation. Les valeurs de Statut et de
 * Type sont les libellés de `statusOptions` et `typeOptions`.
 */
import { automationActionEnum } from "@/lib/db/schema";
import { findEntryNode, type AutomationGraph, type GraphNode } from "@/lib/automations/automation-graph";
import type { CrmRole } from "./fields";
import type { TemplateMessages } from "./template-messages";

export const SAMPLE_AUTOMATION_KEYS = [
  "quoteFollowUp",
  "waitingFollowUp",
  "wonClose",
  "lostClose",
  "dailyReminders",
  "receptionTally",
] as const;
export type SampleAutomationKey = (typeof SAMPLE_AUTOMATION_KEYS)[number];

export type SampleRelationKey = "dossiersContact" | "interactionsDossier" | "interactionsContact";

/** Textes localisés d'un exemple (la tâche 3 les branche sur `crm.template.automations.<clé>`). */
export interface SampleAutomationTexts {
  name: string;
  taskTitle?: string;
  interactionSubject?: string;
  reminderText?: string;
}

export type SampleAutomationMessages = Pick<TemplateMessages, "statusOptions" | "typeOptions"> & {
  automations: Record<SampleAutomationKey, SampleAutomationTexts>;
};

export interface SampleAutomationInput {
  /** Id de la base de chaque rôle. */
  roleDb: Record<CrmRole, string | null | undefined>;
  /** Id de colonne par rôle et par `fieldKey` (absent ou null : colonne non raccordée). */
  fieldIds: Partial<Record<CrmRole, Record<string, string | null | undefined>>>;
  /** Id de chaque relation du modèle (absent ou null : relation non raccordée). */
  relationIds: Partial<Record<SampleRelationKey, string | null | undefined>>;
  /** Options actuelles de la colonne Statut d'une base raccordée ; absent : colonne créée par le modèle. */
  existingStatusOptions?: readonly string[] | null;
}

export interface SampleAutomation {
  key: SampleAutomationKey;
  name: string;
  /** Prérequis déclarés : `role.champ`, `role` (base) ou `rel:<relation>`. */
  requires: string[];
  triggerType: "value_changed" | "date_reached" | "webhook_inbound";
  triggerConfig: Record<string, unknown>;
  /** Couple d'action historique (colonnes notNull), dérivé du premier nœud action du graphe. */
  actionType: string;
  actionConfig: Record<string, unknown>;
  graph: AutomationGraph;
  /** Libellés de Statut cités par cet exemple. */
  statuses: string[];
}

export interface SkippedSample {
  key: SampleAutomationKey;
  /** Prérequis non satisfaits. */
  missing: string[];
}

export interface SampleAutomationsResult {
  automations: SampleAutomation[];
  skipped: SkippedSample[];
}

/**
 * Options de Statut à ajouter pour les seuls exemples donnés (ceux qui seront réellement créés) :
 * libellés cités et absents de la colonne existante. Règle unique, partagée par l'insertion et l'aperçu.
 */
export function statusOptionsToAdd(todo: { statuses: string[] }[], existing: string[] | null): string[] {
  if (!existing || todo.length === 0) return [];
  const have = new Set(existing);
  return [...new Set(todo.flatMap((a) => a.statuses))].filter((x) => !have.has(x));
}

// Index dans statusOptions / typeOptions (ordre de template-messages.ts).
const ST = { fresh: 0, quoteSent: 2, waitingClient: 3, won: 6, lost: 7, dropped: 8 } as const;
const TY_NOTE = 3;

interface Ctx {
  db: Record<CrmRole, string>;
  f: (role: CrmRole, key: string) => string;
  m: SampleAutomationMessages;
}

type Built = Pick<SampleAutomation, "requires" | "triggerType" | "triggerConfig" | "graph"> & { statuses: string[] };

const action = (id: string, actionType: string, actionConfig: Record<string, unknown>, extra: Partial<GraphNode> = {}): GraphNode => ({
  id,
  kind: "action",
  actionType,
  actionConfig,
  ...extra,
});

const chain = (ids: string[]) => ids.slice(0, -1).map((from, i) => ({ from, to: ids[i + 1] }));

const statusCondition = (id: string, c: Ctx, label: string): GraphNode => ({
  id,
  kind: "condition",
  condition: { columnId: c.f("dossiers", "statut"), operator: "is", value: label },
});

const setDossierCells = (c: Ctx, cells: Record<string, unknown>) => ({ databaseId: c.db.dossiers, cells });

const dueTask = (c: Ctx, title: string | undefined, days: number) => ({ title: title ?? "", dueAt: `{{today+${days}}}` });

const noteInteraction = (c: Ctx, subject: string | undefined) => ({
  databaseId: c.db.interactions,
  cells: {
    [c.f("interactions", "date")]: "{{today}}",
    [c.f("interactions", "type")]: c.m.typeOptions[TY_NOTE],
    [c.f("interactions", "dossier")]: ["{{rowId}}"],
    [c.f("interactions", "contact")]: [`{{cells.${c.f("dossiers", "contact")}.0}}`],
    [c.f("interactions", "intitule")]: subject ?? "",
  },
});

const STATUS_TRIGGER = (c: Ctx) => ({ columnId: c.f("dossiers", "statut") });
const BASE = ["dossiers", "dossiers.statut"];
const INTERACTION_REQ = [
  "interactions", "interactions.date", "interactions.type", "interactions.dossier",
  "interactions.contact", "interactions.intitule", "rel:interactionsDossier", "rel:interactionsContact",
  "dossiers.contact",
];

type Builder = (c: Ctx) => Built;

const BUILDERS: Record<SampleAutomationKey, Builder> = {
  quoteFollowUp: (c) => {
    const t = c.m.automations.quoteFollowUp;
    const status = c.m.statusOptions[ST.quoteSent];
    const ids = ["n1", "n2", "n3", "n4"];
    return {
      requires: [...BASE, "dossiers.relance", ...INTERACTION_REQ],
      triggerType: "value_changed",
      triggerConfig: STATUS_TRIGGER(c),
      statuses: [status],
      graph: {
        nodes: [
          statusCondition("n1", c, status),
          action("n2", "update_row", setDossierCells(c, { [c.f("dossiers", "relance")]: "{{today+7}}" })),
          action("n3", "create_task", dueTask(c, t.taskTitle, 7)),
          action("n4", "create_row", noteInteraction(c, t.interactionSubject)),
        ],
        edges: [{ from: ids[0], to: ids[1], branch: "true" }, ...chain(ids.slice(1))],
      },
    };
  },

  waitingFollowUp: (c) => {
    const t = c.m.automations.waitingFollowUp;
    const status = c.m.statusOptions[ST.waitingClient];
    return {
      requires: [...BASE, "dossiers.relance"],
      triggerType: "value_changed",
      triggerConfig: STATUS_TRIGGER(c),
      statuses: [status],
      graph: {
        nodes: [
          statusCondition("n1", c, status),
          action("n2", "update_row", setDossierCells(c, { [c.f("dossiers", "relance")]: "{{today+5}}" })),
          action("n3", "create_task", dueTask(c, t.taskTitle, 5)),
        ],
        edges: [{ from: "n1", to: "n2", branch: "true" }, ...chain(["n2", "n3"])],
      },
    };
  },

  wonClose: (c) => {
    const t = c.m.automations.wonClose;
    const status = c.m.statusOptions[ST.won];
    return {
      requires: [...BASE, "dossiers.cloture", ...INTERACTION_REQ],
      triggerType: "value_changed",
      triggerConfig: STATUS_TRIGGER(c),
      statuses: [status],
      graph: {
        nodes: [
          statusCondition("n1", c, status),
          action("n2", "update_row", setDossierCells(c, { [c.f("dossiers", "cloture")]: "{{today}}" })),
          action("n3", "create_row", noteInteraction(c, t.interactionSubject)),
        ],
        edges: [{ from: "n1", to: "n2", branch: "true" }, ...chain(["n2", "n3"])],
      },
    };
  },

  lostClose: (c) => {
    const t = c.m.automations.lostClose;
    const lost = c.m.statusOptions[ST.lost];
    const dropped = c.m.statusOptions[ST.dropped];
    return {
      requires: [...BASE, "dossiers.cloture", "dossiers.relance"],
      triggerType: "value_changed",
      triggerConfig: STATUS_TRIGGER(c),
      statuses: [lost, dropped],
      graph: {
        nodes: [
          statusCondition("n1", c, lost),
          statusCondition("n2", c, dropped),
          action(
            "n3",
            "update_row",
            setDossierCells(c, { [c.f("dossiers", "cloture")]: "{{today}}", [c.f("dossiers", "relance")]: "" }),
          ),
          action("n4", "create_task", dueTask(c, t.taskTitle, 1)),
        ],
        edges: [
          { from: "n1", to: "n3", branch: "true" },
          { from: "n1", to: "n2", branch: "false" },
          { from: "n2", to: "n3", branch: "true" },
          { from: "n3", to: "n4" },
        ],
      },
    };
  },

  dailyReminders: (c) => {
    const t = c.m.automations.dailyReminders;
    const contact = `{{variables.contact.foundRow.cells.${c.f("contacts", "nom")}}}`;
    return {
      requires: [
        "dossiers", "dossiers.titre", "dossiers.relance", "dossiers.contact", "dossiers.responsable",
        "contacts", "contacts.nom", "rel:dossiersContact",
      ],
      triggerType: "date_reached",
      triggerConfig: { columnId: c.f("dossiers", "relance"), offsetDays: 0, atHour: 8 },
      statuses: [],
      graph: {
        nodes: [
          action(
            "n1",
            "find_row",
            { databaseId: c.db.contacts, rowId: `{{cells.${c.f("dossiers", "contact")}}}` },
            { storeAs: "contact" },
          ),
          action("n2", "notify_user", {
            userId: `{{cells.${c.f("dossiers", "responsable")}.0}}`,
            title: t.reminderText ?? "",
            message: `{{cells.${c.f("dossiers", "titre")}}} (${contact}) : {{cells.${c.f("dossiers", "relance")}}}`,
          }),
        ],
        edges: chain(["n1", "n2"]),
      },
    };
  },

  receptionTally: (c) => {
    const name = "{{variables.tally.name}}";
    const email = "{{variables.tally.email}}";
    const fresh = c.m.statusOptions[ST.fresh];
    return {
      requires: [
        "contacts", "contacts.nom", "contacts.email",
        "dossiers", "dossiers.titre", "dossiers.statut", "dossiers.contact", "dossiers.relance",
        "rel:dossiersContact",
      ],
      triggerType: "webhook_inbound",
      triggerConfig: { tallyFormId: null },
      statuses: [fresh],
      graph: {
        nodes: [
          action(
            "n1",
            "create_row",
            {
              databaseId: c.db.contacts,
              match: { columnId: c.f("contacts", "email"), value: email },
              onMatch: "fill_empty",
              cells: { [c.f("contacts", "nom")]: name, [c.f("contacts", "email")]: email },
            },
            { storeAs: "contact" },
          ),
          action(
            "n2",
            "create_row",
            {
              databaseId: c.db.dossiers,
              cells: {
                [c.f("dossiers", "titre")]: "{{variables.tally.title}}",
                [c.f("dossiers", "statut")]: fresh,
                [c.f("dossiers", "contact")]: ["{{variables.contact.row.id}}"],
              },
            },
            { storeAs: "dossier" },
          ),
          action(
            "n3",
            "update_row",
            {
              databaseId: c.db.dossiers,
              rowId: "{{variables.dossier.row.id}}",
              cells: { [c.f("dossiers", "relance")]: "{{today+1}}" },
            },
          ),
        ],
        edges: chain(["n1", "n2", "n3"]),
      },
    };
  },
};

/**
 * Premier nœud action stockable dans la colonne `action_type` (enum Postgres, sans find_row)
 * rencontré en suivant les arêtes depuis l'entrée (branches vraies avant fausses).
 */
function firstActionNode(graph: AutomationGraph): GraphNode {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const queue = [findEntryNode(graph)!.id];
  const seen = new Set<string>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const node = byId.get(id)!;
    if (node.kind === "action" && (automationActionEnum.enumValues as readonly string[]).includes(node.actionType!)) return node;
    queue.push(...graph.edges.filter((e) => e.from === id).sort((a, b) => (a.branch === "false" ? 1 : 0) - (b.branch === "false" ? 1 : 0)).map((e) => e.to));
  }
  throw new Error("graphe sans nœud action");
}

function missingRequirements(requires: string[], input: SampleAutomationInput): string[] {
  const missing: string[] = [];
  for (const req of requires) {
    let ok: boolean;
    if (req.startsWith("rel:")) ok = !!input.relationIds[req.slice(4) as SampleRelationKey];
    else if (req.includes(".")) {
      const [role, key] = req.split(".");
      ok = !!input.fieldIds[role as CrmRole]?.[key];
    } else ok = !!input.roleDb[req as CrmRole];
    if (!ok) missing.push(req.startsWith("rel:") ? req.slice(4) : req);
  }
  return missing;
}

/**
 * Construit les exemples dont les prérequis sont satisfaits ; les autres sont
 * listés dans `skipped`. Les options de Statut à ajouter se calculent avec
 * `statusOptionsToAdd`, sur les seuls exemples à créer.
 */
export function buildSampleAutomations(input: SampleAutomationInput, m: SampleAutomationMessages): SampleAutomationsResult {
  const c: Ctx = {
    db: input.roleDb as Record<CrmRole, string>,
    f: (role, key) => input.fieldIds[role]?.[key] as string,
    m,
  };
  const automations: SampleAutomation[] = [];
  const skipped: SkippedSample[] = [];
  for (const key of SAMPLE_AUTOMATION_KEYS) {
    const probe = BUILDERS[key]({ ...c, f: (role, k) => input.fieldIds[role]?.[k] ?? "" });
    const missing = missingRequirements(probe.requires, input);
    if (missing.length > 0) {
      skipped.push({ key, missing });
      continue;
    }
    const built = BUILDERS[key](c);
    const first = firstActionNode(built.graph);
    automations.push({
      key,
      name: m.automations[key].name,
      actionType: first.actionType!,
      actionConfig: first.actionConfig ?? {},
      ...built,
    });
  }
  return { automations, skipped };
}
