import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { LAST_SPACE_COOKIE, resolveCurrentSpaceId } from "@/lib/spaces/resolve-current-space";
import { db } from "@/lib/db";
import { eq, inArray, asc } from "drizzle-orm";
import { spaces, userDatabases } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import { getAccessibleSpaceIds } from "@/lib/auth/check-access";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";

interface PageProps {
  searchParams: Promise<{ spaceId?: string }>;
}

/**
 * Page d'accueil de l'Espace Bases — redirige vers la première base du
 * space (créé un état vide sinon).
 */
export default async function BasesPage({ searchParams }: PageProps) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const accessibleIds = await getAccessibleSpaceIds(user);

  const userSpaces =
    accessibleIds.length === 0
      ? []
      : await db
          .select({ id: spaces.id })
          .from(spaces)
          .where(inArray(spaces.id, accessibleIds))
          .orderBy(asc(spaces.name));

  if (userSpaces.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Aucun espace accessible.
      </div>
    );
  }

  // Le `spaceId` des paramètres de requête n'était confronté à aucune
  // organisation (revue adversariale du lot 6, 2026-08-20) : viser un espace
  // d'un autre tenant révélait l'identifiant de sa première base par la
  // redirection. `requireOrgScoped` le confronte à l'organisation de la
  // requête ; en cas de refus on retombe silencieusement sur le premier espace
  // réellement accessible, sans rien dire de l'espace visé.
  const sp = await searchParams;
  // Repli : dernier espace choisi (cookie, revalidé contre la liste accessible).
  const lastSpaceId = (await cookies()).get(LAST_SPACE_COOKIE)?.value ?? null;
  let targetSpaceId =
    resolveCurrentSpaceId({ accessibleIds: userSpaces.map((s) => s.id), lastSpaceId }) ??
    userSpaces[0].id;
  if (sp.spaceId) {
    try {
      await requireOrgScoped({
        resource: { type: "space", id: sp.spaceId },
        minPermission: "viewer",
      });
      targetSpaceId = sp.spaceId;
    } catch (e) {
      if (!(e instanceof OrgScopeError)) throw e;
    }
  }

  // Trouver la première base du space pour rediriger
  const [firstDb] = await db
    .select({ id: userDatabases.id })
    .from(userDatabases)
    .where(eq(userDatabases.spaceId, targetSpaceId))
    .orderBy(asc(userDatabases.position), asc(userDatabases.name))
    .limit(1);

  if (firstDb) {
    redirect(`/bases/${firstDb.id}?spaceId=${targetSpaceId}`);
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
      <p>Aucune base dans cet espace.</p>
      <p className="text-xs">Créez-en une depuis la sidebar.</p>
    </div>
  );
}
