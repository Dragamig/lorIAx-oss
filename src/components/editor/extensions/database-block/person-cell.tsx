"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Plus, X, Search } from "lucide-react";
import { UserAvatar } from "@/components/ui/user-avatar";

interface UserLite {
  id: string;
  name: string | null;
  email: string;
  avatarUrl: string | null;
}

// Cache partagé entre cellules : évite de re-résoudre les mêmes IDs à chaque rendu.
const userCache = new Map<string, UserLite>();

function displayName(u: UserLite): string {
  return u.name?.trim() || u.email;
}

/**
 * Cellule « Personne » : référence un·des utilisateur·s de l'organisation,
 * stockée en `string[]` d'IDs (comme `relation`). Les utilisateurs sont
 * résolus et recherchés via `/api/users/search` (org-wide).
 */
export function PersonCell({
  selected,
  multiple,
  onChange,
  editable = true,
}: {
  selected: string[];
  multiple: boolean;
  onChange: (val: string[]) => void;
  editable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<UserLite[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  // Force le re-rendu quand le cache se remplit après une résolution async.
  const [, setTick] = useState(0);
  const pickerRef = useRef<HTMLDivElement>(null);

  // Résout les IDs sélectionnés encore absents du cache.
  useEffect(() => {
    const missing = selected.filter((id) => !userCache.has(id));
    if (missing.length === 0) return;
    let cancelled = false;
    fetch(`/api/users/search?ids=${encodeURIComponent(missing.join(","))}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((users: UserLite[]) => {
        if (cancelled) return;
        for (const u of users) userCache.set(u.id, u);
        setTick((t) => t + 1);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [selected]);

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

  // Recherche (debounce léger) à la frappe.
  useEffect(() => {
    if (!open) return;
    const q = search.trim();
    let cancelled = false;
    const t = setTimeout(() => {
      if (q.length < 1) {
        setResults([]);
        setSearchError(null);
        return;
      }
      fetch(`/api/users/search?q=${encodeURIComponent(q)}&limit=8`)
        .then(async (r) => {
          if (cancelled) return;
          // Ne plus avaler l'erreur silencieusement : on informe l'usager.
          if (!r.ok) {
            setResults([]);
            setSearchError(
              r.status === 401
                ? "Session expirée — reconnectez-vous."
                : r.status === 404
                  ? "Annuaire indisponible pour cette organisation."
                  : "Erreur lors de la recherche de personnes."
            );
            return;
          }
          const users: UserLite[] = await r.json();
          if (cancelled) return;
          for (const u of users) userCache.set(u.id, u);
          setSearchError(null);
          setResults(users);
        })
        .catch(() => {
          if (cancelled) return;
          setResults([]);
          setSearchError("Erreur réseau lors de la recherche.");
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, open]);

  const addUser = useCallback(
    (u: UserLite) => {
      userCache.set(u.id, u);
      if (multiple) {
        if (!selected.includes(u.id)) onChange([...selected, u.id]);
      } else {
        onChange([u.id]);
        setOpen(false);
      }
      setSearch("");
    },
    [multiple, selected, onChange]
  );

  const sel = new Set(selected);

  return (
    <div className="relative" ref={pickerRef}>
      <div className="flex flex-wrap gap-1 p-1 min-h-[32px] items-center">
        {selected.map((id) => {
          const u = userCache.get(id);
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1 px-1 py-0.5 rounded-full text-xs bg-accent text-accent-foreground"
            >
              {u ? (
                <UserAvatar email={u.email} avatarUrl={u.avatarUrl} size={16} />
              ) : (
                <span className="h-4 w-4 rounded-full bg-muted-foreground/30" />
              )}
              <span className="max-w-[120px] truncate">{u ? displayName(u) : "…"}</span>
              {editable && (
                <button
                  onClick={() => onChange(selected.filter((x) => x !== id))}
                  className="hover:text-destructive"
                  aria-label="Retirer"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          );
        })}
        {editable && (!multiple ? selected.length === 0 : true) && (
          <button
            onClick={() => setOpen(!open)}
            className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Ajouter une personne"
          >
            <Plus className="h-3 w-3" />
          </button>
        )}
      </div>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 w-60 rounded-md border bg-popover text-popover-foreground shadow-md">
          <div className="p-2 border-b">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded border bg-background">
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <input
                autoFocus
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.stopPropagation();
                    setOpen(false);
                    setSearch("");
                  } else if (e.key === "Enter" && results.length > 0) {
                    e.preventDefault();
                    addUser(results[0]);
                  }
                }}
                placeholder="Rechercher une personne..."
                className="flex-1 text-xs bg-transparent outline-none"
              />
            </div>
          </div>
          <div className="max-h-44 overflow-y-auto p-1">
            {searchError && (
              <div className="px-2 py-3 text-xs text-destructive text-center">
                {searchError}
              </div>
            )}
            {!searchError && search.trim().length < 1 && (
              <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                Saisissez un nom ou un e-mail
              </div>
            )}
            {!searchError && search.trim().length >= 1 && results.length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground text-center">
                Aucun résultat
              </div>
            )}
            {results.map((u) => (
              <button
                key={u.id}
                onClick={() => addUser(u)}
                disabled={sel.has(u.id)}
                className="w-full text-left px-2 py-1.5 rounded text-xs hover:bg-accent transition-colors flex items-center gap-2 disabled:opacity-40"
              >
                <UserAvatar email={u.email} avatarUrl={u.avatarUrl} size={20} />
                <span className="flex flex-col min-w-0">
                  <span className="truncate font-medium">{displayName(u)}</span>
                  {u.name && (
                    <span className="truncate text-[10px] text-muted-foreground">{u.email}</span>
                  )}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
