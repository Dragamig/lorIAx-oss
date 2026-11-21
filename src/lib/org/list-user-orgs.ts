import { db } from "@/lib/db";
import { organizations, organizationMembers } from "@/lib/db/schema-org";
import { eq } from "drizzle-orm";

export interface UserOrg {
  slug: string;
  name: string;
  role: "owner" | "admin" | "member";
}

export async function listUserOrganizations(userId: string): Promise<UserOrg[]> {
  const rows = await db
    .select({
      slug: organizations.slug,
      name: organizations.name,
      role: organizationMembers.role,
    })
    .from(organizationMembers)
    .innerJoin(organizations, eq(organizations.id, organizationMembers.organizationId))
    .where(eq(organizationMembers.userId, userId));
  return rows as UserOrg[];
}
