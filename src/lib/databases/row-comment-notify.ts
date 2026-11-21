import { createNotifications } from "@/lib/notifications";

/** Notifie les personnes mentionnées (déjà éligibles) : in-app, sans extrait du commentaire. */
export async function notifyRowMentions(args: {
  userIds: string[];
  actorId: string;
  actorName: string;
  databaseId: string;
  rowId: string;
}): Promise<void> {
  if (args.userIds.length === 0) return;
  await createNotifications(args.userIds, {
    type: "mention",
    title: `${args.actorName} vous a mentionné dans une fiche`,
    databaseId: args.databaseId,
    rowId: args.rowId,
    actorId: args.actorId,
  });
}
