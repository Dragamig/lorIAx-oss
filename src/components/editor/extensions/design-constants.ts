// Shared constants for the Design Studio (formats, fonts, document types).

export type PageFormat =
  | "a4-portrait"
  | "a4-landscape"
  | "square"
  | "free"
  | "social-square"
  | "social-portrait"
  | "social-story"
  | "social-wide";

export interface PageDimensions {
  width: number;
  height: number;
}

export const PAGE_FORMATS: Record<PageFormat, PageDimensions> = {
  "a4-portrait": { width: 595, height: 842 },
  "a4-landscape": { width: 842, height: 595 },
  square: { width: 800, height: 800 },
  free: { width: 800, height: 600 },
  "social-square": { width: 1080, height: 1080 },
  "social-portrait": { width: 1080, height: 1350 },
  "social-story": { width: 1080, height: 1920 },
  "social-wide": { width: 1920, height: 1080 },
};

export const FORMAT_LABELS: Record<PageFormat, string> = {
  "a4-portrait": "A4 Portrait",
  "a4-landscape": "A4 Paysage",
  square: "Carré (800×800)",
  free: "Libre",
  "social-square": "Post carré (1080×1080)",
  "social-portrait": "Post portrait 4:5 (1080×1350)",
  "social-story": "Story 9:16 (1080×1920)",
  "social-wide": "Paysage 16:9 (1920×1080)",
};

/** Snap margin in page px, shared by AligningGuidelines and page snapping. */
export const SNAP_THRESHOLD = 6;

export const FORMAT_GROUPS: Array<{ label: string; formats: PageFormat[] }> = [
  { label: "Réseaux sociaux", formats: ["social-square", "social-portrait", "social-story", "social-wide"] },
  { label: "Impression", formats: ["a4-portrait", "a4-landscape"] },
  { label: "Autres", formats: ["square", "free"] },
];

export const FONT_GROUPS: Array<{ label: string; fonts: string[] }> = [
  {
    label: "LorIAx",
    fonts: ["Plus Jakarta Sans", "Source Serif 4", "JetBrains Mono"],
  },
  {
    label: "Web classiques",
    fonts: ["Inter", "DM Sans", "Roboto", "Open Sans", "Lato", "Montserrat", "Nunito"],
  },
  {
    label: "Display / Éditoriales",
    fonts: ["Playfair Display", "Merriweather", "Space Grotesk", "Bebas Neue", "Pacifico"],
  },
  {
    label: "Fontshare",
    fonts: ["Satoshi", "Clash Display", "General Sans", "Cabinet Grotesk", "Switzer", "Chillax", "Melodrama", "Boska", "Zodiak", "Britney"],
  },
];

export interface DesignPage {
  id: string;
  name: string;
  format: PageFormat;
  bgColor: string;
  json: object | null;
  thumbnail: string | null;
  customWidth?: number;
  customHeight?: number;
}

export interface DesignDocument {
  version: 2;
  title: string;
  pages: DesignPage[];
}
