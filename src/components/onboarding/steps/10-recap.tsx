// loriax-app/src/components/onboarding/steps/10-recap.tsx
import { toast } from "sonner";
import { Link } from "@/i18n/routing";
import type { StepDef } from "./index";

export const step10: StepDef = {
  id: "recap",
  title: "Bravo, tu as fait le tour !",
  body: () => (
    <>
      <p>
        Tu as découvert les bases : espaces, documents, bases de données, événements, visio,
        calendrier, tâches, présentations, assistant IA et palette de commandes.
      </p>
      <p className="mt-2">
        Tu peux à tout moment relancer ce tuto ou retrouver tes badges depuis ton{" "}
        <strong>menu utilisateur</strong>, en bas de la barre latérale.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <Link
          href="/"
          className="inline-flex items-center justify-center rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Aller à mon vrai espace
        </Link>
        <button
          type="button"
          onClick={async (e) => {
            const btn = e.currentTarget;
            btn.disabled = true;
            try {
              const res = await fetch("/api/onboarding/demo-space", {
                method: "DELETE",
              });
              const data = (await res.json().catch(() => null)) as {
                ok?: boolean;
              } | null;
              if (res.ok && data?.ok) {
                toast.success("Espace démo supprimé.");
              } else if (res.ok) {
                toast.info("Aucun espace démo à supprimer.");
              } else {
                toast.error("La suppression de l’espace démo a échoué.");
                btn.disabled = false;
              }
            } catch {
              toast.error("La suppression de l’espace démo a échoué.");
              btn.disabled = false;
            }
          }}
          className="text-xs text-muted-foreground underline hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        >
          Supprimer l’espace démo
        </button>
      </div>
    </>
  ),
  targetSelector: "[data-tour='user-menu']",
  path: () => "/",
};
