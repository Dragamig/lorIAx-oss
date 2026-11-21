/**
 * Logique pure du déclencheur d'automatisation « date atteinte » (C1).
 *
 * Isolée de l'executor (qui importe des modules serveur — DNS, BDD) pour rester
 * testable sans dépendances. L'executor importe ces helpers et les applique aux
 * lignes d'une base à chaque tick minute.
 */

/**
 * Vrai si l'échéance `targetMs` franchit la fenêtre (prevCheckMs, nowMs].
 *
 * C'est le cœur anti-doublon : une échéance ne déclenche qu'une seule fois, au
 * tick où elle passe le seuil, et jamais à nouveau aux ticks suivants
 * (target ≤ prevCheck). Tous les arguments en epoch ms.
 */
export function isDateRowDue(targetMs: number, prevCheckMs: number, nowMs: number): boolean {
  return targetMs > prevCheckMs && targetMs <= nowMs;
}

/**
 * Convertit une valeur de cellule date en epoch ms, optionnellement recalée à
 * une heure de la journée (`atHour`, 0–23). Renvoie null si la valeur est vide
 * ou non parsable — la ligne est alors ignorée par le tick.
 */
export function parseCellDateMs(raw: unknown, atHour?: number): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const str = typeof raw === "string" ? raw : String(raw);
  const d = new Date(str);
  if (Number.isNaN(d.getTime())) return null;
  if (typeof atHour === "number" && atHour >= 0 && atHour <= 23) {
    d.setHours(atHour, 0, 0, 0);
  }
  return d.getTime();
}
