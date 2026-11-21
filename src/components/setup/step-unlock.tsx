"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, KeyRound } from "lucide-react";
import {
  clearSetupToken,
  isSetupAuthorized,
  setSetupToken,
} from "@/lib/setup/client";

/**
 * Écran de déverrouillage de l'assistant d'installation (constat AZ-28).
 * L'exploitant saisit le jeton d'amorçage : soit la valeur de la variable
 * SETUP_BOOTSTRAP_TOKEN, soit le jeton engendré au premier démarrage et
 * affiché dans les journaux du conteneur.
 *
 * Le jeton saisi est conservé pour la durée de l'onglet et rejoué en en-tête
 * sur chaque appel de l'assistant (`src/lib/setup/client.ts`). Le cookie posé
 * par `/api/setup/authorize` n'est qu'un confort : sur une instance ouverte en
 * HTTP nu, cas courant de l'auto-hébergement avant la mise en place de TLS, le
 * navigateur peut le jeter sans rien signaler. On ne se fie donc jamais au
 * seul 200 du POST, on VÉRIFIE que l'autorisation tient sur un appel suivant.
 *
 * Les libellés sont volontairement en français en dur : le catalogue
 * `src/messages/*.json` est hors du périmètre de ce lot de sécurité. Leur
 * internationalisation est un suivi identifié, sans incidence sur la garde.
 */
interface StepUnlockProps {
  onUnlocked: () => void;
}

export function StepUnlock({ onUnlocked }: StepUnlockProps) {
  const [token, setToken] = useState("");
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Un rechargement en cours de parcours ne doit pas redemander le jeton :
  // le jeton conservé pour l'onglet, ou le cookie quand le navigateur l'a
  // accepté, vaut autorisation tant qu'il est valide.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const autorise = await isSetupAuthorized();
      if (cancelled) return;
      if (autorise) {
        onUnlocked();
        return;
      }
      // Jeton périmé ou refusé : on repart d'une saisie propre.
      clearSetupToken();
      setChecking(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const saisi = token.trim();
      const res = await fetch("/api/setup/authorize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: saisi }),
        credentials: "same-origin",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || "Jeton refusé");
      }

      // Le jeton est bon : on le conserve pour l'onglet AVANT de vérifier, car
      // la vérification passe justement par l'en-tête.
      setSetupToken(saisi);

      // On n'enchaîne pas sur un succès que le navigateur aurait pu rejeter :
      // tant que l'autorisation ne tient pas sur un appel réel, l'assistant
      // afficherait des écrans dont chaque étape répondrait 401.
      if (!(await isSetupAuthorized())) {
        clearSetupToken();
        throw new Error(
          "Le jeton est accepté mais l'autorisation ne se maintient pas d'un appel à l'autre. Rechargez la page et réessayez."
        );
      }

      onUnlocked();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Jeton refusé");
    } finally {
      setSubmitting(false);
    }
  }

  if (checking) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6 text-center">
      <KeyRound className="h-14 w-14 text-primary mx-auto" />
      <h1 className="text-2xl font-bold">Déverrouiller la configuration</h1>
      <p className="text-muted-foreground max-w-md mx-auto text-sm">
        La configuration initiale est protégée par un jeton d&apos;amorçage.
        Saisissez la valeur de la variable <code>SETUP_BOOTSTRAP_TOKEN</code>,
        ou le jeton affiché dans les journaux du conteneur au premier
        démarrage.
      </p>

      <form onSubmit={handleSubmit} className="space-y-4 max-w-md mx-auto text-left">
        <div className="space-y-2">
          <Label htmlFor="setup-token">Jeton d&apos;amorçage</Label>
          <Input
            id="setup-token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Collez le jeton ici"
          />
        </div>
        {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <Button type="submit" className="w-full" disabled={submitting || token.trim().length === 0}>
          {submitting ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Vérification
            </>
          ) : (
            "Déverrouiller"
          )}
        </Button>
      </form>
    </div>
  );
}
