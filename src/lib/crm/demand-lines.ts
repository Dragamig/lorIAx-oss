/**
 * Lignes du tableau récapitulatif d'une demande reçue par Tally.
 *
 * Les formulaires Tally sont libres (libellés et champs propres à chaque client) :
 * aucune extraction déterministe des lignes n'est fiable. Le texte des réponses
 * est donc confié à une extraction structurée (injectée, testable), puis chaque
 * ligne est validée seule : une ligne inexploitable est écartée avec un
 * avertissement, jamais fatale.
 */
import { z } from "zod";
import { LINE_TYPES, type DemandLine } from "@/lib/spreadsheet/demand-workbook";

interface TallyOption { id?: unknown; text?: unknown }
interface TallyFieldRaw { label?: unknown; key?: unknown; type?: unknown; value?: unknown; options?: unknown }

function tallyFields(body: unknown): TallyFieldRaw[] {
  const b = body as { eventType?: unknown; data?: { fields?: unknown } } | null | undefined;
  if (b?.eventType !== "FORM_RESPONSE" || !Array.isArray(b.data?.fields)) return [];
  return b.data.fields as TallyFieldRaw[];
}

export function isTallyBody(body: unknown): boolean {
  return (body as { eventType?: unknown } | null | undefined)?.eventType === "FORM_RESPONSE";
}

function answerText(f: TallyFieldRaw): string {
  const v = f.value;
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    const options = Array.isArray(f.options) ? (f.options as TallyOption[]) : [];
    return v
      .map((item) => {
        if (typeof item === "string") {
          const o = options.find((x) => x?.id === item);
          return typeof o?.text === "string" ? o.text : item;
        }
        if (item && typeof item === "object") {
          const name = (item as { name?: unknown }).name;
          return typeof name === "string" ? name : "";
        }
        return typeof item === "number" ? String(item) : "";
      })
      .filter(Boolean)
      .join(", ");
  }
  return "";
}

/** Réponses renseignées d'une réponse Tally, une par ligne, « libellé : valeur » (sans URL de fichier). */
export function tallyAnswersText(body: unknown): string {
  return tallyFields(body)
    .map((f) => {
      const a = answerText(f);
      if (!a) return "";
      const label = typeof f.label === "string" && f.label.trim() ? f.label.trim() : typeof f.key === "string" ? f.key : "Champ";
      return `${label} : ${a}`;
    })
    .filter(Boolean)
    .join("\n");
}

const MAX_TEXT = 500;
/** Plafonds : texte envoyé à l'IA et nombre de lignes retenues. */
export const MAX_ANSWERS_CHARS = 12_000;
export const MAX_LINES = 100;

/**
 * Schéma transmis au modèle : volontairement permissif (aucune borne), pour qu'une
 * valeur hors limites ne fasse jamais échouer toute la sortie. La validation se fait ligne par ligne.
 */
export const demandLinesAiSchema = z.object({ lines: z.array(z.unknown()) });

export interface ExtractedLines { lines: DemandLine[]; warnings: string[] }

const fold = (v: string) => v.normalize("NFD").replace(/\p{M}/gu, "").trim().toLowerCase();

function text(v: unknown): string | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v !== "string") return undefined;
  const t = v.trim().slice(0, MAX_TEXT);
  return t || undefined;
}

interface Normalized { line: DemandLine | null; badQuantity: boolean }

function normalizeLine(raw: unknown): Normalized {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { line: null, badQuantity: false };
  const d = raw as Record<string, unknown>;
  let quantite: number | undefined;
  let badQuantity = false;
  if (d.quantite !== undefined && d.quantite !== null) {
    if (typeof d.quantite === "number" && Number.isFinite(d.quantite) && d.quantite >= 0) quantite = d.quantite;
    else badQuantity = true;
  }
  const rawType = typeof d.type === "string" ? fold(d.type) : "";
  const type = LINE_TYPES.find((t) => fold(t) === rawType);
  const line: DemandLine = {
    sku: text(d.sku), modele: text(d.modele), couleur: text(d.couleur), taille: text(d.taille), matiere: text(d.matiere),
    quantite, type, personnalisation: text(d.personnalisation), delai: text(d.delai),
    statut: "À chiffrer", provenance: "Extrait",
  };
  const useful = [line.sku, line.modele, line.couleur, line.taille, line.matiere, line.quantite, line.personnalisation];
  const ok = useful.some((v) => v !== undefined && v !== "");
  return { line: ok ? line : null, badQuantity: ok && badQuantity };
}

export type DemandLinesGenerator = (answersText: string) => Promise<unknown>;

export async function extractDemandLines(body: unknown, generate: DemandLinesGenerator): Promise<ExtractedLines> {
  const answers = tallyAnswersText(body).slice(0, MAX_ANSWERS_CHARS);
  if (!answers) return { lines: [], warnings: [] };
  let raw: unknown;
  try {
    raw = await generate(answers);
  } catch (err) {
    return { lines: [], warnings: [`Extraction des lignes impossible : ${err instanceof Error ? err.message : String(err)}`] };
  }
  const parsed = z.object({ lines: z.array(z.unknown()) }).safeParse(raw);
  if (!parsed.success) return { lines: [], warnings: ["Extraction des lignes : réponse IA inexploitable"] };
  const warnings: string[] = [];
  const items = parsed.data.lines;
  if (items.length > MAX_LINES) warnings.push(`${items.length} lignes reçues : seules les ${MAX_LINES} premières sont gardées`);
  const lines: DemandLine[] = [];
  let dropped = 0;
  let badQty = 0;
  for (const item of items.slice(0, MAX_LINES)) {
    const n = normalizeLine(item);
    if (n.line) lines.push(n.line);
    else dropped++;
    if (n.badQuantity) badQty++;
  }
  if (dropped > 0) warnings.push(`${dropped} ligne(s) inexploitable(s) écartée(s)`);
  if (badQty > 0) warnings.push(`quantité invalide écartée sur ${badQty} ligne(s)`);
  return { lines, warnings };
}
