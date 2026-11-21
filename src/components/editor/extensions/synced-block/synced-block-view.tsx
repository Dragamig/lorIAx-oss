"use client";

import { NodeViewWrapper } from "@tiptap/react";
import type { NodeViewProps } from "@tiptap/core";
import { useState, useEffect, useCallback, useRef } from "react";
import {
  Link2,
  RefreshCw,
  Trash2,
  ExternalLink,
  Search,
  GripHorizontal,
  FileText,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { SyncedContent } from "./synced-content";
import { listHeadings, extractSection } from "./markdown-section";
import { stopMouse } from "../../utils/stop-mouse";

interface SearchResult {
  id: string;
  title: string;
  spaceSlug: string;
  spaceName: string;
}

const ALL_SCOPE = "__all__";

export function SyncedBlockView({
  node,
  updateAttributes,
  deleteNode,
  selected,
}: Pick<NodeViewProps, "node" | "updateAttributes" | "deleteNode" | "selected">) {
  const attrs = node.attrs;
  const sourceDocumentId = (attrs.sourceDocumentId as string | null) ?? null;
  const sourceTitle = (attrs.sourceTitle as string) || "";
  const sourceSpaceSlug = (attrs.sourceSpaceSlug as string) || "";
  const mode = (attrs.mode as "document" | "section") || "document";
  const anchor = (attrs.anchor as string) || "";

  // ── État du sélecteur de document (quand aucune source) ──
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── État du contenu synchronisé ──
  const [content, setContent] = useState<string | null>(null);
  const [title, setTitle] = useState(sourceTitle);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncedAt, setSyncedAt] = useState<Date | null>(null);

  const fetchContent = useCallback(async () => {
    if (!sourceDocumentId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${sourceDocumentId}`);
      if (!res.ok) throw new Error("not found");
      const data = await res.json();
      setContent(typeof data.content === "string" ? data.content : "");
      if (data.title) setTitle(data.title as string);
      setSyncedAt(new Date());
    } catch {
      setError("Source introuvable ou inaccessible.");
      setContent(null);
    } finally {
      setLoading(false);
    }
  }, [sourceDocumentId]);

  // Rafraîchit à l'ouverture (et quand la source change).
  useEffect(() => {
    fetchContent();
  }, [fetchContent]);

  // Recherche debouncée de documents pour le sélecteur.
  useEffect(() => {
    if (sourceDocumentId) return;
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          // rerank=0 : sélecteur d'insertion, la latence prime sur la finesse
          // du classement.
          `/api/search?q=${encodeURIComponent(query.trim())}&scope=all&limit=8&rerank=0`,
        );
        const data = await res.json();
        const items: SearchResult[] = (data?.results || [])
          .filter(
            (r: { id: string; spaceSlug?: string }) =>
              !r.id.startsWith("event-") && r.spaceSlug !== "calendar",
          )
          .map((r: { id: string; title: string; spaceSlug?: string; spaceName?: string }) => ({
            id: r.id,
            title: r.title,
            spaceSlug: r.spaceSlug || "",
            spaceName: r.spaceName || "",
          }));
        setResults(items);
      } catch {
        setResults([]);
      }
      setSearching(false);
    }, 300);
    return () => {
      if (searchTimeout.current) clearTimeout(searchTimeout.current);
    };
  }, [query, sourceDocumentId]);

  const handlePick = useCallback(
    (doc: SearchResult) => {
      updateAttributes({
        sourceDocumentId: doc.id,
        sourceTitle: doc.title,
        sourceSpaceSlug: doc.spaceSlug,
        mode: "document",
        anchor: "",
      });
    },
    [updateAttributes],
  );

  const handleUnlink = useCallback(() => {
    updateAttributes({
      sourceDocumentId: null,
      sourceTitle: "",
      sourceSpaceSlug: "",
      anchor: "",
      mode: "document",
    });
    setContent(null);
    setError(null);
    setQuery("");
  }, [updateAttributes]);

  // ── Sélecteur (aucune source choisie) ──
  if (!sourceDocumentId) {
    return (
      <NodeViewWrapper className={`synced-block-wrapper ${selected ? "is-selected" : ""}`}>
        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-3">
          <div className="flex items-center gap-2 mb-2 text-sm font-medium">
            <Link2 className="h-4 w-4 text-indigo-500" />
            Bloc synchronisé
            <button
              onClick={deleteNode}
              className="ml-auto text-muted-foreground hover:text-destructive"
              title="Supprimer le bloc"
              aria-label="Supprimer le bloc"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onMouseDown={stopMouse}
              onKeyDown={(e) => e.stopPropagation()}
              placeholder="Rechercher le document à synchroniser…"
              className="w-full text-sm pl-9 pr-3 py-2 rounded-md border bg-background"
            />
          </div>
          {searching && (
            <p className="text-xs text-muted-foreground mt-2 animate-pulse">Recherche…</p>
          )}
          {results.length > 0 && (
            <div className="mt-2 flex flex-col gap-0.5 max-h-56 overflow-y-auto rounded-md border border-border divide-y divide-border">
              {results.map((doc) => (
                <button
                  key={doc.id}
                  onClick={() => handlePick(doc)}
                  className="flex items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                >
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="min-w-0 flex-1 truncate">{doc.title}</span>
                  {doc.spaceName && (
                    <span className="text-xs text-muted-foreground shrink-0">{doc.spaceName}</span>
                  )}
                </button>
              ))}
            </div>
          )}
          {query.trim().length >= 2 && !searching && results.length === 0 && (
            <p className="text-xs text-muted-foreground mt-2">Aucun document trouvé.</p>
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  // ── Source choisie : toolbar + contenu lecture seule ──
  const headings = content ? listHeadings(content) : [];
  const displayed =
    mode === "section" && anchor ? extractSection(content || "", anchor) : content || "";

  return (
    <NodeViewWrapper className={`synced-block-wrapper ${selected ? "is-selected" : ""}`}>
      <div className="synced-block rounded-lg border border-indigo-500/30 bg-indigo-500/[0.03] overflow-hidden">
        {/* Toolbar */}
        <div
          className="flex items-center gap-2 px-3 py-1.5 border-b border-indigo-500/20 bg-indigo-500/[0.04] text-xs"
          data-drag-handle
        >
          <GripHorizontal className="h-3.5 w-3.5 text-muted-foreground cursor-grab shrink-0" />
          <Link2 className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
          <span className="text-muted-foreground shrink-0">Synchronisé&nbsp;:</span>
          {sourceSpaceSlug ? (
            <Link
              href={`/s/${sourceSpaceSlug}/${sourceDocumentId}`}
              target="_blank"
              rel="noopener"
              onMouseDown={stopMouse}
              className="font-medium truncate hover:underline text-foreground"
            >
              {title || "Document"}
            </Link>
          ) : (
            <span className="font-medium truncate text-foreground">{title || "Document"}</span>
          )}

          {/* Portée : document entier ou section */}
          {headings.length > 0 && (
            <select
              value={mode === "section" ? anchor : ALL_SCOPE}
              onChange={(e) => {
                const v = e.target.value;
                if (v === ALL_SCOPE) updateAttributes({ mode: "document", anchor: "" });
                else updateAttributes({ mode: "section", anchor: v });
              }}
              onMouseDown={stopMouse}
              className="ml-1 text-xs bg-background border rounded px-1.5 py-0.5 max-w-[45%] truncate"
              title="Portée synchronisée"
            >
              <option value={ALL_SCOPE}>Document entier</option>
              {headings.map((h, i) => (
                <option key={`${h.text}-${i}`} value={h.text}>
                  {" ".repeat((h.level - 1) * 2) + h.text}
                </option>
              ))}
            </select>
          )}

          <div className="ml-auto flex items-center gap-0.5 shrink-0">
            {syncedAt && (
              <span className="text-muted-foreground hidden sm:inline mr-1">
                Maj&nbsp;
                {syncedAt.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
            <Button
              onClick={fetchContent}
              variant="ghost"
              size="icon-sm"
              title="Rafraîchir"
              disabled={loading}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
            </Button>
            {sourceSpaceSlug && (
              <Link
                href={`/s/${sourceSpaceSlug}/${sourceDocumentId}`}
                target="_blank"
                rel="noopener"
                title="Ouvrir la source"
                onMouseDown={stopMouse}
                className="inline-flex size-7 items-center justify-center rounded-md hover:bg-muted text-muted-foreground"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </Link>
            )}
            <Button onClick={handleUnlink} variant="ghost" size="icon-sm" title="Changer de source">
              <Search className="h-3.5 w-3.5" />
            </Button>
            <Button
              onClick={deleteNode}
              variant="ghost"
              size="icon-sm"
              className="hover:text-destructive"
              title="Supprimer le bloc"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Contenu */}
        <div className="px-4 py-3">
          {loading && content === null && (
            <div className="text-sm text-muted-foreground animate-pulse py-2">
              Chargement du contenu…
            </div>
          )}
          {error && <div className="text-sm text-muted-foreground py-2">{error}</div>}
          {!error &&
            content !== null &&
            (mode === "section" && anchor && !displayed ? (
              <div className="text-sm text-muted-foreground py-2">
                Section «&nbsp;{anchor}&nbsp;» introuvable dans la source.
              </div>
            ) : (
              <SyncedContent markdown={displayed} />
            ))}
        </div>
      </div>
    </NodeViewWrapper>
  );
}
