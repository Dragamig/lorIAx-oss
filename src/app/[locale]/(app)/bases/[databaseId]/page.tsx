import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { eq } from "drizzle-orm";
import {
  userDatabases,
  userDatabaseViews,
  spaces,
} from "@/lib/db/schema";
import { requireOrgScoped, OrgScopeError } from "@/lib/auth/require-org-scoped";
import { listVisibleViews, pickDefaultView } from "@/lib/databases/view-access";
import { readRowParam, viewRedirectUrl } from "@/lib/bases/row-deep-link";

interface PageProps {
  params: Promise<{ databaseId: string }>;
  searchParams: Promise<{ spaceId?: string; row?: string }>;
}

/**
 * Page d'une base: redirige vers sa vue par défaut.
 * Siloing : requireOrgScoped valide que la database appartient bien à l'org
 * courante avant tout fetch. Mismatch = notFound() (404 silencieux).
 */
export default async function DatabaseHomePage({ params, searchParams }: PageProps) {
  const { databaseId } = await params;
  const sp = await searchParams;
  const rowId = readRowParam({ get: () => sp.row ?? null });

  let ctxUserId: string | undefined;
  try {
    const ctx = await requireOrgScoped({ resource: { type: "database", id: databaseId }, minPermission: "viewer" });
    ctxUserId = ctx.user.id;
  } catch (e) {
    if (e instanceof OrgScopeError) {
      // Pas d'accès = inexistant pour le user (jamais révéler)
      notFound();
    }
    throw e;
  }

  const [database] = await db
    .select({ id: userDatabases.id, spaceId: userDatabases.spaceId })
    .from(userDatabases)
    .innerJoin(spaces, eq(spaces.id, userDatabases.spaceId))
    .where(eq(userDatabases.id, databaseId))
    .limit(1);

  if (!database) notFound();

  // Vue par défaut parmi les vues visibles (jamais une vue personnelle tant qu'une partagée existe)
  const defaultView = pickDefaultView(await listVisibleViews(db, databaseId, ctxUserId!));

  const spaceParam = database.spaceId;

  if (defaultView) {
    redirect(viewRedirectUrl({ databaseId, viewId: defaultView.id, spaceId: spaceParam, rowId }));
  }

  // Pas de vue : auto-création d'une vue grid par défaut
  const [created] = await db
    .insert(userDatabaseViews)
    .values({
      databaseId,
      name: "Vue par défaut",
      type: "grid",
      config: {},
      isDefault: true,
      scope: "shared",
      position: 0,
      createdBy: ctxUserId,
    })
    .returning({ id: userDatabaseViews.id });

  redirect(viewRedirectUrl({ databaseId, viewId: created.id, spaceId: spaceParam, rowId }));
}
