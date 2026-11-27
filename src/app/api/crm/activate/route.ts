import { NextResponse, type NextRequest } from "next/server";
import { requireCrm } from "@/lib/crm/access";
import { activateCrm } from "@/lib/crm/activation";
import { activateBodySchema, activateBodyV2Schema, type CrmActivateBody, type CrmActivateBodyV2 } from "@/lib/crm/fields";
import { requestLocale } from "@/lib/crm/locale";

export async function POST(req: NextRequest) {
  const access = await requireCrm({ level: "admin", requireEnabled: false }, req);
  if (!access.ok) return access.response;

  let body: unknown = {};
  try {
    const text = await req.text();
    if (text.trim() !== "") body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const locale = requestLocale(req);
  const isV2 = typeof body === "object" && body !== null && ("space" in body || "roles" in body);
  const parsed = isV2 ? activateBodyV2Schema.safeParse(body) : activateBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Corps invalide", code: "invalid_body" }, { status: 400 });
  }

  const result = await activateCrm(
    access.orgId,
    access.user.id,
    isV2
      ? { v2: parsed.data as CrmActivateBodyV2, locale }
      : { bindings: (parsed.data as CrmActivateBody).bindings ?? {}, locale },
  );
  if (!result.ok && result.status === 400) {
    return NextResponse.json({ error: "Requête invalide", code: result.code }, { status: 400 });
  }
  if (!result.ok && result.status === 403) {
    return NextResponse.json({ error: "Accès refusé", code: result.code }, { status: 403 });
  }
  if (!result.ok && result.status === 409) {
    return NextResponse.json({ error: "Nom déjà pris", code: result.code, role: result.role }, { status: 409 });
  }
  if (!result.ok) return NextResponse.json({ error: "Introuvable" }, { status: 404 });
  return NextResponse.json({
    enabled: true,
    reactivated: result.reactivated,
    created: result.created,
    completed: result.completed,
    unlinkedRelations: result.unlinkedRelations,
    automationsCreated: result.automationsCreated,
    automationsSkipped: result.automationsSkipped,
    statusOptionsAdded: result.statusOptionsAdded,
  });
}
