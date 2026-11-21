// TODO i18n : textes en français codés en dur (à migrer vers next-intl plus tard)
"use client";

import { useState, useRef, useEffect } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import useSWR from "swr";
import { HelpCircle, Send, Bot, User, X, Wrench } from "lucide-react";
import { getClientSlots } from "@/lib/modules/hooks.client";
import { Button } from "@/components/ui/button";

const enabledFetcher = (url: string) =>
  fetch(url).then(
    (r) => r.json() as Promise<{ enabled: boolean; aiConfigured?: boolean }>,
  );

function TypingIndicator() {
  return (
    <div className="flex gap-3">
      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div className="bg-muted rounded-xl px-4 py-3">
        <div className="flex gap-1 items-center h-4">
          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-muted-foreground" />
          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-muted-foreground" />
          <span className="typing-dot w-1.5 h-1.5 rounded-full bg-muted-foreground" />
        </div>
      </div>
    </div>
  );
}

/**
 * Extrait, de façon défensive, un éventuel message lisible depuis la sortie
 * d'une part d'outil (ai@6). On ne suppose pas la structure exacte : on tente
 * `part.output.message` puis `part.result.message`. Retourne null si absent.
 */
function extractToolMessage(part: unknown): string | null {
  if (!part || typeof part !== "object") return null;
  const candidates = [
    (part as { output?: unknown }).output,
    (part as { result?: unknown }).result,
  ];
  for (const candidate of candidates) {
    if (
      candidate &&
      typeof candidate === "object" &&
      typeof (candidate as { message?: unknown }).message === "string"
    ) {
      return (candidate as { message: string }).message;
    }
  }
  return null;
}

const BASE_SUGGESTIONS = [
  "Comment créer une base de données ?",
  "Comment partager un document ?",
];
const BUG_SUGGESTION = "Signaler un bug";

export function HelpAssistant() {
  const { helpBugReport } = getClientSlots();
  const SUGGESTIONS = helpBugReport ? [...BASE_SUGGESTIONS, BUG_SUGGESTION] : BASE_SUGGESTIONS;
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");

  // Réglage admin : on n'affiche le bouton que si l'assistant est activé ET
  // qu'au moins une IA est configurée (sinon l'assistant ne pourrait jamais
  // répondre). Rendu null tant que l'état n'est pas connu pour éviter tout flash.
  const { data: enabledData } = useSWR("/api/help/enabled", enabledFetcher);
  const helpEnabled =
    Boolean(enabledData?.enabled) && enabledData?.aiConfigured !== false;

  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/ai/help" }),
  });

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isLoading = status === "streaming" || status === "submitted";

  // Auto-scroll en bas à chaque nouveau message.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Fermeture sur Échap + focus sur l'input à l'ouverture.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(timer);
    };
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input.trim() });
    setInput("");
  }

  function handleSuggestion(text: string) {
    if (isLoading) return;
    sendMessage({ text });
    inputRef.current?.focus();
  }

  if (!helpEnabled) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Aide"
        title="Aide"
        className="shrink-0 p-1.5 rounded-md hover:bg-sidebar-accent transition-colors"
      >
        <HelpCircle className="h-4 w-4" />
      </button>

      {open && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 bg-black/40 z-40"
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />

          {/* Panneau slide-over */}
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Assistant d'aide"
            className="fixed right-0 top-0 h-full w-full sm:w-[420px] bg-background border-l border-border shadow-lg z-50 flex flex-col"
          >
            {/* En-tête */}
            <div className="flex items-start gap-3 px-4 py-3 border-b border-border">
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <HelpCircle className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-sm font-semibold leading-tight">
                  Assistant d&apos;aide
                </h2>
                <p className="text-xs text-muted-foreground leading-tight">
                  {helpBugReport
                    ? "Posez une question sur LorIAx ou signalez un bug."
                    : "Posez une question sur LorIAx."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fermer"
                className="shrink-0 p-1.5 rounded-md hover:bg-muted transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {messages.length === 0 && (
                <div className="flex flex-col gap-3">
                  <div className="text-sm text-muted-foreground">
                    Bonjour, comment puis-je vous aider ? Voici quelques exemples
                    de questions :
                  </div>
                  <div className="flex flex-col gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => handleSuggestion(s)}
                        className="text-left text-sm border border-border rounded-lg px-3 py-2 hover:bg-muted hover:border-primary/40 transition-all"
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((message) => {
                const parts = message.parts ?? [];
                return (
                  <div key={message.id} className="space-y-2">
                    {/* Bulles de texte */}
                    {parts.some((p) => p.type === "text") && (
                      <div
                        className={`flex gap-3 ${
                          message.role === "user" ? "justify-end" : ""
                        }`}
                      >
                        {message.role === "assistant" && (
                          <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <Bot className="h-4 w-4 text-primary" />
                          </div>
                        )}
                        <div
                          className={`max-w-[75%] rounded-xl px-4 py-3 text-sm ${
                            message.role === "user"
                              ? "bg-primary text-primary-foreground"
                              : "bg-muted"
                          }`}
                        >
                          <div className="whitespace-pre-wrap">
                            {parts
                              .filter((p) => p.type === "text")
                              .map((p, i) => (
                                <span key={i}>
                                  {"text" in p ? p.text : ""}
                                </span>
                              ))}
                          </div>
                        </div>
                        {message.role === "user" && (
                          <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                            <User className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                    )}

                    {/* Notes d'outil fournies par les modules : rendu best-effort */}
                    {parts.map((p, i) => {
                      if (
                        !(
                          p.type === "dynamic-tool" ||
                          (typeof p.type === "string" &&
                            p.type.startsWith("tool-"))
                        )
                      ) {
                        return null;
                      }
                      const toolMessage = extractToolMessage(p);
                      if (!toolMessage) return null;
                      return (
                        <div
                          key={`tool-${i}`}
                          className="flex items-start gap-2 rounded-lg border border-border bg-muted px-3 py-2 text-sm text-muted-foreground"
                        >
                          <Wrench className="h-4 w-4 mt-0.5 flex-shrink-0 text-primary" />
                          <span>{toolMessage}</span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}

              {isLoading && <TypingIndicator />}

              <div ref={messagesEndRef} />
            </div>

            {/* Pied : champ de saisie */}
            <div className="px-4 py-3 border-t border-border">
              <form onSubmit={handleSubmit} className="flex gap-2">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Votre question..."
                  className="flex-1 rounded-lg border border-input bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring transition-shadow"
                />
                <Button type="submit" disabled={isLoading || !input.trim()}>
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </div>
          </div>
        </>
      )}
    </>
  );
}
