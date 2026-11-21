import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { db } from "@/lib/db";
import { spreadsheetData, spaces } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import { getAccessibleSpaceIds } from "@/lib/auth/check-access";
import logger from "@/lib/logger";
import { fortuneSheetsToWorkbookData } from "@/lib/spreadsheet/fortune-to-univer";

type Params = { params: Promise<{ sheetId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { sheetId } = await params;

  try {
    const [row] = await db
      .select({ data: spreadsheetData.data, spaceId: spreadsheetData.spaceId })
      .from(spreadsheetData)
      .where(eq(spreadsheetData.sheetId, sheetId))
      .limit(1);

    if (!row) {
      return NextResponse.json({ error: "Tableur introuvable" }, { status: 404 });
    }

    // Fail-closed : un tableur sans espace de rattachement n'est contrôlable par
    // aucun accès, il n'est donc lisible par personne (auparavant : lisible par
    // tout utilisateur authentifié, y compris d'une autre organisation).
    if (!row.spaceId) {
      return NextResponse.json({ error: "Tableur introuvable" }, { status: 404 });
    }

    // Le tableur est rattaché à un espace : l'utilisateur doit y avoir accès
    // dans l'org courante (anti-fuite cross-tenant).
    const accessible = await getAccessibleSpaceIds(user);
    if (!accessible.includes(row.spaceId)) {
      return NextResponse.json({ error: "Tableur introuvable" }, { status: 404 });
    }

    const parsed = JSON.parse(row.data);
    const data = Array.isArray(parsed)
      ? fortuneSheetsToWorkbookData(parsed)
      : parsed;
    return NextResponse.json({ data });
  } catch (error) {
    logger.error({ err: error }, "[spreadsheet] GET error");
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: Params) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  }

  const { sheetId } = await params;
  const body = await req.json();
  const { data, spaceId } = body;

  if (!data || (typeof data !== "object" && !Array.isArray(data))) {
    return NextResponse.json({ error: "data invalide" }, { status: 400 });
  }

  try {
    // Si c'est encore du Fortune Sheet (tableau), convertir avant stockage
    const toStore = Array.isArray(data) ? fortuneSheetsToWorkbookData(data) : data;
    const serialized = JSON.stringify(toStore);

    const [existing] = await db
      .select({ spaceId: spreadsheetData.spaceId })
      .from(spreadsheetData)
      .where(eq(spreadsheetData.sheetId, sheetId))
      .limit(1);

    // Le rattachement à un espace est la seule prise de contrôle d'accès sur un
    // tableur : il est donc obligatoire, en création comme en mise à jour.
    // Pour une ligne existante, le spaceId stocké fait foi (pas de reparentage
    // via le corps de la requête).
    const effectiveSpaceId = existing ? existing.spaceId : (spaceId ?? null);

    if (!effectiveSpaceId) {
      // Création sans espace, ou ligne héritée sans espace (fail-closed).
      return NextResponse.json(
        existing
          ? { error: "Accès refusé" }
          : { error: "spaceId requis" },
        { status: existing ? 403 : 400 }
      );
    }

    // L'espace doit appartenir à l'org courante ET être accessible à
    // l'utilisateur (anti-fuite cross-tenant : pas de tableur greffé sur
    // l'espace d'un autre tenant, pas d'écrasement d'un tableur d'autrui).
    const orgId = await getRequestOrgId(user);
    if (!orgId) {
      return NextResponse.json({ error: "Espace introuvable" }, { status: 404 });
    }
    const [space] = await db
      .select({ id: spaces.id })
      .from(spaces)
      .where(and(eq(spaces.id, effectiveSpaceId), eq(spaces.organizationId, orgId)))
      .limit(1);
    if (!space) {
      return NextResponse.json({ error: "Espace introuvable" }, { status: 404 });
    }

    const accessible = await getAccessibleSpaceIds(user);
    if (!accessible.includes(effectiveSpaceId)) {
      return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
    }

    await db
      .insert(spreadsheetData)
      .values({
        sheetId,
        spaceId: effectiveSpaceId,
        data: serialized,
      })
      .onConflictDoUpdate({
        target: spreadsheetData.sheetId,
        set: {
          spaceId: effectiveSpaceId,
          data: serialized,
          updatedAt: new Date(),
        },
      });

    return NextResponse.json({ ok: true });
  } catch (error) {
    logger.error({ err: error }, "[spreadsheet] PUT error");
    return NextResponse.json({ error: "Erreur serveur" }, { status: 500 });
  }
}
