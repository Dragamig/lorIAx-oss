import * as Y from "yjs";
import {
  ATTACHMENT_RE,
  UUID_RE,
  safeDecode,
  type LookupResult,
} from "@/lib/media/rewrite-document-refs";

// Fragment ProseMirror utilisé par le serveur collaboratif (voir markdown-sync.ts).
const FRAGMENT_NAME = "default";

export type YDocRewriteResult = { rewritten: number; skipped: number };

type Visitor = {
  attribute?: (el: Y.XmlElement, name: string, value: string) => void;
  link?: (text: Y.XmlText, index: number, length: number, link: Record<string, unknown>, href: string) => void;
};

function walkText(text: Y.XmlText, visitor: Visitor) {
  if (!visitor.link) return;
  let index = 0;
  for (const op of text.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[]) {
    const length = typeof op.insert === "string" ? op.insert.length : 1;
    const link = op.attributes?.link;
    if (link && typeof link === "object" && typeof (link as { href?: unknown }).href === "string") {
      visitor.link(text, index, length, link as Record<string, unknown>, (link as { href: string }).href);
    }
    index += length;
  }
}

function walk(node: Y.XmlFragment | Y.XmlElement, visitor: Visitor) {
  if (visitor.attribute && node instanceof Y.XmlElement) {
    for (const [name, value] of Object.entries(node.getAttributes())) {
      if (typeof value === "string") visitor.attribute(node, name, value);
    }
  }
  for (const child of node.toArray()) {
    if (child instanceof Y.XmlText) walkText(child, visitor);
    else if (child instanceof Y.XmlElement || child instanceof Y.XmlFragment) walk(child, visitor);
  }
}

/**
 * Miniature d'un bloc design stockée en clé nue (forme historique, sans préfixe) :
 * l'éditeur la sert via `/api/attachments/<clé>` (resolveThumbnailSrc) et sait afficher
 * `/api/media/<id>` pour ce même attribut, donc elle se réécrit comme une ancienne URL.
 */
export function isBareDesignThumbnailKey(elementName: string, attrName: string, value: string): boolean {
  if (elementName !== "designBlock" || attrName !== "thumbnailUrl") return false;
  if (!value || value.startsWith("data:") || value.startsWith("http") || value.startsWith("/")) return false;
  return true;
}

function attachmentMatches(value: string): RegExpMatchArray[] {
  if (!value.includes("/api/attachments/")) return [];
  return [...value.matchAll(new RegExp(ATTACHMENT_RE.source, "g"))];
}

/** Clés d'ancienne forme `/api/attachments/<clé>` (décodées, dédupliquées, ordre d'apparition). */
export function collectLegacyKeys(ydoc: Y.Doc): string[] {
  const keys = new Set<string>();
  const add = (value: string) => {
    for (const m of attachmentMatches(value)) {
      const key = safeDecode(m[1]);
      if (key) keys.add(key);
    }
  };
  walk(ydoc.getXmlFragment(FRAGMENT_NAME), {
    attribute: (el, name, value) => {
      if (isBareDesignThumbnailKey(el.nodeName, name, value)) keys.add(value);
      else add(value);
    },
    link: (_t, _i, _l, _link, href) => add(href),
  });
  return [...keys];
}

/**
 * Remplace `/api/attachments/<clé>` par `/api/media/<id>` dans les attributs de nœuds
 * et les `href` des marques de lien. Les textes bruts ne sont pas touchés. Une clé
 * absente de la carte est laissée telle quelle et comptée dans `skipped`.
 */
export function applyKeyMap(ydoc: Y.Doc, map: Map<string, string>): YDocRewriteResult {
  let rewritten = 0;
  let skipped = 0;
  const replace = (value: string): string => {
    return value.replace(new RegExp(ATTACHMENT_RE.source, "g"), (whole, raw: string) => {
      const id = map.get(safeDecode(raw));
      if (id) {
        rewritten += 1;
        return `/api/media/${id}`;
      }
      skipped += 1;
      return whole;
    });
  };
  ydoc.transact(() => {
    walk(ydoc.getXmlFragment(FRAGMENT_NAME), {
      attribute: (el, name, value) => {
        if (isBareDesignThumbnailKey(el.nodeName, name, value)) {
          const id = map.get(value);
          if (id) {
            el.setAttribute(name, `/api/media/${id}`);
            rewritten += 1;
          } else skipped += 1;
          return;
        }
        if (attachmentMatches(value).length === 0) return;
        const next = replace(value);
        if (next !== value) el.setAttribute(name, next);
      },
      link: (text, index, length, link, href) => {
        if (attachmentMatches(href).length === 0) return;
        const next = replace(href);
        if (next !== href) text.format(index, length, { link: { ...link, href: next } });
      },
    });
  });
  return { rewritten, skipped };
}

/** Collecte les clés, les résout dans l'organisation du document, puis réécrit. */
export async function rewriteYDocMediaRefs(
  ydoc: Y.Doc,
  resolve: (keys: string[]) => Promise<Map<string, LookupResult>>,
): Promise<YDocRewriteResult> {
  const keys = collectLegacyKeys(ydoc);
  if (keys.length === 0) return { rewritten: 0, skipped: 0 };
  let found: Map<string, LookupResult> | null = null;
  try {
    found = await resolve(keys);
  } catch {
    found = null;
  }
  const map = new Map<string, string>();
  for (const key of keys) {
    const r = found?.get(key);
    if (r && r.status === "found" && UUID_RE.test(r.id)) map.set(key, r.id.toLowerCase());
  }
  return applyKeyMap(ydoc, map);
}
