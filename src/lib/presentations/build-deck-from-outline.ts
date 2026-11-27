/**
 * Construit un diaporama à partir du plan validé d'une proposition de création.
 *
 * Part de `createEmptyDeck` et n'écrit que l'enveloppe décrite par `deckSchema`
 * et les champs de texte déjà posés par ce module (ADR-082) : rien d'autre du
 * format Bento n'est modélisé ici.
 */
import { randomUUID } from "crypto";
import { createEmptyDeck, type Deck } from "@/lib/presentations/deck";
import type { PresentationProposal } from "@/lib/ai/creation/schemas";

const MAX_SLIDES = 12;

type OutlineSlide = PresentationProposal["slides"][number];

/** Le champ `html` du runtime est interprété : tout texte y entre échappé. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

function textElement(
  html: string,
  box: { x: number; y: number; w: number; h: number },
  style: {
    fontSize: number;
    fontWeight: number;
    align: "left" | "center";
    valign: "top" | "middle";
    role?: string;
  }
) {
  return {
    id: randomUUID(),
    type: "text",
    ...box,
    rotation: 0,
    opacity: 1,
    html,
    fontFamily: FONT,
    color: "#1E2A3A",
    lineHeight: 1.3,
    ...style,
  };
}

function buildSlide(slide: OutlineSlide) {
  const layout = slide.layout ?? "content";
  const title = escapeHtml(slide.title);
  const elements =
    layout === "content"
      ? [
          textElement(title, { x: 80, y: 60, w: 1120, h: 100 }, {
            fontSize: 44, fontWeight: 700, align: "left", valign: "middle", role: "title",
          }),
          ...(slide.bullets?.length
            ? [
                textElement(
                  slide.bullets.map((b) => `• ${escapeHtml(b)}`).join("<br>"),
                  { x: 80, y: 190, w: 1120, h: 460 },
                  { fontSize: 28, fontWeight: 400, align: "left", valign: "top", role: "body" }
                ),
              ]
            : []),
        ]
      : [
          textElement(title, { x: 140, y: 260, w: 1000, h: 140 }, {
            fontSize: layout === "cover" ? 64 : 56,
            fontWeight: 700,
            align: layout === "cover" ? "left" : "center",
            valign: "middle",
            role: "title",
          }),
        ];
  return {
    id: randomUUID(),
    background: "#FFFFFF",
    transition: "fade",
    notes: slide.notes ?? "",
    elements,
  };
}

export function buildDeckFromOutline(title: string, slides: OutlineSlide[]): Deck {
  const deck = createEmptyDeck(title);
  deck.slides = slides.slice(0, MAX_SLIDES).map(buildSlide);
  return deck;
}
