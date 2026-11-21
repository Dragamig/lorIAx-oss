"use client";

import { useEffect, useState } from "react";

interface TemplateOption {
  id: string;
  name: string;
  category?: string | null;
}

/**
 * Sélecteur de modèle de document : liste les templates accessibles
 * (builtins + modèles de l'espace) au lieu d'exiger la saisie d'un UUID.
 */
export function TemplateSelector({
  spaceId,
  value,
  onChange,
  className,
}: {
  spaceId: string;
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/api/templates?spaceId=${encodeURIComponent(spaceId)}`)
      .then((r) => (r.ok ? r.json() : []))
      .then((data: TemplateOption[]) => {
        if (!cancelled) setTemplates(Array.isArray(data) ? data : []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [spaceId]);

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={loading}
      className={className}
    >
      <option value="">
        {loading ? "Chargement des modèles…" : "Document vierge (aucun modèle)"}
      </option>
      {templates.map((t) => (
        <option key={t.id} value={t.id}>
          {t.category ? `${t.name} — ${t.category}` : t.name}
        </option>
      ))}
    </select>
  );
}
