"use client";

import { requestFilePicker, requestImagePicker } from "@/components/editor/media-insert";

import {
  AudioLines,
  Paperclip,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  ListChecks,
  Code,
  Quote,
  Table,
  Image as ImageIcon,
  Minus,
  AlertCircle,
  ChevronRight,
  Link as LinkIcon,
  FileText,
  Link2,
  BarChart3,
  Smile,
  Database,
  MapPin,
  Calendar,
  CalendarDays,
  Clock,
  Video,
  Mic,
  PenLine,
  LayoutTemplate,
  Table2,
  Network,
  Palette,
  Clapperboard,
  Presentation,
  Timer,
  Zap,
  Braces,
} from "lucide-react";

import type { CommandItem } from "./types";
import { openTemplatePicker } from "./template-picker";
import { getMetaDocId } from "../meta-context";

export const defaultAliases: Record<string, string[]> = {
  "Tâches": ["todo", "task", "tache", "taches", "assignation", "suivi"],
  "Cases à cocher": ["checklist", "cases", "coche", "liste", "courses"],
  "Titre 1": ["t1", "h1", "heading1"],
  "Titre 2": ["t2", "h2", "heading2"],
  "Titre 3": ["t3", "h3", "heading3"],
  "Liste à puces": ["ul", "bullet"],
  "Liste numérotée": ["ol", "numbered"],
  "Citation": ["quote", "blockquote", "guillemets"],
  "Séparateur": ["hr", "divider", "ligne"],
  "Attention": ["callout", "info", "note", "astuce", "alerte", "warning"],
  "Lien": ["url", "href"],
  "Lien document": ["document", "wiki", "wikilink", "lien-doc", "[["],
  "Vidéo": ["video", "youtube", "vimeo", "dailymotion", "embed"],
  "Graphique": ["chart", "graphe", "diagramme", "barres", "camembert"],
  "Nouvelle base": ["database", "db", "bdd", "donnees", "tableau-donnees", "base-nouvelle", "creer-base"],
  "Base existante": ["base-existante", "lier-base", "reutiliser-base", "db-existante"],
  "Tableur": ["sheet", "excel", "calc", "tableau", "formule", "spreadsheet"],
  "Tableau blanc": ["whiteboard", "dessin", "sketch", "draw", "miro", "tldraw"],
  "Fichier": ["pdf", "document", "piece", "pièce", "joindre", "attachment"],
  "Studio": ["studio", "design", "canvas", "canva", "graphique", "infographie", "maquette", "illustration"],
  "Montage vidéo": ["montage", "video-editor", "film", "clip"],
  "Présentation": ["presentation", "diaporama", "ppt", "slides", "diapo"],
  "Mind map": ["mindmap", "carte", "mentale", "brainstorm", "arbre"],
  "Carte": ["map", "plan", "itineraire", "osm", "geo", "lieu"],
  "Calendrier": ["calendar", "agenda", "planning", "evenement"],
  "Événement": ["event", "rdv"],
  "Réunion": ["reunion", "visio", "livekit", "call", "appel"],
  "Réunion présentielle": ["meeting-room", "présentiel", "presentiel", "micro", "dictaphone"],
  "Note vocale": ["vocal", "dictée", "dictee", "memo", "mémo", "note-vocale", "voix"],
  "Date": ["today", "aujourd'hui", "maintenant", "jour"],
  "Date et heure": ["datetime", "heure", "timestamp", "now"],
  "Modèle": ["template", "modele", "gabarit", "patron"],
  "Émoji": ["emoji", "smiley", "emoticone", "icone"],
  "Variable": ["variable", "placeholder", "champ", "var"],
};

export const commands: CommandItem[] = [
  {
    title: "Titre 1",
    description: "Titre principal",
    aliases: ["t1", "h1", "heading1"],
    icon: <Heading1 className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 1 }).run();
    },
  },
  {
    title: "Titre 2",
    description: "Sous-titre",
    aliases: ["t2", "h2", "heading2"],
    icon: <Heading2 className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 2 }).run();
    },
  },
  {
    title: "Titre 3",
    description: "Sous-section",
    aliases: ["t3", "h3", "heading3"],
    icon: <Heading3 className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setNode("heading", { level: 3 }).run();
    },
  },
  {
    title: "Liste à puces",
    description: "Liste non ordonnée",
    aliases: ["ul", "bullet"],
    icon: <List className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBulletList().run();
    },
  },
  {
    title: "Liste numérotée",
    description: "Liste ordonnée",
    aliases: ["ol", "numbered"],
    icon: <ListOrdered className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleOrderedList().run();
    },
  },
  {
    title: "Tâches",
    description: "Liste de tâches avec assignation et suivi",
    aliases: ["todo", "task", "tache", "taches", "assignation", "suivi"],
    icon: <CheckSquare className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleTaskList().run();
    },
  },
  {
    title: "Cases à cocher",
    description: "Checklist simple sans suivi (inventaire, courses…)",
    aliases: ["checklist", "cases", "coche", "liste", "courses"],
    icon: <ListChecks className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleList("checklist", "checklistItem").run();
    },
  },
  {
    title: "Code",
    description: "Bloc de code",
    icon: <Code className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
    },
  },
  {
    title: "Citation",
    description: "Bloc de citation avec auteur",
    aliases: ["quote", "blockquote", "guillemets"],
    icon: <Quote className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).toggleBlockquote().run();
    },
  },
  {
    title: "Tableau",
    description: "Insérer un tableau",
    icon: <Table className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run();
    },
  },
  {
    title: "Image",
    // Description traduite à l'affichage (clé), vide ici : le filtre se fait sur le titre et les alias.
    description: "",
    descriptionKey: "document.slashImageDescription",
    icon: <ImageIcon className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      requestImagePicker(editor);
    },
  },
  {
    title: "Fichier",
    module: "library",
    description: "",
    descriptionKey: "document.slashFileDescription",
    aliases: ["pdf", "document", "piece", "pièce", "joindre", "attachment"],
    icon: <Paperclip className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      requestFilePicker(editor);
    },
  },
  {
    title: "Séparateur",
    description: "Ligne horizontale",
    aliases: ["hr", "divider", "ligne"],
    icon: <Minus className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).setHorizontalRule().run();
    },
  },
  {
    title: "Attention",
    description: "Bloc coloré avec émoji (info, attention, succès, erreur)",
    aliases: ["callout", "info", "note", "astuce", "alerte", "warning"],
    icon: <AlertCircle className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "calloutBlock",
          attrs: { calloutType: "info", emoji: "\u2139\ufe0f" },
          content: [{ type: "paragraph" }],
        })
        .run();
    },
  },
  {
    title: "Toggle",
    description: "Contenu dépliable",
    aliases: ["toggle", "depliable", "dépliable", "details", "accordeon", "accordéon"],
    icon: <ChevronRight className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "details",
          attrs: { open: true },
          content: [
            { type: "detailsSummary", content: [{ type: "text", text: "Cliquer pour déplier" }] },
            { type: "detailsContent", content: [{ type: "paragraph" }] },
          ],
        })
        .run();
    },
  },
  {
    title: "Lien",
    description: "Insérer un lien externe",
    aliases: ["url", "href"],
    icon: <LinkIcon className="h-4 w-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const url = window.prompt("URL du lien");
      if (url) {
        editor.chain().focus().setLink({ href: url }).insertContent(url).run();
      }
    },
  },
  {
    title: "Lien document",
    description: "Lien vers un autre document",
    aliases: ["document", "wiki", "wikilink", "lien-doc", "[["],
    icon: <Link2 className="h-4 w-4" />,
    command: ({ editor, range }) => {
      // Delete the slash command range then insert [[ to trigger wiki-link suggestion
      editor.chain().focus().deleteRange(range).insertContent("[[").run();
    },
  },
  {
    title: "Google Docs",
    description: "Intégrer un document Google Docs",
    icon: <FileText className="h-4 w-4 text-blue-500" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "googleDocsEmbed", attrs: { url: "", height: 600 } })
        .run();
    },
  },
  {
    title: "Vidéo",
    module: "studiovideo",
    description: "Intégrer une vidéo YouTube ou Vimeo",
    aliases: ["video", "youtube", "vimeo", "dailymotion", "embed"],
    icon: <Video className="h-4 w-4 text-red-500" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "videoEmbed", attrs: { src: "", provider: "", videoid: "" } })
        .run();
    },
  },
  {
    title: "Graphique",
    description: "Insérer un graphique (barres, courbe, camembert)",
    aliases: ["chart", "graphe", "diagramme", "barres", "camembert"],
    icon: <BarChart3 className="h-4 w-4 text-indigo-500" />,
    desktopOnly: true,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "chartBlock" })
        .run();
    },
  },
  {
    title: "Chrono",
    description: "Chronomètre démarrer/arrêter, durée éditable",
    aliases: ["chrono", "timer", "minuteur", "stopwatch", "temps", "duree"],
    icon: <Timer className="h-4 w-4 text-rose-500" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "chronoBlock" })
        .run();
    },
  },
  {
    title: "Bouton",
    description: "Déclenche une automatisation d'une base d'un clic",
    aliases: ["bouton", "button", "action", "declencher", "trigger", "automatisation"],
    icon: <Zap className="h-4 w-4 text-amber-500" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "automationButton" })
        .run();
    },
  },
  {
    title: "Variable",
    description: "Insérer un placeholder activable dans un modèle",
    aliases: ["variable", "placeholder", "champ", "var"],
    icon: <Braces className="h-4 w-4 text-violet-500" />,
    command: ({ editor, range }) => {
      // Insère une variable « non configurée » : la puce ouvre aussitôt son
      // popover de saisie inline (voir template-variable.tsx). Plus de
      // window.prompt bloquant (incohérent, non stylable, KO sous Playwright).
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setTemplateVariable({ key: "", label: "" })
        .run();
    },
  },
  {
    title: "Nouvelle base",
    description: "Créer une base de données dans cette page",
    aliases: ["database", "db", "bdd", "donnees", "tableau-donnees", "creer-base"],
    icon: <Database className="h-4 w-4 text-emerald-500" />,
    desktopOnly: true,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "databaseBlock", attrs: { intent: "create" } })
        .run();
    },
  },
  {
    title: "Base existante",
    description: "Intégrer une base déjà créée depuis l'Espace Bases",
    aliases: ["base-existante", "lier-base", "reutiliser-base", "db-existante"],
    icon: <Database className="h-4 w-4 text-cyan-500" />,
    desktopOnly: true,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "databaseBlock", attrs: { intent: "pick" } })
        .run();
    },
  },
  {
    title: "Base liée (lecture seule)",
    description: "Intégrer une base existante en lecture seule, avec tri et filtres propres à ce document",
    aliases: ["base-liee", "linked-db", "vue-base", "base-lecture-seule", "db-readonly", "base-miroir"],
    icon: <Database className="h-4 w-4 text-indigo-500" />,
    desktopOnly: true,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "databaseBlock",
          attrs: { intent: "pick", linked: true, readOnly: true },
        })
        .run();
    },
  },
  {
    title: "Bloc synchronisé",
    description: "Afficher le contenu d'un autre document, synchronisé en lecture seule",
    aliases: ["sync", "synchronise", "reference", "transclusion", "miroir", "bloc-lie", "embed-doc"],
    icon: <Link2 className="h-4 w-4 text-indigo-500" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertContent({ type: "syncedBlock" }).run();
    },
  },
  {
    title: "Tableur",
    description: "Feuille de calcul avec formules",
    aliases: ["sheet", "excel", "calc", "tableau", "formule", "spreadsheet"],
    icon: <Table2 className="h-4 w-4 text-emerald-500" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "spreadsheetBlock",
          attrs: {
            title: "Nouveau tableur",
          },
        })
        .run();
    },
  },
  {
    title: "Tableau blanc",
    description: "Canvas collaboratif Miro-like (tldraw)",
    aliases: ["whiteboard", "dessin", "sketch", "draw", "miro", "tldraw"],
    icon: <PenLine className="h-4 w-4 text-blue-500" />,
    desktopOnly: true,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertContent({
        type: "whiteboardBlock",
        attrs: { canvasId: crypto.randomUUID(), title: "Nouveau tableau blanc" },
      }).run();
    },
  },
  {
    title: "Studio",
    module: "studio",
    description: "Éditeur graphique — formes, texte, images, infographie",
    aliases: ["studio", "design", "canvas", "canva", "graphique", "infographie", "maquette", "illustration"],
    icon: <Palette className="h-4 w-4 text-emerald-500" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertContent({
        type: "designBlock",
        attrs: { designId: crypto.randomUUID(), title: "Nouveau studio" },
      }).run();
    },
  },
  {
    title: "Montage vidéo",
    module: "studiovideo",
    description: "Créer un projet de montage vidéo multi-pistes",
    aliases: ["montage", "video-editor", "film", "clip"],
    icon: <Clapperboard className="h-4 w-4 text-orange-500" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertContent({
        type: "videoEditorBlock",
        attrs: { projectId: null, title: "Nouveau montage" },
      }).run();
    },
  },
  {
    title: "Présentation",
    module: "presentations",
    description: "Créer un diaporama joué depuis le document",
    // `bento` est l'hommage au moteur vendorisé : sa marque est retirée de la
    // barre de l'éditeur, elle survit ici, là où seul qui la cherche la trouve.
    aliases: ["presentation", "diaporama", "ppt", "slides", "diapo", "bento"],
    icon: <Presentation className="h-4 w-4 text-violet-500" />,
    command: ({ editor, range }) => {
      // La présentation est créée avant le nœud : celui-ci ne porte qu'un
      // identifiant, l'insérer vide laisserait un bloc que rien ne rattache.
      const spaceId =
        typeof window !== "undefined" ? window.__loriax_spaceId ?? "" : "";
      const documentId = getMetaDocId(editor);
      editor.chain().focus().deleteRange(range).run();
      if (!spaceId) return;
      fetch("/api/presentations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ spaceId, documentId, title: "Nouvelle présentation" }),
      })
        .then((res) => (res.ok ? res.json() : Promise.reject(res.statusText)))
        .then((presentation) => {
          if (!presentation?.id) return;
          editor.chain().focus().insertContent({
            type: "presentationBlock",
            attrs: { presentationId: presentation.id, title: presentation.title },
          }).run();
        })
        .catch(() => {});
    },
  },
  {
    title: "Mind map",
    description: "Carte mentale interactive",
    aliases: ["mindmap", "carte", "mentale", "brainstorm", "arbre"],
    icon: <Network className="h-4 w-4 text-amber-500" />,
    desktopOnly: true,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).insertContent({
        type: "mindmapBlock",
        attrs: { mindmapId: crypto.randomUUID(), title: "Nouvelle carte mentale" },
      }).run();
    },
  },
  {
    title: "Carte",
    description: "Insérer une carte OpenStreetMap interactive",
    aliases: ["map", "plan", "itineraire", "osm", "geo", "lieu"],
    icon: <MapPin className="h-4 w-4 text-blue-500" />,
    desktopOnly: true,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "mapBlock" })
        .run();
    },
  },
  {
    title: "Calendrier",
    description: "Insérer un mini-calendrier dans le document",
    aliases: ["calendar", "agenda", "planning", "rdv", "evenement"],
    icon: <CalendarDays className="h-4 w-4 text-orange-500" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({ type: "calendarBlock" })
        .run();
    },
  },
  {
    title: "Événement",
    description: "Insérer un lien vers un événement calendrier",
    aliases: ["event", "rdv", "reunion", "meeting"],
    icon: <Clock className="h-4 w-4 text-orange-500" />,
    command: ({ editor, range }) => {
      // Insert a placeholder event inline node
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "eventInline",
          attrs: {
            title: "Nouvel événement",
            startAt: new Date().toISOString(),
          },
        })
        .run();
    },
  },
  {
    title: "Réunion",
    module: "livekit",
    description: "Démarrer une visioconférence",
    aliases: ["reunion", "meeting", "visio", "livekit", "call", "appel", "video"],
    icon: <Video className="h-4 w-4 text-indigo-500" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "meetingBlock",
          attrs: {
            meetingId: "",
            title: "Nouvelle réunion",
            status: "scheduled",
          },
        })
        .run();
    },
  },
  {
    title: "Réunion présentielle",
    module: "meeting-rooms",
    description: "Retranscrire une réunion présentielle",
    aliases: ["reunion", "meeting-room", "présentiel", "presentiel", "micro", "dictaphone"],
    icon: <Mic className="h-4 w-4 text-violet-500" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "inPersonMeetingBlock",
          attrs: {
            meetingId: "",
            title: "Nouvelle réunion",
            status: "scheduled",
            participants: [],
          },
        })
        .run();
    },
  },
  {
    title: "Note vocale",
    module: "voice-notes",
    description: "Dicter ou déposer un audio, puis en tirer un compte rendu",
    aliases: ["vocal", "dictée", "dictee", "memo", "mémo", "note-vocale", "voix"],
    icon: <AudioLines className="h-4 w-4 text-rose-500" />,
    command: ({ editor, range }) => {
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertContent({
          type: "voiceNoteBlock",
          attrs: { voiceNoteId: "" },
        })
        .run();
    },
  },
  {
    title: "Date",
    description: "Insérer la date du jour",
    aliases: ["today", "aujourd'hui", "maintenant", "jour"],
    icon: <Calendar className="h-4 w-4 text-teal-500" />,
    command: ({ editor, range }) => {
      const now = new Date();
      const date = now.toLocaleDateString("fr-FR", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      editor.chain().focus().deleteRange(range).insertContent(date).run();
    },
  },
  {
    title: "Date et heure",
    description: "Insérer la date et l'heure actuelles",
    aliases: ["datetime", "heure", "timestamp", "now"],
    icon: <Calendar className="h-4 w-4 text-teal-500" />,
    command: ({ editor, range }) => {
      const now = new Date();
      const dateTime = now.toLocaleDateString("fr-FR", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
      editor.chain().focus().deleteRange(range).insertContent(dateTime).run();
    },
  },
  {
    title: "Modèle",
    description: "Insérer un modèle de document",
    aliases: ["template", "modele", "gabarit", "patron"],
    icon: <LayoutTemplate className="h-4 w-4 text-purple-500" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      openTemplatePicker(editor);
    },
  },
  {
    title: "Émoji",
    description: "Insérer un émoji",
    aliases: ["emoji", "smiley", "emoticone", "icone"],
    icon: <Smile className="h-4 w-4 text-amber-500" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();

      // Créer un conteneur temporaire pour le picker
      const container = document.createElement("div");
      container.style.position = "fixed";
      container.style.zIndex = "9999";

      // Position near cursor
      const { view } = editor;
      const coords = view.coordsAtPos(view.state.selection.from);
      container.style.left = `${coords.left}px`;
      container.style.top = `${coords.bottom + 4}px`;
      document.body.appendChild(container);

      // Import et render le picker dynamiquement
      Promise.all([
        import("emoji-picker-react"),
        import("react-dom/client"),
        import("react"),
      ]).then(([emojiMod, { createRoot }, React]) => {
        const EmojiPicker = emojiMod.default;
        const { Theme, EmojiStyle } = emojiMod;
        const isDark = document.documentElement.classList.contains("dark");

        const root = createRoot(container);

        function cleanup() {
          root.unmount();
          container.remove();
          document.removeEventListener("mousedown", handleOutsideClick);
        }

        function handleOutsideClick(e: MouseEvent) {
          if (!container.contains(e.target as Node)) {
            cleanup();
          }
        }

        // Délai pour ne pas capturer le clic initial
        setTimeout(() => {
          document.addEventListener("mousedown", handleOutsideClick);
        }, 100);

        root.render(
          React.createElement(EmojiPicker, {
            onEmojiClick: (emojiData: { emoji: string }) => {
              editor.chain().focus().insertContent(emojiData.emoji).run();
              cleanup();
            },
            theme: isDark ? Theme.DARK : Theme.LIGHT,
            emojiStyle: EmojiStyle.NATIVE,
            width: 320,
            height: 400,
            searchPlaceHolder: "Rechercher un emoji...",
            previewConfig: { showPreview: false },
            lazyLoadEmojis: true,
          })
        );
      });
    },
  },
];
