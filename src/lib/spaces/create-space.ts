import slugify from "slugify";
import { spaces } from "@/lib/db/schema";
import type { DbExecutor } from "@/lib/databases/row-writes";
import { initRepository } from "@/lib/git/repository";
import { logActivity } from "@/lib/activity";
import { getHooks } from "@/lib/modules/hooks";
import { createSpaceChannel } from "@/lib/chat/channel-hooks";
import { recordOnboardingEvent } from "@/lib/onboarding/progress";
import logger from "@/lib/logger";

export type InsertSpaceInput = {
  orgId: string;
  userId: string;
  name: string;
  type: "personal" | "team" | "organization";
  description?: string;
  icon?: string;
  ownerTeamId?: string;
};

/** Quota d'espaces de l'organisation (enveloppe de la licence et du comptage). */
export async function assertSpaceQuota(
  orgId: string,
): Promise<{ exceeded: boolean; current: number; max: number | null }> {
  const status = await getHooks().usage.checkSpacesLimit(orgId);
  return { exceeded: status.exceeded, current: status.current, max: status.max };
}

/**
 * Insère la ligne d'espace sur l'exécuteur fourni (transaction de l'appelant incluse) :
 * le propriétaire est posé sur la ligne elle-même, rien d'autre n'est écrit.
 */
export async function insertSpace(
  tx: DbExecutor,
  input: InsertSpaceInput,
): Promise<typeof spaces.$inferSelect> {
  const { orgId, userId, name, type, description, icon, ownerTeamId } = input;
  const slug = slugify(name, { lower: true, strict: true });
  const gitRepoPath = `${type}/${slug}-${Date.now()}`;
  const [space] = await tx
    .insert(spaces)
    .values({
      name,
      slug,
      type,
      description,
      icon,
      ownerUserId: type !== "team" ? userId : undefined,
      ownerTeamId: type === "team" ? ownerTeamId : undefined,
      gitRepoPath,
      organizationId: orgId,
    })
    .returning();
  return space;
}

/**
 * Effets de bord à lancer après le commit : dépôt git, canal de messagerie, journal d'activité,
 * événement d'onboarding. Chaque échec est journalisé sans lever ; un échec git interrompt la suite.
 */
export async function afterSpaceCreated(
  space: typeof spaces.$inferSelect,
  userId: string,
): Promise<{ gitOk: boolean }> {
  try {
    await initRepository(space.gitRepoPath);
  } catch (err) {
    logger.error(
      { err, gitRepoPath: space.gitRepoPath },
      "[spaces] Erreur lors de l'initialisation du repository git",
    );
    return { gitOk: false };
  }

  createSpaceChannel({
    spaceId: space.id,
    organizationId: space.organizationId,
    createdBy: userId,
    memberIds: [userId],
  }).catch((err) => logger.error({ err }, "[channel-hooks] Erreur création canal espace"));

  logActivity({
    userId,
    action: "create",
    entityType: "space",
    entityId: space.id,
    metadata: { name: space.name, type: space.type },
  });

  recordOnboardingEvent(userId, "space").catch((err) =>
    logger.error({ err }, "[onboarding] erreur record space"),
  );

  return { gitOk: true };
}
