"use client";

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface AiCreateModalProps {
  spaceId: string;
  open: boolean;
  onClose: () => void;
  onCreated: (databaseId: string) => void;
}

const COLUMN_TYPES = [
  "text",
  "number",
  "date",
  "select",
  "checkbox",
  "url",
  "email",
  "formula",
] as const;

interface PlanCol {
  name: string;
  type: (typeof COLUMN_TYPES)[number];
  options?: string[];
}
interface Plan {
  name: string;
  description?: string;
  columns: PlanCol[];
}

type Step = "describe" | "review" | "applying";

export function AiCreateModal({ spaceId, open, onClose, onCreated }: AiCreateModalProps) {
  const [step, setStep] = useState<Step>("describe");
  const [description, setDescription] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function propose() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/databases/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "propose", description }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Erreur IA");
      setPlan(body.plan);
      setStep("review");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!plan) return;
    setBusy(true);
    setStep("applying");
    setError("");
    try {
      const res = await fetch("/api/databases/ai-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "apply", spaceId, plan }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Erreur création");
      onCreated(body.id);
      reset();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
      setStep("review");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep("describe");
    setDescription("");
    setPlan(null);
    setError("");
  }

  function patchCol(idx: number, patch: Partial<PlanCol>) {
    if (!plan) return;
    const cols = [...plan.columns];
    cols[idx] = { ...cols[idx], ...patch };
    setPlan({ ...plan, columns: cols });
  }
  function removeCol(idx: number) {
    if (!plan) return;
    setPlan({ ...plan, columns: plan.columns.filter((_, i) => i !== idx) });
  }
  function addCol() {
    if (!plan) return;
    setPlan({ ...plan, columns: [...plan.columns, { name: "Nouvelle colonne", type: "text" }] });
  }

  function handleOpenChange(next: boolean) {
    if (!next) {
      reset();
      onClose();
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-purple-500" />
            Créer une base avec l&apos;IA
          </DialogTitle>
          <DialogDescription>
            Décrivez votre besoin, l&apos;IA propose un schéma que vous pouvez ajuster.
          </DialogDescription>
        </DialogHeader>

        {step === "describe" && (
          <div className="space-y-3">
            <label htmlFor="ai-create-description" className="block text-sm font-medium">
              Décrivez la base que vous voulez créer
            </label>
            <textarea
              id="ai-create-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={5}
              placeholder="Ex. : Je veux suivre les candidatures de mes recrutements avec le nom, l'email, le poste, l'étape du process, la date de réception et un statut."
              className="w-full rounded border px-3 py-2 text-sm"
            />
            {error && (
              <div role="alert" className="rounded bg-red-50 p-2 text-sm text-red-900">
                {error}
              </div>
            )}
            <DialogFooter>
              <button
                onClick={() => handleOpenChange(false)}
                className="rounded px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                Annuler
              </button>
              <button
                onClick={propose}
                disabled={busy || description.length < 10}
                className="flex items-center gap-1.5 rounded bg-purple-600 px-3 py-1.5 text-sm text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                Proposer un schéma
              </button>
            </DialogFooter>
          </div>
        )}

        {step === "review" && plan && (
          <div className="space-y-3">
            <div className="rounded bg-purple-50 p-2 text-xs text-purple-900 dark:bg-purple-950 dark:text-purple-200">
              Plan proposé — vous pouvez ajuster les noms, types, options avant validation.
            </div>
            <div>
              <label htmlFor="ai-plan-name" className="mb-1 block text-xs font-medium">Nom de la base</label>
              <input
                id="ai-plan-name"
                value={plan.name}
                onChange={(e) => setPlan({ ...plan, name: e.target.value })}
                className="w-full rounded border px-2 py-1 text-sm"
              />
            </div>
            {plan.description !== undefined && (
              <div>
                <label htmlFor="ai-plan-desc" className="mb-1 block text-xs font-medium">Description</label>
                <input
                  id="ai-plan-desc"
                  value={plan.description}
                  onChange={(e) => setPlan({ ...plan, description: e.target.value })}
                  className="w-full rounded border px-2 py-1 text-sm"
                />
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium">
                Colonnes ({plan.columns.length})
              </label>
              <ul className="space-y-1.5 max-h-72 overflow-auto rounded border p-2">
                {plan.columns.map((c, i) => (
                  <li key={i} className="flex items-center gap-1.5">
                    <input
                      aria-label={`Nom colonne ${i + 1}`}
                      value={c.name}
                      onChange={(e) => patchCol(i, { name: e.target.value })}
                      className="flex-1 rounded border px-2 py-1 text-xs"
                    />
                    <select
                      aria-label={`Type colonne ${i + 1}`}
                      value={c.type}
                      onChange={(e) => patchCol(i, { type: e.target.value as PlanCol["type"] })}
                      className="rounded border bg-transparent px-1 py-1 text-xs"
                    >
                      {COLUMN_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    {c.type === "select" && (
                      <input
                        aria-label={`Options colonne ${i + 1}`}
                        value={(c.options ?? []).join(", ")}
                        onChange={(e) =>
                          patchCol(i, {
                            options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                          })
                        }
                        placeholder="opt1, opt2…"
                        className="w-32 rounded border px-2 py-1 text-xs"
                      />
                    )}
                    <button
                      aria-label={`Supprimer colonne ${c.name}`}
                      onClick={() => removeCol(i)}
                      className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-50"
                    >
                      ✕
                    </button>
                  </li>
                ))}
              </ul>
              <button
                onClick={addCol}
                className="mt-1 text-xs text-blue-600 hover:underline"
              >
                + Ajouter une colonne
              </button>
            </div>
            {error && (
              <div role="alert" className="rounded bg-red-50 p-2 text-sm text-red-900">
                {error}
              </div>
            )}
            <DialogFooter className="sm:justify-between">
              <button
                onClick={() => setStep("describe")}
                className="rounded px-3 py-1.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                ← Affiner
              </button>
              <button
                onClick={apply}
                disabled={busy}
                className="rounded bg-purple-600 px-3 py-1.5 text-sm text-white hover:bg-purple-700 disabled:opacity-50"
              >
                Créer la base
              </button>
            </DialogFooter>
          </div>
        )}

        {step === "applying" && (
          <div className="flex flex-col items-center justify-center py-12" role="status" aria-live="polite">
            <Loader2 className="h-8 w-8 animate-spin text-purple-500" />
            <p className="mt-3 text-sm text-neutral-500">Création en cours…</p>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
