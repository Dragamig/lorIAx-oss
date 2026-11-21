"use client";

// i18n-ignore — global-error vit hors du segment [locale] (il remplace le root
// layout entier en cas de crash). Pas de contexte next-intl disponible ici :
// textes en français en dur, volontairement.
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { AlertTriangle } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // On journalise le detail cote console/serveur, jamais a l'ecran (fuite
    // d'info technique potentielle : chemins, stack, identifiants internes).
    console.error("[LorIAx GlobalError]", error);
  }, [error]);

  return (
    <html lang="fr">
      <body className="flex flex-col items-center justify-center min-h-screen gap-4 bg-background text-foreground">
        <AlertTriangle className="h-12 w-12 text-destructive" />
        <h2 className="text-xl font-bold">Erreur critique</h2>
        <p className="text-sm text-muted-foreground max-w-md text-center">
          Une erreur inattendue est survenue.
        </p>
        <Button onClick={reset} variant="outline">
          Réessayer
        </Button>
      </body>
    </html>
  );
}
