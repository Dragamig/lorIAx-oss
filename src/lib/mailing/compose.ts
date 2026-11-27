/**
 * Composition d'un mail sortant : schema d'entree, assainissement du HTML,
 * texte brut, cle de fil et options MIME nodemailer.
 */
import { randomUUID } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import type Mail from "nodemailer/lib/mailer";
import type { MailAccountRow } from "@/lib/db/schema-mailing";
import type { ResolvedAttachment } from "./attachments";

export const MAX_RECIPIENTS = 50;
const MAX_BODY_CHARS = 1_000_000;

const ALLOWED_TAGS = ["p", "br", "strong", "em", "u", "a", "ul", "ol", "li", "blockquote", "span", "div"];

export function sanitizeMailHtml(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: ALLOWED_TAGS,
    allowedAttributes: { a: ["href", "target", "rel"] },
    allowedSchemes: ["http", "https", "mailto"],
    allowProtocolRelative: false,
    disallowedTagsMode: "discard",
    transformTags: { a: sanitizeHtml.simpleTransform("a", { target: "_blank", rel: "noopener noreferrer" }) },
  });
}

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " " };

export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<a\s[^>]*?href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, inner: string) => {
      const label = inner.replace(/<[^>]*>/g, "").trim();
      return !label || label === href || href.startsWith("mailto:") ? inner : `${inner} (${href})`;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<\/li>/gi, "\n")
    .replace(/<\/(p|div|blockquote|ul|ol)>/gi, "\n\n");
  const stripped = sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} });
  return stripped
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (m) => ENTITIES[m] ?? m)
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const address = z.string().trim().max(320).email().transform((v) => v.toLowerCase());

const attachmentRef = z
  .object({
    source: z.enum(["upload", "media"]),
    storageKey: z.string().min(1).max(1024),
    fileName: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(255),
    size: z.number().int().min(0),
    mediaId: z.string().uuid().optional(),
  })
  .strict();

export const composeInputSchema = z
  .object({
    clientKey: z.string().uuid(),
    databaseId: z.string().uuid(),
    rowId: z.string().uuid(),
    dossierRowId: z.string().uuid().optional(),
    to: z.array(address).min(1).max(MAX_RECIPIENTS),
    cc: z.array(address).max(MAX_RECIPIENTS).optional(),
    bcc: z.array(address).max(MAX_RECIPIENTS).optional(),
    subject: z.string().trim().min(1).max(255),
    bodyHtml: z.string().min(1).max(MAX_BODY_CHARS),
    attachments: z.array(attachmentRef).max(20),
    inReplyToMessageId: z.string().max(998).optional(),
  })
  .strict()
  .transform((v, ctx) => {
    const seen = new Set<string>();
    const dedupe = (list: string[] | undefined) =>
      (list ?? []).filter((a) => (seen.has(a) ? false : (seen.add(a), true)));
    const to = dedupe(v.to);
    const cc = dedupe(v.cc);
    const bcc = dedupe(v.bcc);
    if (to.length + cc.length + bcc.length > MAX_RECIPIENTS) {
      ctx.addIssue({ code: "custom", message: "Trop de destinataires", path: ["to"] });
      return z.NEVER;
    }
    const bodyHtml = sanitizeMailHtml(v.bodyHtml);
    if (!htmlToText(bodyHtml)) {
      ctx.addIssue({ code: "custom", message: "Corps vide", path: ["bodyHtml"] });
      return z.NEVER;
    }
    return { ...v, to, cc, bcc, bodyHtml };
  });

export type ComposeInput = z.infer<typeof composeInputSchema>;

const stripBrackets = (id: string) => id.replace(/[<>\s]/g, "");

export function computeThreadKey(input: {
  inReplyTo?: string | null;
  references?: string[];
  messageId: string;
}): string {
  const first = (input.references ?? []).flatMap((r) => r.split(/\s+/)).map(stripBrackets).find(Boolean);
  if (first) return first;
  const reply = input.inReplyTo ? stripBrackets(input.inReplyTo) : "";
  return reply || stripBrackets(input.messageId);
}

export interface MimeMessage {
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  bodyHtml: string;
  inReplyTo?: string | null;
  references?: string[];
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function signatureParts(signature: string): { html: string; text: string } {
  const sig = signature.trim();
  if (!sig) return { html: "", text: "" };
  const isHtml = /<[a-z][\s\S]*>/i.test(sig);
  const html = isHtml ? sanitizeMailHtml(sig) : escapeHtml(sig).replace(/\r?\n/g, "<br>");
  return { html: `<br><div>-- <br>${html}</div>`, text: `\n\n-- \n${htmlToText(html)}` };
}

export function buildMimeOptions(
  account: Pick<MailAccountRow, "address" | "displayName" | "signature">,
  message: MimeMessage,
  attachments: ResolvedAttachment[],
): Mail.Options {
  const addr = account.address.trim().toLowerCase();
  const domain = addr.split("@")[1] ?? "localhost";
  const name = account.displayName.replace(/["\\\r\n]/g, "").trim();
  const sig = signatureParts(account.signature);
  const body = sanitizeMailHtml(message.bodyHtml);
  const cc = message.cc ?? [];
  const bcc = message.bcc ?? [];
  const options: Mail.Options = {
    from: name ? `"${name}" <${addr}>` : addr,
    to: message.to,
    subject: message.subject,
    messageId: `<${randomUUID()}@${domain}>`,
    html: body + sig.html,
    text: htmlToText(body) + sig.text,
    // Les Bcc ne figurent que dans l'enveloppe, jamais dans les en-tetes.
    envelope: { from: addr, to: [...message.to, ...cc, ...bcc] },
  };
  if (cc.length) options.cc = cc;
  if (message.inReplyTo) options.inReplyTo = message.inReplyTo;
  if (message.references?.length) options.references = message.references;
  if (attachments.length) {
    options.attachments = attachments.map((a) => ({ filename: a.fileName, contentType: a.mimeType, content: a.content }));
  }
  return options;
}
