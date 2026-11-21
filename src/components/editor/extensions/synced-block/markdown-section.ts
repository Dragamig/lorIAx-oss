// Helpers d'extraction de sections markdown pour le bloc synchronisé.
// Permet de ne synchroniser qu'une portion (un titre et son contenu) d'un
// document source plutôt que le document entier.

export interface Heading {
  level: number;
  text: string;
}

// Titre ATX : « # … » à « ###### … », en ignorant les # de fermeture optionnels.
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

function isFence(line: string): boolean {
  return /^\s*(```|~~~)/.test(line);
}

/** Liste les titres du markdown, en ignorant ceux situés dans un bloc de code. */
export function listHeadings(markdown: string): Heading[] {
  const out: Heading[] = [];
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (isFence(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = HEADING_RE.exec(line);
    if (m) out.push({ level: m[1].length, text: m[2].trim() });
  }
  return out;
}

/**
 * Extrait la section commençant au titre `anchor` jusqu'au prochain titre de
 * niveau égal ou supérieur (le titre d'ancrage est inclus dans le résultat).
 * Retourne une chaîne vide si l'ancre est introuvable.
 */
export function extractSection(markdown: string, anchor: string): string {
  if (!anchor) return markdown;
  const lines = markdown.split(/\r?\n/);
  let inFence = false;
  let start = -1;
  let startLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    if (isFence(lines[i])) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const m = HEADING_RE.exec(lines[i]);
    if (!m) continue;

    if (start === -1) {
      if (m[2].trim() === anchor) {
        start = i;
        startLevel = m[1].length;
      }
    } else if (m[1].length <= startLevel) {
      // Prochain titre de niveau ≤ : fin de la section.
      return lines.slice(start, i).join("\n").trim();
    }
  }

  if (start === -1) return "";
  return lines.slice(start).join("\n").trim();
}
