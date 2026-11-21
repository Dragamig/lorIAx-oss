/**
 * Logique pure du rattrapage des relations bidirectionnelles (aucune E/S).
 * Utilisée par `scripts/backfill-relations.ts`.
 */
export type Cells = Record<string, unknown>;

export interface BaseLite {
  id: string;
  name: string;
  organizationId: string;
}
export interface ColLite {
  id: string;
  databaseId: string;
  name: string;
  type: string;
  config: unknown;
}

export function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of value) {
    if (typeof v !== "string" || !v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

/** Union : ordre de `existing` conservé, puis les ids nouveaux de `extra`. */
export function unionIds(existing: unknown, extra: unknown): string[] {
  const out = idList(existing);
  const seen = new Set(out);
  for (const id of idList(extra)) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export interface PairPlan {
  /** Nouvelle valeur complète de la cellule, par ligne de A / de B (lignes à modifier seulement). */
  updatesA: Map<string, string[]>;
  updatesB: Map<string, string[]>;
  addedToA: number;
  addedToB: number;
  /** Ids cités dans une colonne mais absents de la base cible. */
  orphansA: number;
  orphansB: number;
}

/**
 * Rattrapage d'un jumelage : si a liste b (colA), b doit lister a (colB), et
 * réciproquement. Union, jamais de retrait. Idempotent.
 */
export function planPairBackfill(args: {
  colA: string;
  colB: string;
  rowsA: ReadonlyArray<{ id: string; cells: Cells }>;
  rowsB: ReadonlyArray<{ id: string; cells: Cells }>;
}): PairPlan {
  const { colA, colB, rowsA, rowsB } = args;
  const idsA = new Set(rowsA.map((r) => r.id));
  const idsB = new Set(rowsB.map((r) => r.id));
  const wantA = new Map<string, string[]>(); // a -> b à lister dans colA
  const wantB = new Map<string, string[]>();
  let orphansA = 0;
  let orphansB = 0;

  for (const a of rowsA) {
    for (const b of idList(a.cells?.[colA])) {
      if (!idsB.has(b)) {
        orphansA++;
        continue;
      }
      wantB.set(b, [...(wantB.get(b) ?? []), a.id]);
    }
  }
  for (const b of rowsB) {
    for (const a of idList(b.cells?.[colB])) {
      if (!idsA.has(a)) {
        orphansB++;
        continue;
      }
      wantA.set(a, [...(wantA.get(a) ?? []), b.id]);
    }
  }

  const build = (
    rows: ReadonlyArray<{ id: string; cells: Cells }>,
    col: string,
    want: Map<string, string[]>
  ) => {
    const updates = new Map<string, string[]>();
    let added = 0;
    for (const r of rows) {
      const extra = want.get(r.id);
      if (!extra) continue;
      const current = idList(r.cells?.[col]);
      const next = unionIds(current, extra);
      if (next.length !== current.length) {
        updates.set(r.id, next);
        added += next.length - current.length;
      }
    }
    return { updates, added };
  };
  const a = build(rowsA, colA, wantA);
  const b = build(rowsB, colB, wantB);
  return {
    updatesA: a.updates,
    updatesB: b.updates,
    addedToA: a.added,
    addedToB: b.added,
    orphansA,
    orphansB,
  };
}

const targetOf = (c: ColLite): string | null => {
  const t = (c.config as Record<string, unknown> | null)?.targetDatabaseId;
  return typeof t === "string" && t ? t : null;
};
const inverseOf = (c: ColLite): string | null => {
  const t = (c.config as Record<string, unknown> | null)?.inverseColumnId;
  return typeof t === "string" && t ? t : null;
};

export interface Candidates {
  candidates: Array<{ a: ColLite; b: ColLite }>;
  /** Groupes (A,B) où plusieurs colonnes d'un côté : listés, jamais corrigés. */
  ambiguous: Array<{ databaseA: string; databaseB: string; a: ColLite[]; b: ColLite[] }>;
  /** Relations non jumelées sans contrepartie (candidates à --create-inverse). */
  unmatched: ColLite[];
  alreadyPaired: number;
}

/** Une colonne est jumelée si sa jumelle existe, est relation et pointe en retour. */
export function isReciprocal(c: ColLite, byId: Map<string, ColLite>): boolean {
  const inv = inverseOf(c);
  if (!inv) return false;
  const o = byId.get(inv);
  return !!o && o.type === "relation" && inverseOf(o) === c.id;
}

export function findCandidates(columns: ColLite[], bases: BaseLite[]): Candidates {
  const baseById = new Map(bases.map((b) => [b.id, b]));
  const rels = columns.filter((c) => c.type === "relation");
  const byId = new Map(rels.map((c) => [c.id, c]));
  const out: Candidates = { candidates: [], ambiguous: [], unmatched: [], alreadyPaired: 0 };

  const unpaired: ColLite[] = [];
  let paired = 0;
  for (const c of rels) {
    if (isReciprocal(c, byId)) paired++;
    else unpaired.push(c);
  }
  out.alreadyPaired = paired / 2;

  const sameOrg = (x: string, y: string) => {
    const bx = baseById.get(x);
    const by = baseById.get(y);
    return !!bx && !!by && bx.organizationId === by.organizationId;
  };

  const handled = new Set<string>();
  for (const c of unpaired) {
    if (handled.has(c.id)) continue;
    const t = targetOf(c);
    if (!t || t === c.databaseId || !baseById.has(t) || !sameOrg(c.databaseId, t)) {
      handled.add(c.id);
      out.unmatched.push(c);
      continue;
    }
    const forward = unpaired.filter((x) => x.databaseId === c.databaseId && targetOf(x) === t);
    const back = unpaired.filter((x) => x.databaseId === t && targetOf(x) === c.databaseId);
    forward.forEach((x) => handled.add(x.id));
    if (back.length === 0) {
      out.unmatched.push(...forward);
      continue;
    }
    back.forEach((x) => handled.add(x.id));
    if (forward.length === 1 && back.length === 1) {
      out.candidates.push({ a: forward[0], b: back[0] });
    } else {
      out.ambiguous.push({ databaseA: c.databaseId, databaseB: t, a: forward, b: back });
    }
  }
  return out;
}

/** Découpages possibles de « Base.Colonne » (les noms peuvent contenir des points). */
export function splitRef(ref: string): Array<{ base: string; column: string }> {
  const out: Array<{ base: string; column: string }> = [];
  for (let i = 0; i < ref.length; i++) {
    if (ref[i] === "." && i > 0 && i < ref.length - 1) {
      out.push({ base: ref.slice(0, i), column: ref.slice(i + 1) });
    }
  }
  return out;
}

export function parsePairArg(arg: string): { left: string; right: string } {
  const i = arg.indexOf("=");
  if (i <= 0 || i === arg.length - 1) {
    throw new Error(`--pair invalide (attendu « Base A.Colonne A=Base B.Colonne B ») : ${arg}`);
  }
  return { left: arg.slice(0, i).trim(), right: arg.slice(i + 1).trim() };
}
