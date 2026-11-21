import { NextResponse, type NextRequest } from "next/server";
import { requireCrm } from "@/lib/crm/access";
import { loadConnection, saveConnection, type ResolvedConnection } from "@/lib/crm/connection";
import { bindingsSchema, parseFieldMap } from "@/lib/crm/fields";

const notFound = () => NextResponse.json({ error: "Introuvable" }, { status: 404 });

function payload(conn: ResolvedConnection, canAdmin: boolean) {
  return {
    enabled: true,
    canAdmin,
    roles: conn.roles,
    okTotal: conn.okTotal,
    badTotal: conn.badTotal,
    complete: conn.complete,
  };
}

export async function GET(req: NextRequest) {
  const access = await requireCrm({ level: "member", requireEnabled: true }, req);
  if (!access.ok) return access.response;
  const conn = await loadConnection(access.orgId, access.user.id, "viewer");
  if (!conn) return notFound();
  return NextResponse.json(payload(conn, access.isAdmin));
}

const MESSAGES = {
  column_not_in_database: "Colonne absente de la base choisie",
  duplicate_database: "Une même base ne peut servir qu'un seul rôle",
} as const;

export async function PUT(req: NextRequest) {
  const access = await requireCrm({ level: "admin", requireEnabled: true }, req);
  if (!access.ok) return access.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = undefined;
  }
  const parsed = bindingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Corps invalide", code: "invalid_body" }, { status: 400 });
  }

  const saved = await saveConnection(access.orgId, access.user.id, {
    roles: parsed.data.roles,
    fieldMap: parseFieldMap(parsed.data.fieldMap),
  });
  if (!saved.ok) {
    if (saved.status === 404) return notFound();
    return NextResponse.json(
      { error: MESSAGES[saved.code as keyof typeof MESSAGES] ?? "Requête invalide", code: saved.code },
      { status: 400 },
    );
  }
  const conn = await loadConnection(access.orgId, access.user.id, "viewer");
  if (!conn) return notFound();
  return NextResponse.json(payload(conn, true));
}
