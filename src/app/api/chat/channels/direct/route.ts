import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { chatChannels, chatChannelMembers } from "@/lib/db/schema-chat";
import { sql } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { getOrgMemberIds } from "@/lib/org/org-members";

export async function POST(req: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Non authentifié" }, { status: 401 });

  let body: { targetUserId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Corps de requête invalide" }, { status: 400 });
  }

  const { targetUserId } = body;
  if (!targetUserId || typeof targetUserId !== "string") {
    return NextResponse.json({ error: "targetUserId requis" }, { status: 400 });
  }

  if (targetUserId === user.id) {
    return NextResponse.json({ error: "Impossible de créer un DM avec soi-même" }, { status: 400 });
  }

  // Cloisonnement multi-tenant (AZ-17). L'organisation de la requête est
  // résolue depuis le sous-domaine, et `null` vaut « aucun accès » : on rend un
  // 404 plutôt que de retomber sur une organisation arbitraire de l'appelant.
  const orgId = await getRequestOrgId(user);
  if (!orgId) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  }

  // La cible doit être membre de l'organisation courante. La vérification
  // d'appartenance remplace la vérification d'existence : un identifiant
  // inexistant et l'identifiant d'un membre d'un autre tenant donnent
  // exactement la même réponse, ce qui ferme l'oracle d'existence de comptes.
  const memberIds = await getOrgMemberIds(orgId);
  if (!memberIds.includes(targetUserId)) {
    return NextResponse.json({ error: "Utilisateur introuvable" }, { status: 404 });
  }

  // Utiliser une transaction pour éviter les doublons en cas de requêtes simultanées
  const channelId = await db.transaction(async (tx) => {
    const existing = await tx.execute(sql`
      SELECT c.id FROM chat_channels c
      WHERE c.type = 'direct'
        AND c.organization_id = ${orgId}::uuid
        AND (
          SELECT COUNT(*) FROM chat_channel_members m WHERE m.channel_id = c.id
            AND m.user_id IN (${user.id}::uuid, ${targetUserId}::uuid)
        ) = 2
      LIMIT 1
    `);

    if (existing.rows.length > 0) {
      return (existing.rows[0] as { id: string }).id;
    }

    const [channel] = await tx
      .insert(chatChannels)
      .values({ organizationId: orgId, type: "direct", createdBy: user.id })
      .returning({ id: chatChannels.id });

    await tx.insert(chatChannelMembers).values([
      { channelId: channel.id, userId: user.id },
      { channelId: channel.id, userId: targetUserId },
    ]);

    return channel.id;
  });

  return NextResponse.json({ id: channelId });
}
