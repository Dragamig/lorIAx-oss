import type { DbColumn, DbRow, CellValue } from "./types";
import {
  toDate,
  addToDate,
  diffUnit,
  formatDate,
  startOfDay,
} from "./date-helpers";

export function evaluateFormula(
  formula: string,
  row: DbRow,
  columns: DbColumn[],
  opts?: { now?: Date }
): CellValue {
  try {
    const tokens = tokenize(formula.trim());
    const parser = new Parser(tokens, row, columns, opts?.now ?? new Date());
    return parser.parse();
  } catch {
    return "#ERREUR";
  }
}

type Token =
  | { type: "number"; value: number }
  | { type: "string"; value: string }
  | { type: "bool"; value: boolean }
  | { type: "ident"; value: string }
  | { type: "op"; value: string }
  | { type: "paren"; value: string }
  | { type: "comma"; value: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < input.length) {
    if (/\s/.test(input[i])) { i++; continue; }
    if (/[0-9.]/.test(input[i])) {
      let num = "";
      while (i < input.length && /[0-9.]/.test(input[i])) num += input[i++];
      tokens.push({ type: "number", value: parseFloat(num) });
      continue;
    }
    if (input[i] === '"') {
      i++;
      let str = "";
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) {
          // Escape sequence: consume backslash and next char
          i++;
          str += input[i++];
        } else {
          str += input[i++];
        }
      }
      i++;
      tokens.push({ type: "string", value: str });
      continue;
    }
    if ("+-*/%".includes(input[i])) { tokens.push({ type: "op", value: input[i++] }); continue; }
    if (input[i] === "=" && input[i + 1] === "=") { tokens.push({ type: "op", value: "==" }); i += 2; continue; }
    if (input[i] === "!" && input[i + 1] === "=") { tokens.push({ type: "op", value: "!=" }); i += 2; continue; }
    if (input[i] === ">" && input[i + 1] === "=") { tokens.push({ type: "op", value: ">=" }); i += 2; continue; }
    if (input[i] === "<" && input[i + 1] === "=") { tokens.push({ type: "op", value: "<=" }); i += 2; continue; }
    if (input[i] === ">" || input[i] === "<") { tokens.push({ type: "op", value: input[i++] }); continue; }
    if ("()".includes(input[i])) { tokens.push({ type: "paren", value: input[i++] }); continue; }
    if (input[i] === ",") { tokens.push({ type: "comma", value: "," }); i++; continue; }
    if (/[a-zA-Z_]/.test(input[i])) {
      let ident = "";
      while (i < input.length && /[a-zA-Z_0-9]/.test(input[i])) ident += input[i++];
      if (ident === "true") tokens.push({ type: "bool", value: true });
      else if (ident === "false") tokens.push({ type: "bool", value: false });
      else tokens.push({ type: "ident", value: ident });
      continue;
    }
    i++;
  }
  return tokens;
}

class Parser {
  private tokens: Token[];
  private pos = 0;
  private row: DbRow;
  private columns: DbColumn[];
  private now: Date;

  constructor(tokens: Token[], row: DbRow, columns: DbColumn[], now: Date) {
    this.tokens = tokens;
    this.row = row;
    this.columns = columns;
    this.now = now;
  }

  // Formate une date en date seule à minuit, sinon en date-heure ISO locale.
  private formatAuto(d: Date): string {
    const midnight = d.getHours() === 0 && d.getMinutes() === 0 && d.getSeconds() === 0;
    return formatDate(d, midnight ? "YYYY-MM-DD" : "YYYY-MM-DDTHH:mm:ss");
  }

  private peek(): Token | undefined { return this.tokens[this.pos]; }
  private next(): Token { return this.tokens[this.pos++]; }

  parse(): CellValue {
    const result = this.parseExpression();
    if (result === undefined) return null;
    return result as CellValue;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseExpression(): any {
    return this.parseComparison();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseComparison(): any {
    let left = this.parseAddSub();
    while (this.peek()?.type === "op" && ["==", "!=", ">", "<", ">=", "<="].includes(this.peek()!.value as string)) {
      const op = this.next().value;
      const right = this.parseAddSub();
      switch (op) {
        case "==": left = left == right; break;
        case "!=": left = left != right; break;
        case ">": left = left > right; break;
        case "<": left = left < right; break;
        case ">=": left = left >= right; break;
        case "<=": left = left <= right; break;
      }
    }
    return left;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseAddSub(): any {
    let left = this.parseMulDiv();
    while (this.peek()?.type === "op" && ["+", "-"].includes(this.peek()!.value as string)) {
      const op = this.next().value;
      const right = this.parseMulDiv();
      if (op === "+") {
        if (typeof left === "string" || typeof right === "string") left = String(left ?? "") + String(right ?? "");
        else left = (Number(left) || 0) + (Number(right) || 0);
      } else {
        left = (Number(left) || 0) - (Number(right) || 0);
      }
    }
    return left;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseMulDiv(): any {
    let left = this.parseUnary();
    while (this.peek()?.type === "op" && ["*", "/", "%"].includes(this.peek()!.value as string)) {
      const op = this.next().value;
      const right = this.parseUnary();
      if (op === "*") left = (Number(left) || 0) * (Number(right) || 0);
      else if (op === "/") { const r = Number(right) || 0; left = r === 0 ? "#DIV/0" : (Number(left) || 0) / r; }
      else left = (Number(left) || 0) % (Number(right) || 0);
    }
    return left;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseUnary(): any {
    if (this.peek()?.type === "op" && this.peek()?.value === "-") {
      this.next();
      return -(Number(this.parsePrimary()) || 0);
    }
    return this.parsePrimary();
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parsePrimary(): any {
    const token = this.peek();
    if (!token) return null;
    if (token.type === "number") { this.next(); return token.value; }
    if (token.type === "string") { this.next(); return token.value; }
    if (token.type === "bool") { this.next(); return token.value; }
    if (token.type === "paren" && token.value === "(") {
      this.next();
      const result = this.parseExpression();
      if (this.peek()?.type === "paren" && this.peek()?.value === ")") this.next();
      return result;
    }
    if (token.type === "ident") {
      const name = token.value;
      this.next();
      if (this.peek()?.type === "paren" && this.peek()?.value === "(") {
        this.next();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const args: any[] = [];
        while (this.peek() && !(this.peek()?.type === "paren" && this.peek()?.value === ")")) {
          args.push(this.parseExpression());
          if (this.peek()?.type === "comma") this.next();
        }
        if (this.peek()?.type === "paren" && this.peek()?.value === ")") this.next();
        return this.callFunction(name, args);
      }
      return name;
    }
    this.next();
    return null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private callFunction(name: string, args: any[]): any {
    switch (name.toLowerCase()) {
      case "prop": {
        const colName = String(args[0] ?? "");
        const col = this.columns.find((c) => c.name === colName);
        if (!col) return null;
        return this.row.cells?.[col.id] ?? null;
      }
      case "abs": return Math.abs(Number(args[0]) || 0);
      case "round": return Math.round(Number(args[0]) || 0);
      case "floor": return Math.floor(Number(args[0]) || 0);
      case "ceil": return Math.ceil(Number(args[0]) || 0);
      case "sqrt": return Math.sqrt(Number(args[0]) || 0);
      case "pow": return Math.pow(Number(args[0]) || 0, Number(args[1]) || 0);
      case "min": return args.reduce((m, a) => Math.min(m, Number(a) || 0), Number(args[0]) || 0);
      case "max": return args.reduce((m, a) => Math.max(m, Number(a) || 0), Number(args[0]) || 0);
      case "concat": return args.map((a) => String(a ?? "")).join("");
      case "length": return String(args[0] ?? "").length;
      case "lower": return String(args[0] ?? "").toLowerCase();
      case "upper": return String(args[0] ?? "").toUpperCase();
      case "contains": return String(args[0] ?? "").includes(String(args[1] ?? ""));
      case "if": return args[0] ? args[1] : args[2];
      case "and": return args.every(Boolean);
      case "or": return args.some(Boolean);
      case "not": return !args[0];
      case "empty": return args[0] == null || args[0] === "" || (Array.isArray(args[0]) && args[0].length === 0);
      // ─── Dates (parité Airtable) ──────────────────────────────────────────
      case "today": return formatDate(this.now, "YYYY-MM-DD");
      case "now": return formatDate(this.now, "YYYY-MM-DDTHH:mm:ss");
      case "dateadd": {
        // dateadd(date, n, unit) → date décalée. date omise/invalide ⇒ maintenant.
        const base = toDate(args[0]) ?? this.now;
        return this.formatAuto(addToDate(base, Number(args[1]) || 0, args[2]));
      }
      case "datetime_diff": {
        // datetime_diff(d1, d2, unit) → d1 - d2 dans l'unité, tronqué.
        const a = toDate(args[0]);
        const b = toDate(args[1]);
        if (!a || !b) return 0;
        return diffUnit(a, b, args[2]);
      }
      case "datetime_format": {
        // datetime_format(date, fmt) → chaîne formatée (défaut YYYY-MM-DD).
        const d = toDate(args[0]) ?? this.now;
        return formatDate(d, String(args[1] ?? "YYYY-MM-DD"));
      }
      case "year": { const d = toDate(args[0]); return d ? d.getFullYear() : null; }
      case "month": { const d = toDate(args[0]); return d ? d.getMonth() + 1 : null; }
      case "day": { const d = toDate(args[0]); return d ? d.getDate() : null; }
      case "weekday": {
        // weekday(date, [startOfWeek]) → 0..6. Défaut dimanche=0 (Airtable) ;
        // "Monday"/"lundi" ⇒ lundi=0.
        const d = toDate(args[0]);
        if (!d) return null;
        const dow = d.getDay(); // 0 = dimanche
        const start = String(args[1] ?? "").toLowerCase();
        if (start === "monday" || start === "lundi") return (dow + 6) % 7;
        return dow;
      }
      case "is_before": {
        const a = toDate(args[0]);
        const b = toDate(args[1]);
        return a && b ? a.getTime() < b.getTime() : false;
      }
      case "is_after": {
        const a = toDate(args[0]);
        const b = toDate(args[1]);
        return a && b ? a.getTime() > b.getTime() : false;
      }
      case "is_same": {
        // is_same(d1, d2, [unit]) → égalité à la granularité de l'unité.
        // Sans unité : égalité exacte (millisecondes).
        const a = toDate(args[0]);
        const b = toDate(args[1]);
        if (!a || !b) return false;
        const unit = String(args[2] ?? "").toLowerCase();
        if (!unit) return a.getTime() === b.getTime();
        if (["y", "year", "years"].includes(unit)) return a.getFullYear() === b.getFullYear();
        if (["mo", "month", "months", "m"].includes(unit))
          return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
        // défaut : jour
        return startOfDay(a) === startOfDay(b);
      }
      case "hour":
        // hour("14:30") → 14
        return parseInt(String(args[0] ?? "00:00").split(":")[0], 10) || 0;
      case "minute":
        // minute("14:30") → 30
        return parseInt(String(args[0] ?? "00:00").split(":")[1], 10) || 0;
      case "formattime":
        // formatTime("14:30") → "14:30"
        return String(args[0] ?? "");
      case "timediff": {
        // timeDiff("08:00", "14:30") → 390 (minutes)
        const toMinutes = (t: string) => {
          const parts = String(t ?? "00:00").split(":");
          return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
        };
        return toMinutes(String(args[1] ?? "")) - toMinutes(String(args[0] ?? ""));
      }
      case "addminutes": {
        // addMinutes("14:30", 90) → "16:00"
        const toMinutes2 = (t: string) => {
          const parts = String(t ?? "00:00").split(":");
          return (parseInt(parts[0], 10) || 0) * 60 + (parseInt(parts[1], 10) || 0);
        };
        const totalMinutes = toMinutes2(String(args[0] ?? "")) + (Number(args[1]) || 0);
        const normalized = ((totalMinutes % 1440) + 1440) % 1440;
        const hh = Math.floor(normalized / 60).toString().padStart(2, "0");
        const mm = (normalized % 60).toString().padStart(2, "0");
        return `${hh}:${mm}`;
      }
      case "nowtime": {
        // nowTime() → heure actuelle "HH:MM"
        const now = new Date();
        return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      }
      default: return null;
    }
  }
}
