import { and, eq, inArray } from "drizzle-orm";
import { organizationMembers } from "@/lib/db/schema-org";
import { getSpacePermission } from "@/lib/auth/check-access";
import type { DbExecutor } from "./row-writes";

export type CanView = (userId: string) => Promise<boolean>;

/** Nombre maximal d'identifiants examines par appel. */
export const MAX_ELIGIBILITY_IDS = 100;

/**
 * Vrai si l'utilisateur a au moins `viewer` sur l'espace (getSpacePermission, qui lit aussi les
 * droits d'equipe). Resultat memorise pour la duree de l'instance.
 */
export function makeCanView(spaceId: string): CanView {
  const cache = new Map<string, Promise<boolean>>();
  return (userId) => {
    let hit = cache.get(userId);
    if (!hit) {
      hit = getSpacePermission(userId, spaceId).then((p) => p != null);
      cache.set(userId, hit);
    }
    return hit;
  };
}

/** Identifiants dedupliques, membres de l'organisation ET autorises a voir l'espace, ordre conserve. */
export async function filterEligibleUsers(
  executor: DbExecutor,
  args: { orgId: string; userIds: string[]; canView: CanView },
): Promise<string[]> {
  const ids = [...new Set(args.userIds)].slice(0, MAX_ELIGIBILITY_IDS);
  if (ids.length === 0) return [];
  const rows = await executor
    .select({ userId: organizationMembers.userId })
    .from(organizationMembers)
    .where(and(eq(organizationMembers.organizationId, args.orgId), inArray(organizationMembers.userId, ids)));
  const members = new Set(rows.map((r) => r.userId));
  const out: string[] = [];
  for (const id of ids) {
    if (members.has(id) && (await args.canView(id))) out.push(id);
  }
  return out;
}

export async function isEligibleUser(
  executor: DbExecutor,
  args: { orgId: string; userId: string; canView: CanView },
): Promise<boolean> {
  const r = await filterEligibleUsers(executor, { orgId: args.orgId, userIds: [args.userId], canView: args.canView });
  return r.length === 1;
}
