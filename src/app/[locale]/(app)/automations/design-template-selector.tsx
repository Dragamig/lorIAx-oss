"use client";

import { useEffect, useState } from "react";

/** Variable exposée par un modèle de design ({key,label,layerId}). */
export interface DesignTemplateVariable {
  key: string;
  label: string;
  layerId: string;
}

export interface DesignTemplateOption {
  id: string;
  name: string;
  category?: string | null;
  variables?: DesignTemplateVariable[] | null;
}

/**
 * Charge une seule fois la liste des modèles de design accessibles
 * (`GET /api/studio/design-templates`). La réponse porte déjà les `variables`
 * de chaque modèle : on évite ainsi un second appel par template pour le
 * data-binding (cf. create_design). L'espace n'est pas filtré ici — il est
 * résolu à l'exécution par l'action.
 */
export function useDesignTemplates() {
  const [templates, setTemplates] = useState<DesignTemplateOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/studio/design-templates`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: DesignTemplateOption[]) => {
        if (!cancelled) setTemplates(Array.isArray(data) ? data : []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { templates, loading };
}

/**
 * Sélecteur de modèle de design (miroir de TemplateSelector pour les
 * documents). Le modèle est requis pour l'action create_design : l'option
 * vide n'est qu'un état non renseigné.
 */
export function DesignTemplateSelector({
  templates,
  loading,
  value,
  onChange,
  className,
}: {
  templates: DesignTemplateOption[];
  loading: boolean;
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={loading}
      className={className}
    >
      <option value="">
        {loading ? "Chargement des modèles…" : "— Choisir un modèle —"}
      </option>
      {templates.map((t) => (
        <option key={t.id} value={t.id}>
          {t.category ? `${t.name} — ${t.category}` : t.name}
        </option>
      ))}
    </select>
  );
}
