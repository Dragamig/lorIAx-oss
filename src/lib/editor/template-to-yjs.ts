import * as Y from "yjs";

interface TemplateDatabase {
  name: string;
  columns: Array<{
    name: string;
    type: string;
    config?: Record<string, unknown>;
  }>;
}

interface TemplateContent {
  markdown?: string;
  database?: TemplateDatabase;
}

// ─── Inline (gras / italique / code / lien) ───────────────────────────────────

type Delta = { insert: string; attributes?: Record<string, unknown> };

const INLINE_RE =
  /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*?)\*|_([^_\s][^_]*?)_|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\))/;

/** Tokenise une ligne en delta Yjs avec marques (bold/italic/code/link). */
function inlineToDelta(text: string): Delta[] {
  const out: Delta[] = [];
  const push = (s: string, attrs?: Record<string, unknown>) => {
    if (!s) return;
    out.push(attrs ? { insert: s, attributes: attrs } : { insert: s });
  };

  let rest = text;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(rest)) !== null) {
    if (m.index > 0) push(rest.slice(0, m.index));
    if (m[2] !== undefined) push(m[2], { bold: true });
    else if (m[3] !== undefined) push(m[3], { bold: true });
    else if (m[4] !== undefined) push(m[4], { italic: true });
    else if (m[5] !== undefined) push(m[5], { italic: true });
    else if (m[6] !== undefined) push(m[6], { code: true });
    else if (m[7] !== undefined && m[8] !== undefined) push(m[7], { link: { href: m[8] } });
    rest = rest.slice(m.index + m[0].length);
  }
  if (rest) push(rest);
  if (out.length === 0) out.push({ insert: "" });
  return out;
}

function xmlText(text: string): Y.XmlText {
  const t = new Y.XmlText();
  t.applyDelta(inlineToDelta(text));
  return t;
}

function paragraph(text: string): Y.XmlElement {
  const p = new Y.XmlElement("paragraph");
  p.insert(0, [xmlText(text)]);
  return p;
}

// ─── Détecteurs de blocs ───────────────────────────────────────────────────────

const RE_HEADING = /^(#{1,6})\s+(.+)$/;
const RE_HR = /^(?:-{3,}|\*{3,}|_{3,})$/;
const RE_IMAGE = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const RE_TASK = /^[-*+]\s+\[([ xX])\]\s+(.*)$/;
const RE_BULLET = /^[-*+]\s+(.*)$/;
const RE_ORDERED = /^\d+[.)]\s+(.*)$/;
const RE_QUOTE = /^>\s?(.*)$/;
const RE_TABLE_ROW = /^\|(.+)\|\s*$/;
const RE_TABLE_SEP = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/;
const RE_CHRONO = /^\[\[\s*chrono\s*(?::\s*(.*?))?\s*\]\]$/i;
const RE_DB = /^\[\[\s*(?:bdd|database|base)\s*:\s*(.+?)\s*\]\]$/i;
// Bloc dépliable, sérialisé en HTML par l'extension `details-block`
const RE_DETAILS_OPEN = /^<details(?:\s[^>]*)?>$/i;
const RE_DETAILS_CLOSE = /^<\/details>$/i;
const RE_SUMMARY = /^<summary>(.*)<\/summary>$/i;
const RE_DETAILS_CONTENT_OPEN = /^<div\s+data-type=["']?detailsContent["']?\s*>$/i;
const RE_DIV_CLOSE = /^<\/div>$/i;

function splitTableCells(row: string): string[] {
  // Retire les pipes de bord puis découpe (sans gérer l'échappement \| — rare en template)
  const inner = row.replace(/^\|/, "").replace(/\|\s*$/, "");
  return inner.split("|").map((c) => c.trim());
}

// ─── Markdown → fragment Yjs ───────────────────────────────────────────────────

/**
 * Construit un fragment Yjs (XmlFragment "default") à partir de markdown.
 * Produit de VRAIS blocs TipTap : titres, paragraphes, listes à puces /
 * numérotées, listes de tâches (checklists), tableaux, citations, filets,
 * images, chronomètre et base de données liée (placeholder).
 * Utilisé côté serveur pour initialiser le contenu d'un nouveau document.
 */
function markdownToXmlFragment(markdown: string, fragment: Y.XmlFragment): void {
  const nodes = markdownToNodes(markdown);
  if (nodes.length > 0) {
    fragment.insert(0, nodes);
  }
}

/**
 * Construit un bloc dépliable (`details` > `detailsSummary` + `detailsContent`)
 * à partir des lignes internes d'un `<details>` sérialisé en HTML.
 */
function buildDetails(innerLines: string[]): Y.XmlElement {
  const rest = [...innerLines];

  // Titre cliquable
  let summaryText = "Détails";
  const summaryIdx = rest.findIndex((l) => RE_SUMMARY.test(l.trim()));
  if (summaryIdx !== -1) {
    summaryText = rest[summaryIdx].trim().match(RE_SUMMARY)?.[1]?.trim() || "";
    rest.splice(0, summaryIdx + 1);
  }

  // Corps : retire l'enveloppe <div data-type="detailsContent"> ... </div>
  while (rest.length > 0 && !rest[0].trim()) rest.shift();
  if (rest.length > 0 && RE_DETAILS_CONTENT_OPEN.test(rest[0].trim())) {
    rest.shift();
    let depth = 1;
    const body: string[] = [];
    while (rest.length > 0) {
      const line = rest.shift()!;
      const trimmed = line.trim();
      if (RE_DETAILS_CONTENT_OPEN.test(trimmed) || /^<div\b/i.test(trimmed)) depth++;
      else if (RE_DIV_CLOSE.test(trimmed)) {
        depth--;
        if (depth === 0) break;
      }
      body.push(line);
    }
    rest.length = 0;
    rest.push(...body);
  }

  const summary = new Y.XmlElement("detailsSummary");
  summary.insert(0, [xmlText(summaryText)]);

  const contentNodes = markdownToNodes(rest.join("\n"));
  const content = new Y.XmlElement("detailsContent");
  content.insert(0, contentNodes.length > 0 ? contentNodes : [paragraph("")]);

  const details = new Y.XmlElement("details");
  details.insert(0, [summary, content]);
  return details;
}

/** Convertit du markdown en liste de nœuds TipTap (voir markdownToXmlFragment). */
function markdownToNodes(markdown: string): Y.XmlElement[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const nodes: Y.XmlElement[] = [];
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    const line = raw.trim();

    // Lignes vides → ignorées (séparation de blocs)
    if (!line) { i++; continue; }

    // Bloc dépliable : <details> ... </details> (avec imbrication possible)
    if (RE_DETAILS_OPEN.test(line)) {
      let depth = 1;
      const inner: string[] = [];
      i++;
      while (i < lines.length) {
        const cur = lines[i].trim();
        if (RE_DETAILS_OPEN.test(cur)) depth++;
        else if (RE_DETAILS_CLOSE.test(cur)) {
          depth--;
          if (depth === 0) { i++; break; }
        }
        inner.push(lines[i]);
        i++;
      }
      nodes.push(buildDetails(inner));
      continue;
    }

    // Balises orphelines de bloc dépliable : ignorées (pas de paragraphe littéral)
    if (
      RE_DETAILS_CLOSE.test(line) ||
      RE_SUMMARY.test(line) ||
      RE_DETAILS_CONTENT_OPEN.test(line) ||
      RE_DIV_CLOSE.test(line)
    ) {
      i++;
      continue;
    }

    // Filet horizontal
    if (RE_HR.test(line)) {
      nodes.push(new Y.XmlElement("horizontalRule"));
      i++;
      continue;
    }

    // Titre
    const mh = line.match(RE_HEADING);
    if (mh) {
      const el = new Y.XmlElement("heading");
      el.setAttribute("level", String(mh[1].length));
      el.insert(0, [xmlText(mh[2])]);
      nodes.push(el);
      i++;
      continue;
    }

    // Image (bloc seul)
    const mi = line.match(RE_IMAGE);
    if (mi) {
      const img = new Y.XmlElement("image");
      img.setAttribute("src", mi[2]);
      if (mi[1]) img.setAttribute("alt", mi[1]);
      nodes.push(img);
      i++;
      continue;
    }

    // Chronomètre (placeholder) : [[chrono]] ou [[chrono: Label]]
    const mc = line.match(RE_CHRONO);
    if (mc) {
      const chrono = new Y.XmlElement("chronoBlock");
      if (mc[1]) chrono.setAttribute("label", mc[1]);
      nodes.push(chrono);
      i++;
      continue;
    }

    // Base de données liée (placeholder à câbler) : [[bdd: Nom]]
    const md = line.match(RE_DB);
    if (md) {
      const dbBlock = new Y.XmlElement("databaseBlock");
      dbBlock.setAttribute("databaseName", md[1]);
      dbBlock.setAttribute("viewMode", "table");
      // databaseId laissé absent (null) → le bloc s'affiche en mode création/liaison.
      nodes.push(dbBlock);
      i++;
      continue;
    }

    // Tableau : ligne d'en-tête suivie d'une ligne de séparation
    if (RE_TABLE_ROW.test(line) && i + 1 < lines.length && RE_TABLE_SEP.test(lines[i + 1].trim())) {
      const table = new Y.XmlElement("table");
      // En-tête
      const headerCells = splitTableCells(line);
      const headerRow = new Y.XmlElement("tableRow");
      for (const cell of headerCells) {
        const th = new Y.XmlElement("tableHeader");
        th.insert(0, [paragraph(cell)]);
        headerRow.insert(headerRow.length, [th]);
      }
      table.insert(0, [headerRow]);
      i += 2; // saute en-tête + séparateur
      // Lignes de corps
      while (i < lines.length && RE_TABLE_ROW.test(lines[i].trim())) {
        const cells = splitTableCells(lines[i].trim());
        const row = new Y.XmlElement("tableRow");
        for (const cell of cells) {
          const td = new Y.XmlElement("tableCell");
          td.insert(0, [paragraph(cell)]);
          row.insert(row.length, [td]);
        }
        table.insert(table.length, [row]);
        i++;
      }
      nodes.push(table);
      continue;
    }

    // Citation : lignes consécutives commençant par >
    if (RE_QUOTE.test(line)) {
      const quote = new Y.XmlElement("blockquote");
      while (i < lines.length && RE_QUOTE.test(lines[i].trim())) {
        const match = lines[i].trim().match(RE_QUOTE);
        const text = match?.[1] ?? '';
        quote.insert(quote.length, [paragraph(text)]);
        i++;
      }
      nodes.push(quote);
      continue;
    }

    // Liste de tâches (checklist) : - [ ] / - [x]
    if (RE_TASK.test(line)) {
      const list = new Y.XmlElement("taskList");
      while (i < lines.length && RE_TASK.test(lines[i].trim())) {
        const match = lines[i].trim().match(RE_TASK);
        const mt = match || [];
        const item = new Y.XmlElement("taskItem");
        item.setAttribute("checked", (mt[1] || '').toLowerCase() === "x" ? "true" : "false");
        item.insert(0, [paragraph(mt[2] || '')]);
        list.insert(list.length, [item]);
        i++;
      }
      nodes.push(list);
      continue;
    }

    // Liste à puces
    if (RE_BULLET.test(line)) {
      const list = new Y.XmlElement("bulletList");
      while (i < lines.length && RE_BULLET.test(lines[i].trim()) && !RE_TASK.test(lines[i].trim())) {
        const match = lines[i].trim().match(RE_BULLET);
        const mb = match || [];
        const item = new Y.XmlElement("listItem");
        item.insert(0, [paragraph(mb[1] || '')]);
        list.insert(list.length, [item]);
        i++;
      }
      nodes.push(list);
      continue;
    }

    // Liste numérotée
    if (RE_ORDERED.test(line)) {
      const list = new Y.XmlElement("orderedList");
      while (i < lines.length && RE_ORDERED.test(lines[i].trim())) {
        const match = lines[i].trim().match(RE_ORDERED);
        const mo = match || [];
        const item = new Y.XmlElement("listItem");
        item.insert(0, [paragraph(mo[1] || '')]);
        list.insert(list.length, [item]);
        i++;
      }
      nodes.push(list);
      continue;
    }

    // Paragraphe : regrouper les lignes consécutives « simples »
    const buf: string[] = [];
    while (i < lines.length) {
      const l = lines[i].trim();
      if (
        !l ||
        RE_HR.test(l) || RE_HEADING.test(l) || RE_IMAGE.test(l) ||
        RE_TASK.test(l) || RE_BULLET.test(l) || RE_ORDERED.test(l) ||
        RE_QUOTE.test(l) || RE_TABLE_ROW.test(l) ||
        RE_CHRONO.test(l) || RE_DB.test(l) ||
        RE_DETAILS_OPEN.test(l) || RE_DETAILS_CLOSE.test(l) ||
        RE_SUMMARY.test(l) || RE_DETAILS_CONTENT_OPEN.test(l) || RE_DIV_CLOSE.test(l)
      ) break;
      buf.push(l);
      i++;
    }
    if (buf.length > 0) nodes.push(paragraph(buf.join(" ")));
  }

  return nodes;
}

/**
 * Convertit un contenu de template (markdown + optionnel: databaseBlock) en état Yjs binaire.
 * Retourne null si le contenu est vide.
 */
export function templateContentToYjsState(
  content: TemplateContent,
  databaseId?: string
): Uint8Array | null {
  if (!content.markdown && !content.database) return null;

  const ydoc = new Y.Doc();
  const fragment = ydoc.getXmlFragment("default");

  if (content.markdown) {
    markdownToXmlFragment(content.markdown, fragment);
  }

  if (content.database && databaseId) {
    const dbBlock = new Y.XmlElement("databaseBlock");
    dbBlock.setAttribute("databaseId", databaseId);
    dbBlock.setAttribute("databaseName", content.database.name);
    dbBlock.setAttribute("viewMode", "table");
    fragment.insert(fragment.length, [dbBlock]);
  }

  const state = Y.encodeStateAsUpdate(ydoc);
  ydoc.destroy();
  return state;
}
