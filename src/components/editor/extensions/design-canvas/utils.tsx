// Design Canvas — pure utilities and shared constants
// Extracted from design-canvas.tsx (monolith). The monolith remains unchanged.
//
// NOTE: SVG_SHAPES and LINE_SHAPES use JSX, so this file is .tsx (not .ts).

import type { DesignDocument, DesignPage } from "../design-constants";

// ─── Sérialisation des calques variabilisés ───────────────────────────────────
//
// Fabric v7 : `canvas.toJSON()` ne prend AUCUN argument (c'est un alias de
// `toObject()` sans `propertiesToInclude`). Pour que les props custom d'un calque
// « rendu variable » survivent à la sérialisation/rechargement, toute persistance
// du design DOIT utiliser `canvas.toObject(PERSIST_PROPS)` (et non `toJSON()`).
// Au rechargement, `loadFromJSON` repose ces props sur les objets Fabric (elles
// sont présentes dans le JSON), donc le round-trip est complet tant que CHAQUE
// sérialisation de persistance inclut ces clés (historique undo/redo compris).
export const PERSIST_PROPS: string[] = ["layerId", "variableKey", "variableLabel"];

// ─── Extraction des variables d'un DesignDocument ─────────────────────────────

export interface DesignVariable {
  key: string;
  label: string;
  layerId: string;
}

/** Objet Fabric minimal parcouru ici (calque texte éventuellement groupé). */
interface FabricLayer {
  layerId?: string;
  variableKey?: string;
  variableLabel?: string;
  objects?: FabricLayer[];
  [key: string]: unknown;
}

function walkLayers(objects: FabricLayer[] | undefined, visit: (o: FabricLayer) => void): void {
  if (!Array.isArray(objects)) return;
  for (const o of objects) {
    if (!o || typeof o !== "object") continue;
    visit(o);
    if (Array.isArray(o.objects)) walkLayers(o.objects, visit);
  }
}

/**
 * Parcourt tous les objets de toutes les pages et collecte les calques
 * « variabilisés » (portant `variableKey`) sous forme `{ key, label, layerId }`.
 * Dédupe par `key` (première occurrence conservée). Sert à l'enregistrement d'un
 * design comme template (colonne `variables` de `design_templates`).
 */
export function extractDesignVariables(pages: DesignPage[]): DesignVariable[] {
  const byKey = new Map<string, DesignVariable>();
  for (const page of pages) {
    const json = page.json as { objects?: FabricLayer[] } | null;
    if (!json) continue;
    walkLayers(json.objects, (o) => {
      if (typeof o.variableKey === "string" && o.variableKey && typeof o.layerId === "string" && o.layerId) {
        if (!byKey.has(o.variableKey)) {
          byKey.set(o.variableKey, {
            key: o.variableKey,
            label: typeof o.variableLabel === "string" && o.variableLabel ? o.variableLabel : o.variableKey,
            layerId: o.layerId,
          });
        }
      }
    });
  }
  return Array.from(byKey.values());
}

/** Slugifie un texte en clé de variable (a-z0-9_), max 40 car. */
export function slugifyVariableKey(s: string): string {
  const slug = s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return slug || "variable";
}

// ─── Unit conversion ─────────────────────────────────────────────────────────

export type DesignUnit = "px" | "cm" | "mm";
export const PX_PER_CM = 96 / 2.54;
export const PX_PER_MM = 96 / 25.4;

export function pxToUnit(px: number, unit: DesignUnit): string {
  if (unit === "px") return String(Math.round(px));
  if (unit === "cm") return (px / PX_PER_CM).toFixed(2);
  return (px / PX_PER_MM).toFixed(1);
}

export function unitToPx(val: string, unit: DesignUnit): number {
  const n = parseFloat(val) || 0;
  if (unit === "px") return n;
  if (unit === "cm") return n * PX_PER_CM;
  return n * PX_PER_MM;
}

// ─── Generic debounce ────────────────────────────────────────────────────────

export function debounce<T extends (...args: unknown[]) => void>(fn: T, delay: number): T {
  let timer: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  }) as T;
}

// ─── Export-safe guidelines guard ─────────────────────────────────────────────
//
// Bug Fabric v7 × smart guides : `Canvas.toCanvasElement` (utilisé par toDataURL /
// toSVG / exports) met `contextTop` (elements.upper.ctx) à `undefined` le temps de
// l'export, MAIS sans try/finally (cf. node_modules/fabric/dist/index.mjs). Or
// l'extension AligningGuidelines enregistre un handler `before:render` qui appelle
// `clearContext(canvas.contextTop)`. Pendant l'export ce contexte est `undefined`
// → le handler jette → Fabric ne restaure jamais `contextTop` → tous les
// `renderAll()` suivants plantent sur `renderTopLayer(undefined)` et le canvas se
// fige (formes plus rendues, miniature/prévisualisation vides).
//
// On détache donc les hooks de rendu des smart guides autour de chaque export, et
// on « répare » `contextTop` en sortie comme filet de sécurité.

type GuidelinesInstance = {
  dispose(): void;
  beforeRender?: () => void;
  afterRender?: () => void;
};

type CanvasWithGuidelines = {
  __aligningGuidelines?: GuidelinesInstance | null;
  off(event: string, handler: unknown): void;
  on(event: string, handler: unknown): void;
  elements?: { upper?: { el?: HTMLCanvasElement; ctx?: CanvasRenderingContext2D } };
};

export function runWithoutGuidelines<T>(canvas: unknown, fn: () => T): T {
  const c = canvas as CanvasWithGuidelines;
  const g = c.__aligningGuidelines ?? null;
  if (g?.beforeRender) c.off("before:render", g.beforeRender);
  if (g?.afterRender) c.off("after:render", g.afterRender);
  try {
    return fn();
  } finally {
    // Filet de sécurité : si l'export a tout de même jeté, Fabric a pu laisser
    // contextTop à undefined → on le rétablit pour que le canvas continue de rendre.
    const up = c.elements?.upper;
    if (up && !up.ctx && up.el) {
      const ctx = up.el.getContext("2d");
      if (ctx) up.ctx = ctx;
    }
    if (g?.beforeRender) c.on("before:render", g.beforeRender);
    if (g?.afterRender) c.on("after:render", g.afterRender);
  }
}

// ─── Schema migration v1 → v2 ────────────────────────────────────────────────

export function migrateToDocument(raw: unknown): DesignDocument {
  if (!raw || typeof raw !== "object") {
    return {
      version: 2,
      title: "Design sans titre",
      pages: [
        {
          id: crypto.randomUUID(),
          name: "Page 1",
          format: "a4-portrait",
          bgColor: "#ffffff",
          json: null,
          thumbnail: null,
        },
      ],
    };
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version === 2 && Array.isArray(obj.pages)) {
    return raw as DesignDocument;
  }
  // Format v1 : raw est directement un Fabric.js JSON
  return {
    version: 2,
    title: typeof obj.title === "string" ? obj.title : "Design sans titre",
    pages: [
      {
        id: crypto.randomUUID(),
        name: "Page 1",
        format: "a4-portrait",
        bgColor: "#ffffff",
        json: raw as object,
        thumbnail: null,
      },
    ],
  };
}

// ─── Font URLs ───────────────────────────────────────────────────────────────

// Plages de graisses complètes (axes variables quand disponibles) pour que le
// slider de graisse et les fontes variables rendent toutes les valeurs 100→900,
// et pas seulement 400/700.
export const GOOGLE_FONTS_URL =
  "https://fonts.googleapis.com/css2?family=Inter:wght@100..900" +
  "&family=DM+Sans:wght@100..900" +
  "&family=Roboto:wght@100;300;400;500;700;900" +
  "&family=Open+Sans:wght@300..800" +
  "&family=Lato:wght@100;300;400;700;900" +
  "&family=Montserrat:wght@100..900" +
  "&family=Nunito:wght@200..900" +
  "&family=Playfair+Display:ital,wght@0,400..900;1,400..900" +
  "&family=Merriweather:ital,wght@0,300;0,400;0,700;0,900;1,300;1,400" +
  "&family=Space+Grotesk:wght@300..700" +
  "&family=Bebas+Neue" +
  "&family=Pacifico" +
  "&display=swap";

export const FONTSHARE_URL =
  "https://api.fontshare.com/v2/css" +
  "?f[]=satoshi@400,700" +
  "&f[]=clash-display@400,700" +
  "&f[]=general-sans@400,700" +
  "&f[]=cabinet-grotesk@400,700" +
  "&f[]=switzer@400,700" +
  "&f[]=chillax@400,700" +
  "&f[]=melodrama@400,700" +
  "&f[]=boska@400,700" +
  "&f[]=zodiak@400,700" +
  "&f[]=britney@400,700" +
  "&display=swap";

// ─── Text presets ─────────────────────────────────────────────────────────────

export interface TextPreset {
  label: string;
  fontSize: number;
  fontWeight: string;
  fontStyle: string;
  fontFamily: string;
}

export const TEXT_PRESETS: TextPreset[] = [
  { label: "Titre",      fontSize: 48, fontWeight: "bold",   fontStyle: "normal", fontFamily: "Plus Jakarta Sans" },
  { label: "Sous-titre", fontSize: 28, fontWeight: "normal", fontStyle: "normal", fontFamily: "Plus Jakarta Sans" },
  { label: "Corps",      fontSize: 18, fontWeight: "normal", fontStyle: "normal", fontFamily: "Plus Jakarta Sans" },
  { label: "Légende",    fontSize: 12, fontWeight: "normal", fontStyle: "italic", fontFamily: "Source Serif 4" },
  { label: "Citation",   fontSize: 22, fontWeight: "normal", fontStyle: "italic", fontFamily: "Playfair Display" },
];

// ─── SVG shapes (preview elements) ───────────────────────────────────────────
// These use JSX, hence the .tsx extension.
// fill/stroke use currentColor so they inherit the text-color of the parent button.

export const SVG_SHAPES = [
  {
    id: "rect",
    label: "Rectangle",
    preview: <rect x="4" y="8" width="24" height="16" rx="1" fill="currentColor" />,
  },
  {
    id: "circle",
    label: "Cercle",
    preview: <circle cx="16" cy="16" r="10" fill="currentColor" />,
  },
  {
    id: "triangle",
    label: "Triangle",
    preview: <polygon points="16,4 28,28 4,28" fill="currentColor" />,
  },
  {
    id: "star",
    label: "Étoile",
    preview: (
      <polygon
        points="16,4 18.5,12 27,12 20.5,17 23,25 16,20 9,25 11.5,17 5,12 13.5,12"
        fill="currentColor"
      />
    ),
  },
  {
    id: "diamond",
    label: "Losange",
    preview: <polygon points="16,3 29,16 16,29 3,16" fill="currentColor" />,
  },
  {
    id: "hexagon",
    label: "Hexagone",
    preview: <polygon points="16,3 28,9.5 28,22.5 16,29 4,22.5 4,9.5" fill="currentColor" />,
  },
  {
    id: "arrow",
    label: "Flèche",
    preview: <polygon points="2,12 20,12 20,8 30,16 20,24 20,20 2,20" fill="currentColor" />,
  },
  {
    id: "bubble",
    label: "Bulle",
    preview: (
      <>
        <rect x="3" y="3" width="26" height="20" rx="4" fill="currentColor" />
        <polygon points="8,23 12,30 16,23" fill="currentColor" />
      </>
    ),
  },
  {
    id: "pentagon",
    label: "Pentagone",
    preview: <polygon points="16,3 29,12 24,27 8,27 3,12" fill="currentColor" />,
  },
];

export const LINE_SHAPES = [
  {
    id: "line",
    label: "Ligne",
    preview: <line x1="4" y1="16" x2="28" y2="16" stroke="currentColor" strokeWidth="2" />,
  },
  {
    id: "dashed-line",
    label: "Pointillés",
    preview: (
      <line
        x1="4"
        y1="16"
        x2="28"
        y2="16"
        stroke="currentColor"
        strokeWidth="2"
        strokeDasharray="4 3"
      />
    ),
  },
  {
    id: "arrow-line",
    label: "Flèche",
    preview: (
      <>
        <line x1="4" y1="16" x2="24" y2="16" stroke="currentColor" strokeWidth="2" />
        <polygon points="24,12 30,16 24,20" fill="currentColor" />
      </>
    ),
  },
];
