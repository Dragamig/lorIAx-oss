/**
 * Document de présentation, côté LorIAx.
 *
 * Le format complet appartient au runtime Bento vendorisé et n'est pas
 * reproduit ici : on n'en décrit que l'enveloppe, celle dont l'application a
 * réellement besoin pour créer un document neuf, compter ses diapositives et
 * refuser une charge utile qui n'est pas un diaporama. Le reste des champs
 * traverse l'application sans être interprété.
 *
 * Ce choix est délibéré : plus notre modèle décrit finement le format d'un
 * tiers, plus une montée de version amont casse de code. Le point de contact
 * est ici, et nulle part ailleurs.
 */
import { z } from "zod";
import { randomUUID } from "crypto";

/** Marqueur de format posé par le runtime, seul contrôle d'identité fiable. */
export const DECK_FORMAT = "bento/slides";

/** Version de format lue et écrite par le runtime vendorisé. */
export const DECK_FORMAT_VERSION = 1;

/**
 * Enveloppe minimale. `passthrough` est essentiel : tout ce que le runtime
 * ajoute (thème, polices embarquées, mises en page, notes) doit survivre à un
 * aller-retour par nos routes, sans que nous ayons à le décrire.
 */
export const deckSchema = z
  .object({
    format: z.literal(DECK_FORMAT),
    version: z.number().int().positive(),
    title: z.string().optional(),
    slides: z.array(z.unknown()).min(1),
  })
  .passthrough()
  // `collab` est la pièce de session partagée que le moteur ajoute de lui-même
  // (salle sur un service tiers, clés privées). LorIAx n'utilise aucune session
  // externe : le champ n'est ni conservé ni enregistré, où qu'il soit parsé.
  .transform((deck) => {
    const { collab: _collab, ...rest } = deck as Record<string, unknown>;
    void _collab;
    return rest as typeof deck;
  });

export type Deck = z.infer<typeof deckSchema>;

/**
 * Empreinte de comparaison : le document sans les champs que le moteur réécrit
 * seul (`modified` à chaque retouche, `collab` à l'ouverture). Deux documents
 * qui ne diffèrent que par eux ont le même contenu et n'appellent aucune
 * écriture. `modified` reste enregistré avec le document, seule la comparaison
 * l'ignore.
 */
export function deckFingerprint(deck: unknown): string {
  if (deck && typeof deck === "object") {
    const { collab: _c, modified: _m, ...rest } = deck as Record<string, unknown>;
    void _c;
    void _m;
    return JSON.stringify(rest);
  }
  return JSON.stringify(deck);
}

/** Nombre de diapositives, pour l'affichage du bloc et de la liste. */
export function countSlides(deck: Deck): number {
  return deck.slides.length;
}

/**
 * Document neuf : une diapositive de titre, rien d'autre.
 *
 * Le runtime sait démarrer sur un document vide, mais il ouvre alors son
 * diaporama de démonstration, ce qu'un utilisateur qui vient de cliquer
 * « Nouvelle présentation » ne comprendrait pas. Un document minimal explicite
 * est plus honnête et coûte quelques lignes.
 */
export function createEmptyDeck(title: string): Deck {
  const now = new Date().toISOString();
  return {
    format: DECK_FORMAT,
    version: DECK_FORMAT_VERSION,
    docId: randomUUID(),
    title,
    size: { width: 1280, height: 720 },
    theme: {
      background: "#FFFFFF",
      color: "#1E2A3A",
      accent: "#F7A600",
      fontFamily:
        "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    },
    slides: [
      {
        id: randomUUID(),
        background: "#FFFFFF",
        transition: "fade",
        notes: "",
        elements: [
          {
            id: randomUUID(),
            type: "text",
            x: 140,
            y: 260,
            w: 1000,
            h: 140,
            rotation: 0,
            opacity: 1,
            html: title,
            fontSize: 64,
            fontFamily:
              "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
            fontWeight: 700,
            color: "#1E2A3A",
            align: "left",
            valign: "middle",
            lineHeight: 1.2,
            role: "title",
          },
        ],
      },
    ],
    modified: now,
  } as Deck;
}
