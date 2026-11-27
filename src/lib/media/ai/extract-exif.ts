import exifr from "exifr";

const PICK = [
  "Make",
  "Model",
  "DateTimeOriginal",
  "ImageDescription",
  "Artist",
  "Copyright",
  "XPTitle",
  "XPComment",
  "XPAuthor",
  "XPKeywords",
  "Keywords",
  "subject",
  "title",
  "description",
  "creator",
  "rights",
];

const flat = (v: unknown): string => {
  if (v == null) return "";
  if (Array.isArray(v)) return v.map(flat).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    return flat(o.value ?? o["x-default"] ?? Object.values(o)[0]);
  }
  return String(v).replace(/\0/g, "").trim();
};

/**
 * Texte descriptif tiré de l'EXIF/IPTC/XMP : appareil, date de prise de vue,
 * description, auteur, droits, mots-clés. Liste blanche de champs et `gps:
 * false` : aucune coordonnée ni altitude, jamais. `null` sans métadonnées.
 */
export async function extractExifText(buffer: Buffer): Promise<string | null> {
  try {
    const d = (await exifr.parse(buffer, {
      gps: false,
      tiff: true,
      exif: true,
      iptc: true,
      xmp: true,
      icc: false,
      jfif: false,
      ihdr: false,
      reviveValues: false,
      mergeOutput: true,
      translateKeys: true,
      translateValues: true,
    })) as Record<string, unknown> | undefined;
    if (!d) return null;
    // Liste blanche appliquée à la sortie (le filtre `pick` d'exifr ignore XMP).
    for (const k of Object.keys(d)) if (!PICK.includes(k)) delete d[k];
    const line = (label: string, ...keys: string[]) => {
      const v = keys.map((k) => flat(d[k])).find(Boolean);
      return v ? `${label} : ${v}` : "";
    };
    const date = flat(d.DateTimeOriginal).replace(/^(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3");
    const camera = [flat(d.Make), flat(d.Model)].filter(Boolean).join(" ");
    const lines = [
      camera ? `Appareil : ${camera}` : "",
      date ? `Date de prise de vue : ${date}` : "",
      line("Titre", "XPTitle", "title"),
      line("Description", "ImageDescription", "description", "XPComment"),
      line("Auteur", "Artist", "XPAuthor", "creator"),
      line("Copyright", "Copyright", "rights"),
      line("Mots-clés", "XPKeywords", "Keywords", "subject"),
    ].filter(Boolean);
    return lines.length ? lines.join("\n") : null;
  } catch {
    return null;
  }
}
