import { ReactNode } from "react";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  spaces,
  userDatabases,
  userDatabaseGroups,
  userDatabaseRecents,
  favorites,
  aiProviders,
} from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth/get-user";
import { getAccessibleSpaceIds } from "@/lib/auth/check-access";
import { LAST_SPACE_COOKIE } from "@/lib/spaces/resolve-current-space";
import { BasesSidebar, type BasesSidebarSpaceData } from "@/components/bases/bases-sidebar";

interface LayoutProps {
  children: ReactNode;
}

/**
 * Layout de l'Espace Bases. Un layout ne reçoit jamais searchParams : on
 * charge donc les données de tous les espaces accessibles et la sidebar
 * (client) choisit l'espace courant d'après l'URL (`?spaceId=`, base ouverte),
 * puis le dernier espace choisi, puis le premier.
 *
 * Siloing : seuls les espaces de getAccessibleSpaceIds sont chargés, un
 * `?spaceId=` forgé hors de cette liste est ignoré ; chaque API appelée
 * derrière passe par requireOrgScoped.
 */
export default async function BasesLayout({ children }: LayoutProps) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Espaces accessibles dans l'org courante (liste autoritative, admins inclus).
  const accessibleIds = await getAccessibleSpaceIds(user);

  const userSpaces =
    accessibleIds.length === 0
      ? []
      : await db
          .select()
          .from(spaces)
          .where(inArray(spaces.id, accessibleIds))
          .orderBy(asc(spaces.name));

  if (userSpaces.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Aucun espace accessible — créez-en un dans Paramètres pour commencer.
      </div>
    );
  }

  const spaceIds = userSpaces.map((s) => s.id);

  const [groups, allDatabases, enabledProviders, favRows, recentRows] =
    await Promise.all([
      db
        .select()
        .from(userDatabaseGroups)
        .where(inArray(userDatabaseGroups.spaceId, spaceIds))
        .orderBy(asc(userDatabaseGroups.position), asc(userDatabaseGroups.name)),
      db
        .select()
        .from(userDatabases)
        .where(inArray(userDatabases.spaceId, spaceIds))
        .orderBy(asc(userDatabases.position), asc(userDatabases.name)),
      db
        .select({ id: aiProviders.id })
        .from(aiProviders)
        .where(eq(aiProviders.isEnabled, true))
        .limit(1),
      db
        .select({ entityId: favorites.entityId })
        .from(favorites)
        .where(
          and(eq(favorites.userId, user.id), eq(favorites.entityType, "database"))
        ),
      db
        .select({
          databaseId: userDatabaseRecents.databaseId,
          spaceId: userDatabases.spaceId,
          openedAt: userDatabaseRecents.openedAt,
        })
        .from(userDatabaseRecents)
        .innerJoin(
          userDatabases,
          eq(userDatabases.id, userDatabaseRecents.databaseId)
        )
        .where(
          and(
            eq(userDatabaseRecents.userId, user.id),
            inArray(userDatabases.spaceId, spaceIds),
            isNull(userDatabases.archivedAt),
            isNull(userDatabases.deletedAt)
          )
        )
        .orderBy(desc(userDatabaseRecents.openedAt)),
    ]);

  const aiEnabled = enabledProviders.length > 0;
  const favoriteIds = new Set(favRows.map((f) => f.entityId));
  const lastSpaceId = (await cookies()).get(LAST_SPACE_COOKIE)?.value ?? null;

  // Données par espace : le layout ne peut pas lire searchParams, c'est la
  // sidebar (client) qui choisit l'espace courant selon l'URL.
  const spaceData: Record<string, BasesSidebarSpaceData> = {};
  for (const s of userSpaces) {
    const dbs = allDatabases.filter((d) => d.spaceId === s.id);
    spaceData[s.id] = {
      groups: groups
        .filter((g) => g.spaceId === s.id)
        .map((g) => ({ id: g.id, name: g.name, icon: g.icon ?? null })),
      databases: dbs
        .filter((d) => d.archivedAt === null && d.deletedAt === null)
        .map((d) => ({
          id: d.id,
          name: d.name,
          icon: d.icon ?? null,
          groupId: d.groupId ?? null,
          isFavorite: favoriteIds.has(d.id),
        })),
      recentIds: recentRows
        .filter((r) => r.spaceId === s.id)
        .slice(0, 5)
        .map((r) => r.databaseId),
      archivedCount: dbs.filter((d) => d.archivedAt !== null && d.deletedAt === null).length,
      trashedCount: dbs.filter((d) => d.deletedAt !== null).length,
    };
  }
  const databaseSpaceIds: Record<string, string> = {};
  for (const d of allDatabases) databaseSpaceIds[d.id] = d.spaceId;

  return (
    <div className="flex h-full">
      <BasesSidebar
        spaces={userSpaces.map((s) => ({ id: s.id, name: s.name }))}
        spaceData={spaceData}
        databaseSpaceIds={databaseSpaceIds}
        lastSpaceId={lastSpaceId}
        aiEnabled={aiEnabled}
      />
      <main className="flex-1 overflow-hidden">{children}</main>
    </div>
  );
}
