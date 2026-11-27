/** Logique pure de la boîte Réception Tally : identifiant de formulaire et correspondance des champs. */

export interface TallyField {
  key: string;
  label: string;
  type: string;
}

export type FieldMapKey = "name" | "email" | "title";
export type StoredFieldMap = Partial<Record<FieldMapKey, string>>;

export interface MappingChoice {
  /** Clé du champ Tally ; null = aucun (ou automatique pour le titre). */
  key: string | null;
  /** Vrai quand la sélection vient de la détection par type, non d'un choix enregistré. */
  detected: boolean;
}
export type MappingState = Record<FieldMapKey, MappingChoice>;

const URL_RE = /^https?:\/\/(?:www\.)?tally\.so\/(?:r|forms|embed)\/([A-Za-z0-9]{4,})(?:[/?#].*)?$/;
const ID_RE = /^[A-Za-z0-9]{4,12}$/;

/** Extrait l'identifiant d'un formulaire depuis une URL tally.so ou un identifiant nu. */
export function extractTallyFormId(input: string): { id?: string; error?: true } {
  const v = input.trim();
  if (!v) return {};
  const m = v.match(URL_RE);
  if (m) return { id: m[1] };
  if (ID_RE.test(v)) return { id: v };
  return { error: true };
}

const firstOfType = (fields: TallyField[], type: string): string | null => fields.find((f) => f.type === type)?.key ?? null;

/** Même règle que le serveur : nom = premier INPUT_TEXT, e-mail = premier INPUT_EMAIL, titre = nom du contact. */
export function resolveMapping(stored: StoredFieldMap | undefined, fields: TallyField[]): MappingState {
  const pick = (k: "name" | "email", type: string): MappingChoice => {
    const s = stored?.[k];
    if (typeof s === "string" && s !== "") return { key: s, detected: false };
    const d = firstOfType(fields, type);
    return { key: d, detected: d !== null };
  };
  const t = stored?.title;
  return {
    name: pick("name", "INPUT_TEXT"),
    email: pick("email", "INPUT_EMAIL"),
    title: { key: typeof t === "string" && t !== "" ? t : null, detected: false },
  };
}

/** Correspondance à enregistrer : seuls les choix explicites, la détection et le titre automatique restent implicites. */
export function buildFieldMap(state: MappingState): StoredFieldMap {
  const out: StoredFieldMap = {};
  for (const k of ["name", "email", "title"] as const) {
    const c = state[k];
    if (c.key && !c.detected) out[k] = c.key;
  }
  return out;
}
