// Formate la valeur stockée (entier) selon la config d'une colonne autonumber.
export function formatAutonumber(
  value: unknown,
  config?: { padding?: number; prefix?: string; suffix?: string }
): string {
  if (value == null || value === "") return "";
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return "";
  const padding = Math.max(0, Math.floor(config?.padding ?? 0));
  const body = padding > 0 ? String(n).padStart(padding, "0") : String(n);
  return `${config?.prefix ?? ""}${body}${config?.suffix ?? ""}`;
}
