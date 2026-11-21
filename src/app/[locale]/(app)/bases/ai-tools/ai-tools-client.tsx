"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Calculator, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { AiCreateModal } from "@/components/bases/ai-create-modal";

interface BaseLite {
  id: string;
  name: string;
}

export function AiToolsClient({
  spaceId,
  canCreate,
  configured,
  bases,
}: {
  spaceId: string;
  canCreate: boolean;
  configured: boolean;
  bases: BaseLite[];
}) {
  const router = useRouter();
  const [createOpen, setCreateOpen] = useState(false);
  const [formulaDbId, setFormulaDbId] = useState(bases[0]?.id ?? "");
  const [formulaPrompt, setFormulaPrompt] = useState("");
  const [formulaResult, setFormulaResult] = useState<{
    formula: string;
    explanation: string;
  } | null>(null);
  const [formulaBusy, setFormulaBusy] = useState(false);

  async function generateFormula() {
    if (!formulaDbId || !formulaPrompt.trim()) return;
    setFormulaBusy(true);
    setFormulaResult(null);
    try {
      const res = await fetch("/api/databases/ai-formula", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ databaseId: formulaDbId, prompt: formulaPrompt }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error ?? "Génération impossible");
        return;
      }
      const data = await res.json();
      setFormulaResult({ formula: data.formula, explanation: data.explanation });
    } catch {
      toast.error("Génération impossible — vérifiez votre connexion");
    } finally {
      setFormulaBusy(false);
    }
  }

  function copy(text: string) {
    navigator.clipboard
      .writeText(text)
      .then(() => toast.success("Copié"))
      .catch(() => toast.error("Copie impossible"));
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Carte 1 — Création par IA */}
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
          <div className="flex items-start gap-2">
            <Sparkles className="mt-0.5 h-5 w-5 text-purple-500" />
            <div className="flex-1">
              <h3 className="text-sm font-medium">Création de base par IA</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Décrivez votre besoin en français ; l&apos;IA propose un schéma
                de colonnes, vous le révisez puis l&apos;appliquez en un clic.
              </p>
            </div>
          </div>
          <button
            onClick={() => setCreateOpen(true)}
            disabled={!canCreate || !configured}
            className="mt-2 self-start rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Ouvrir l&apos;assistant
          </button>
          {!canCreate && (
            <p className="text-[11px] italic text-muted-foreground">
              Permission lecture seule sur cet espace.
            </p>
          )}
        </div>

        {/* Carte 2 — Aide formule */}
        <div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4">
          <div className="flex items-start gap-2">
            <Calculator className="mt-0.5 h-5 w-5 text-blue-500" />
            <div className="flex-1">
              <h3 className="text-sm font-medium">Aide à la rédaction de formules</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Choisissez une base, décrivez la formule en langage naturel,
                l&apos;IA renvoie une expression compatible avec
                l&apos;évaluateur LorIAx.
              </p>
            </div>
          </div>
          {bases.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">
              Aucune base active dans cet espace.
            </p>
          ) : (
            <>
              <select
                value={formulaDbId}
                onChange={(e) => setFormulaDbId(e.target.value)}
                className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
              >
                {bases.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
              <textarea
                value={formulaPrompt}
                onChange={(e) => setFormulaPrompt(e.target.value)}
                placeholder='Ex. "Concatène le prénom et le nom avec une espace"'
                rows={2}
                className="w-full rounded border border-border bg-background px-2 py-1 text-xs"
              />
              <button
                onClick={generateFormula}
                disabled={
                  !configured ||
                  formulaBusy ||
                  !formulaDbId ||
                  formulaPrompt.trim() === ""
                }
                className="self-start rounded bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {formulaBusy ? (
                  <span className="inline-flex items-center gap-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Génération…
                  </span>
                ) : (
                  "Générer la formule"
                )}
              </button>
            </>
          )}
          {formulaResult && (
            <div className="mt-2 space-y-2 rounded border border-border bg-muted p-2 text-xs">
              <div>
                <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Formule
                </div>
                <code className="block whitespace-pre-wrap break-all rounded bg-card px-2 py-1 text-xs">
                  {formulaResult.formula}
                </code>
                <button
                  onClick={() => copy(formulaResult.formula)}
                  className="mt-1 text-[11px] text-blue-600 hover:underline dark:text-blue-400"
                >
                  Copier
                </button>
              </div>
              <div>
                <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  Explication
                </div>
                <p className="text-foreground">
                  {formulaResult.explanation}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>

      <AiCreateModal
        spaceId={spaceId}
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(databaseId) => {
          setCreateOpen(false);
          router.push(
            `/bases/${databaseId}?spaceId=${encodeURIComponent(spaceId)}`
          );
          router.refresh();
        }}
      />
    </div>
  );
}
