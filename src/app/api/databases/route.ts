import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { userDatabases, userDatabaseColumns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { checkSpaceViewAccess, checkSpaceEditAccess } from "@/lib/auth/check-access";
import { z } from "zod";

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json([], { status: 401 });

  const spaceId = request.nextUrl.searchParams.get("spaceId");
  if (!spaceId) {
    return NextResponse.json(
      { error: "spaceId requis" },
      { status: 400 }
    );
  }

  // Une base est rattachee a un espace : lister les bases d'un espace exige le droit
  // de lecture sur cet espace. Sans ce controle, `?spaceId=` suffisait a enumerer les
  // bases de tous les espaces.
  //
  // Mode `member` et non `app` : `user_databases` ne porte qu'un `spaceId`, jamais de
  // `documentId`. Le contenu d'un bloc base insere dans un document `confidential` ou
  // `secret` n'est donc pas filtrable par classification. Ouvrir la branche « espace
  // d'organisation » servirait ce contenu a tout compte authentifie alors que
  // GET /api/documents/[id] refuse le document qui le porte. Un lien explicite
  // (propriete ou permission) est exige tant que le rattachement `documentId` n'existe pas.
  const canView = await checkSpaceViewAccess(user, spaceId, "member");
  if (!canView) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const result = await db
    .select()
    .from(userDatabases)
    .where(eq(userDatabases.spaceId, spaceId))
    .orderBy(userDatabases.name);

  return NextResponse.json(result);
}

const columnDefSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["text", "number", "date", "select", "checkbox", "relation", "image", "formula", "url", "email"]),
  config: z.record(z.string(), z.any()).optional(),
});

const createSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  spaceId: z.string().uuid(),
  columns: z.array(columnDefSchema).optional(),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Non authentifié" }, { status: 401 });
  }

  const body = await request.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 }
    );
  }

  const { name, description, spaceId, columns } = parsed.data;

  // Verify space access
  const canEdit = await checkSpaceEditAccess(user, spaceId);
  if (!canEdit) {
    return NextResponse.json({ error: "Accès refusé" }, { status: 403 });
  }

  const [database] = await db
    .insert(userDatabases)
    .values({ name, description, spaceId, createdBy: user.id })
    .returning();

  if (columns && columns.length > 0) {
    await db.insert(userDatabaseColumns).values(
      columns.map((col, i) => ({
        databaseId: database.id,
        name: col.name,
        type: col.type,
        config: col.config ?? {},
        position: i,
      }))
    );
  } else {
    await db.insert(userDatabaseColumns).values({
      databaseId: database.id,
      name: "Nom",
      type: "text",
      position: 0,
    });
  }

  return NextResponse.json(database, { status: 201 });
}
