"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, Search, X } from "lucide-react";

interface DocRef {
  id: string;
  title: string;
  spaceSlug: string;
}

function parseRef(value: string): DocRef | null {
  if (!value) return null;
  try {
    const o = JSON.parse(value) as Partial<DocRef>;
    if (o && typeof o.id === "string" && o.id) {
      return { id: o.id, title: o.title ?? "Document", spaceSlug: o.spaceSlug ?? "" };
    }
  } catch {
    /* valeur non-JSON : pas de référence */
  }
  return null;
}

/**
 * Cellule « Lien document » : référence un document interne LorIAx.
 * Valeur stockée = JSON `{ id, title, spaceSlug }`. Recherche via /api/search.
 */
export function DocumentLinkCell({
  value,
  onChange,
  editable = true,
}: {
  value: string;
  onChange: (val: string) => void;
  editable?: boolean;
}) {
  const current = parseRef(value);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<DocRef[]>([]);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Ferme le picker au clic extérieur.
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as globalThis.Node)) {
        setOpen(false);
        setSearch("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  // Recherche de documents par titre (debounce léger).
  useEffect(() => {
    if (!open) return;
    const q = search.trim();
    let cancelled = false;
    const t = setTimeout(() => {
      if (q.length < 2) {
        setResults([]);
        return;
      }
      fetch(`/api/search?q=${encodeURIComponent(q)}&scope=title&limit=8&rerank=0`)
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((data: { results?: Array<{ id: string; title: string; spaceSlug?: string }> }) => {
          if (cancelled) return;
          setResults(
            (data.results ?? []).map((r) => ({
              id: r.id,
              title: r.title,
              spaceSlug: r.spaceSlug ?? "",
            }))
          );
        })
        .catch(() => {});
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, open]);

  function pick(doc: DocRef) {
    onChange(JSON.stringify(doc));
    setOpen(false);
    setSearch("");
  }

  return (
    <div className="relative" ref={pickerRef}>
      <div className="flex items-center gap-1 p-1 min-h-[32px]">
        {current ? (
          <span className="inline-flex items-center gap-1 min-w-0">
            <a
              href={current.spaceSlug ? `/s/${current.spaceSlug}/${current.id}` : "#"}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline min-w-0"
            >
              <FileText className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate max-w-[180px]">{current.title}</span>
            </a>
            {editable && (
              <button
                onClick={() => onChange("")}
                className="text-muted-foreground hover:text-destructive shrink-0"
                aria-label="Retirer le lien"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </span>
        ) : editable ? (
          <button
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <FileText className="h-3.5 w-3.5" />
            Lier un document
          </button>
        ) : (
          <span className="text-muted-foreground text-xs">—</span>
        )}
      </div>

      {open && editable && (
        <div className="absolute top-full left-0 mt-1 z-50 w-64 rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="p-2 border-b">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded border bg-background">
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Escape") {
                    setOpen(false);
                    setSearch("");
                  } else if (e.key === "Enter" && results.length > 0) {
                    e.preventDefault();
                    pick(results[0]);
                  }
                }}
                onMouseDown={(e) => e.stopPropagation()}
                placeholder="Rechercher un document…"
                className="flex-1 text-xs bg-transparent outline-none"
              />
            </div>
          </div>
          <div className="max-h-44 overflow-y-auto p-1">
            {search.trim().length < 2 && (
              <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                Saisissez au moins 2 caractères
              </div>
            )}
            {search.trim().length >= 2 && results.length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                Aucun document trouvé
              </div>
            )}
            {results.map((doc) => (
              <button
                key={doc.id}
                onClick={() => pick(doc)}
                className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent transition-colors flex items-center gap-2"
              >
                <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                <span className="truncate">{doc.title}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
