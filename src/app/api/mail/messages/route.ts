import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { requireCrm } from "@/lib/crm/access";
import { composeInputSchema } from "@/lib/mailing/compose";
import { resolveFicheContext } from "@/lib/mailing/crm-trace";
import { MailError, scheduleMail } from "@/lib/mailing/outbox";
import { AttachmentError } from "@/lib/mailing/attachments";
import { groupConversations, listFicheMails } from "@/lib/mailing/threads";

const notFound = () => NextResponse.json({ error: "Introuvable" }, { status: 404 });
const fail = (status: number, code: string, error = code) => NextResponse.json({ error, code }, { status });
const query = z.object({ databaseId: z.string().uuid(), rowId: z.string().uuid() });

export async function GET(req: NextRequest) {
  const access = await requireCrm({ level: "member", requireEnabled: true }, req);
  if (!access.ok) return access.response;
  const parsed = query.safeParse({
    databaseId: req.nextUrl.searchParams.get("databaseId"),
    rowId: req.nextUrl.searchParams.get("rowId"),
  });
  if (!parsed.success) return notFound();

  const fiche = await resolveFicheContext(access.orgId, access.user.id, parsed.data);
  if (!fiche) return notFound();

  const scope =
    fiche.role === "dossiers"
      ? ({ kind: "dossier", dossierRowId: parsed.data.rowId } as const)
      : ({ kind: "contact", contactRowId: fiche.contactRowId } as const);
  const rows = await listFicheMails(access.orgId, access.user.id, scope);
  return NextResponse.json({ conversations: groupConversations(rows) });
}

export async function POST(req: NextRequest) {
  const access = await requireCrm({ level: "member", requireEnabled: true }, req);
  if (!access.ok) return access.response;

  let json: unknown;
  try {
    json = await req.json();
  } catch {
    json = undefined;
  }
  // Schéma strict : un userId ou un from dans le corps est refusé, l'expéditeur vient de la session.
  const parsed = composeInputSchema.safeParse(json);
  if (!parsed.success) return fail(400, "invalid_body", "Corps invalide");
  const compose = parsed.data;

  // Lecture de la fiche vérifiée avant tout envoi ; les écritures de trace sont ensuite système.
  const fiche = await resolveFicheContext(access.orgId, access.user.id, {
    databaseId: compose.databaseId,
    rowId: compose.rowId,
  });
  if (!fiche) return notFound();

  try {
    const r = await scheduleMail({ orgId: access.orgId, userId: access.user.id, compose, ctx: fiche });
    return NextResponse.json(
      { id: r.rowId, scheduledAt: r.scheduledAt.toISOString(), cancelDelaySeconds: r.cancelDelaySeconds },
      { status: 201 },
    );
  } catch (e) {
    if (e instanceof MailError) {
      switch (e.code) {
        case "no_account":
          return fail(409, "no_account", "Aucune boîte mail configurée");
        case "account_unverified":
          return fail(409, "account_unverified", "Boîte mail non vérifiée : lancez le test de connexion dans Paramètres, Mails");
        case "account_error":
          return NextResponse.json(
            {
              error: `Dernier test de la boîte mail en échec : ${e.detail?.statusMessage ?? "motif inconnu"}. Corrigez les réglages puis relancez le test dans Paramètres, Mails`,
              code: "account_error",
              detail: e.detail?.statusMessage ?? "",
            },
            { status: 409 },
          );
        case "quota":
          return NextResponse.json(
            { error: "Quota d'envoi atteint", code: e.detail?.reason === "abuse" ? "quota_abuse" : "quota_plan", limit: e.detail?.limit ?? null },
            { status: 429 },
          );
        case "fiche_forbidden":
          return notFound();
        case "dossier_mismatch":
          return fail(400, "dossier_mismatch", "Dossier invalide");
        case "invalid_header":
          return fail(400, "invalid_body", "Corps invalide");
      }
    }
    if (e instanceof AttachmentError) {
      if (e.code === "too_large") return fail(413, "attachment_too_large", "Pièces jointes trop volumineuses");
      if (e.code === "forbidden") return notFound();
      return fail(400, "attachment_missing", "Pièce jointe introuvable");
    }
    throw e;
  }
}
