import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/get-user";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import type { PermissionLevel } from "@/types";
import { BASE_TEMPLATES } from "./templates";
import { TemplateGallery } from "./template-gallery";

interface PageProps {
  searchParams?: Promise<{ spaceId?: string }>;
}

/**
 * Cloisonnement multi-tenant (revue adversariale du lot 6, 2026-08-20).
 *
 * Cette page prenait un `spaceId` dans les paramètres de requête et
 * l'autorisait sur la seule permission d'espace : `getSpacePermission`
 * n'applique aucun filtre d'organisation, un espace d'un autre tenant passait
 * donc le contrôle. `requireOrgScoped` confronte l'espace à l'organisation de
 * la requête AVANT de rendre la permission, et son refus est traduit en
 * redirection muette vers `/bases` (jamais un message qui révélerait
 * l'existence de l'espace visé).
 */
export default async function BasesSettingsPage({ searchParams }: PageProps) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const sp = (await searchParams) ?? {};
  if (!sp.spaceId) redirect("/bases");

  let permission: PermissionLevel | null = null;
  try {
    const ctx = await requireOrgScoped({
      resource: { type: "space", id: sp.spaceId },
      minPermission: "viewer",
    });
    permission = ctx.permission ?? null;
  } catch (e) {
    if (e instanceof OrgScopeError) redirect("/bases");
    throw e;
  }
  if (!permission) redirect("/bases");

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="mx-auto max-w-4xl">
        <h1 className="mb-1 text-xl font-semibold">Paramètres des bases</h1>
        <p className="mb-6 text-sm text-muted-foreground">
          Démarrez plus vite avec un modèle prêt à l&apos;emploi. Chaque modèle
          crée une nouvelle base avec ses colonnes pré-configurées dans
          l&apos;espace courant.
        </p>

        <section>
          <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Modèles de base
          </h2>
          <TemplateGallery
            templates={BASE_TEMPLATES}
            spaceId={sp.spaceId}
            canCreate={permission !== "viewer"}
          />
        </section>
      </div>
    </div>
  );
}
