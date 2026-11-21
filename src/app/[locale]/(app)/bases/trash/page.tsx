import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { userDatabases } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import type { PermissionLevel } from "@/types";
import { LifecycleList } from "../archived/lifecycle-list";

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
export default async function TrashedBasesPage({ searchParams }: PageProps) {
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

  const rows = await db
    .select()
    .from(userDatabases)
    .where(
      and(
        eq(userDatabases.spaceId, sp.spaceId),
        isNotNull(userDatabases.deletedAt)
      )
    )
    .orderBy(asc(userDatabases.name));

  return (
    <div className="h-full overflow-y-auto p-6">
      <h1 className="mb-1 text-xl font-semibold">Corbeille</h1>
      <p className="mb-4 text-sm text-muted-foreground">
        Les bases mises à la corbeille restent récupérables. La suppression
        définitive sera proposée plus tard ; en attendant, une base restaurée
        revient dans la liste active.
      </p>
      <LifecycleList
        mode="trashed"
        items={rows.map((d) => ({
          id: d.id,
          name: d.name,
          archivedAt: d.deletedAt?.toISOString() ?? null,
        }))}
        canMutate={permission !== "viewer"}
      />
    </div>
  );
}
