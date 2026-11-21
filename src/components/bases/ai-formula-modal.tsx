"use client";

import { useState } from "react";
import { Sparkles, Loader2 } from "lucide-react";

interface AiFormulaModalProps {
  databaseId: string;
  open: boolean;
  currentFormula?: string;
  onClose: () => void;
  onAccept: (formula: string) => void;
}

/**
 * Modal d'assistance IA pour rédiger une formule.
 * Affiche un champ de description, appelle /api/databases/ai-formula,
 * propose la formule générée avec son explication, l'utilisateur accepte
 * ou affine.
 */
export function AiFormulaModal({
  databaseId,
  open,
  currentFormula,
  onClose,
  onAccept,
}: AiFormulaModalProps) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ formula: string; explanation: string } | null>(null);

  if (!open) return null;

  async function generate() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/databases/ai-formula", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ databaseId, prompt }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Erreur IA");
      setResult({ formula: body.formula, explanation: body.explanation });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setPrompt("");
    setResult(null);
    setError("");
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-lg bg-white p-5 shadow-2xl dark:bg-neutral-900">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="h-4 w-4 text-purple-500" />
            Demander une formule à l&apos;IA
          </h2>
          <button
            onClick={() => {
              reset();
              onClose();
            }}
            className="text-sm text-neutral-500 hover:text-neutral-900"
          >
            Fermer
          </button>
        </div>

        {currentFormula && (
          <div className="mb-3 rounded bg-neutral-100 p-2 font-mono text-xs dark:bg-neutral-800">
            Formule actuelle : <code>{currentFormula}</code>
          </div>
        )}

        <label className="mb-1 block text-xs font-medium">
          Décrivez ce que vous voulez calculer
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          placeholder='Ex. : "Si le prix est supérieur à 100, ajouter 10 € de frais de port, sinon 5 €"'
          className="mb-2 w-full rounded border px-2 py-1.5 text-sm"
        />

        <div className="flex justify-end">
          <button
            onClick={generate}
            disabled={busy || prompt.length < 5}
            className="flex items-center gap-1.5 rounded bg-purple-600 px-3 py-1.5 text-sm text-white hover:bg-purple-700 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Générer
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded bg-red-50 p-2 text-xs text-red-900">{error}</div>
        )}

        {result && (
          <div className="mt-4 space-y-3 rounded border border-purple-200 bg-purple-50 p-3 dark:border-purple-800 dark:bg-purple-950">
            <div>
              <p className="mb-1 text-xs font-medium text-purple-900 dark:text-purple-200">
                Formule proposée
              </p>
              <code className="block break-all rounded bg-white px-2 py-1.5 font-mono text-xs dark:bg-neutral-900">
                {result.formula}
              </code>
            </div>
            <div>
              <p className="mb-1 text-xs font-medium text-purple-900 dark:text-purple-200">
                Explication
              </p>
              <p className="text-xs text-purple-900 dark:text-purple-200">
                {result.explanation}
              </p>
            </div>
            <div className="flex justify-between">
              <button
                onClick={() => setResult(null)}
                className="rounded px-2 py-1 text-xs hover:bg-white/50 dark:hover:bg-black/30"
              >
                Affiner
              </button>
              <button
                onClick={() => {
                  onAccept(result.formula);
                  reset();
                  onClose();
                }}
                className="rounded bg-purple-600 px-3 py-1.5 text-xs text-white hover:bg-purple-700"
              >
                Utiliser cette formule
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
