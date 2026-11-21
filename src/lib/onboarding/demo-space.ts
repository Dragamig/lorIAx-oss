// loriax-app/src/lib/onboarding/demo-space.ts
// Gestion de l'espace démo « Découverte LorIAx » — Feature 1.

import { db } from "@/lib/db";
import { spaces } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import slugify from "slugify";
import { initRepository } from "@/lib/git/repository";

const DEMO_NAME = "Découverte LorIAx";

export async function isDemoSpace(spaceId: string): Promise<boolean> {
  const [row] = await db
    .select({ isDemo: spaces.isDemo })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);
  return Boolean(row?.isDemo);
}

export async function getDemoSpaceForUser(userId: string, orgId: string) {
  const [row] = await db
    .select()
    .from(spaces)
    .where(
      and(
        eq(spaces.ownerUserId, userId),
        eq(spaces.isDemo, true),
        eq(spaces.organizationId, orgId),
      ),
    )
    .limit(1);
  return row ?? null;
}

export async function createDemoSpace(userId: string, orgId: string) {
  const existing = await getDemoSpaceForUser(userId, orgId);
  if (existing) return existing;
  const slug = slugify(`${DEMO_NAME}-${userId.slice(0, 8)}`, {
    lower: true,
    strict: true,
  });
  const gitRepoPath = `personal/${slug}-${Date.now()}`;
  const [space] = await db
    .insert(spaces)
    .values({
      name: DEMO_NAME,
      slug,
      type: "personal",
      icon: "🎓",
      ownerUserId: userId,
      gitRepoPath,
      isDemo: true,
      organizationId: orgId,
    })
    .returning();
  await initRepository(gitRepoPath);
  return space;
}

export async function deleteDemoSpace(
  userId: string,
  orgId: string,
): Promise<boolean> {
  const space = await getDemoSpaceForUser(userId, orgId);
  if (!space) return false;
  await db.delete(spaces).where(eq(spaces.id, space.id));
  return true;
}
