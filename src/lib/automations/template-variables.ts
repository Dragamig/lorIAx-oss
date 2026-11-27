/**
 * Extraction des placeholders d'un template (Spec 1 §4). Deux sources :
 * - le contenu TipTap (nœuds inline `templateVariable`) — source de vérité ;
 * - repli : scan des `{{clé}}` du markdown pour les anciens templates.
 */
import { interpolate, isDateToken, placeholderRegex, type InterpolationPayload } from "@/lib/automations/interpolate";

export type TemplateVariable = { key: string; label: string };

/**
 * Source d'un placeholder de template mappé dans la config d'une action
 * `create_document` (Task 12). `ref` = columnId (cells), chemin de variable
 * d'étape (variables), champ user (`id`/`email`/`name`), ou texte statique.
 */
export type BindingSource = {
  kind: "cells" | "variables" | "user" | "static";
  ref: string;
};

/**
 * Résout un mapping placeholder→source en un dictionnaire clé→valeur
 * interpolée, destiné au canal `extra` d'`interpolate`/`instantiateTemplate`.
 * Réutilise `interpolate` pour cells/variables/user (valeurs absentes → ""),
 * valeur brute pour `static`.
 */
export function buildBindingPayload(
  bindings: Record<string, BindingSource>,
  ctx: InterpolationPayload
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, src] of Object.entries(bindings)) {
    if (src.kind === "static") {
      out[key] = src.ref;
    } else if (src.kind === "cells") {
      out[key] = interpolate(`{{cells.${src.ref}}}`, ctx);
    } else if (src.kind === "variables") {
      out[key] = interpolate(`{{variables.${src.ref}}}`, ctx);
    } else {
      out[key] = interpolate(`{{user.${src.ref}}}`, ctx);
    }
  }
  return out;
}

const RESERVED_PREFIXES = ["cells.", "variables.", "user.", "space.", "doc.", "media."];
const RESERVED_KEYS = new Set(["rowId", "databaseId", "event"]);

export function extractTemplateVariables(content: unknown): TemplateVariable[] {
  const out: TemplateVariable[] = [];
  const seen = new Set<string>();
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const n = node as { type?: string; attrs?: { key?: string; label?: string }; content?: unknown[] };
    if (n.type === "templateVariable" && n.attrs?.key && !seen.has(n.attrs.key)) {
      seen.add(n.attrs.key);
      out.push({ key: n.attrs.key, label: n.attrs.label || n.attrs.key });
    }
    if (Array.isArray(n.content)) for (const child of n.content) walk(child);
  };
  walk(content);
  return out;
}

/**
 * Dérive la liste complète des placeholders d'un template à partir de son
 * `content` persisté (enveloppe `{ markdown?, database? }`, cf. `builtin.ts`).
 * Combine les nœuds `templateVariable` (si le contenu porte un arbre TipTap,
 * cf. Task 11) et le repli de scan du markdown — dédupliqués par clé, les
 * nœuds structurés priment sur le scan texte.
 */
export function deriveTemplateVariables(content: unknown): TemplateVariable[] {
  const fromNodes = extractTemplateVariables(content);
  const markdown =
    typeof content === "string"
      ? content
      : typeof (content as { markdown?: unknown })?.markdown === "string"
        ? ((content as { markdown: string }).markdown)
        : "";
  const fromMarkdown = scanMarkdownPlaceholders(markdown);
  const seen = new Set(fromNodes.map((v) => v.key));
  return [...fromNodes, ...fromMarkdown.filter((v) => !seen.has(v.key))];
}

export function scanMarkdownPlaceholders(markdown: string): TemplateVariable[] {
  const out: TemplateVariable[] = [];
  const seen = new Set<string>();
  const re = placeholderRegex();
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const key = m[1];
    if (isDateToken(key) || RESERVED_KEYS.has(key) || RESERVED_PREFIXES.some((p) => key.startsWith(p))) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: key });
  }
  return out;
}
