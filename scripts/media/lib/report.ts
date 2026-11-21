/**
 * Rapport des scripts de réécriture de la médiathèque (B72).
 * Aucune connexion base ici : module pur, testable sans infrastructure.
 */

export type RewriteOutcome =
  | "rewritten"
  | "already_new"
  | "orphan"
  | "key_not_found"
  | "ambiguous"
  | "unparseable"
  | "skipped_concurrent"
  | "unchanged";

export const OUTCOMES: readonly RewriteOutcome[] = [
  "rewritten",
  "already_new",
  "orphan",
  "key_not_found",
  "ambiguous",
  "unparseable",
  "skipped_concurrent",
  "unchanged",
];

export interface ReportRef {
  table: string;
  id: string;
  detail?: string;
}

interface ReportEntry {
  kind: string;
  outcome: RewriteOutcome;
  ref: ReportRef;
}

function emptyCounts(): Record<RewriteOutcome, number> {
  const counts = {} as Record<RewriteOutcome, number>;
  for (const o of OUTCOMES) counts[o] = 0;
  return counts;
}

export class Report {
  private entries: ReportEntry[] = [];

  constructor(private meta: { script: string; apply: boolean; target?: string } = { script: "", apply: false }) {}

  add(kind: string, outcome: RewriteOutcome, ref: ReportRef): void {
    this.entries.push({ kind, outcome, ref });
  }

  summary(): Record<string, Record<RewriteOutcome, number>> {
    const out: Record<string, Record<RewriteOutcome, number>> = {};
    for (const e of this.entries) {
      if (!out[e.kind]) out[e.kind] = emptyCounts();
      out[e.kind][e.outcome] += 1;
    }
    return out;
  }

  /** Entrées qui demandent une attention humaine (tout sauf réécrit, déjà neuf, inchangé). */
  private attention(): ReportEntry[] {
    const quiet: RewriteOutcome[] = ["rewritten", "already_new", "unchanged"];
    return this.entries.filter((e) => !quiet.includes(e.outcome));
  }

  toJSON(): object {
    return {
      ...this.meta,
      summary: this.summary(),
      attention: this.attention().map((e) => ({ kind: e.kind, outcome: e.outcome, ...e.ref })),
      total: this.entries.length,
    };
  }

  toText(): string {
    const lines: string[] = [];
    lines.push(`Rapport ${this.meta.script || "réécriture"} (${this.meta.apply ? "écriture" : "simulation"})`);
    if (this.meta.target) lines.push(`Base cible : ${this.meta.target}`);
    const summary = this.summary();
    const kinds = Object.keys(summary).sort();
    if (kinds.length === 0) lines.push("Aucune référence examinée.");
    for (const kind of kinds) {
      const c = summary[kind];
      const parts = OUTCOMES.filter((o) => c[o] > 0).map((o) => `${o} ${c[o]}`);
      lines.push(`${kind} : ${parts.join(", ")}`);
    }
    const attention = this.attention();
    if (attention.length > 0) {
      lines.push("À examiner :");
      for (const e of attention) {
        lines.push(`  ${e.outcome} ${e.ref.table} ${e.ref.id}${e.ref.detail ? ` (${e.ref.detail})` : ""}`);
      }
    }
    return lines.join("\n");
  }
}
