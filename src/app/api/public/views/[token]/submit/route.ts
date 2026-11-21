import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { eq, and, sql } from "drizzle-orm";
import {
  userDatabaseViews,
  userDatabaseColumns,
  userDatabaseRows,
} from "@/lib/db/schema";
import { tryAllowSubmission } from "@/lib/bases/public-form-rate-limit";
import { isCaptchaEnabled, verifyHCaptcha } from "@/lib/bases/public-form-captcha";
import { dispatchRowEvents } from "@/lib/automations/dispatch-row-events";
import { getClientIpOrNull } from "@/lib/rate-limit";
import { assertMediaCells, MediaCellError } from "@/lib/databases/attachment-cell-guard";
import { setRowChangeContext } from "@/lib/databases/row-change-context";

type RouteParams = { params: Promise<{ token: string }> };

/**
 * POST /api/public/views/[token]/submit
 *
 * Endpoint NON authentifié — crée une ligne dans la base associée à une vue
 * form publique.
 *
 * Siloing (R6 du spec) :
 *  - On ne lit la vue QUE par token + isPublic=true. Si quelqu'un essaie
 *    avec un token bidon → 410 Gone (jamais 404 pour ne pas distinguer
 *    "n'existe pas" de "existe mais privé").
 *  - La réponse ne contient AUCUNE info sur l'org/space/userId.
 *  - Pas d'accès aux rows existantes (juste insert).
 *
 * Anti-bot :
 *  - Honey pot field `_hp` (vide attendu)
 *  - Rate-limit 10 / IP / token / heure (Redis si REDIS_URL, sinon in-memory),
 *    l'adresse étant extraite par `getClientIpOrNull`, donc non falsifiable
 *  - hCaptcha optionnel (activé si HCAPTCHA_SECRET défini)
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  const { token } = await params;

  if (!token || token.length < 32) {
    return NextResponse.json({ error: "Lien invalide" }, { status: 410 });
  }

  // AZ-25 : l'adresse était lue dans le PREMIER élément de `x-forwarded-for`,
  // c'est-à-dire la partie que le client écrit lui-même. Un robot y mettait une
  // valeur différente à chaque requête, changeait donc de seau à chaque appel,
  // et ni le plafond horaire ni le captcha ne freinaient quoi que ce soit.
  // `getClientIpOrNull` prend la valeur de DROITE, celle qu'ajoute le proxy de
  // confiance, et rend `null` plutôt qu'une constante commune quand aucune
  // adresse n'est déterminable.
  const ip = getClientIpOrNull(request);

  if (!(await tryAllowSubmission(ip, token))) {
    return NextResponse.json(
      { error: "Trop de soumissions, réessayez dans une heure" },
      { status: 429 }
    );
  }

  const body = await request.json().catch(() => ({}));
  const cells = (body?.cells ?? {}) as Record<string, unknown>;
  const honey = body?._hp;
  const captchaToken = typeof body?.captchaToken === "string" ? body.captchaToken : undefined;

  // Honey pot : si rempli, on accepte silencieusement (200 OK) mais on ne
  // fait rien — empêche le bot de savoir qu'il est détecté
  if (typeof honey === "string" && honey.length > 0) {
    return NextResponse.json({ ok: true });
  }

  // hCaptcha (si configuré côté serveur)
  if (isCaptchaEnabled()) {
    const ok = await verifyHCaptcha(captchaToken, ip ?? undefined);
    if (!ok) {
      return NextResponse.json(
        { error: "Vérification anti-bot échouée — rechargez la page et réessayez" },
        { status: 400 }
      );
    }
  }

  // Récupérer la vue par token (siloing : isPublic obligatoire)
  const [view] = await db
    .select({
      databaseId: userDatabaseViews.databaseId,
      type: userDatabaseViews.type,
    })
    .from(userDatabaseViews)
    .where(
      and(
        eq(userDatabaseViews.publicToken, token),
        eq(userDatabaseViews.isPublic, true),
        eq(userDatabaseViews.scope, "shared"),
      )
    )
    .limit(1);

  if (!view || view.type !== "form") {
    return NextResponse.json({ error: "Formulaire indisponible" }, { status: 410 });
  }

  // Filtrer les cells pour ne garder QUE les colonnes existantes de cette
  // database (évite d'écrire des clés inconnues)
  const columns = await db
    .select({ id: userDatabaseColumns.id, type: userDatabaseColumns.type })
    .from(userDatabaseColumns)
    .where(eq(userDatabaseColumns.databaseId, view.databaseId));

  const validIds = new Set(columns.map((c) => c.id));
  const writableTypes = new Set([
    "text",
    "number",
    "date",
    "select",
    "checkbox",
    "url",
    "email",
    "time",
  ]);
  const validIdToType = new Map(columns.map((c) => [c.id, c.type]));

  const filteredCells: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(cells)) {
    if (!validIds.has(k)) continue;
    const t = validIdToType.get(k);
    if (!t || !writableTypes.has(t)) continue;
    filteredCells[k] = v;
  }

  // Garde des cellules médias : pas d'utilisateur connecté, donc aucune
  // référence à un média existant n'est acceptée. Les colonnes image et pièce
  // jointe ne sont déjà pas écrivables ci-dessus ; ce contrôle protège si la
  // liste évolue.
  try {
    await assertMediaCells(view.databaseId, filteredCells, { user: null, orgId: "" });
  } catch (e) {
    if (e instanceof MediaCellError) {
      return NextResponse.json({ error: "Valeur invalide" }, { status: 400 });
    }
    throw e;
  }

  // Position max + 1
  const [maxPos] = await db
    .select({ max: sql<number>`COALESCE(MAX(${userDatabaseRows.position}), -1)` })
    .from(userDatabaseRows)
    .where(eq(userDatabaseRows.databaseId, view.databaseId));

  // Anonymous submission: no actor, the history entry carries the public_form source.
  const created = await db.transaction(async (tx) => {
    await setRowChangeContext(tx, { source: "public_form" });
    const [row] = await tx
      .insert(userDatabaseRows)
      .values({
        databaseId: view.databaseId,
        cells: filteredCells,
        position: (maxPos?.max ?? -1) + 1,
      })
      .returning({ id: userDatabaseRows.id });
    return row;
  });

  // Déclenche les automations row_created (peut servir à notifier l'équipe
  // qu'une soumission est arrivée)
  dispatchRowEvents({
    databaseId: view.databaseId,
    rowId: created.id,
    before: null,
    after: filteredCells,
  });

  // Réponse minimaliste — ne jamais renvoyer rowId/databaseId au client public
  return NextResponse.json({ ok: true });
}

// Pour le préfetch HEAD éventuel (Cloudflare/CDN healthcheck)
export async function HEAD() {
  return new NextResponse(null, { status: 204 });
}
