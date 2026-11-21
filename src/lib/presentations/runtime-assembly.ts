/**
 * Pièces LorIAx assemblées dans le runtime servi : document de démarrage,
 * habillage de la barre et pont. Leur hachage entre dans l'URL de l'iframe,
 * pour qu'un cache navigateur ne serve jamais un pont périmé.
 *
 * Module sans dépendance serveur : importé aussi côté client par `runtimeUrl`.
 */
import { RUNTIME_BRIDGE_SCRIPT } from "./runtime-bridge-script";

/**
 * Document injecté dans la balise que le runtime lit au démarrage.
 *
 * Sans lui, le runtime ouvre son diaporama de démonstration, que l'utilisateur
 * verrait clignoter avant l'arrivée du vrai document par le pont. Une unique
 * diapositive vide est plus honnête. Le contenu réel est toujours transmis
 * ensuite par le message `load`, jamais par cette route, qui doit rester
 * identique pour tout le monde afin d'être mise en cache indéfiniment.
 */
export const BLANK_DECK = JSON.stringify({
  format: "bento/slides",
  version: 1,
  docId: "00000000-0000-4000-8000-000000000000",
  title: "",
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
      id: "00000000-0000-4000-8000-000000000001",
      background: "#FFFFFF",
      transition: "fade",
      notes: "",
      elements: [],
    },
  ],
  modified: "1970-01-01T00:00:00.000Z",
});

/**
 * Habillage de la barre du moteur.
 *
 * L'artefact affiche sa propre marque « bento/slides » en haut à gauche : un
 * pictogramme et un mot-symbole, à l'intérieur d'un bouton qui ouvre la boîte
 * « À propos » (version, mises à jour, licences). La licence MIT n'impose pas
 * cet affichage, et une marque tierce n'a rien à faire dans la barre d'une
 * présentation LorIAx : le bloc entier est masqué. L'hommage au moteur vit
 * ailleurs, dans l'alias `/bento` de la commande slash des documents.
 *
 * Le texte de la licence n'est pas perdu pour autant : il reste dans
 * `vendor/bento/<version>/` et dans `docs/briques-libres-licences.md`, ce que
 * MIT demande. Rien n'oblige à l'afficher dans une interface.
 *
 * Le geste est purement visuel et ne touche pas l'artefact vendorisé : le
 * moteur reconstruit sa barre à chaque rendu, une retouche du DOM se ferait
 * défaire, une règle de style non.
 */
export const BRAND_CSS = ".ed-logo { display: none !important; }";

/** Hachage 53 bits (cyrb53), pur JS : identique côté serveur et navigateur. */
function hash53(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
}

/** Calculé une fois au chargement du module. */
export const RUNTIME_ASSEMBLY_HASH = hash53(
  [RUNTIME_BRIDGE_SCRIPT, BRAND_CSS, BLANK_DECK].join("\u0000")
);
