import { and, asc, eq, isNull } from "drizzle-orm";
import { spaces, userDatabases } from "@/lib/db/schema";
import { CRM_ROLES, type CrmRole } from "./fields";
import { defaultCrmDeps, type Candidate, type CrmDeps } from "./connection";
import { normalizeName } from "./plan";

export interface PreviewSpace {
  id: string;
  name: string;
}
export interface PreviewCollision {
  databaseId: string;
  name: string;
}

/** Corps de la réponse de `GET /api/crm/activate/preview`. */
export interface ActivationPreview {
  roles: Record<CrmRole, { candidates: Candidate[]; preselected: string | null }>;
  existing: boolean;
  spaces: PreviewSpace[];
  suggestedSpaceId: string | null;
  collisions: Record<CrmRole, PreviewCollision[]>;
  orgs: { slug: string; name: string }[];
}

/**
 * Espaces de l'organisation de la requête où l'utilisateur est au moins éditeur. L'organisation est
 * confrontée en SQL d'abord ; `permissionOf` n'est appelée que pour les espaces de cette organisation.
 */
export async function listEditableSpaces(
  orgId: string,
  userId: string,
  deps: CrmDeps = defaultCrmDeps(),
): Promise<PreviewSpace[]> {
  const rows = await deps.executor
    .select({ id: spaces.id, name: spaces.name })
    .from(spaces)
    .where(eq(spaces.organizationId, orgId))
    .orderBy(asc(spaces.name));
  const out: PreviewSpace[] = [];
  for (const row of rows) {
    const level = await deps.permissionOf(userId, row.id);
    if (level === "editor" || level === "admin") out.push(row);
  }
  return out;
}

/** Espace éditable dont le nom normalisé vaut l'un des noms proposés, sinon null. */
export function suggestSpaceId(editable: PreviewSpace[], names: string[]): string | null {
  const wanted = new Set(names.map(normalizeName));
  return editable.find((s) => wanted.has(normalizeName(s.name)))?.id ?? null;
}

/**
 * Bases vivantes de l'espace proposé dont le nom normalisé égale le nom de création d'un rôle.
 * `spaceId` doit provenir de `listEditableSpaces` (organisation déjà confrontée).
 */
export async function findCollisions(
  spaceId: string | null,
  createNames: Record<CrmRole, string>,
  deps: CrmDeps = defaultCrmDeps(),
): Promise<Record<CrmRole, PreviewCollision[]>> {
  const out = Object.fromEntries(CRM_ROLES.map((r) => [r, [] as PreviewCollision[]])) as Record<CrmRole, PreviewCollision[]>;
  if (!spaceId) return out;
  const rows = await deps.executor
    .select({ databaseId: userDatabases.id, name: userDatabases.name })
    .from(userDatabases)
    .where(
      and(
        eq(userDatabases.spaceId, spaceId),
        isNull(userDatabases.deletedAt),
        isNull(userDatabases.archivedAt),
      ),
    )
    .orderBy(asc(userDatabases.name));
  for (const role of CRM_ROLES) {
    const wanted = normalizeName(createNames[role]);
    out[role] = rows.filter((r) => normalizeName(r.name) === wanted);
  }
  return out;
}
