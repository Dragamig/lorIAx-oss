/**
 * Jours fériés France métropolitaine.
 * Liste statique pour le MVP — à remplacer par une lib (date-holidays)
 * en V2 pour gérer la récurrence et les régions.
 */
const FIXED_HOLIDAYS_FR_2026 = [
  "2026-01-01", // Jour de l'an
  "2026-04-06", // Lundi de Pâques
  "2026-05-01", // Fête du Travail
  "2026-05-08", // Victoire 1945
  "2026-05-14", // Ascension
  "2026-05-25", // Lundi de Pentecôte
  "2026-07-14", // Fête nationale
  "2026-08-15", // Assomption
  "2026-11-01", // Toussaint
  "2026-11-11", // Armistice
  "2026-12-25", // Noël
];

const FIXED_HOLIDAYS_FR_2027 = [
  "2027-01-01",
  "2027-03-29", // Lundi de Pâques
  "2027-05-01",
  "2027-05-06", // Ascension
  "2027-05-08",
  "2027-05-17", // Lundi de Pentecôte
  "2027-07-14",
  "2027-08-15",
  "2027-11-01",
  "2027-11-11",
  "2027-12-25",
];

const ALL_HOLIDAYS = new Set([
  ...FIXED_HOLIDAYS_FR_2026,
  ...FIXED_HOLIDAYS_FR_2027,
]);

export function isFrenchHoliday(date: Date): boolean {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return ALL_HOLIDAYS.has(`${y}-${m}-${d}`);
}
