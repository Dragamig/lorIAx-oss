"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { KeyRound, Loader2, Lock, ShieldCheck } from "lucide-react";

type AccessStatus =
  | "loading"
  | "granted"
  | "token_required"
  | "forbidden"
  | "completed"
  | "unavailable";

/**
 * Contrôle d'entrée de l'assistant de configuration.
 *
 * Une instance fraîchement installée ne s'ouvre pas au premier visiteur : elle
 * réclame la clé d'installation, que le serveur écrit dans ses journaux au
 * démarrage de la configuration. Un super administrateur déjà connecté entre
 * directement.
 */
export function SetupAccessGate({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AccessStatus>("loading");
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/setup/access");
      if (!res.ok) {
        setStatus("unavailable");
        return;
      }
      const body = (await res.json()) as { status?: AccessStatus };
      setStatus(body.status ?? "unavailable");
    } catch {
      setStatus("unavailable");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!token.trim()) {
      setError("Saisissez la clé d'installation.");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const res = await fetch("/api/setup/access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || "Clé refusée");
      }
      setToken("");
      setStatus("granted");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inattendue");
    } finally {
      setSubmitting(false);
    }
  }

  if (status === "loading") {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Vérification en cours…
      </div>
    );
  }

  if (status === "granted") {
    return <>{children}</>;
  }

  if (status === "token_required") {
    return (
      <form onSubmit={handleSubmit} className="space-y-6 text-center">
        <KeyRound className="h-16 w-16 text-primary mx-auto" />
        <h1 className="text-3xl font-bold">Configurer cette instance</h1>
        <p className="text-muted-foreground max-w-md mx-auto">
          Pour éviter que n&apos;importe qui ne configure votre instance, la clé
          d&apos;installation est demandée. Elle est inscrite dans les journaux
          du serveur, cherchez la ligne « Jeton d&apos;installation ».
        </p>

        <div className="max-w-md mx-auto space-y-3 text-left">
          <label className="text-sm font-medium" htmlFor="install-token">
            Clé d&apos;installation
          </label>
          <Input
            id="install-token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="font-mono"
            placeholder="Collez la clé ici"
          />
          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
          <Button type="submit" className="w-full" disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Vérification…
              </>
            ) : (
              "Continuer"
            )}
          </Button>
        </div>

        <p className="text-sm text-muted-foreground">
          Votre instance est déjà en service ?{" "}
          <Link className="underline" href="/login">
            Connectez-vous comme super administrateur
          </Link>
          , la clé n&apos;est alors plus nécessaire.
        </p>
      </form>
    );
  }

  if (status === "forbidden") {
    return (
      <div className="space-y-4 text-center">
        <Lock className="h-16 w-16 text-muted-foreground mx-auto" />
        <h1 className="text-2xl font-bold">Configuration réservée</h1>
        <p className="text-muted-foreground max-w-md mx-auto">
          Seul un super administrateur peut configurer cette instance.
        </p>
        <Button render={<Link href="/" />}>Retour à l&apos;application</Button>
      </div>
    );
  }

  if (status === "completed") {
    return (
      <div className="space-y-4 text-center">
        <ShieldCheck className="h-16 w-16 text-green-500 mx-auto" />
        <h1 className="text-2xl font-bold">Instance déjà configurée</h1>
        <p className="text-muted-foreground max-w-md mx-auto">
          La configuration initiale a déjà été réalisée. Les réglages restent
          modifiables depuis l&apos;administration.
        </p>
        <Button render={<Link href="/" />}>Retour à l&apos;application</Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 text-center">
      <Lock className="h-16 w-16 text-muted-foreground mx-auto" />
      <h1 className="text-2xl font-bold">Configuration indisponible</h1>
      <p className="text-muted-foreground max-w-md mx-auto">
        Impossible de joindre le serveur pour l&apos;instant.
      </p>
      <Button onClick={() => void refresh()}>Réessayer</Button>
    </div>
  );
}
