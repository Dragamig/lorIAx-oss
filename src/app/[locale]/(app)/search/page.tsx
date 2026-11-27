"use client";

import { useState, useCallback, useEffect, useRef, memo, useMemo } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import {
  Search as SearchIcon,
  FileText,
  Loader2,
  Sparkles,
  MessageSquare,
  Send,
  Filter,
  Image as ImageIcon,
} from "lucide-react";
import type { SearchResult } from "@/types";
import { EmptyState } from "@/components/ui/empty-state";

type MediaHit = {
  id: string;
  filename: string;
  title: string | null;
  thumbnailUrl: string | null;
  spaceName: string | null;
  snippet: string | null;
  matchedOn: "name" | "title" | "alt" | "tag" | "description";
};

type MediaContentHit = {
  id: string;
  filename: string;
  title: string | null;
  spaceName: string | null;
  snippet: string;
};

type SearchMode = "text" | "ai";
type SearchScope = "all" | "title" | "content";

export default function SearchPage() {
  const t = useTranslations("search");
  const tLib = useTranslations("library");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [mediaHits, setMediaHits] = useState<MediaHit[]>([]);
  const [mediaContentHits, setMediaContentHits] = useState<MediaContentHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<SearchMode>("text");
  const [scope, setScope] = useState<SearchScope>("all");
  const [spaceFilter, setSpaceFilter] = useState<string>("");
  const [availableSpaces, setAvailableSpaces] = useState<{ slug: string; name: string }[]>([]);

  // IA mode state
  const [aiQuestion, setAiQuestion] = useState("");
  const [aiAnswer, setAiAnswer] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const answerRef = useRef<HTMLDivElement>(null);

  // Charger les espaces pour le filtre
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/spaces", { signal: controller.signal })
      .then((r) => r.json())
      .then((data) => {
        if (Array.isArray(data)) {
          setAvailableSpaces(data.map((s: { slug: string; name: string }) => ({ slug: s.slug, name: s.name })));
        }
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const abortRef = useRef<AbortController | null>(null);

  const search = useCallback(
    async (q: string) => {
      if (q.length < 2) {
        setResults([]);
        setMediaHits([]);
        setMediaContentHits([]);
        return;
      }
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setLoading(true);
      try {
        let url = `/api/search?q=${encodeURIComponent(q)}&limit=30&scope=${scope}`;
        if (spaceFilter) url += `&space=${encodeURIComponent(spaceFilter)}`;
        const res = await fetch(url, { signal: controller.signal });
        const data = await res.json();
        setResults(data.results || []);
        setMediaHits(Array.isArray(data.media) ? data.media : []);
        setMediaContentHits(Array.isArray(data.mediaContent) ? data.mediaContent : []);
      } catch {
        if (!controller.signal.aborted) {
          setResults([]);
          setMediaHits([]);
          setMediaContentHits([]);
        }
      }
      if (!controller.signal.aborted) setLoading(false);
    },
    [spaceFilter, scope]
  );

  // Auto-search à 3 caractères (debounce 300ms)
  useEffect(() => {
    if (mode !== "text") return;
    if (query.length < 3) return;
    const timer = setTimeout(() => search(query), 300);
    return () => clearTimeout(timer);
  }, [query, search, mode]);

  // Recherche sur Entrée dès 2 caractères
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && query.length >= 2) {
      search(query);
    }
  }

  async function handleAiSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!aiQuestion.trim()) return;

    setAiLoading(true);
    setAiAnswer("");

    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: aiQuestion }],
        }),
      });

      if (!res.ok) {
        setAiAnswer(t("errors.aiProviderError"));
        setAiLoading(false);
        return;
      }

      // Streaming
      const cloned = res.clone();
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let fullAnswer = "";

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk = decoder.decode(value);

          // Traiter les chunks SSE (Vercel AI SDK format)
          const lines = chunk.split("\n");
          for (const line of lines) {
            if (line.startsWith("0:")) {
              try {
                const text = JSON.parse(line.slice(2));
                fullAnswer += text;
                setAiAnswer(fullAnswer);
              } catch {
                // ignore
              }
            }
          }
        }
      }

      if (!fullAnswer) {
        const text = await cloned.text();
        if (text) setAiAnswer(text);
      }
    } catch {
      setAiAnswer(t("errors.networkError"));
    }

    setAiLoading(false);
  }

  return (
    <div className="max-w-3xl mx-auto px-8 py-12">
      <div className="mb-8">
        <h1 className="text-2xl font-bold mb-4">{t("title")}</h1>

        {/* Toggle mode */}
        <div className="flex gap-1 mb-4 p-1 bg-muted rounded-lg w-fit">
          <button
            onClick={() => setMode("text")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              mode === "text"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <SearchIcon className="h-3.5 w-3.5" />
            {t("modes.text")}
          </button>
          <button
            onClick={() => setMode("ai")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              mode === "ai"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Sparkles className="h-3.5 w-3.5" />
            {t("modes.ai")}
          </button>
        </div>

        {/* Mode texte */}
        {mode === "text" && (
          <>
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={t("textPlaceholder")}
                autoFocus
                className="w-full pl-10 pr-4 py-3 rounded-xl border border-input bg-background text-base outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            {/* Filtres : périmètre + espace */}
            <div className="flex items-center gap-4 mt-3 flex-wrap">
              {/* Sélecteur de périmètre */}
              <div className="flex gap-1 p-0.5 bg-muted rounded-md">
                {(["all", "title", "content"] as const).map((value) => (
                  <button
                    key={value}
                    onClick={() => setScope(value)}
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                      scope === value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {t(`scopes.${value}`)}
                  </button>
                ))}
              </div>

              {/* Filtre par espace */}
              {availableSpaces.length > 1 && (
                <div className="flex items-center gap-2">
                  <Filter className="h-3.5 w-3.5 text-muted-foreground" />
                  <select
                    value={spaceFilter}
                    onChange={(e) => setSpaceFilter(e.target.value)}
                    className="text-sm px-2 py-1 rounded border border-input bg-background"
                  >
                    <option value="">{t("allSpaces")}</option>
                    {availableSpaces.map((s) => (
                      <option key={s.slug} value={s.slug}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </>
        )}

        {/* Mode IA */}
        {mode === "ai" && (
          <form onSubmit={handleAiSearch} className="relative">
            <MessageSquare className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
            <input
              type="text"
              value={aiQuestion}
              onChange={(e) => setAiQuestion(e.target.value)}
              placeholder={t("aiPlaceholder")}
              autoFocus
              className="w-full pl-10 pr-12 py-3 rounded-xl border border-input bg-background text-base outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={aiLoading || !aiQuestion.trim()}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-accent disabled:opacity-40"
            >
              <Send className="h-4 w-4" />
            </button>
          </form>
        )}
      </div>

      {/* Résultats mode texte */}
      {mode === "text" && (
        <>
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("loading")}
            </div>
          )}

          {!loading && query.length >= 2 && results.length === 0 && mediaHits.length === 0 && mediaContentHits.length === 0 && (
            <EmptyState
              icon={SearchIcon}
              title={t("noResults", { query })}
              description={t("noResultsHint")}
              size="sm"
            />
          )}

          {mediaHits.length > 0 && (
            <section className="mb-6" aria-label={tLib("search.title")}>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-medium text-muted-foreground">{tLib("search.title")}</h2>
                <Link
                  href={`/mediatheque?q=${encodeURIComponent(query)}`}
                  className="text-sm text-primary hover:underline"
                >
                  {tLib("search.seeAll")}
                </Link>
              </div>
              <div className="space-y-2">
                {mediaHits.map((m) => (
                  <Link
                    key={m.id}
                    href={`/mediatheque?id=${encodeURIComponent(m.id)}`}
                    className="flex items-center gap-3 p-3 rounded-lg border border-border hover:border-primary/30 hover:bg-muted/50 transition-all"
                  >
                    {m.thumbnailUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.thumbnailUrl} alt="" className="h-10 w-10 rounded object-cover flex-shrink-0" />
                    ) : (
                      <ImageIcon className="h-5 w-5 text-primary flex-shrink-0" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="font-medium truncate">
                        <Highlight text={m.title || m.filename} term={query} />
                      </p>
                      <p className="text-sm text-muted-foreground truncate">
                        {[m.spaceName, m.snippet && `${tLib(`search.${m.matchedOn === "title" ? "titleField" : m.matchedOn === "alt" ? "alt" : m.matchedOn}`)} : ${m.snippet}`]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {mediaContentHits.length > 0 && (
            <section className="mb-6" aria-label={tLib("search.contentGroup")}>
              <h2 className="mb-2 text-sm font-medium text-muted-foreground">
                {tLib("search.contentGroup")}
              </h2>
              <div className="space-y-2">
                {mediaContentHits.map((m) => {
                  const name = m.title || m.filename;
                  const label = tLib("search.contentOpen", { name });
                  return (
                    <Link
                      key={m.id}
                      href={`/mediatheque?id=${encodeURIComponent(m.id)}`}
                      aria-label={label}
                      title={label}
                      className="flex items-start gap-3 p-3 rounded-lg border border-border hover:border-primary/30 hover:bg-muted/50 transition-all"
                    >
                      <FileText className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium truncate">{name}</p>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          <Highlight text={m.snippet} term={query} />
                        </p>
                        {m.spaceName && (
                          <p className="text-xs text-muted-foreground truncate">{m.spaceName}</p>
                        )}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          <div className="space-y-2">
            {results.map((r) => (
              <Link
                key={r.id}
                href={`/s/${r.spaceSlug}/${r.id}`}
                className="block p-4 rounded-lg border border-border hover:border-primary/30 hover:bg-muted/50 transition-all"
              >
                <div className="flex items-start gap-3">
                  <FileText className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      <Highlight text={r.title} term={query} />
                    </p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {r.spaceName}
                    </p>
                    {r.excerpt && (
                      <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                        <Highlight text={r.excerpt} term={query} />
                      </p>
                    )}
                  </div>
                  {r.type === "semantic" && (
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full whitespace-nowrap">
                      {t("semanticBadge")}
                    </span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        </>
      )}

      {/* Résultat mode IA */}
      {mode === "ai" && (
        <>
          {aiLoading && (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("aiLoading")}
            </div>
          )}

          {aiAnswer && (
            <div ref={answerRef} className="space-y-4">
              <div className="p-5 rounded-lg border border-primary/20 bg-primary/5">
                <div className="flex items-center gap-2 mb-3">
                  <Sparkles className="h-4 w-4 text-primary" />
                  <span className="text-sm font-medium text-primary">
                    {t("aiAnswerTitle")}
                  </span>
                </div>
                <div className="prose prose-sm dark:prose-invert max-w-none whitespace-pre-wrap">
                  {aiAnswer}
                </div>
              </div>
            </div>
          )}

          {!aiLoading && !aiAnswer && (
            <div className="text-center py-12">
              <MessageSquare className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">
                {t("aiEmptyHint")}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                {t("aiExamples")}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}

const Highlight = memo(function Highlight({ text, term }: { text: string; term: string }) {
  const parts = useMemo(() => {
    if (!term || term.length < 2) return null;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return text.split(new RegExp(`(${escaped})`, "gi"));
  }, [text, term]);

  if (!parts) return <>{text}</>;
  const lowerTerm = term.toLowerCase();
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === lowerTerm ? (
          <mark key={i} className="bg-yellow-200/60 dark:bg-yellow-500/30 rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </>
  );
});
