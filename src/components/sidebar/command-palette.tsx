"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";
import { Command } from "cmdk";
import useSWR from "swr";
import {
  FileText,
  Search,
  Plus,
  Network,
  Sparkles,
  Settings,
  Home,
  Image as ImageIcon,
} from "lucide-react";
import { paletteActions, type ActionId } from "@/lib/media/actions";

interface SearchResult {
  id: string;
  title: string;
  spaceSlug: string;
  spaceName: string;
  excerpt?: string;
}

interface MediaResult {
  id: string;
  filename: string;
  title: string | null;
  spaceName: string | null;
}

interface MediaContentResult extends MediaResult {
  snippet: string;
}

/** Destination de chaque action de médiathèque de la palette (dérivées du registre). */
const LIBRARY_PALETTE_TARGET: Partial<Record<ActionId, string>> = {
  openLibrary: "/mediatheque",
  upload: "/mediatheque?upload=1",
};

/** Chemins de médiathèque produits par la navigation et la palette. */
export const LIBRARY_ROUTES: string[] = ["/mediatheque", ...Object.values(LIBRARY_PALETTE_TARGET).filter((v): v is string => !!v)]

/** Lien de la médiathèque avec le média ouvert (paramètre `id` de la page). */
export function mediaHref(id: string): string {
  return `/mediatheque?id=${encodeURIComponent(id)}`;
}

export function CommandPalette() {
  const t = useTranslations("shell.commandPalette");
  const tLib = useTranslations("library");
  const { data: caps } = useSWR<{ modules?: string[] }>(
    "/api/modules/active",
    (url: string) => fetch(url).then((r) => (r.ok ? r.json() : null)),
    { revalidateOnFocus: false }
  );
  const libraryActive = Array.isArray(caps?.modules) && caps.modules.includes("library");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [mediaResults, setMediaResults] = useState<MediaResult[]>([]);
  const [mediaContentResults, setMediaContentResults] = useState<MediaContentResult[]>([]);
  const router = useRouter();

  // Miroir de `open` pour que le gestionnaire de touches global (deps []) lise
  // l'état courant sans se recréer.
  const openRef = useRef(open);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  // Onboarding : badge « Palette de commandes » à la 1re ouverture. La route est
  // idempotente côté serveur, ce drapeau évite juste un appel par ouverture.
  const eventSentRef = useRef(false);
  useEffect(() => {
    if (!open || eventSentRef.current) return;
    eventSentRef.current = true;
    fetch("/api/onboarding/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind: "palette" }),
    }).catch(() => {
      /* ignore */
    });
  }, [open]);

  // Ouverture programmatique (tuto guidé) : évite d'avoir à simuler Ctrl+K.
  useEffect(() => {
    function handleOpenRequest() {
      setOpen(true);
    }
    function handleCloseRequest() {
      setOpen(false);
    }
    window.addEventListener("loriax:command-palette-open", handleOpenRequest);
    window.addEventListener("loriax:command-palette-close", handleCloseRequest);
    return () => {
      window.removeEventListener("loriax:command-palette-open", handleOpenRequest);
      window.removeEventListener("loriax:command-palette-close", handleCloseRequest);
    };
  }, []);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((prev) => !prev);
      } else if (e.key === "Escape" && openRef.current) {
        // cmdk en mode `<Command>` nu ne gère pas Escape (contrairement à
        // `<Command.Dialog>`) : on ferme nous-mêmes.
        e.preventDefault();
        setOpen(false);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  const searchDocuments = useCallback(async (q: string) => {
    if (q.length < 2) {
      setResults([]);
      setMediaResults([]);
      setMediaContentResults([]);
      return;
    }
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(q)}&limit=10`);
      const data = await res.json();
      if (Array.isArray(data.results)) {
        setResults(data.results);
      }
      setMediaResults(Array.isArray(data.media) ? data.media : []);
      setMediaContentResults(Array.isArray(data.mediaContent) ? data.mediaContent : []);
    } catch {
      setResults([]);
      setMediaResults([]);
      setMediaContentResults([]);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => searchDocuments(query), 200);
    return () => clearTimeout(timer);
  }, [query, searchDocuments]);

  function navigate(path: string) {
    setOpen(false);
    setQuery("");
    router.push(path);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]">
      <div
        className="fixed inset-0 bg-black/50"
        onClick={() => setOpen(false)}
      />
      <div
        className="relative w-full max-w-lg bg-popover border border-border rounded-xl shadow-2xl overflow-hidden"
        data-tour="command-palette"
      >
        {/*
          `vimBindings={false}` : cmdk mappe sinon Ctrl+K sur « élément précédent »,
          en concurrence directe avec le raccourci d'ouverture/fermeture ci-dessus.
        */}
        <Command shouldFilter={false} vimBindings={false}>
          {/*
            `autoFocus` est indispensable : cmdk pose son gestionnaire clavier
            (flèches, Entrée, Home/End) en prop React sur le div [cmdk-root], donc
            il ne reçoit rien tant que le focus n'est pas DANS la palette. Sans lui,
            l'ouverture au clavier laissait le focus sur la page et toute la
            navigation clavier restait inerte.
          */}
          <Command.Input
            autoFocus
            value={query}
            onValueChange={setQuery}
            placeholder={t("placeholder")}
            className="w-full px-4 py-3 text-sm bg-transparent border-b border-border outline-none"
          />
          <Command.List className="max-h-80 overflow-y-auto p-2">
            <Command.Empty className="px-4 py-8 text-center text-sm text-muted-foreground">
              {t("noResults")}
            </Command.Empty>

            {results.length > 0 && (
              <Command.Group heading={t("documentsGroup")}>
                {results.map((r) => (
                  <Command.Item
                    key={r.id}
                    // Value explicite : sans elle cmdk retombe sur le textContent,
                    // et deux documents homonymes partagent alors la même identité
                    // de sélection.
                    value={`doc-${r.id}`}
                    onSelect={() =>
                      navigate(`/s/${r.spaceSlug}/${r.id}`)
                    }
                    className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm aria-selected:bg-accent"
                  >
                    <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="truncate">{r.title}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {r.spaceName}
                      </p>
                    </div>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {libraryActive && mediaResults.length > 0 && (
              <Command.Group heading={tLib("search.group")}>
                {mediaResults.map((m) => (
                  <Command.Item
                    key={m.id}
                    value={`media-${m.id}`}
                    onSelect={() => navigate(mediaHref(m.id))}
                    className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm aria-selected:bg-accent"
                  >
                    <ImageIcon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="truncate">{m.title || m.filename}</p>
                      {m.spaceName && (
                        <p className="text-xs text-muted-foreground truncate">{m.spaceName}</p>
                      )}
                    </div>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {libraryActive && mediaContentResults.length > 0 && (
              <Command.Group heading={tLib("search.contentGroup")}>
                {mediaContentResults.map((m) => {
                  const name = m.title || m.filename;
                  const label = tLib("search.contentOpen", { name });
                  return (
                    <Command.Item
                      key={`content-${m.id}`}
                      value={`media-content-${m.id}`}
                      onSelect={() => navigate(mediaHref(m.id))}
                      aria-label={label}
                      title={label}
                      className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm aria-selected:bg-accent"
                    >
                      <FileText className="h-4 w-4 text-muted-foreground flex-shrink-0" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="truncate">{name}</p>
                        <p className="text-xs text-muted-foreground line-clamp-2">{m.snippet}</p>
                      </div>
                    </Command.Item>
                  );
                })}
              </Command.Group>
            )}

            <Command.Group heading={t("actionsGroup")}>
              <Command.Item
                value="action-home"
                onSelect={() => navigate("/")}
                className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm aria-selected:bg-accent"
              >
                <Home className="h-4 w-4 text-muted-foreground" />
                {t("home")}
              </Command.Item>
              <Command.Item
                value="action-search"
                onSelect={() => navigate("/search")}
                className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm aria-selected:bg-accent"
              >
                <Search className="h-4 w-4 text-muted-foreground" />
                {t("advancedSearch")}
              </Command.Item>
              <Command.Item
                value="action-graph"
                onSelect={() => navigate("/graph")}
                className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm aria-selected:bg-accent"
              >
                <Network className="h-4 w-4 text-muted-foreground" />
                {t("knowledgeGraph")}
              </Command.Item>
              <Command.Item
                value="action-ai"
                onSelect={() => navigate("/ai")}
                className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm aria-selected:bg-accent"
              >
                <Sparkles className="h-4 w-4 text-muted-foreground" />
                {t("aiAssistant")}
              </Command.Item>
              <Command.Item
                value="action-new"
                onSelect={() => navigate("/new")}
                className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm aria-selected:bg-accent"
              >
                <Plus className="h-4 w-4 text-muted-foreground" />
                {t("newDocument")}
              </Command.Item>
              <Command.Item
                value="action-settings"
                onSelect={() => navigate("/settings")}
                className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm aria-selected:bg-accent"
              >
                <Settings className="h-4 w-4 text-muted-foreground" />
                {t("settings")}
              </Command.Item>
              {libraryActive &&
                paletteActions().map((a) => {
                  const target = LIBRARY_PALETTE_TARGET[a.id];
                  if (!target) return null;
                  const Icon = a.icon;
                  return (
                    <Command.Item
                      key={a.id}
                      value={`action-library-${a.id}`}
                      onSelect={() => navigate(target)}
                      className="flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer text-sm aria-selected:bg-accent"
                    >
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      {tLib(a.labelKey.replace(/^library\./, ""))}
                    </Command.Item>
                  );
                })}
            </Command.Group>
          </Command.List>

          <div className="px-4 py-2 border-t border-border text-xs text-muted-foreground flex gap-4">
            <span>
              <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px]">↑↓</kbd>{" "}
              {t("navigate")}
            </span>
            <span>
              <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px]">↵</kbd>{" "}
              {t("open")}
            </span>
            <span>
              <kbd className="bg-muted px-1.5 py-0.5 rounded text-[10px]">Esc</kbd>{" "}
              {t("close")}
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
}
