import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireCrm } from "@/lib/crm/access";
import { loadCrmContext } from "@/lib/crm/context";
import { mergeActivity, type ActivityTask } from "@/lib/crm/activity-model";
import { dealExists, loadActivityInteractions, loadActivityMails, loadActivityTasks, type ActivityScope } from "@/lib/crm/activity";
import { interactionLogging } from "@/lib/crm/relances";
import type { InteractionDto } from "@/lib/crm/deal-model";
import { requireRowScope } from "@/lib/databases/row-route-access";
import { resolveFicheContext } from "@/lib/mailing/crm-trace";
import type { MailMessageDto } from "@/lib/mailing/threads";

const notFound = () => NextResponse.json({ error: "Introuvable" }, { status: 404 });
const query = z.object({ databaseId: z.string().uuid(), rowId: z.string().uuid() });

/** Une source qui échoue rend une liste vide et se déclare dans `partial`. */
async function settle<T>(name: string, partial: string[], run: () => Promise<T | null>): Promise<T | []> {
  try {
    const value = await run();
    if (value === null) {
      partial.push(name);
      return [];
    }
    return value;
  } catch {
    partial.push(name);
    return [];
  }
}

/** Même règle que PATCH /api/tasks/[id] : assigné ou auteur. */
const canToggleFor = (userId: string) => (t: ActivityTask): ActivityTask => ({
  ...t,
  canToggle: t.assigneeId === userId || t.createdBy === userId,
});

export async function GET(req: NextRequest) {
  const access = await requireCrm({ level: "member", requireEnabled: true }, req);
  if (!access.ok) return access.response;

  const parsed = query.safeParse({
    databaseId: req.nextUrl.searchParams.get("databaseId"),
    rowId: req.nextUrl.searchParams.get("rowId"),
  });
  if (!parsed.success) return notFound();
  const { databaseId, rowId } = parsed.data;

  // Fiche d'une base de la connexion de l'organisation, sinon 404 muet (autre organisation comprise).
  const fiche = await resolveFicheContext(access.orgId, access.user.id, { databaseId, rowId });
  const ctx = await loadCrmContext(access.orgId, access.user.id);
  if (!ctx) return notFound();
  // Dossier sans contact lié (ou contact supprimé) : resolveFicheContext renvoie null. On vérifie alors
  // que la base est celle des Dossiers de la connexion de l'organisation et que la ligne y existe.
  const orphanDeal = !fiche && ctx.databaseId("dossiers") === databaseId && (await dealExists(ctx, rowId));
  if (!fiche && !orphanDeal) return notFound();
  const role = fiche ? fiche.role : "dossiers";

  // Les tâches ne vérifient pas l'appartenance de la ligne : accès viewer à la base d'abord.
  const rowScope = await requireRowScope(req, { databaseId, rowId, min: "viewer" });
  if (rowScope instanceof NextResponse) return rowScope;

  const scope: ActivityScope = { kind: role === "dossiers" ? "deal" : "contact", rowId };
  const partial: string[] = [];
  const [interactions, tasks, mails] = await Promise.all([
    settle<InteractionDto[]>("interactions", partial, () => loadActivityInteractions(ctx, scope)),
    settle<ActivityTask[]>("tasks", partial, () => loadActivityTasks(db, { databaseId, rowId })),
    // Sans contact, aucun périmètre de mail.
    fiche
      ? settle<MailMessageDto[]>("mails", partial, () => loadActivityMails(access.orgId, access.user.id, scope))
      : Promise.resolve([] as MailMessageDto[]),
  ]);

  return NextResponse.json({
    items: mergeActivity({ interactions, tasks: tasks.map(canToggleFor(access.user.id)), mails }),
    role,
    canLogInteraction: role === "dossiers" && interactionLogging(ctx).canLog,
    partial: partial.sort(),
  });
}
