import { db } from "@/lib/db";
import { chatChannels, chatChannelMembers } from "@/lib/db/schema-chat";

interface CreateChannelOptions {
  organizationId: string;
  createdBy: string;
  memberIds: string[];
}

export async function createTeamChannel(
  opts: CreateChannelOptions & { teamId: string }
): Promise<string> {
  return db.transaction(async (tx) => {
    const [channel] = await tx
      .insert(chatChannels)
      .values({
        organizationId: opts.organizationId,
        type: "team",
        teamId: opts.teamId,
        createdBy: opts.createdBy,
      })
      .returning({ id: chatChannels.id });

    if (!channel) throw new Error("Échec création canal équipe");

    if (opts.memberIds.length > 0) {
      await tx.insert(chatChannelMembers).values(
        opts.memberIds.map((userId) => ({ channelId: channel.id, userId }))
      );
    }

    return channel.id;
  });
}

export async function createSpaceChannel(
  opts: CreateChannelOptions & { spaceId: string }
): Promise<string> {
  return db.transaction(async (tx) => {
    const [channel] = await tx
      .insert(chatChannels)
      .values({
        organizationId: opts.organizationId,
        type: "space",
        spaceId: opts.spaceId,
        createdBy: opts.createdBy,
      })
      .returning({ id: chatChannels.id });

    if (!channel) throw new Error("Échec création canal espace");

    if (opts.memberIds.length > 0) {
      await tx.insert(chatChannelMembers).values(
        opts.memberIds.map((userId) => ({ channelId: channel.id, userId }))
      );
    }

    return channel.id;
  });
}
