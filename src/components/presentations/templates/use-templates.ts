"use client";

/**
 * Hook de données des modèles de présentation (T9).
 *
 * Lecture : SWR sur `/api/presentations/templates` (même convention que
 * `use-team-status`). Écritures : `fetch` vers les routes T5/T6, puis
 * rafraîchissement de la liste seulement après un succès.
 *
 * Chaque action rend un résultat typé pour que l'appelant affiche un toast :
 * `{ ok: true, ... }` ou `{ ok: false, status, error }`. `status` vaut 0 pour
 * une panne réseau (aucune réponse HTTP).
 *
 * Le hook ne traduit rien : les titres des modèles LorIAx sont en français en
 * base, l'affichage passe par `presentations.templates.lorIAx.<seedKey>.name`.
 */
import { useState } from "react";
import useSWR from "swr";

export const TEMPLATES_ENDPOINT = "/api/presentations/templates";

export type TemplateFilter = "all" | "lorIAx" | "organization";

export interface TemplateSummary {
  id: string;
  title: string;
  templateDescription: string | null;
  templateOrigin: string | null;
  templateSeedKey: string | null;
  templateHiddenAt: string | null;
  version: number;
  slideCount: number;
  updatedAt: string;
}

export type TemplateActionError = {
  ok: false;
  status: number;
  error: string;
  currentVersion?: number;
};

export type TemplateActionResult<T> = ({ ok: true } & T) | TemplateActionError;

const NETWORK_ERROR = "Erreur réseau";
const GENERIC_ERROR = "Erreur serveur";

interface TemplatesResponse {
  templates: TemplateSummary[];
}

async function fetcher(url: string): Promise<TemplatesResponse> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(GENERIC_ERROR);
  return res.json();
}

/** Appel mutant : jamais d'exception, toujours un résultat typé. */
async function send<T extends object>(
  url: string,
  method: "POST" | "PATCH" | "DELETE",
  body: unknown | undefined,
  pick: (json: Record<string, unknown>) => T
): Promise<TemplateActionResult<T>> {
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0, error: NETWORK_ERROR };
  }

  let json: Record<string, unknown> = {};
  try {
    json = (await res.json()) ?? {};
  } catch {
    // Corps absent ou non JSON : on garde le message générique.
  }

  if (!res.ok) {
    const error = typeof json.error === "string" ? json.error : GENERIC_ERROR;
    const failure: TemplateActionError = { ok: false, status: res.status, error };
    if (typeof json.currentVersion === "number") failure.currentVersion = json.currentVersion;
    return failure;
  }
  return { ok: true, ...pick(json) } as TemplateActionResult<T>;
}

function matchesFilter(t: TemplateSummary, filter: TemplateFilter): boolean {
  if (filter === "lorIAx") return t.templateOrigin === "lorIAx";
  if (filter === "organization") return t.templateOrigin !== "lorIAx";
  return true;
}

/**
 * `enabled: false` : aucune lecture de la liste (clé SWR nulle). L'éditeur n'a
 * besoin que des écritures, et la lecture sème les modèles LorIAx d'une
 * organisation : inutile de la déclencher à chaque ouverture d'une présentation.
 */
export function useTemplates({ enabled = true }: { enabled?: boolean } = {}) {
  const { data, error, isLoading, mutate } = useSWR<TemplatesResponse>(
    enabled ? TEMPLATES_ENDPOINT : null,
    fetcher
  );
  // Filtre local : la liste complète reste disponible pour les compteurs.
  const [filter, setFilter] = useState<TemplateFilter>("all");

  const allTemplates = data?.templates ?? [];
  const templates = allTemplates.filter((t) => matchesFilter(t, filter));
  const hasError = Boolean(error);
  const loading = Boolean(isLoading) && !data && !hasError;

  /** Rafraîchit la liste après une action réussie. */
  const refresh = async () => {
    await mutate();
  };

  const afterSuccess = async <T extends object>(result: TemplateActionResult<T>) => {
    if (result.ok) await refresh();
    return result;
  };

  return {
    templates,
    allTemplates,
    filter,
    setFilter,
    isLoading: loading,
    error: hasError,
    isEmpty: !loading && !hasError && templates.length === 0,
    refresh,

    /** Crée une présentation depuis un modèle, dans l'espace donné. */
    use: (templateId: string, spaceId: string) =>
      send<{ presentation: Record<string, unknown> }>(
        "/api/presentations",
        "POST",
        { templateId, spaceId },
        (json) => ({ presentation: json })
      ),

    /** Enregistre une présentation existante comme modèle (copie). */
    saveAsTemplate: async (
      presentationId: string,
      input: { name: string; description?: string }
    ) =>
      afterSuccess(
        await send<{ template: Record<string, unknown> }>(
          `/api/presentations/${presentationId}/template`,
          "POST",
          input,
          (json) => ({ template: (json.template ?? json) as Record<string, unknown> })
        )
      ),

    /** Masque un modèle (PATCH hidden: true). */
    hide: async (templateId: string) =>
      afterSuccess(await patchTemplate(templateId, { hidden: true })),

    /** Rétablit un modèle masqué (PATCH hidden: false). */
    unhide: async (templateId: string) =>
      afterSuccess(await patchTemplate(templateId, { hidden: false })),

    /** Retire un modèle : DELETE masque, rien n'est supprimé. */
    retire: async (templateId: string) =>
      afterSuccess(
        await send<{ template: Record<string, unknown> }>(
          `${TEMPLATES_ENDPOINT}/${templateId}`,
          "DELETE",
          undefined,
          (json) => ({ template: (json.template ?? json) as Record<string, unknown> })
        )
      ),

    /** Réinitialise un modèle d'origine LorIAx à la version du dépôt. */
    reset: async (templateId: string, expectedVersion?: number) =>
      afterSuccess(
        await send<{ template: Record<string, unknown> }>(
          `${TEMPLATES_ENDPOINT}/${templateId}/reset`,
          "POST",
          expectedVersion === undefined ? {} : { expectedVersion },
          (json) => ({ template: (json.template ?? json) as Record<string, unknown> })
        )
      ),
  };
}

function patchTemplate(templateId: string, patch: { hidden: boolean }) {
  return send<{ template: Record<string, unknown> }>(
    `${TEMPLATES_ENDPOINT}/${templateId}`,
    "PATCH",
    patch,
    (json) => ({ template: (json.template ?? json) as Record<string, unknown> })
  );
}
