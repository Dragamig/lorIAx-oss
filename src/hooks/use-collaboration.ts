"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { HocuspocusProvider } from "@hocuspocus/provider";
import { IndexeddbPersistence } from "y-indexeddb";
import * as Y from "yjs";

interface UseCollaborationOptions {
  documentId: string;
  token: string;
  enabled?: boolean;
}

interface CollaborationState {
  provider: HocuspocusProvider | null;
  ydoc: Y.Doc | null;
  isConnected: boolean;
  isSynced: boolean;
  connectionError: string | null;
  /** Number of Yjs updates buffered locally (not yet sent to server) */
  pendingUpdates: number;
  /** True dès que IndexedDB a restauré le document Yjs (~50-100ms, avant la synchro WebSocket) */
  ydocReady: boolean;
}

export function useCollaboration({
  documentId,
  token,
  enabled = true,
}: UseCollaborationOptions): CollaborationState {
  const [isConnected, setIsConnected] = useState(false);
  const [isSynced, setIsSynced] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [pendingUpdates, setPendingUpdates] = useState(0);
  const [ydocReady, setYdocReady] = useState(false);
  /**
   * Jeton réellement utilisé pour la connexion. Il part du jeton fourni par la
   * page, puis peut être remplacé par un jeton fraîchement émis si le serveur
   * refuse celui-ci comme périmé (jeton expiré, ou émis avant le cloisonnement
   * multi-tenant du canal WebSocket et donc dépourvu d'organisation).
   */
  const [activeToken, setActiveToken] = useState(token);
  const tokenRefreshedRef = useRef(false);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const idbPersistenceRef = useRef<IndexeddbPersistence | null>(null);

  const cleanup = useCallback(() => {
    if (providerRef.current) {
      providerRef.current.destroy();
      providerRef.current = null;
    }
    if (idbPersistenceRef.current) {
      idbPersistenceRef.current.destroy();
      idbPersistenceRef.current = null;
    }
    if (ydocRef.current) {
      ydocRef.current.destroy();
      ydocRef.current = null;
    }
    setIsConnected(false);
    setIsSynced(false);
    setPendingUpdates(0);
    setYdocReady(false);
  }, []);

  // Un nouveau jeton fourni par la page réarme la possibilité de rafraîchir
  useEffect(() => {
    tokenRefreshedRef.current = false;
    setActiveToken(token);
  }, [token, documentId]);

  useEffect(() => {
    if (!enabled || !documentId || !activeToken) {
      cleanup();
      return;
    }

    let mounted = true;

    // Create Yjs document
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;

    // Persist Y.Doc in IndexedDB for offline reading
    const idbPersistence = new IndexeddbPersistence(`loriax-doc-${documentId}`, ydoc);
    idbPersistenceRef.current = idbPersistence;

    // Signal dès que IndexedDB a restauré le contenu Yjs (avant la synchro WebSocket)
    // Guard against calling setState after unmount (fast document navigation)
    idbPersistence.whenSynced.then(() => {
      if (mounted) setYdocReady(true);
    });

    // Determine WebSocket URL
    const wsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${wsProtocol}//${window.location.host}/ws/collab`;

    // Track local Yjs updates that haven't been synced
    let localPending = 0;
    const handleYjsUpdate = (_update: Uint8Array, origin: unknown) => {
      // Updates originating from the provider (server) are not "pending"
      if (origin !== provider) {
        localPending++;
        setPendingUpdates(localPending);
      }
    };
    ydoc.on("update", handleYjsUpdate);

    // Create Hocuspocus provider
    const provider = new HocuspocusProvider({
      url: wsUrl,
      name: documentId,
      document: ydoc,
      token: activeToken,
      onConnect() {
        setIsConnected(true);
        setConnectionError(null);
      },
      onDisconnect() {
        setIsConnected(false);
        setIsSynced(false);
      },
      onSynced() {
        setIsSynced(true);
        // Once synced, all buffered updates have been sent
        localPending = 0;
        setPendingUpdates(0);
      },
      onAuthenticationFailed(data) {
        const reason = data.reason;
        // Hocuspocus renvoie "permission-denied" par défaut — on traduit en français
        if (reason === "permission-denied" || reason === "Accès refusé") {
          setConnectionError("Accès refusé — vous n'avez pas les droits sur ce document");
          return;
        }
        // Jeton périmé ou antérieur au cloisonnement multi-tenant : on en
        // redemande un neuf (une seule fois) plutôt que de boucler sur le refus.
        if (reason === "Session expirée" || reason === "Non autorisé") {
          if (tokenRefreshedRef.current) {
            setConnectionError("Session expirée — veuillez recharger la page");
            return;
          }
          tokenRefreshedRef.current = true;
          fetch("/api/auth/ws-token")
            .then((res) => (res.ok ? res.json() : null))
            .then((body: { token?: string } | null) => {
              if (!mounted) return;
              if (body?.token) {
                setConnectionError(null);
                setActiveToken(body.token);
              } else {
                setConnectionError("Session expirée — veuillez recharger la page");
              }
            })
            .catch(() => {
              if (mounted) setConnectionError("Session expirée — veuillez recharger la page");
            });
          return;
        }
        setConnectionError(reason || "Erreur d'authentification");
      },
    });

    providerRef.current = provider;

    return () => {
      mounted = false;
      cleanup();
    };
  }, [documentId, activeToken, enabled, cleanup]);

  return {
    provider: providerRef.current,
    ydoc: ydocRef.current,
    isConnected,
    isSynced,
    connectionError,
    pendingUpdates,
    ydocReady,
  };
}
