"use client";

/**
 * Côté parent du pont vers le runtime de présentation.
 *
 * L'iframe est en origine opaque (`sandbox` sans `allow-same-origin`) : le
 * runtime n'a accès ni à nos cookies, ni à notre stockage, ni à notre DOM, et
 * sa CSP lui coupe le réseau. En contrepartie, `event.origin` vaut la chaîne
 * `"null"` et ne prouve rien : le seul contrôle non usurpable est
 * `event.source === iframe.contentWindow`, et c'est celui qui est fait ici.
 *
 * L'enregistrement est toujours à l'initiative de ce composant : le runtime ne
 * connaît ni nos routes ni notre stockage, il rend son document quand on le lui
 * demande, rien de plus.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { useTranslations } from "next-intl";
import { Loader2, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  BRIDGE_AUTOSAVE_DEBOUNCE_MS,
  BRIDGE_READY_TIMEOUT_MS,
  BRIDGE_SAVE_TIMEOUT_MS,
  runtimeMessageSchema,
  type ParentMessage,
  type PresentationMode,
} from "@/lib/presentations/bridge";
import { deckSchema, deckFingerprint, type Deck } from "@/lib/presentations/deck";
import { runtimeUrl } from "@/lib/presentations/runtime";

type SaveState = "idle" | "pending" | "saved" | "error" | "conflict";

/** Issue d'un enregistrement demandé à la main (bouton « Terminer »). */
export type SaveOutcome = "saved" | "conflict" | "error";

interface PresentationRuntimeProps {
  presentationId: string;
  initialDeck: Deck;
  initialVersion: number;
  mode: PresentationMode;
  locale: string;
  /**
   * Commande de sortie, à droite de la barre : retour à la liste sur la page
   * dédiée, fermeture de la modale depuis un document. Le moteur occupe toute
   * la surface restante et n'offre aucun chemin de retour, il faut donc que
   * l'application en fournisse un.
   */
  action?: ReactNode;
  /** Averti après chaque enregistrement réussi, pour rafraîchir un compteur. */
  onSaved?: (version: number, slideCount: number, deck: Deck) => void;
  /**
   * Le diaporama s'est terminé dans le moteur, Échap ou fin de deck. Échap ne
   * franchit pas l'origine opaque : sans ce signal, l'incrustation du parent
   * resterait ouverte sur un éditeur nu.
   */
  onPresentEnd?: () => void;
  /** Bandeau au-dessus de la barre (édition d'un modèle, lecture seule). */
  banner?: ReactNode;
  /**
   * Reçoit une fonction qui obtient l'état courant du document auprès du
   * moteur (sans se fier au signal de modification, qui peut ne pas encore
   * être arrivé), l'écrit par le PUT versionné s'il diffère de la dernière
   * version connue, et rend son issue. Sert à « Terminer » et à « Enregistrer
   * comme modèle ».
   */
  saveControlRef?: MutableRefObject<(() => Promise<SaveOutcome>) | null>;
  /** Averti quand le moteur est prêt (vrai) : les actions qui en dépendent s'activent. */
  onReadyChange?: (ready: boolean) => void;
}

export function PresentationRuntime({
  presentationId,
  initialDeck,
  initialVersion,
  mode,
  locale,
  action,
  onSaved,
  onPresentEnd,
  banner,
  saveControlRef,
  onReadyChange,
}: PresentationRuntimeProps) {
  const t = useTranslations("presentations");
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const [loaded, setLoaded] = useState(false);
  const [bootFailed, setBootFailed] = useState(false);
  /**
   * Diaporama en cours. Le moteur occupe alors toute la fenêtre, par-dessus la
   * barre latérale et la barre de l'application : sur la page d'édition, le
   * plein écran du navigateur ne suffit pas, la commande vient du moteur et
   * l'application resterait visible derrière lui.
   */
  const [presenting, setPresenting] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");

  /**
   * Références plutôt qu'état : ces valeurs sont lues dans des écouteurs et des
   * minuteries qui survivent aux rendus, et un état périmé ferait enregistrer
   * contre une mauvaise version.
   */
  const versionRef = useRef(initialVersion);
  /**
   * Dernier deck écrit avec succès : c'est celui qu'on renvoie au moteur quand
   * il recharge. Renvoyer `initialDeck` ferait repartir d'un état périmé avec
   * une version à jour, et la retouche suivante écraserait le travail déjà
   * enregistré sans que le contrôle de version le voie.
   */
  const lastDeckRef = useRef<Deck>(initialDeck);
  const readyRef = useRef(false);
  const dirtyRef = useRef(false);
  /** Dernier contenu connu du serveur : sert à ne pas réécrire un document inchangé. */
  const baselineRef = useRef(
    // Même forme que les messages du pont (déjà passés par le schéma).
    deckFingerprint(deckSchema.safeParse(initialDeck).data ?? initialDeck)
  );
  /** La prochaine réponse du moteur est une vérification : pas d'écriture si rien n'a changé. */
  const skipUnchangedRef = useRef(false);
  const onReadyChangeRef = useRef(onReadyChange);
  useEffect(() => {
    onReadyChangeRef.current = onReadyChange;
  }, [onReadyChange]);
  // Gardé dans un ref : l'effet du pont ne doit pas se rebrancher parce que le
  // parent a recréé sa fonction de fermeture.
  const onPresentEndRef = useRef(onPresentEnd);
  useEffect(() => {
    onPresentEndRef.current = onPresentEnd;
  }, [onPresentEnd]);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Les écritures sont sérialisées : `chainRef` enchaîne les PUT, `queuedRef`
   * compte ceux qui sont en vol ou en attente. Sans cela, un second PUT partirait
   * avec une version périmée (la réponse du premier n'est pas encore revenue) et
   * produirait un faux conflit.
   */
  const chainRef = useRef<Promise<void>>(Promise.resolve());
  const queuedRef = useRef(0);
  /** Nombre de chargements de l'iframe vus : le premier est le démarrage, les suivants des rechargements. */
  const loadCountRef = useRef(0);
  /** Attente de l'issue d'un enregistrement demandé par `saveControlRef`. */
  const outcomeResolver = useRef<((outcome: SaveOutcome) => void) | null>(null);

  const settle = useCallback((outcome: SaveOutcome) => {
    outcomeResolver.current?.(outcome);
    outcomeResolver.current = null;
  }, []);

  const send = useCallback((message: ParentMessage) => {
    // L'iframe n'a pas d'origine à nommer : le joker est ici la seule valeur
    // possible. Ce n'est pas une faiblesse, le contenu posté n'est jamais un
    // secret et la cible est une fenêtre que nous avons nous-mêmes créée.
    iframeRef.current?.contentWindow?.postMessage(message, "*");
  }, []);

  /** Demande le document courant au runtime ; la suite se passe sur `saved`. */
  const requestSave = useCallback(() => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current);
    setSaveState("pending");
    saveTimeout.current = setTimeout(() => {
      saveTimeout.current = null;
      skipUnchangedRef.current = false;
      // Pas de réponse : on échoue franchement plutôt que de laisser croire à
      // un enregistrement en cours qui n'arrivera jamais.
      setSaveState("error");
      settle("error");
    }, BRIDGE_SAVE_TIMEOUT_MS);
    send({ type: "requestSave" });
  }, [send, settle]);

  useEffect(() => {
    if (!saveControlRef) return;
    saveControlRef.current = () =>
      new Promise<SaveOutcome>((resolve) => {
        if (!readyRef.current) {
          resolve("error");
          return;
        }
        // Une demande précédente encore en attente est abandonnée en erreur.
        settle("error");
        outcomeResolver.current = resolve;
        if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
        // Le signal de modification peut ne pas être arrivé : on demande
        // toujours l'état courant au moteur plutôt que de s'y fier.
        skipUnchangedRef.current = true;
        requestSave();
      });
    return () => {
      saveControlRef.current = null;
    };
  }, [saveControlRef, requestSave, settle]);

  /**
   * L'issue « enregistré » n'est rendue qu'au dernier enregistrement pertinent :
   * pas tant qu'un autre PUT est en attente (le courant compte pour un), ni tant qu'une réponse du moteur
   * est encore attendue (`saveTimeout` armé), car elle peut apporter un état
   * plus récent que celui qui vient d'être écrit.
   */
  const settleSavedIfIdle = useCallback(() => {
    if (queuedRef.current <= 1 && !saveTimeout.current) settle("saved");
  }, [settle]);

  const write = useCallback(
    async (deck: Deck, skipIfBaseline: boolean) => {
      // Comparé à la référence mise à jour par l'écriture précédente : si le
      // document n'a pas bougé depuis, rien à écrire.
      if (skipIfBaseline && deckFingerprint(deck) === baselineRef.current) {
        setSaveState("saved");
        settleSavedIfIdle();
        return;
      }
      try {
        const response = await fetch(`/api/presentations/${presentationId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          // Le titre voyage avec le document : renommer dans le moteur doit
          // renommer la présentation partout, liste et bloc compris.
          body: JSON.stringify({
            deck,
            expectedVersion: versionRef.current,
            title:
              typeof deck.title === "string" && deck.title.trim()
                ? deck.title.trim()
                : undefined,
          }),
        });
        if (response.status === 409) {
          // Un autre onglet a écrit entre-temps : on ne recouvre rien en
          // silence, l'utilisateur décide de recharger.
          setSaveState("conflict");
          settle("conflict");
          return;
        }
        if (!response.ok) {
          setSaveState("error");
          settle("error");
          return;
        }
        const saved = (await response.json()) as {
          presentation: { version: number; slideCount: number };
        };
        versionRef.current = saved.presentation.version;
        dirtyRef.current = false;
        baselineRef.current = deckFingerprint(deck);
        lastDeckRef.current = deck;
        setSaveState("saved");
        settleSavedIfIdle();
        onSaved?.(saved.presentation.version, saved.presentation.slideCount, deck);
      } catch {
        setSaveState("error");
        settle("error");
      }
    },
    [presentationId, onSaved, settle, settleSavedIfIdle]
  );

  const persist = useCallback(
    (deck: Deck) => {
      // Un persist mis en file derrière un autre ne connaît pas encore la
      // version ni la référence que ce dernier va produire : il les lit au
      // moment d'écrire, et se passe d'écrire si le document est identique.
      const queuedBehind = queuedRef.current > 0;
      queuedRef.current += 1;
      const run = chainRef.current.then(() => write(deck, queuedBehind));
      chainRef.current = run.finally(() => {
        queuedRef.current -= 1;
      });
      return run;
    },
    [write]
  );

  useEffect(() => {
    const bootTimer = setTimeout(() => {
      // Sans signal de démarrage, mieux vaut une erreur explicite qu'une
      // surface d'édition muette dans laquelle on travaillerait pour rien.
      if (!readyRef.current) setBootFailed(true);
    }, BRIDGE_READY_TIMEOUT_MS);

    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      const parsed = runtimeMessageSchema.safeParse(event.data);
      if (!parsed.success) {
        console.warn("[presentations] Message ignoré :", parsed.error.issues[0]);
        return;
      }
      const message = parsed.data;

      switch (message.type) {
        case "ready":
          // Le runtime répète ce signal jusqu'à ce que nous répondions : on ne
          // recharge pas le document à chaque répétition.
          if (readyRef.current) break;
          clearTimeout(bootTimer);
          readyRef.current = true;
          send({
            type: "load",
            deck: lastDeckRef.current,
            mode,
            locale,
            // Sur la page d'édition, le diaporama part du bouton du moteur :
            // le plein écran ne peut être demandé que de l'intérieur du cadre.
            // Depuis un document, c'est le clic sur « Lire » qui le demande.
            autoFullscreen: mode === "edit",
          });
          setLoaded(true);
          onReadyChangeRef.current?.(true);
          break;

        case "dirty":
          if (mode !== "edit") break;
          dirtyRef.current = message.dirty;
          if (!message.dirty) break;
          if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
          autosaveTimer.current = setTimeout(
            requestSave,
            BRIDGE_AUTOSAVE_DEBOUNCE_MS
          );
          break;

        case "saveRequested":
          // Le raccourci clavier vaut demande explicite : on n'attend pas le
          // délai de l'enregistrement automatique.
          if (mode !== "edit") break;
          if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
          requestSave();
          break;

        case "saved":
          // Seul l'éditeur écrit : un `saved` reçu en lecture ne peut venir que
          // d'un runtime qui s'écarte du protocole, il ne déclenche aucun PUT.
          if (mode !== "edit") break;
          // Le pont ne porte pas d'identifiant de demande : un `saved`
          // d'autosave arrivé pendant une vérification de « Terminer » est
          // indiscernable de la réponse attendue. C'est sans conséquence, les
          // deux portent l'état courant du moteur et suivent le même chemin.
          if (saveTimeout.current) clearTimeout(saveTimeout.current);
          saveTimeout.current = null;
          if (
            skipUnchangedRef.current &&
            queuedRef.current === 0 &&
            !dirtyRef.current &&
            deckFingerprint(message.deck) === baselineRef.current
          ) {
            skipUnchangedRef.current = false;
            setSaveState("saved");
            settle("saved");
            break;
          }
          skipUnchangedRef.current = false;
          void persist(message.deck as Deck);
          break;

        case "presentStarted":
          setPresenting(true);
          break;

        case "presentEnded":
          setPresenting(false);
          onPresentEndRef.current?.();
          break;

        case "error":
          console.error(
            `[presentations] Runtime en erreur (${message.code}) :`,
            message.message
          );
          if (message.code === "boot") {
            clearTimeout(bootTimer);
            setBootFailed(true);
          }
          break;
      }
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      clearTimeout(bootTimer);
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
    };
  }, [locale, mode, persist, requestSave, send, settle]);

  /**
   * Fermeture de l'onglet : dernière chance d'enregistrer. Le navigateur ne
   * garantit rien au-delà de l'avertissement, d'où le message natif plutôt
   * qu'une promesse d'écriture qu'on ne pourrait pas tenir.
   */
  useEffect(() => {
    if (mode !== "edit") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current) return;
      requestSave();
      event.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [mode, requestSave]);

  if (bootFailed) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <TriangleAlert className="h-8 w-8 text-destructive" />
        <p className="text-sm text-muted-foreground">{t("bootError")}</p>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t("reload")}
        </Button>
      </div>
    );
  }

  return (
    <div
      className={
        presenting
          ? "fixed inset-0 z-[60] flex flex-col bg-background"
          : "flex h-full w-full flex-col"
      }
    >
      {/* Le titre n'est pas répété ici : le moteur l'affiche déjà dans sa
          propre barre, et c'est là qu'on le renomme. */}
      {/* En diaporama, rien ne surmonte la diapositive : la barre servirait
          seulement à fermer, ce que fait déjà la touche Échap. */}
      {mode === "edit" && !presenting && banner}
      {mode === "edit" && !presenting && (
        <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-3">
          <span className="text-xs text-muted-foreground">
            {saveState === "pending" && t("saving")}
            {saveState === "saved" && t("saved")}
            {saveState === "error" && (
              <span className="text-destructive">{t("saveError")}</span>
            )}
            {saveState === "conflict" && (
              <span className="text-destructive">{t("conflict")}</span>
            )}
          </span>
          <div className="ml-auto">{action}</div>
        </div>
      )}

      <div className="relative min-h-0 flex-1">
      <iframe
        ref={iframeRef}
        src={runtimeUrl(locale)}
        onLoad={() => {
          loadCountRef.current += 1;
          // Le premier chargement est le démarrage. Un suivant est un
          // rechargement : le moteur n'a plus l'état et doit redonner `ready`.
          if (loadCountRef.current <= 1 || !readyRef.current) return;
          readyRef.current = false;
          setLoaded(false);
          settle("error");
          onReadyChangeRef.current?.(false);
        }}
        title={t("runtimeFrameTitle")}
        /**
         * Pas de `allow-same-origin` : c'est tout l'intérêt du montage.
         * `allow-modals` sert l'impression. Pas de `allow-popups` : la vue
         * présentateur est retirée du pont, rien ne doit ouvrir de fenêtre.
         */
        sandbox="allow-scripts allow-modals"
        /**
         * Sans cette autorisation, le mode diaporama construit bien ses
         * diapositives mais ne s'affiche jamais : le passage en plein écran
         * est refusé à une iframe qui ne le déclare pas, et l'éditeur reste
         * visible par-dessus. La politique de permissions de l'application
         * n'interdit pas le plein écran, il suffit de le déléguer au cadre.
         *
         * Le verrou de veille suit la même règle : sans lui, le moteur le
         * demande au démarrage du diaporama, le navigateur refuse, et l'écran
         * peut s'éteindre en pleine présentation.
         */
        allow="fullscreen; screen-wake-lock"
        className="h-full w-full border-0"
      />

      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">{t("loading")}</span>
        </div>
      )}

      </div>
    </div>
  );
}
