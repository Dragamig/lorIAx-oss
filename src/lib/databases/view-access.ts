/**
 * Visibilité des vues d'une base : une vue partagée est visible de tous, une vue personnelle
 * uniquement de son auteur. Une vue personnelle d'un autre est indiscernable d'une vue inexistante.
 */
import { userDatabaseViews, type VIEW_SCOPES } from "@/lib/db/schema";
import { and, asc, count, eq, or, sql, type SQL } from "drizzle-orm";
import type { DbExecutor } from "./row-writes";

export type ViewRow = typeof userDatabaseViews.$inferSelect;
type ViewScope = (typeof VIEW_SCOPES)[number];

export function visibleViewsCondition(userId: string): SQL {
  return or(
    eq(userDatabaseViews.scope, "shared"),
    and(eq(userDatabaseViews.scope, "personal"), eq(userDatabaseViews.createdBy, userId)),
  ) as SQL;
}

export async function listVisibleViews(
  executor: DbExecutor,
  databaseId: string,
  userId: string,
): Promise<ViewRow[]> {
  return executor
    .select()
    .from(userDatabaseViews)
    .where(and(eq(userDatabaseViews.databaseId, databaseId), visibleViewsCondition(userId)))
    .orderBy(
      sql`CASE WHEN ${userDatabaseViews.scope} = 'shared' THEN 0 ELSE 1 END`,
      asc(userDatabaseViews.position),
      asc(userDatabaseViews.createdAt),
    );
}

export async function getVisibleView(
  executor: DbExecutor,
  databaseId: string,
  viewId: string,
  userId: string,
): Promise<ViewRow | null> {
  const [row] = await executor
    .select()
    .from(userDatabaseViews)
    .where(
      and(
        eq(userDatabaseViews.id, viewId),
        eq(userDatabaseViews.databaseId, databaseId),
        visibleViewsCondition(userId),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** La vue par défaut partagée, sinon la première partagée, sinon la première visible. */
export function pickDefaultView(views: ViewRow[]): ViewRow | null {
  const shared = views.filter((v) => v.scope === "shared");
  return shared.find((v) => v.isDefault) ?? shared[0] ?? views[0] ?? null;
}

const NOT_FOUND = { ok: false, status: 404, error: "Introuvable" } as const;

export async function countSharedViews(executor: DbExecutor, databaseId: string): Promise<number> {
  const [row] = await executor
    .select({ n: count() })
    .from(userDatabaseViews)
    .where(and(eq(userDatabaseViews.databaseId, databaseId), eq(userDatabaseViews.scope, "shared")));
  return Number(row?.n ?? 0);
}

/**
 * Verrou transactionnel sur l'ensemble des vues d'une base. Doit etre appele dans une transaction
 * (le verrou est libere au commit). Serialise les changements de portee et suppressions concurrents.
 */
export async function lockDatabaseViews(executor: DbExecutor, databaseId: string): Promise<void> {
  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`views:${databaseId}`}, 0))`);
}

export type ViewWriteDecision =
  | { ok: true; revokePublicToken: boolean; unsetDefaultOthers: boolean; view: ViewRow }
  | { ok: false; status: 400 | 403 | 404; error: string };

/**
 * DOIT etre appele dans une transaction, et l'ecriture qui suit dans la MEME transaction : la fonction
 * prend le verrou des vues de la base, relit la vue par id (l'instantane `view` ne sert qu'a localiser
 * la base et l'identifiant ; 404 si disparue ou invisible), puis decide. `view` renvoye = ligne relue.
 */
export async function decideViewUpdate(
  executor: DbExecutor,
  args: {
    view: ViewRow;
    userId: string;
    patch: { scope?: ViewScope; isDefault?: boolean; isPublic?: boolean };
  },
): Promise<ViewWriteDecision> {
  const { userId, patch } = args;
  await lockDatabaseViews(executor, args.view.databaseId);
  const view = await getVisibleView(executor, args.view.databaseId, args.view.id, userId);
  if (!view) return NOT_FOUND;

  const target: ViewScope = patch.scope ?? (view.scope as ViewScope);
  const scopeChanges = target !== view.scope;

  if (scopeChanges) {
    if (target === "personal" && view.createdBy == null) {
      return { ok: false, status: 400, error: "Une vue sans auteur ne peut pas devenir personnelle" };
    }
    if (view.createdBy !== userId) return { ok: false, status: 403, error: "Accès refusé" };
  }

  if (target === "personal") {
    if (patch.isDefault === true || patch.isPublic === true) {
      return { ok: false, status: 400, error: "Une vue personnelle ne peut être ni par défaut ni publique" };
    }
    if (scopeChanges) {
      if (view.isDefault) {
        return { ok: false, status: 400, error: "La vue par défaut ne peut pas devenir personnelle" };
      }
      if ((await countSharedViews(executor, view.databaseId)) <= 1) {
        return { ok: false, status: 400, error: "La dernière vue partagée d'une base ne peut pas devenir personnelle" };
      }
    }
  }

  return {
    ok: true,
    revokePublicToken: scopeChanges && target === "personal" && (view.isPublic || view.publicToken != null),
    unsetDefaultOthers: target === "shared" && patch.isDefault === true,
    view,
  };
}

export function decideViewCreate(args: {
  scope: ViewScope;
  isDefault?: boolean;
  isPublic?: boolean;
}): { ok: true } | { ok: false; status: 400; error: string } {
  if (args.scope === "personal" && (args.isDefault || args.isPublic)) {
    return { ok: false, status: 400, error: "Une vue personnelle ne peut être ni par défaut ni publique" };
  }
  return { ok: true };
}

/** Meme contrat transactionnel que decideViewUpdate (verrou, relecture, ecriture dans la meme transaction). */
export async function decideViewDelete(
  executor: DbExecutor,
  args: { view: ViewRow; userId: string },
): Promise<{ ok: true; promoteDefault: boolean } | { ok: false; status: 400 | 404; error: string }> {
  const { userId } = args;
  await lockDatabaseViews(executor, args.view.databaseId);
  const view = await getVisibleView(executor, args.view.databaseId, args.view.id, userId);
  if (!view) return NOT_FOUND;
  if (view.scope === "personal") return { ok: true, promoteDefault: false };
  if ((await countSharedViews(executor, view.databaseId)) <= 1) {
    return { ok: false, status: 400, error: "Impossible de supprimer la dernière vue partagée d'une base" };
  }
  return { ok: true, promoteDefault: view.isDefault };
}
