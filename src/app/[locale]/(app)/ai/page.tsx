"use client";

import { useState, useRef, useEffect } from "react";
import { useTranslations } from "next-intl";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { Sparkles, Send, User, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { MarkdownContent } from "@/components/ai/markdown-content";
import { ProposalCard } from "@/components/ai/proposal-card";
import { CreationCard } from "@/components/ai/creation-card";
import { ToolCallLine, type ToolPart } from "@/components/ai/tool-call-line";
import { PendingProposalsBanner } from "@/components/ai/pending-proposals-banner";

/** Identifiant de proposition d'une partie outil `propose_*` terminée (règle R4), sinon null. */
function proposalIdOf(part: ToolPart): string | null {
  if (part.state !== "output-available") return null;
  const out = part.output as { proposalId?: unknown } | null | undefined;
  return typeof out?.proposalId === "string" ? out.proposalId : null;
}

function isToolPart(p: { type: string }): p is ToolPart {
  return p.type.startsWith("tool-");
}

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

export default function AIPage() {
  const t = useTranslations("ai");
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/ai/chat" }),
  });

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const isLoading = status === "streaming" || status === "submitted";

  // Curseur dans le champ à l'ouverture. Le lien du menu cliqué garde le focus :
  // on le reprend, sauf si une autre saisie est déjà active.
  useEffect(() => {
    const active = document.activeElement as HTMLElement | null;
    const editing =
      !!active &&
      (active.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName));
    if (!editing) inputRef.current?.focus();
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    sendMessage({ text: input.trim() });
    setInput("");
  }

  function handleSuggestion(text: string) {
    const filled = text.replace(/\.{3}$/, "") + " ";
    setInput(filled);
    setTimeout(() => {
      const el = inputRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(filled.length, filled.length);
      }
    }, 0);
  }

  const renderedProposalIds = messages.flatMap((m) =>
    (m.parts ?? []).filter(isToolPart).map(proposalIdOf).filter((id): id is string => id !== null),
  );

  const suggestions = [
    t("suggestions.summarize"),
    t("suggestions.links"),
    t("suggestions.find"),
  ];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-6 py-3 border-b border-border bg-card">
        <Sparkles className="h-5 w-5 text-primary" />
        <h1 className="text-lg font-semibold">{t("title")}</h1>
        <span className="text-sm text-muted-foreground">
          {t("subtitle")}
        </span>
      </div>

      <PendingProposalsBanner hiddenIds={renderedProposalIds} />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full">
            <EmptyState
              icon={Sparkles}
              title={t("emptyTitle")}
              description={t("emptyDescription")}
              size="lg"
            />
            <div className="flex gap-2 mt-2 flex-wrap justify-center">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => handleSuggestion(s)}
                  className="text-sm border border-border rounded-lg px-3 py-2 hover:bg-muted hover:border-primary/40 transition-all"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => {
          // Une partie texte par étape (avant et après les outils) : séparées
          // par un paragraphe, sinon « disponibles.Aucune » se colle.
          const text = (message.parts ?? [])
            .map((p) => (p.type === "text" ? p.text.trim() : ""))
            .filter(Boolean)
            .join("\n\n");
          const toolParts = (message.parts ?? []).filter(isToolPart);
          return (
          <div
            key={message.id}
            className={`flex gap-3 ${message.role === "user" ? "justify-end" : ""}`}
          >
            {message.role === "assistant" && (
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Bot className="h-4 w-4 text-primary" />
              </div>
            )}
            <div className="flex min-w-0 max-w-[70%] flex-col gap-2">
              {(text || toolParts.length === 0) && (
                <div
                  className={`rounded-xl px-4 py-3 text-sm ${
                    message.role === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {message.role === "user" ? (
                    <div className="whitespace-pre-wrap">{text}</div>
                  ) : (
                    <MarkdownContent text={text} />
                  )}
                </div>
              )}
              {toolParts.map((part, i) => {
                const proposalId = proposalIdOf(part);
                if (proposalId && part.type.startsWith("tool-propose_create_")) {
                  return <CreationCard key={`${message.id}-${i}`} proposalId={proposalId} />;
                }
                return proposalId ? (
                  <ProposalCard key={`${message.id}-${i}`} proposalId={proposalId} />
                ) : (
                  <ToolCallLine key={`${message.id}-${i}`} part={part} />
                );
              })}
            </div>
            {message.role === "user" && (
              <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center flex-shrink-0">
                <User className="h-4 w-4" />
              </div>
            )}
          </div>
          );
        })}

        {isLoading && <TypingIndicator />}

        <div ref={messagesEndRef} />
      </div>

      {/* Prompt box */}
      <div className="px-6 py-4 border-t border-border bg-card">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("inputPlaceholder")}
            className="prompt-input flex-1 rounded-lg border border-input bg-background px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring transition-shadow"
          />
          <Button type="submit" disabled={isLoading || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        </form>
      </div>
    </div>
  );
}
