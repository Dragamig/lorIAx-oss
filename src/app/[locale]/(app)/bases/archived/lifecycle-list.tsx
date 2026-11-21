"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { ArchiveRestore, Trash2 } from "lucide-react";

interface Item {
  id: string;
  name: string;
  archivedAt: string | null;
}

export function LifecycleList({
  mode,
  items,
  canMutate,
}: {
  mode: "archived" | "trashed";
  items: Item[];
  canMutate: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function act(id: string, action: "unarchive" | "restore" | "trash") {
    setBusy(id);
    try {
      const res = await fetch(`/api/databases/${id}/lifecycle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        toast.success(
          action === "unarchive"
            ? "Base désarchivée"
            : action === "restore"
              ? "Base restaurée"
              : "Base supprimée"
        );
        router.refresh();
      } else toast.error("Action impossible");
    } catch {
      toast.error("Action impossible — vérifiez votre connexion");
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) {
    return (
      <p className="rounded border border-dashed border-border p-6 text-center text-sm italic text-muted-foreground">
        {mode === "archived"
          ? "Aucune base archivée."
          : "La corbeille est vide."}
      </p>
    );
  }

  return (
    <ul className="divide-y divide-border rounded border border-border">
      {items.map((d) => (
        <li
          key={d.id}
          className="flex items-center gap-3 px-3 py-2 text-sm hover:bg-muted/50"
        >
          <span className="flex-1 truncate">{d.name}</span>
          {d.archivedAt && (
            <span className="text-xs text-muted-foreground">
              {mode === "archived" ? "archivée le " : "supprimée le "}
              {new Date(d.archivedAt).toLocaleDateString("fr-FR")}
            </span>
          )}
          {canMutate && mode === "archived" && (
            <>
              <button
                onClick={() => act(d.id, "unarchive")}
                disabled={busy === d.id}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
              >
                <ArchiveRestore className="h-3.5 w-3.5" />
                Désarchiver
              </button>
              <button
                onClick={() => act(d.id, "trash")}
                disabled={busy === d.id}
                className="flex items-center gap-1 rounded px-2 py-1 text-xs text-destructive hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Supprimer
              </button>
            </>
          )}
          {canMutate && mode === "trashed" && (
            <button
              onClick={() => act(d.id, "restore")}
              disabled={busy === d.id}
              className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted disabled:opacity-50"
            >
              <ArchiveRestore className="h-3.5 w-3.5" />
              Restaurer
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}
