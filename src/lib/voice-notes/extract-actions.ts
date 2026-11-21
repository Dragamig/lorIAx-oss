/**
 * Extraction des actions listées dans la synthèse markdown d'une note vocale.
 *
 * Le prompt `note-vocale-synthese` (voir `lib/ai/builtin-prompts.ts`) impose une
 * section `## Actions` avec une liste à puces au format "- action (échéance si
 * mentionnée)", ou la ligne "(Aucune)" quand rien n'a été dicté. On parse ce
 * markdown de façon tolérante (variantes de titre, puces `*`/`+`, listes
 * numérotées) car la sortie vient d'un LLM et ne respecte pas toujours le
 * format à la lettre.
 */

// Repère un titre markdown (1 à 3 dièses) pour délimiter le début et la fin
// de la section Actions.
const HEADING_RE = /^#{1,3}\s*(.+?)\s*:?\s*$/;

// Normalise un titre de section pour une comparaison tolérante aux accents et
// à la casse (le LLM écrit parfois "## Actions", parfois "##Actions :", etc.).
function normalizeHeading(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Retire la marque de liste (puce ou numéro) en tête de ligne, sans toucher
// au reste du texte : l'échéance entre parenthèses fait partie de l'intitulé
// et doit être conservée telle quelle.
const LIST_MARKER_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;

function stripListMarker(line: string): string | null {
  if (!LIST_MARKER_RE.test(line)) return null;
  return line.replace(LIST_MARKER_RE, "").trim();
}

// Une entrée "(Aucune)" (avec ou sans accent, insensible à la casse) ne
// compte pas comme une action réelle.
function isNoneMarker(text: string): boolean {
  return normalizeHeading(text).replace(/^\(|\)$/g, "") === "aucune";
}

export function extractVoiceNoteActions(summaryMarkdown: string | null | undefined): string[] {
  if (!summaryMarkdown) return [];

  const lines = summaryMarkdown.split(/\r?\n/);

  // 1. Localiser la ligne de titre "Actions".
  let sectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(HEADING_RE);
    if (match && normalizeHeading(match[1]) === "actions") {
      sectionStart = i + 1;
      break;
    }
  }
  if (sectionStart === -1) return [];

  // 2. La section s'étend jusqu'au prochain titre markdown ou la fin du texte.
  let sectionEnd = lines.length;
  for (let i = sectionStart; i < lines.length; i++) {
    if (HEADING_RE.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }

  // 3. Ne retenir que les items de liste ; tout le reste (lignes vides, texte
  // parasite non-puce) est ignoré plutôt que rejeté en bloc.
  const actions: string[] = [];
  const seen = new Set<string>();
  for (let i = sectionStart; i < sectionEnd; i++) {
    const item = stripListMarker(lines[i]);
    if (item === null || item === "") continue;
    if (isNoneMarker(item)) continue;

    const dedupeKey = item.replace(/\s+/g, " ").trim();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    actions.push(item);
  }

  return actions;
}
