/**
 * Sérialisation markdown des nœuds atomiques de l'éditeur, côté serveur.
 *
 * L'enregistrement classique passe par tiptap-markdown (navigateur), qui écrit
 * un bloc atomique sous forme de balise HTML `<div attr="..." data-type="x"></div>`
 * (attributs non nuls, noms en minuscules) ; wikiLink et templateVariable ont
 * leur propre syntaxe. Le chemin collaboratif reconstruit le markdown depuis le
 * JSON ProseMirror du document Yjs : ce helper pur lui fait écrire les mêmes
 * balises dans `documents.content_text`, d'où dépendent la recherche plein
 * texte, le RAG et les contrôles d'accès aux canevas (identifiant cherché
 * littéralement dans le contenu).
 */

import { serializeFileBlock } from "@/components/editor/extensions/file-block-markdown";

type PmNode = Record<string, unknown>;

/** Nom du nœud ProseMirror -> valeur de `data-type` et balise HTML. */
const ATOMIC_NODES: Record<string, { dataType: string; tag: "div" | "span" }> = {
  chartBlock: { dataType: "chart-block", tag: "div" },
  whiteboardBlock: { dataType: "whiteboard-block", tag: "div" },
  mapBlock: { dataType: "map-block", tag: "div" },
  syncedBlock: { dataType: "synced-block", tag: "div" },
  videoEmbed: { dataType: "video-embed", tag: "div" },
  voiceNoteBlock: { dataType: "voice-note-block", tag: "div" },
  automationButton: { dataType: "automation-button", tag: "div" },
  calendarBlock: { dataType: "calendar-block", tag: "div" },
  chronoBlock: { dataType: "chrono-block", tag: "div" },
  designBlock: { dataType: "design-block", tag: "div" },
  googleDocsEmbed: { dataType: "google-docs-embed", tag: "div" },
  linkPreview: { dataType: "link-preview", tag: "div" },
  mindmapBlock: { dataType: "mindmap-block", tag: "div" },
  spreadsheetBlock: { dataType: "spreadsheet-block", tag: "div" },
  videoEditorBlock: { dataType: "video-editor-block", tag: "div" },
  databaseBlock: { dataType: "database-block", tag: "div" },
  meetingBlock: { dataType: "meeting-block", tag: "div" },
  inPersonMeetingBlock: { dataType: "in-person-meeting-block", tag: "div" },
  eventInline: { dataType: "event-inline", tag: "span" },
};

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Vrai si le type de nœud est sérialisé par ce helper. */
export function isAtomicNodeType(type: unknown): boolean {
  return (
    typeof type === "string" &&
    (type in ATOMIC_NODES || type === "fileBlock" || type === "wikiLink" || type === "templateVariable")
  );
}

/**
 * Markdown d'un nœud atomique ou `null` si le type n'en est pas un.
 * Sans saut de ligne final : l'appelant décide de la mise en page.
 */
export function serializeAtomicNode(node: PmNode): string | null {
  const type = node.type;
  if (typeof type !== "string") return null;
  const attrs = (node.attrs as Record<string, unknown> | undefined) ?? {};

  if (type === "wikiLink") {
    const target = String(attrs.target ?? "");
    const label = String(attrs.label ?? "");
    return label && label !== target ? `[[${target}|${label}]]` : `[[${target}]]`;
  }
  if (type === "templateVariable") {
    return `{{${String(attrs.key ?? "")}}}`;
  }

  if (type === "fileBlock") return serializeFileBlock(attrs) || null;

  const def = ATOMIC_NODES[type];
  if (!def) return null;

  const parts: string[] = [];
  for (const [name, value] of Object.entries(attrs)) {
    if (value === null || value === undefined) continue;
    if (typeof value === "object") continue;
    parts.push(`${name.toLowerCase()}="${escapeAttr(String(value))}"`);
  }
  parts.push(`data-type="${def.dataType}"`);
  return `<${def.tag} ${parts.join(" ")}></${def.tag}>`;
}
