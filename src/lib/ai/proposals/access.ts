import type { NextRequest } from "next/server";
import type { AiProposalRow } from "@/lib/db/schema-ai-proposals";
import { requireDatabaseAccess, ToolAccessError, type ChatToolContext } from "@/lib/ai/chat-tools/context";
import type { SessionUser } from "@/types";

/**
 * Accès à une proposition au clic (apply, undo, recompute) : elle appartient à l'utilisateur de la session et à
 * son organisation courante, et l'accès `editor` à sa base est revérifié à cet instant (droits modifiables depuis).
 * Propriétaire, organisation ou base inconnus : `not_found` (indiscernable d'une proposition inexistante).
 * Droit d'édition retiré alors que la lecture reste acquise : `forbidden`.
 * `req` est transmis à requireOrgScoped quand l'appelant l'a (sinon l'organisation est lue via headers()).
 */
export async function assertProposalAccess(args: {
  user: SessionUser;
  orgId: string;
  proposal: AiProposalRow;
  minPermission: "editor";
  req?: NextRequest;
}): Promise<void> {
  const { user, orgId, proposal } = args;
  if (proposal.userId !== user.id || proposal.orgId !== orgId) throw new ToolAccessError("not_found");
  const ctx: ChatToolContext = { user, orgId, spaceIds: [], admin: false, req: args.req as NextRequest };
  await requireDatabaseAccess(ctx, proposal.databaseId, args.minPermission);
}
