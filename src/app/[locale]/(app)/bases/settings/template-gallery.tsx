"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import type { BaseTemplate } from "./templates";

export function TemplateGallery({
  templates,
  spaceId,
  canCreate,
}: {
  templates: BaseTemplate[];
  spaceId: string;
  canCreate: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function applyTemplate(tpl: BaseTemplate) {
    if (!canCreate) {
      toast.error("Vous n'avez pas la permission de créer une base ici.");
      return;
    }
    setBusy(tpl.id);
    try {
      const res = await fetch("/api/databases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: tpl.name,
          description: tpl.description,
          spaceId,
          columns: tpl.columns,
        }),
      });
      if (!res.ok) {
        toast.error("Création impossible");
        return;
      }
      const created = await res.json();
      toast.success(`Base « ${tpl.name} » créée`);
      router.push(`/bases/${created.id}?spaceId=${encodeURIComponent(spaceId)}`);
      router.refresh();
    } catch {
      toast.error("Création impossible — vérifiez votre connexion");
    } finally {
      setBusy(null);
    }
  }

  return (
    <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {templates.map((tpl) => (
        <li
          key={tpl.id}
          className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4"
        >
          <div className="flex items-start gap-2">
            <span className="text-2xl leading-none">{tpl.icon}</span>
            <div className="flex-1">
              <h3 className="text-sm font-medium">{tpl.name}</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">{tpl.description}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-1">
            {tpl.columns.slice(0, 5).map((c) => (
              <span
                key={c.name}
                className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
              >
                {c.name}
              </span>
            ))}
            {tpl.columns.length > 5 && (
              <span className="text-[10px] text-muted-foreground">
                +{tpl.columns.length - 5}
              </span>
            )}
          </div>
          <button
            onClick={() => applyTemplate(tpl)}
            disabled={busy !== null || !canCreate}
            className="mt-1 self-end rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy === tpl.id ? "Création…" : "Utiliser ce modèle"}
          </button>
        </li>
      ))}
    </ul>
  );
}
