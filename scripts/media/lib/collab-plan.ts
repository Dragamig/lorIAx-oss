/**
 * Cadre de décision du script media:rewrite-collab (B123).
 * Aucune connexion base ici : module pur, testable sans infrastructure.
 */
import { ATTACHMENT_RE, safeDecode } from "@/lib/media/rewrite-document-refs";
import type { RewriteOutcome } from "./report";

export type CollabAction = "rewrite_state" | "resync_markdown" | "skip_clean" | "skip_active";

export interface ClassifyInput {
  /** L'état Yjs contient au moins une clé ancienne qui se résout vers un média de l'organisation. */
  stateHasResolvable: boolean;
  /** Le fichier disque ET content_text égalent le Markdown régénéré depuis l'état actuel. */
  contentInSync: boolean;
  /** Minutes écoulées depuis la dernière modification de l'état. */
  idleMinutes: number;
  /** Inactivité minimale exigée pour réécrire un état. */
  minIdle: number;
}

/**
 * Décision par comparaison, jamais par simple présence d'une URL ancienne :
 * - clés résolvables dans l'état : rewrite_state (skip_active si l'état a bougé depuis moins de minIdle) ;
 * - sinon, disque et content_text déjà égaux au Markdown de l'état : skip_clean (une URL ancienne en
 *   texte brut ou une clé non résolue ne provoque aucune passe) ;
 * - sinon : resync_markdown, sans condition d'inactivité (l'état n'est pas modifié).
 */
export function classifyDocument(input: ClassifyInput): CollabAction {
  if (input.stateHasResolvable) {
    return input.idleMinutes < input.minIdle ? "skip_active" : "rewrite_state";
  }
  return input.contentInSync ? "skip_clean" : "resync_markdown";
}

/** Fins de ligne et espace final uniquement. */
export function normalizeMarkdown(text: string): string {
  return text.replace(/\r\n/g, "\n").trimEnd();
}

const DESIGN_TAG_RE = /<div\b[^>]*\bdata-type="design-block"[^>]*>/g;
const THUMB_ATTR_RE = /(\bthumbnailurl=")([^"]*)(")/;

function unescapeAttr(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

function isBareKey(value: string): boolean {
  return value !== "" && !value.startsWith("data:") && !value.startsWith("http") && !value.startsWith("/");
}

/** Clés anciennes d'un Markdown : `/api/attachments/<clé>` (décodées) et miniatures de bloc design en clé nue. */
export function collectMarkdownKeys(text: string | null | undefined): string[] {
  const src = text ?? "";
  const keys = new Set<string>();
  if (src.includes("/api/attachments/")) {
    for (const m of src.matchAll(new RegExp(ATTACHMENT_RE.source, "g"))) {
      const key = safeDecode(m[1]);
      if (key) keys.add(key);
    }
  }
  for (const tag of src.match(DESIGN_TAG_RE) ?? []) {
    const m = THUMB_ATTR_RE.exec(tag);
    const value = m ? unescapeAttr(m[2]) : "";
    if (isBareKey(value)) keys.add(value);
  }
  return [...keys];
}

/**
 * Substitue dans un Markdown les anciennes références dont la clé figure dans `map` (clé vers id de média).
 * Les clés absentes de la carte restent telles quelles.
 */
export function substituteResolvedRefs(text: string, map: ReadonlyMap<string, string>): string {
  let out = text;
  if (out.includes("/api/attachments/")) {
    out = out.replace(new RegExp(ATTACHMENT_RE.source, "g"), (whole, raw: string) => {
      const id = map.get(safeDecode(raw));
      return id ? `/api/media/${id}` : whole;
    });
  }
  return out.replace(DESIGN_TAG_RE, (tag) =>
    tag.replace(THUMB_ATTR_RE, (whole, pre: string, value: string, post: string) => {
      const v = unescapeAttr(value);
      const id = isBareKey(v) ? map.get(v) : undefined;
      return id ? `${pre}/api/media/${id}${post}` : whole;
    }),
  );
}

/**
 * Invariant d'écriture : le fichier actuel, une fois ses anciennes URL résolues substituées, égale le
 * Markdown régénéré depuis le nouvel état. Sinon la régénération perdrait autre chose qu'une URL.
 */
export function diskDifferenceIsOnlyRefs(
  disk: string,
  regenerated: string,
  map: ReadonlyMap<string, string>,
): boolean {
  return normalizeMarkdown(substituteResolvedRefs(disk, map)) === normalizeMarkdown(regenerated);
}

/**
 * Second cas d'écriture admis : le fichier actuel égale, à la normalisation près, le Markdown que produisait le
 * convertisseur antérieur à B123 (sans rendu des images) pour l'état d'origine. Cela prouve que le serveur
 * collaboratif a écrit ce fichier : le régénérer n'ajoute que les images et la substitution d'URL.
 */
export function diskMatchesLegacyConverter(disk: string, legacyMarkdown: string): boolean {
  return normalizeMarkdown(disk) === normalizeMarkdown(legacyMarkdown);
}

/** Vrai si aucune référence d'avant n'a disparu après réécriture (ensembles dédupliqués, ordre indifférent). */
export function checkReferenceGuard(beforeRefs: readonly string[], afterRefs: readonly string[]): boolean {
  const after = new Set(afterRefs);
  for (const ref of new Set(beforeRefs)) {
    if (!after.has(ref)) return false;
  }
  return true;
}

export type CollabStatus =
  | "rewritten"
  /** État propre, Markdown resynchronisé. */
  | "resynced"
  | "skip_clean"
  | "skip_active"
  /** Ignoré par la garde de références (références perdues). */
  | "skipped_guard"
  /** Ignoré : le fichier disque diffère du Markdown régénéré par autre chose que des URL résolues. */
  | "disk_diverged"
  /** Ignoré : la mise à jour conditionnelle a été perdue (le document a bougé). */
  | "skipped_concurrent"
  /** État réécrit mais écriture disque échouée ; rattrapé par resync_markdown à la passe suivante. */
  | "markdown_stale"
  | "error";

export interface CollabReportEntry {
  documentId: string;
  orgId: string;
  status: CollabStatus;
  /** Nombre de références réécrites. */
  rewritten: number;
  /** Nombre de références laissées en l'état. */
  skipped: number;
  reason?: string;
}

/** Projection sur les issues de Report (scripts/media/lib/report.ts). */
export function toReportOutcome(status: CollabStatus): RewriteOutcome {
  switch (status) {
    case "rewritten":
    case "resynced":
      return "rewritten";
    case "skip_clean":
      return "unchanged";
    case "skip_active":
    case "skipped_concurrent":
      return "skipped_concurrent";
    case "skipped_guard":
    case "disk_diverged":
    case "markdown_stale":
    case "error":
      return "unparseable";
  }
}
