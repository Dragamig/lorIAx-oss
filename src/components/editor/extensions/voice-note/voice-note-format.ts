/** Mise en forme des libelles du bloc note vocale. Fonctions pures, testables seules. */

/** Compteur d'enregistrement : `02:14`, ou `1:02:14` au dela de l'heure. */
export function formatClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${pad(minutes)}:${pad(seconds)}`;
}

/** Duree en toutes lettres : `2 min 41 s`, `45 s`, `1 h 03 min`. */
export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined || totalSeconds < 0) {
    return "durée inconnue";
  }
  const safe = Math.floor(totalSeconds);
  if (safe < 60) return `${safe} s`;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  return seconds > 0 ? `${minutes} min ${seconds} s` : `${minutes} min`;
}

/** Nombre de mots du transcript, pour la mention discrete de l'accordéon. */
export function countWords(text: string | null | undefined): number {
  if (!text) return 0;
  const matches = text.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

export function formatWordCount(text: string | null | undefined): string {
  const count = countWords(text);
  return count <= 1 ? `${count} mot` : `${count} mots`;
}

/** Titre du bloc une fois la note aboutie : « Note vocale du 17 août ». */
export function formatNoteTitle(createdAt: string | null | undefined): string {
  if (!createdAt) return "Note vocale";
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "Note vocale";
  return `Note vocale du ${date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
  })}`;
}

/** Date courte, en toutes lettres : « 17 août 2026 ». */
export function formatConvertedDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Heure courte d'une génération : « 12 h 44 ». */
export function formatShortTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours} h ${minutes}`;
}
