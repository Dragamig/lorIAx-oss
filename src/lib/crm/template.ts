import type { TemplateColumn, TemplateDatabase, TemplateView } from "@/lib/databases/templates/types";
import { CRM_FIELDS, type CrmFieldDef, type CrmRole } from "./fields";
import type { MissingColumn } from "./plan";
import type { TemplateMessages } from "./template-messages";

export interface CrmRelationSpec {
  from: CrmRole;
  to: CrmRole;
  fieldKey: string;
  name: string;
  inverseName: string;
}

/** Options de modèle d'un champ `select` (Statut, Type), sinon aucune. */
function optionsFor(role: CrmRole, key: string, m: TemplateMessages): string[] | undefined {
  if (role === "dossiers" && key === "statut") return m.statusOptions;
  if (role === "interactions" && key === "type") return m.typeOptions;
  return undefined;
}

function toColumn(def: CrmFieldDef, name: string, m: TemplateMessages): TemplateColumn {
  const col: TemplateColumn = { key: def.key, name, type: def.types[0] };
  const options = def.types[0] === "select" ? optionsFor(def.role, def.key, m) : undefined;
  if (options) col.options = [...options];
  return col;
}

/** Poids de la spec CRM 6.5, dans l'ordre des options de Statut ; les trois derniers statuts sont clos. */
const STATUS_WEIGHTS = [10, 20, 40, 50, 60, 70, 100, 0, 0] as const;
const CLOSED_FROM = 6;

type Cond = { id: string; columnId: string; operator: string; value: string };
const tree = (...children: Cond[]) => ({ id: "root", type: "group", conjunction: "and", children });
const cond = (id: string, columnId: string, operator: string, value = ""): Cond => ({ id, columnId, operator, value });
const base = (filters: unknown, sorts: { columnId: string; direction: "asc" | "desc" }[] = []) => ({
  filters,
  sorts,
  visibleColumns: "*",
  version: "v1",
});

/** Vues d'exemple de la base Dossiers créée : valeurs d'options de Statut = libellés stockés. */
export function dossiersViews(m: TemplateMessages): TemplateView[] {
  const v = m.views;
  const [won] = m.statusOptions.slice(CLOSED_FROM);
  return [
    {
      name: v.pipeline,
      type: "kanban",
      config: (c) => ({
        ...base(tree()),
        groupByColumnId: c.statut,
        kanbanTotals: {
          amountColumnId: c.montant,
          closedLanes: m.statusOptions.slice(CLOSED_FROM),
          weights: Object.fromEntries(m.statusOptions.map((label, i) => [label, STATUS_WEIGHTS[i]])),
          currency: "EUR",
          showWeighted: true,
        },
      }),
    },
    {
      name: v.followUps,
      type: "grid",
      config: (c) => base(tree(cond("c1", c.relance, "is_not_empty")), [{ columnId: c.relance, direction: "asc" }]),
    },
    { name: v.all, type: "grid", config: () => base(tree()) },
    {
      name: v.mine,
      type: "grid",
      config: (c) => base(tree(cond("c1", c.responsable, "is_me"))),
    },
    {
      name: v.wonThisQuarter,
      type: "grid",
      config: (c) =>
        base(tree(cond("c1", c.statut, "is", won), cond("c2", c.cloture, "is_this_quarter")), [
          { columnId: c.cloture, direction: "desc" },
        ]),
    },
  ];
}

/** Une base par rôle : tous les champs sauf les relations, posées ensuite par `crmRelations`. */
export function buildRoleDatabase(role: CrmRole, m: TemplateMessages): TemplateDatabase {
  const db: TemplateDatabase = {
    key: role,
    name: m.databases[role],
    columns: CRM_FIELDS[role]
      .filter((f) => f.types[0] !== "relation")
      .map((f) => toColumn(f, m.fields[role][f.key], m)),
  };
  if (role === "dossiers") db.views = dossiersViews(m);
  return db;
}

export function crmRelations(m: TemplateMessages): CrmRelationSpec[] {
  return [
    { from: "dossiers", to: "contacts", fieldKey: "contact", name: m.fields.dossiers.contact, inverseName: m.inverseNames.contactDossiers },
    { from: "interactions", to: "dossiers", fieldKey: "dossier", name: m.fields.interactions.dossier, inverseName: m.inverseNames.dossierInteractions },
    { from: "interactions", to: "contacts", fieldKey: "contact", name: m.fields.interactions.contact, inverseName: m.inverseNames.dossierInteractions },
  ];
}

/** Colonnes à ajouter à une base existante : nom déjà arbitré par le plan, options de modèle pour un select. */
export function missingToTemplateColumns(missing: MissingColumn[], role: CrmRole, m: TemplateMessages): TemplateColumn[] {
  return missing.map((x) => {
    const col: TemplateColumn = { key: x.fieldKey, name: x.name, type: x.type };
    const options = x.type === "select" ? optionsFor(role, x.fieldKey, m) : undefined;
    if (options) col.options = [...options];
    return col;
  });
}
