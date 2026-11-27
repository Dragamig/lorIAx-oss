"use client";

import { useCallback, useEffect, useState } from "react";
import type { ConversationDto, MailMessageDto } from "@/lib/mailing/threads";

export type MailDto = MailMessageDto;
export type ConversationView = ConversationDto;

export interface FicheMailContext {
  viewer: { orgId: string; userId: string };
  role: "contacts" | "dossiers";
  contact: { rowId: string | null; name: string | null; email: string | null };
  dossiers: { rowId: string; title: string; updatedAt: string }[];
  defaultDossierRowId: string | null;
  fixedDossierRowId: string | null;
  mailbox: { configured: boolean; address: string | null; signature: string; cancelDelaySeconds: number };
  quota: { limit: number | null; exceeded: boolean };
  alert: { pending: number; crmDisconnected: boolean };
}

export type FicheMailsStatus = "loading" | "ready" | "error" | "empty" | "unconfigured";

export interface ComposeOptions {
  replyTo?: MailDto;
  /** Failed mail whose content reopens in the drawer. */
  resume?: MailDto;
}

const qs = (databaseId: string, rowId: string) =>
  `databaseId=${encodeURIComponent(databaseId)}&rowId=${encodeURIComponent(rowId)}`;

interface Loaded {
  key: string;
  available: boolean;
  context: FicheMailContext | null;
  conversations: ConversationView[];
  failed: boolean;
}

export interface FicheMails {
  context: FicheMailContext | null;
  conversations: ConversationView[];
  status: FicheMailsStatus;
  /** null while unknown, false when the context route does not recognise the row (404). */
  available: boolean | null;
  reload(): void;
  openCompose(opts?: ComposeOptions): void;
}

/** One load of context and messages, shared by the aside (tab visibility, count) and the tab itself. */
export function useFicheMails(databaseId: string, rowId: string, onCompose?: (opts?: ComposeOptions) => void): FicheMails {
  const [nonce, setNonce] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const key = `${databaseId}:${rowId}:${nonce}`;

  useEffect(() => {
    const ctrl = new AbortController();
    (async () => {
      let result: Loaded;
      try {
        const ctxRes = await fetch(`/api/mail/context?${qs(databaseId, rowId)}`, { signal: ctrl.signal });
        if (ctxRes.status === 404) {
          result = { key, available: false, context: null, conversations: [], failed: true };
        } else {
          const msgRes = await fetch(`/api/mail/messages?${qs(databaseId, rowId)}`, { signal: ctrl.signal });
          if (!ctxRes.ok || !msgRes.ok) throw new Error("http");
          const context = (await ctxRes.json()) as FicheMailContext;
          const body = (await msgRes.json()) as { conversations: ConversationView[] };
          if (!context?.mailbox || !Array.isArray(body?.conversations)) {
            // Réponse sans la forme attendue (route absente, module non servi) : l'onglet n'est pas proposé.
            result = { key, available: false, context: null, conversations: [], failed: true };
          } else {
            result = { key, available: true, context, conversations: body.conversations, failed: false };
          }
        }
      } catch {
        if (ctrl.signal.aborted) return;
        result = { key, available: true, context: null, conversations: [], failed: true };
      }
      if (!ctrl.signal.aborted) setLoaded(result);
    })();
    return () => ctrl.abort();
  }, [databaseId, rowId, key]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  const openCompose = useCallback((opts?: ComposeOptions) => onCompose?.(opts), [onCompose]);

  const current = loaded && loaded.key === key ? loaded : null;
  let status: FicheMailsStatus = "loading";
  if (current) {
    if (current.failed) status = "error";
    else if (!current.context?.mailbox.configured) status = "unconfigured";
    else status = current.conversations.length === 0 ? "empty" : "ready";
  }
  return {
    context: current?.context ?? null,
    conversations: current?.conversations ?? [],
    status,
    available: current ? current.available : null,
    reload,
    openCompose,
  };
}
