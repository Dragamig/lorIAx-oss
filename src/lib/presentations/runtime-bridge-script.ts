/**
 * Script de pont, injecté dans le runtime vendorisé au moment où la route le
 * sert. Il s'exécute AVANT le chargeur du bundle Bento.
 *
 * Pourquoi une injection plutôt qu'un patch de l'artefact : le fichier
 * `vendor/bento/<version>/bento-runtime.html` doit rester l'artefact amont bit
 * pour bit, vérifiable par l'empreinte SHA-256 de son NOTICE. Tout ce qui est
 * à nous vit ici, dans du code applicatif relu et versionné, et une montée de
 * version amont ne demande pas de rejouer un patch.
 *
 * Le runtime amont n'expose aucun `postMessage` : ce fichier est donc le seul
 * endroit qui connaît ses points d'accroche réels, tous relevés en lisant ses
 * sources en version 1.0.19. Ils sont commentés un par un, parce qu'ils sont
 * la partie fragile du module.
 */

/**
 * Le script complet, en JavaScript brut (il s'exécute dans l'iframe, hors de
 * tout outillage de compilation).
 */
export const RUNTIME_BRIDGE_SCRIPT = `
(function () {
  "use strict";

  var parent = window.parent;
  if (parent === window) return; // ouvert hors iframe : rien à faire.

  function post(message) {
    // Origine opaque des deux côtés : il n'y a pas d'origine à nommer.
    // Le parent, lui, contrôle l'identité par event.source.
    try { parent.postMessage(message, "*"); } catch (e) {}
  }

  /**
   * Stockage local de secours.
   *
   * En origine opaque, l'accès à localStorage LÈVE, il ne rend pas null. Le
   * runtime se protège déjà, mais il perd du même coup sa préférence de langue,
   * qu'il lit là avant tout le reste. On lui substitue donc une mémoire de page,
   * dans laquelle on pose la langue choisie par l'application. Elle ne survit
   * pas au rechargement, ce qui est exactement le comportement voulu : la
   * langue vient de l'application, jamais de l'iframe.
   */
  var lang = window.__LORIAX_BENTO_LANG__ || "en";
  try {
    window.localStorage.getItem("bento-lang");
    window.localStorage.setItem("bento-lang", lang);
    window.localStorage.setItem("bento-save-notice", "seen");
  } catch (e) {
    var memory = { "bento-lang": lang, "bento-save-notice": "seen" };
    try {
      Object.defineProperty(window, "localStorage", {
        configurable: true,
        value: {
          getItem: function (key) { return key in memory ? memory[key] : null; },
          setItem: function (key, value) { memory[key] = String(value); },
          removeItem: function (key) { delete memory[key]; },
          clear: function () { memory = {}; },
          key: function (index) { return Object.keys(memory)[index] || null; },
          get length() { return Object.keys(memory).length; },
        },
      });
    } catch (e2) {}
  }

  /**
   * Aucune connexion sortante, jamais. Le moteur sait ouvrir une session de
   * partage en direct sur un service tiers (wss://sync.bento.page) ; la CSP de
   * la route (connect-src 'none') la refuse déjà, et ceci en est le second
   * verrou : le constructeur lève, le moteur n'obtient jamais de socket.
   */
  window.WebSocket = function () {
    throw new Error("Connexions réseau désactivées dans le runtime de présentation.");
  };

  /**
   * BroadcastChannel n'est pas gardé par le runtime amont (module de
   * synchronisation, instancié dès le démarrage) et Chrome le REFUSE en
   * origine opaque. Sans ce garde-fou, le runtime ne démarre pas du tout.
   * On ne neutralise que si le navigateur refuse réellement.
   */
  try {
    new BroadcastChannel("bento-bridge-probe").close();
  } catch (e) {
    window.BroadcastChannel = function () {
      return {
        name: "", postMessage: function () {}, close: function () {},
        addEventListener: function () {}, removeEventListener: function () {},
        onmessage: null, onmessageerror: null,
      };
    };
  }

  /**
   * Le moteur se croit en train d'éditer un fichier local : il propose de
   * l'enregistrer, d'en télécharger une copie, et prévient que le navigateur ne
   * peut pas réécrire le fichier en place. Rien de tout cela n'a de sens ici,
   * où c'est l'application qui enregistre, dans sa base et son stockage.
   *
   * La clé "bento-save-notice" ci-dessus supprime l'avertissement, et cette
   * feuille de style retire les commandes de fichier de la barre d'outils. Le
   * reste de l'éditeur est intact.
   */
  var style = document.createElement("style");
  style.textContent =
    ".ed-split, .ed-filechip, .ed-recover { display: none !important; }";
  (document.head || document.documentElement).appendChild(style);

  /**
   * Recadrage des fenêtres surgissantes du moteur.
   *
   * Le sélecteur de mise en page s'ouvre au-dessus du bouton « Nouvelle
   * diapositive » et se positionne en coordonnées fixes, sans tenir compte du
   * bord haut : avec une liste de diapositives courte, il ressort à top: -88px,
   * donc hors de vue, sous la barre d'outils. Le moteur calcule cette position
   * lui-même, on ne peut pas la lui faire calculer autrement de l'extérieur, on
   * la corrige donc après coup, sans rien masquer.
   *
   * Rustine liée à la version 1.0.19 : à revérifier à chaque montée de version.
   */
  var TOP_MARGIN = 8;
  function keepInView(node) {
    if (!(node instanceof HTMLElement)) return;
    if (getComputedStyle(node).position !== "fixed") return;
    var box = node.getBoundingClientRect();
    if (box.height === 0) return;
    // Une couche qui occupe tout le cadre n'est pas une fenêtre surgissante :
    // c'est le mode présentation, qui doit rester collé aux quatre bords. Le
    // recadrage l'avait rendu invisible, diapositives construites et hauteur
    // nulle.
    if (box.width >= window.innerWidth - 2 && box.height >= window.innerHeight - 2) return;
    var bar = document.querySelector(".ed-topbar");
    var floor = bar ? bar.getBoundingClientRect().bottom + TOP_MARGIN : TOP_MARGIN;
    if (box.top >= floor) return;
    node.style.top = floor + "px";
    node.style.bottom = "auto";
    node.style.maxHeight = "calc(100vh - " + (floor + TOP_MARGIN) + "px)";
    node.style.overflowY = "auto";
  }

  new MutationObserver(function (mutations) {
    for (var i = 0; i < mutations.length; i++) {
      var added = mutations[i].addedNodes;
      for (var j = 0; j < added.length; j++) keepInView(added[j]);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });

  /**
   * Le raccourci d'enregistrement est capté AVANT le moteur (phase de capture),
   * qui l'entendrait en phase de bulle et déclencherait un téléchargement.
   * L'intention de l'utilisateur est bonne, c'est la destination qui change.
   */
  document.addEventListener(
    "keydown",
    function (event) {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (String(event.key).toLowerCase() !== "s") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      post({ type: "saveRequested" });
    },
    true
  );

  /**
   * Le moteur interroge son site amont pour savoir s'il existe une version plus
   * récente. La CSP de la route le bloque déjà, mais l'échec s'affiche en
   * console à chaque ouverture et la question n'a pas de sens ici : la version
   * est épinglée, la faire monter est un lot de notre côté. On refuse donc
   * l'appel avant qu'il ne parte, sans rien masquer d'un appel légitime : le
   * moteur n'en a aucun, tout passe par le pont.
   */
  var nativeFetch = window.fetch ? window.fetch.bind(window) : null;
  if (nativeFetch) {
    window.fetch = function (input) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      if (/^https?:/i.test(url)) {
        return Promise.reject(new Error("Réseau désactivé dans ce cadre."));
      }
      return nativeFetch.apply(null, arguments);
    };
  }

  /**
   * La vue présentateur est retirée : elle ne peut pas fonctionner ici.
   *
   * Le moteur ouvre une fenêtre vierge puis y écrit son interface depuis le
   * document ouvreur. Or notre iframe est en origine opaque : la fenêtre fille
   * en hérite, deux origines opaques ne sont jamais de même origine, et
   * l'écriture est refusée. Vérifié en manipulant : la fenêtre s'ouvre vide et
   * le moteur lève une SecurityError.
   *
   * Plutôt qu'une commande qui ouvre une fenêtre vide, on la retire, et on
   * neutralise l'ouverture elle-même pour les chemins qui ne passent pas par le
   * menu. Une vraie vue présentateur demanderait que l'application ouvre la
   * fenêtre et y monte sa propre iframe, synchronisée par le pont : c'est un
   * lot à part entière.
   */
  window.open = function (url, name) {
    if (name === "bento-speaker") {
      post({ type: "error", code: "runtime", message: "Vue présentateur indisponible dans ce cadre." });
    }
    // Sans allow-popups, le navigateur refuse de toute façon : on rend
    // null explicitement plutôt que de compter sur ce refus.
    return null;
  };

  function dropSpeakerViewItem() {
    var caret = document.querySelector(".ed-pill-caret");
    var menu = caret && caret.parentElement
      ? caret.parentElement.querySelector(".ed-menu")
      : null;
    if (!menu) return;
    // Deux entrées : présenter dans cet onglet, puis vue présentateur.
    var items = menu.querySelectorAll("button");
    if (items.length > 1) items[1].remove();
  }

  /**
   * Lancement du diaporama depuis le parent.
   *
   * Le moteur n'expose aucune API de présentation : window.bento ne porte que
   * le document et ses utilitaires. Le seul déclencheur est son propre bouton.
   * On prend l'entrée « Présenter dans cet onglet » du menu, pas le bouton
   * principal : celui-là appelle l'API Fullscreen depuis l'iframe, qui n'a pas
   * d'activation utilisateur quand l'ordre vient d'un postMessage. Le plein
   * écran réel est demandé par le parent, sur l'iframe, dans le clic même.
   */
  function startPresenting() {
    var pill = document.querySelector(".ed-present-pill");
    var item = pill ? pill.querySelector(".ed-menu button") : null;
    if (!item) {
      post({ type: "error", code: "runtime", message: "Bouton de diaporama introuvable." });
      return;
    }
    item.click();
  }

  /**
   * Début et fin du diaporama, guettés en continu.
   *
   * Rien ne les annonce : le moteur n'émet aucun événement, et le clavier ne
   * franchit pas l'origine opaque, donc l'Échap qui termine la présentation
   * resterait invisible au parent. Or le parent a besoin des deux bords : à
   * l'ouverture pour effacer son interface, la barre latérale comprise, à la
   * fermeture pour la rétablir. La couche de présentation du moteur est le seul
   * témoin fiable de l'état.
   *
   * La surveillance tourne dès le démarrage, sans quoi un diaporama lancé
   * depuis le moteur lui-même, et non par le parent, ne serait pas rapporté.
   */
  var presenting = false;
  var autoFullscreen = false;
  setInterval(function () {
    var open = !!document.querySelector(".bento-present-overlay");
    if (open === presenting) return;
    presenting = open;
    post({ type: open ? "presentStarted" : "presentEnded" });
    if (!autoFullscreen) return;
    // Le diaporama a été lancé depuis le moteur : personne d'autre ne peut
    // demander le plein écran, le clic ayant eu lieu dans ce cadre et non chez
    // le parent. Le relevé est immédiat, l'activation utilisateur du clic vaut
    // encore quelques secondes.
    try {
      if (open) {
        if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
          var p = document.documentElement.requestFullscreen();
          if (p && p.catch) p.catch(function () {});
        }
      } else if (document.fullscreenElement && document.exitFullscreen) {
        var q = document.exitFullscreen();
        if (q && q.catch) q.catch(function () {});
      }
    } catch (e) { /* le navigateur refuse, le diaporama reste jouable */ }
  }, 200);

  var api = null;            // window.bento, dès que le runtime le pose
  var ready = false;

  /**
   * Le runtime pose son API par une simple affectation en fin de démarrage.
   * On l'intercepte plutôt que de sonder en boucle : c'est exact, et cela
   * donne le signal « prêt » à la milliseconde près.
   */
  try {
    Object.defineProperty(window, "bento", {
      configurable: true,
      get: function () { return api; },
      set: function (value) { api = value; onReady(); },
    });
  } catch (e) {
    var poll = setInterval(function () {
      if (window.bento) { api = window.bento; clearInterval(poll); onReady(); }
    }, 50);
  }

  /**
   * Le signal « prêt » est RÉPÉTÉ jusqu'à ce que le parent se manifeste.
   *
   * La réponse de la route est mise en cache indéfiniment, version dans l'URL :
   * à la deuxième ouverture, le moteur démarre depuis le cache, plus vite que
   * le parent n'installe son écouteur de messages, et un signal envoyé une
   * seule fois se perd. L'utilisateur voyait alors un voile de chargement
   * éternel sur une page dont le moteur, lui, était bel et bien démarré.
   */
  var readyBeat = null;
  function onReady() {
    if (ready || !api) return;
    ready = true;
    dropSpeakerViewItem();
    watchDirty();
    var announce = function () {
      post({ type: "ready", readonly: api.readonly === true });
    };
    announce();
    readyBeat = setInterval(announce, 250);
  }

  /**
   * Le runtime n'émet aucun événement de modification et n'expose pas son
   * drapeau interne. Son seul témoin fiable est le champ "modified" du
   * document, réécrit à chaque retouche par le moteur lui-même.
   *
   * La pastille de la barre d'outils avait été essayée d'abord : sa classe ne
   * bascule pas dans cette version, l'observer ne remarquait donc jamais rien.
   * Un sondage d'une chaîne toutes les demi-secondes coûte moins qu'un
   * enregistrement manqué.
   */
  var lastModified = null;
  function watchDirty() {
    setInterval(function () {
      if (!api || !api.doc) return;
      var current = api.doc.modified || null;
      if (lastModified === null) { lastModified = current; return; }
      if (current === lastModified) return;
      lastModified = current;
      post({ type: "dirty", dirty: true });
    }, 500);
  }

  /**
   * Le drapeau interne est hors de portée : après un enregistrement réussi côté
   * application, la pastille de la barre resterait allumée et mentirait. On
   * l'éteint sur le DOM, faute de mieux, et sans en dépendre.
   */
  function clearDirtyBadge() {
    var badge = document.querySelector(".ed-dirty");
    if (badge) badge.classList.remove("on");
  }

  window.addEventListener("message", function (event) {
    if (event.source !== parent) return;
    var data = event.data;
    if (!data || typeof data !== "object") return;

    // Le parent est là : inutile de continuer à répéter le signal de départ.
    if (readyBeat) { clearInterval(readyBeat); readyBeat = null; }

    if (data.type === "load") {
      if (!api || typeof api.loadDoc !== "function") {
        post({ type: "error", code: "load", message: "Runtime non prêt ou en lecture seule." });
        return;
      }
      try {
        if (data.locale && api.i18n && typeof api.i18n.setLocale === "function") {
          api.i18n.setLocale(data.locale);
        }
        var accepted = api.loadDoc(JSON.stringify(data.deck));
        if (!accepted) {
          post({ type: "error", code: "load", message: "Document refusé par le runtime." });
          return;
        }
        lastModified = api.doc && api.doc.modified ? api.doc.modified : null;
        clearDirtyBadge();
        autoFullscreen = data.autoFullscreen === true;
        if (data.mode === "play") startPresenting();
      } catch (err) {
        post({ type: "error", code: "load", message: String((err && err.message) || err) });
      }
      return;
    }

    if (data.type === "requestSave") {
      if (!api || !api.doc) {
        post({ type: "error", code: "serialize", message: "Aucun document à enregistrer." });
        return;
      }
      try {
        // api.doc est la référence vive du document courant : on en prend une
        // copie sérialisée, jamais l'objet lui-même (il n'est pas clonable
        // sans risque et continuerait de vivre côté runtime).
        var deck = JSON.parse(JSON.stringify(api.doc));
        post({ type: "saved", deck: deck });
        clearDirtyBadge();
      } catch (err) {
        post({ type: "error", code: "serialize", message: String((err && err.message) || err) });
      }
      return;
    }
  });

  window.addEventListener("error", function (event) {
    post({ type: "error", code: ready ? "runtime" : "boot", message: String(event.message || "Erreur inconnue") });
  });

  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    post({ type: "error", code: ready ? "runtime" : "boot", message: String((reason && reason.message) || reason) });
  });
})();
`;
