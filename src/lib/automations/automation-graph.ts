/**
 * Modèle graphe des automatisations (C5.2a) — éditeur visuel n8n-like.
 *
 * Une automatisation peut porter un `graph` optionnel : un enchaînement de nœuds
 * `action` (webhook, email, IA, create_row, …) et `condition` (test sur une
 * cellule, deux sorties true/false). Le déclencheur reste porté par les colonnes
 * (trigger_type/config) ; le graphe ne décrit QUE la suite d'actions.
 *
 * Module 100 % pur (aucun import serveur) : il porte les types, la validation
 * structurelle (entrée unique, acyclicité, arêtes cohérentes), la synthèse du
 * graphe de repli depuis l'action linéaire historique, et l'évaluation des
 * conditions. L'executor s'appuie dessus pour la marche effective.
 *
 * IMPORTANT : ne rien importer ici qui tire `server-only` (db, executor, etc.),
 * afin que ce module reste testable sous vitest sans charger le runtime serveur.
 */
import { matchesFilter } from "@/components/editor/extensions/database-block/filter-tree";
import type {
  CellValue,
  ColumnType,
  FilterOperator,
} from "@/components/editor/extensions/database-block/types";

export type GraphNodeKind = "action" | "condition";

/** Condition d'un nœud `condition` : test d'une cellule via `matchesFilter`. */
export interface GraphCondition {
  /**
   * Source testée. Absente ou "cell" : cellule `columnId` de la ligne
   * déclencheuse (conditions historiques). "variable" : valeur de
   * `variables.<path>` issue d'une étape précédente (`storeAs`).
   */
  source?: "cell" | "variable";
  /** Chemin pointé sous `variables` (source "variable"), ex. `crm.foundRow.id`. */
  path?: string;
  columnId: string;
  operator: FilterOperator;
  value?: string;
  colType?: ColumnType;
}

export interface GraphNode {
  /** Identifiant stable, unique dans le graphe. */
  id: string;
  kind: GraphNodeKind;
  /** Renseignés pour kind === "action". */
  actionType?: string;
  actionConfig?: Record<string, unknown>;
  /**
   * Nom de variable où stocker le résultat de l'action, réutilisable dans les
   * étapes suivantes via `{{variables.<storeAs>...}}`. Optionnel.
   */
  storeAs?: string;
  /**
   * Nœud action seulement. Vrai : si l'étape échoue, l'erreur est tracée mais le
   * graphe continue (sortie de l'étape = null) et le run finit « partial ».
   * Défaut : faux (l'échec arrête le scénario).
   */
  continueOnError?: boolean;
  /** Renseignée pour kind === "condition". */
  condition?: GraphCondition;
}

export interface GraphEdge {
  from: string;
  to: string;
  /**
   * Pour les arêtes sortant d'un nœud condition : sur quelle sortie
   * (vrai/faux) elles partent. Absent pour les arêtes d'un nœud action.
   */
  branch?: "true" | "false";
}

export interface AutomationGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** Opérateurs autorisés quand la source est une variable. */
export const VARIABLE_CONDITION_OPERATORS: readonly FilterOperator[] = [
  "is_empty",
  "is_not_empty",
  "is",
  "is_not",
];

/**
 * Un automatisme n'a pas d'utilisateur courant : `is_me` ne correspondrait à
 * aucune ligne. Il est refusé à l'enregistrement plutôt que de désactiver
 * silencieusement la condition.
 */
export const IS_ME_REJECTED_MESSAGE =
  "L'opérateur « est moi » n'est pas disponible dans un automatisme";

export type GraphValidation = { ok: true } | { ok: false; error: string };

const MAX_NODES = 50;
const MAX_EDGES = 100;

/**
 * Valide la structure d'un graphe d'automatisation :
 *   - au moins un nœud, bornes de taille ;
 *   - identifiants de nœuds uniques ;
 *   - arêtes pointant des nœuds existants, pas de boucle directe ;
 *   - chaque nœud action a un actionType ; chaque condition a une condition ;
 *   - les arêtes sortant d'une condition portent un branch true/false, celles
 *     des actions n'en portent pas ;
 *   - une seule entrée (un seul nœud sans arête entrante) ;
 *   - acyclicité (DFS) ;
 *   - une condition a au plus une sortie par branche.
 */
export function validateGraph(graph: AutomationGraph): GraphValidation {
  const { nodes, edges } = graph;

  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    return { ok: false, error: "Graphe invalide : nodes et edges requis" };
  }
  if (nodes.length === 0) {
    return { ok: false, error: "Le graphe doit contenir au moins un nœud" };
  }
  if (nodes.length > MAX_NODES) {
    return { ok: false, error: `Trop de nœuds (max ${MAX_NODES})` };
  }
  if (edges.length > MAX_EDGES) {
    return { ok: false, error: `Trop d'arêtes (max ${MAX_EDGES})` };
  }

  const byId = new Map<string, GraphNode>();
  for (const node of nodes) {
    if (!node.id) return { ok: false, error: "Nœud sans identifiant" };
    if (byId.has(node.id)) {
      return { ok: false, error: `Identifiant de nœud en double : ${node.id}` };
    }
    if (node.kind === "action") {
      if (!node.actionType) {
        return { ok: false, error: `Nœud action sans actionType : ${node.id}` };
      }
      if (node.continueOnError !== undefined && typeof node.continueOnError !== "boolean") {
        return { ok: false, error: `continueOnError doit être booléen : ${node.id}` };
      }
    } else if (node.kind === "condition") {
      const cond = node.condition;
      if (cond?.operator === "is_me") {
        return { ok: false, error: IS_ME_REJECTED_MESSAGE };
      }
      if (cond?.source === "variable") {
        if (!cond.path?.trim() || !cond.operator) {
          return { ok: false, error: `Nœud condition incomplet : ${node.id}` };
        }
        if (!VARIABLE_CONDITION_OPERATORS.includes(cond.operator)) {
          return { ok: false, error: `Opérateur non supporté pour une variable : ${node.id}` };
        }
      } else if (!cond || !cond.columnId || !cond.operator) {
        return { ok: false, error: `Nœud condition incomplet : ${node.id}` };
      }
    } else {
      return { ok: false, error: `Type de nœud inconnu : ${node.id}` };
    }
    byId.set(node.id, node);
  }

  // Arêtes : endpoints existants, pas de self-loop, branch cohérent, unicité.
  const incoming = new Map<string, number>();
  const branchSeen = new Set<string>();
  for (const edge of edges) {
    const fromNode = byId.get(edge.from);
    const toNode = byId.get(edge.to);
    if (!fromNode) return { ok: false, error: `Arête depuis un nœud inconnu : ${edge.from}` };
    if (!toNode) return { ok: false, error: `Arête vers un nœud inconnu : ${edge.to}` };
    if (edge.from === edge.to) {
      return { ok: false, error: `Boucle directe interdite sur ${edge.from}` };
    }

    if (fromNode.kind === "condition") {
      if (edge.branch !== "true" && edge.branch !== "false") {
        return { ok: false, error: `Arête d'une condition sans branche true/false : ${edge.from}` };
      }
      const key = `${edge.from}:${edge.branch}`;
      if (branchSeen.has(key)) {
        return { ok: false, error: `Branche ${edge.branch} dupliquée sur ${edge.from}` };
      }
      branchSeen.add(key);
    } else if (edge.branch) {
      return { ok: false, error: `Arête d'une action ne doit pas porter de branche : ${edge.from}` };
    }

    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }

  // Entrée unique : exactement un nœud sans arête entrante.
  const roots = nodes.filter((n) => !incoming.has(n.id));
  if (roots.length === 0) {
    return { ok: false, error: "Aucune entrée : le graphe est cyclique" };
  }
  if (roots.length > 1) {
    return { ok: false, error: "Le graphe doit avoir une seule entrée" };
  }

  // Acyclicité : DFS coloration depuis l'entrée + détection d'inaccessibles.
  const adjacency = new Map<string, string[]>();
  for (const edge of edges) {
    const list = adjacency.get(edge.from) ?? [];
    list.push(edge.to);
    adjacency.set(edge.from, list);
  }
  const WHITE = 0, GREY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const n of nodes) color.set(n.id, WHITE);

  const stack: Array<{ id: string; phase: "enter" | "exit" }> = [
    { id: roots[0].id, phase: "enter" },
  ];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.phase === "exit") {
      color.set(frame.id, BLACK);
      continue;
    }
    if (color.get(frame.id) === GREY) continue;
    color.set(frame.id, GREY);
    stack.push({ id: frame.id, phase: "exit" });
    for (const next of adjacency.get(frame.id) ?? []) {
      const c = color.get(next);
      if (c === GREY) return { ok: false, error: "Le graphe contient un cycle" };
      if (c === WHITE) stack.push({ id: next, phase: "enter" });
    }
  }

  return { ok: true };
}

/**
 * Construit un graphe à un seul nœud action depuis le couple (action_type,
 * action_config) historique. Utilisé comme repli quand `graph` est null →
 * l'executor traite uniformément linéaire et graphe.
 */
export function synthesizeGraphFromAction(
  actionType: string,
  actionConfig: Record<string, unknown> | null | undefined
): AutomationGraph {
  return {
    nodes: [
      {
        id: "root",
        kind: "action",
        actionType,
        actionConfig: actionConfig ?? {},
      },
    ],
    edges: [],
  };
}

/** Renvoie le nœud d'entrée (sans arête entrante) ou undefined. */
export function findEntryNode(graph: AutomationGraph): GraphNode | undefined {
  const hasIncoming = new Set(graph.edges.map((e) => e.to));
  return graph.nodes.find((n) => !hasIncoming.has(n.id));
}

/**
 * Identifiants des nœuds suivants depuis `nodeId`. Pour un nœud condition, on
 * filtre par la branche retenue (true/false) ; pour une action, toutes les
 * arêtes sortantes (sans branche).
 */
export function nextNodeIds(
  graph: AutomationGraph,
  nodeId: string,
  branch?: "true" | "false"
): string[] {
  return graph.edges
    .filter((e) => e.from === nodeId && (branch === undefined || e.branch === branch))
    .map((e) => e.to);
}

/** Lit `a.b.c` dans un objet ; undefined si un maillon manque. */
function readPath(root: unknown, path: string): unknown {
  let cur: unknown = root;
  for (const key of path.split(".").filter(Boolean)) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

/**
 * Évalue la condition d'un nœud : contre les cellules du payload (source
 * cellule, défaut) ou contre `variables.<path>` (source "variable").
 */
export function evaluateCondition(
  condition: GraphCondition,
  cells: Record<string, unknown>,
  variables: Record<string, unknown> = {}
): boolean {
  if (condition.source === "variable") {
    let raw = readPath(variables, condition.path ?? "") as CellValue;
    if (raw === undefined) raw = null;
    // Un objet (ex. foundRow) est « présent » ; une chaîne vide ou null est vide.
    return matchesFilter(raw, condition.operator, condition.value ?? "");
  }
  const raw = cells[condition.columnId] as CellValue;
  return matchesFilter(raw, condition.operator, condition.value ?? "", {
    colType: condition.colType,
  });
}

/**
 * Nœud de jonction d'une condition : premier nœud, dans l'ordre de parcours de
 * la branche vrai, qui est aussi atteignable depuis la branche faux. Null si
 * les deux branches ne convergent pas.
 */
export function findJoinNode(graph: AutomationGraph, conditionId: string): string | null {
  const start = (b: "true" | "false") =>
    graph.edges.find((e) => e.from === conditionId && e.branch === b)?.to ?? null;
  const walk = (from: string | null): string[] => {
    const order: string[] = [];
    const seen = new Set<string>();
    const queue = from ? [from] : [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      if (seen.has(id)) continue;
      seen.add(id);
      order.push(id);
      for (const e of graph.edges) if (e.from === id) queue.push(e.to);
    }
    return order;
  };
  const falseSet = new Set(walk(start("false")));
  return walk(start("true")).find((id) => falseSet.has(id)) ?? null;
}
