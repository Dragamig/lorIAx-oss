// Helpers de normalisation des options de colonne « select » / « multiSelect ».
//
// Une option peut être stockée sous deux formes :
//   - une simple chaîne ("Prospect")
//   - un objet { label, color } (cas des templates, ex. BDD clients)
//
// Rendre un objet directement comme enfant React (`<option>{opt}</option>` ou une
// pastille `{opt}`) déclenche « React error #31 » et fait planter le bloc (cf. #66).
// On normalise donc systématiquement vers le libellé textuel avant tout rendu.

export function optionLabel(o: unknown): string {
  if (typeof o === "string") return o;
  if (o && typeof o === "object") {
    const obj = o as { label?: unknown; value?: unknown };
    return String(obj.label ?? obj.value ?? "");
  }
  return "";
}

export function normalizeOptions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(optionLabel).filter(Boolean);
  if (typeof raw === "string") return raw.split(",").map((s) => s.trim()).filter(Boolean);
  return [];
}
