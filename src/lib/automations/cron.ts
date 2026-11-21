/**
 * Helpers cron purs (sans I/O) — description lisible (fr), validation, prochaine
 * occurrence et test d'échéance. S'appuie sur `cron-parser` (calcul) et
 * `cronstrue` (libellé). Utilisé par le builder (aperçu) et par tickCron.
 */
import parser from "cron-parser";
import cronstrue from "cronstrue/i18n";

export function isValidCron(expr: string): boolean {
  try {
    parser.parseExpression(expr);
    return true;
  } catch {
    return false;
  }
}

export function describeCron(expr: string): string {
  try {
    return cronstrue.toString(expr, { locale: "fr", use24HourTimeFormat: true });
  } catch {
    return "Expression cron invalide";
  }
}

export function nextCronOccurrence(expr: string, from: Date = new Date()): Date | null {
  try {
    const it = parser.parseExpression(expr, { currentDate: from, tz: "UTC" });
    return it.next().toDate();
  } catch {
    return null;
  }
}

/**
 * Une occurrence tombe-t-elle dans la fenêtre (prev, now] ? `prev` = lastRunAt,
 * ou now - 60 s au premier passage (on ne rejoue pas l'historique).
 */
export function isCronDue(expr: string, lastRunAt: Date | null, now: Date): boolean {
  const prev = lastRunAt ?? new Date(now.getTime() - 60_000);
  const next = nextCronOccurrence(expr, prev);
  return next !== null && next.getTime() <= now.getTime();
}
