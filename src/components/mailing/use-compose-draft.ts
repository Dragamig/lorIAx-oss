"use client";

import { useCallback, useEffect, useState } from "react";

export interface DraftAttachment {
  source: "upload" | "media";
  storageKey: string;
  fileName: string;
  mimeType: string;
  size: number;
  mediaId?: string;
}

export interface ComposeDraft {
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  bodyHtml: string;
  attachments: DraftAttachment[];
  dossierRowId: string | null;
  /** Idempotency key of the next send; regenerated after a cancel. */
  clientKey: string;
  inReplyToMessageId?: string;
}

const PREFIX = "loriax:mail-draft:";
const EVENT = "loriax:mail-draft";

const stripTags = (html: string) => html.replace(/<[^>]*>/g, "").replace(/&nbsp;/g, " ").trim();

/** A draft worth keeping: something typed beyond the prefilled recipient. */
export function isMeaningful(d: ComposeDraft): boolean {
  return Boolean(d.subject.trim() || stripTags(d.bodyHtml) || d.attachments.length || d.cc.length || d.bcc.length);
}

export function readDraft(key: string): ComposeDraft | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<ComposeDraft>;
    if (!v || typeof v !== "object" || !Array.isArray(v.to) || typeof v.clientKey !== "string") return null;
    return {
      to: v.to,
      cc: Array.isArray(v.cc) ? v.cc : [],
      bcc: Array.isArray(v.bcc) ? v.bcc : [],
      subject: typeof v.subject === "string" ? v.subject : "",
      bodyHtml: typeof v.bodyHtml === "string" ? v.bodyHtml : "",
      attachments: Array.isArray(v.attachments) ? v.attachments : [],
      dossierRowId: typeof v.dossierRowId === "string" ? v.dossierRowId : null,
      clientKey: v.clientKey,
      inReplyToMessageId: typeof v.inReplyToMessageId === "string" ? v.inReplyToMessageId : undefined,
    };
  } catch {
    return null;
  }
}

function notify(key: string) {
  try {
    window.dispatchEvent(new CustomEvent(EVENT, { detail: key }));
  } catch {
    /* ignore */
  }
}

export function writeDraft(key: string, draft: ComposeDraft): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(draft));
  } catch {
    /* storage unavailable: the draft just does not persist */
  }
  notify(key);
}

export function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* ignore */
  }
  notify(key);
}

/** Removes every local draft (sign out): drafts must not outlive the session on a shared browser. */
export function purgeMailDrafts(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i);
      if (k?.startsWith(PREFIX)) keys.push(k);
    }
    for (const k of keys) window.localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

/** Per-fiche draft in localStorage (never the mailbox password); reads are guarded. */
export function useComposeDraft(key: string): {
  draft: ComposeDraft | null;
  setDraft: (d: ComposeDraft) => void;
  clear: () => void;
} {
  const [state, setState] = useState<{ key: string; draft: ComposeDraft | null }>(() => ({ key, draft: readDraft(key) }));
  const draft = state.key === key ? state.draft : readDraft(key);

  useEffect(() => {
    const on = (e: Event) => {
      if ((e as CustomEvent<string>).detail === key) setState({ key, draft: readDraft(key) });
    };
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [key]);

  const setDraft = useCallback((d: ComposeDraft) => writeDraft(key, d), [key]);
  const clear = useCallback(() => clearDraft(key), [key]);
  return { draft, setDraft, clear };
}
