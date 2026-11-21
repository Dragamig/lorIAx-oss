import { useEffect, useState } from "react";

// Cache du module : les mêmes identifiants ne sont résolus qu'une fois par session.
const nameCache = new Map<string, string>();

/**
 * Résout des identifiants d'utilisateurs en noms via `/api/users/search?ids=`
 * (même route que la cellule « Personne »). Les identifiants non résolus
 * (membre retiré de l'organisation) restent absents du résultat.
 */
export function usePersonNames(ids: string[]): (id: string) => string | null {
  const [, setTick] = useState(0);
  const key = [...new Set(ids)].sort().join(",");

  useEffect(() => {
    const missing = key ? key.split(",").filter((id) => !nameCache.has(id)) : [];
    if (missing.length === 0) return;
    let cancelled = false;
    fetch(`/api/users/search?ids=${encodeURIComponent(missing.join(","))}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((users: Array<{ id: string; name: string | null; email: string }>) => {
        if (cancelled) return;
        for (const u of users) nameCache.set(u.id, u.name?.trim() || u.email);
        setTick((t) => t + 1);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key]);

  return (id) => nameCache.get(id) ?? null;
}
