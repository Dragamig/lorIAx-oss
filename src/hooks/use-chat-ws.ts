"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useSession } from "next-auth/react";
import type { SessionUser } from "@/types";

export interface ChatMessage {
  id: string;
  channelId: string;
  authorId: string;
  authorName: string;
  content: string | null;
  createdAt: string;
}

interface UseChatWsOptions {
  onMessage: (msg: ChatMessage) => void;
  onTyping?: (channelId: string, userName: string) => void;
}

/**
 * Hook WebSocket pour la messagerie live.
 *
 * L'authentification se fait via un jeton JWT court-vécu obtenu depuis
 * GET /api/auth/ws-token (le cookie de session est HTTP-only et inaccessible
 * au JS côté client).
 */
export function useChatWs({ onMessage, onTyping }: UseChatWsOptions) {
  const { data: session, status } = useSession();
  const ws = useRef<WebSocket | null>(null);
  const [connected, setConnected] = useState(false);

  // Refs pour les callbacks afin d'éviter de recréer le socket à chaque render
  const onMessageRef = useRef(onMessage);
  const onTypingRef = useRef(onTyping);
  useEffect(() => { onMessageRef.current = onMessage; }, [onMessage]);
  useEffect(() => { onTypingRef.current = onTyping; }, [onTyping]);

  // Identifiant stable : `session.user` change de référence à chaque refetch de
  // next-auth (focus fenêtre, refresh) même quand les données sont identiques.
  // Dépendre de l'objet relancerait l'effet en boucle et fermerait le socket
  // en cours de connexion. On dépend donc de l'`id` primitif.
  const userId = (session?.user as SessionUser | undefined)?.id;

  useEffect(() => {
    // Attendre que la session soit authentifiée
    if (status !== "authenticated" || !userId) return;

    let socket: WebSocket | null = null;
    let cancelled = false;

    async function connect() {
      // Obtenir un jeton JWT court-vécu pour l'auth WebSocket
      const res = await fetch("/api/auth/ws-token");
      if (!res.ok || cancelled) return;

      const { token } = await res.json() as { token: string };
      if (!token || cancelled) return;

      const protocol = window.location.protocol === "https:" ? "wss" : "ws";
      socket = new WebSocket(`${protocol}://${window.location.host}/ws/chat`);
      ws.current = socket;

      socket.onopen = () => {
        socket!.send(JSON.stringify({ type: "auth", token }));
      };

      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data as string) as Record<string, unknown>;
          if (data.type === "auth_ok") {
            setConnected(true);
          } else if (data.type === "message") {
            onMessageRef.current(data as unknown as ChatMessage);
          } else if (data.type === "typing" && onTypingRef.current) {
            onTypingRef.current(data.channelId as string, data.userName as string);
          }
        } catch {
          // Ignorer les messages malformés
        }
      };

      socket.onclose = () => {
        if (ws.current === socket) {  // guard : ignorer la fermeture d'un ancien socket
          setConnected(false);
          ws.current = null;
        }
      };
    }

    connect();

    return () => {
      cancelled = true;
      if (socket) {
        // Fermer un socket encore en CONNECTING déclenche le warning navigateur
        // « WebSocket is closed before the connection is established ». On diffère
        // donc la fermeture jusqu'à l'ouverture effective.
        if (socket.readyState === WebSocket.OPEN) {
          socket.close();
        } else if (socket.readyState === WebSocket.CONNECTING) {
          const s = socket;
          s.addEventListener("open", () => s.close(), { once: true });
        }
      }
      ws.current = null;
      setConnected(false);
    };
  }, [status, userId]);

  const sendMessage = useCallback((channelId: string, content: string) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: "message", channelId, content }));
    }
  }, []);

  const sendTyping = useCallback((channelId: string) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: "typing", channelId }));
    }
  }, []);

  const markRead = useCallback((channelId: string) => {
    if (ws.current?.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({ type: "read", channelId }));
    }
  }, []);

  return { connected, sendMessage, sendTyping, markRead };
}
