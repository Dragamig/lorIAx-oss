/**
 * Contrat de dialogue entre l'application et le runtime de présentation.
 *
 * Le runtime vit dans une iframe en ORIGINE OPAQUE (sandbox sans
 * `allow-same-origin`). Conséquence directe : `event.origin` y vaut la chaîne
 * `"null"` et ne prouve rien. Le seul contrôle non usurpable côté parent est
 * `event.source === iframe.contentWindow`, et le parent poste en
 * `targetOrigin: "*"`, faute d'origine à nommer. C'est assumé : l'iframe ne
 * peut ni lire nos cookies, ni notre stockage, ni notre DOM, et sa CSP lui
 * coupe tout accès réseau.
 *
 * Tout message entrant est validé ici. Un message non conforme est ignoré et
 * journalisé, jamais interprété partiellement.
 */
import { z } from "zod";
import { deckSchema } from "./deck";

/** Mode d'ouverture demandé au runtime. */
export const presentationModeSchema = z.enum(["edit", "play"]);
export type PresentationMode = z.infer<typeof presentationModeSchema>;

/** Messages du parent vers le runtime. */
export type ParentMessage =
  | {
      type: "load";
      /**
       * Le moteur demande lui-même le plein écran quand son propre bouton lance
       * le diaporama. Faux quand le parent s'en charge, depuis un document, où
       * le clic a lieu chez lui.
       */
      autoFullscreen?: boolean;
      deck: unknown;
      mode: PresentationMode;
      locale: string;
    }
  | { type: "requestSave" };

/**
 * Messages du runtime vers le parent.
 *
 * `saved` porte le document complet : c'est le parent qui décide de l'écrire,
 * le runtime ne connaît ni nos routes ni notre stockage.
 */
export const runtimeMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ready"),
    /** Vrai quand le runtime a démarré en lecteur, sans outils d'édition. */
    readonly: z.boolean(),
  }),
  z.object({
    type: z.literal("dirty"),
    dirty: z.boolean(),
  }),
  z.object({
    type: z.literal("saved"),
    deck: deckSchema,
  }),
  /**
   * L'utilisateur a demandé un enregistrement au clavier. Le raccourci est
   * intercepté dans l'iframe avant que le moteur ne l'entende, sans quoi il
   * déclencherait un téléchargement de fichier, geste qui n'a aucun sens ici.
   */
  z.object({
    type: z.literal("saveRequested"),
  }),
  /** Le diaporama vient de démarrer dans le moteur, d'où qu'on l'ait lancé. */
  z.object({
    type: z.literal("presentStarted"),
  }),
  /** Le diaporama vient de se terminer dans le moteur, Échap ou fin de deck. */
  z.object({
    type: z.literal("presentEnded"),
  }),
  z.object({
    type: z.literal("error"),
    code: z.enum(["boot", "load", "serialize", "runtime"]),
    message: z.string().max(2000),
  }),
]);

export type RuntimeMessage = z.infer<typeof runtimeMessageSchema>;

/**
 * Délais du pont.
 *
 * Sans `ready` dans le temps imparti, l'interface affiche une erreur avec
 * rechargement plutôt qu'une surface d'édition muette où l'utilisateur
 * travaillerait dans le vide. Sans `saved` après une demande, l'enregistrement
 * échoue explicitement et rien n'est écrit.
 */
export const BRIDGE_READY_TIMEOUT_MS = 10_000;
export const BRIDGE_SAVE_TIMEOUT_MS = 5_000;

/** Silence après la dernière modification avant enregistrement automatique. */
export const BRIDGE_AUTOSAVE_DEBOUNCE_MS = 2_000;
