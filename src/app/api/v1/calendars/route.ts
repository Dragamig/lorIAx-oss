import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { calendars } from "@/lib/db/schema";
import { inArray } from "drizzle-orm";
import { authenticateApiRequest } from "@/lib/api/auth-api";
import { apiSuccess, apiError } from "@/lib/api/response";
import { hasScope } from "@/lib/auth/api-key";
import { getAccessibleCalendarIds } from "@/lib/calendar/permissions";

export async function GET(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if ("error" in auth) return auth.error;

  const { user } = auth;

  // Check scope
  if (user.scopes && !hasScope(user.scopes, "calendars:read")) {
    return apiError("Scope calendars:read requis", 403);
  }

  // Cloisonnement multi-tenant : calendriers accessibles confinés à l'org de la clé API.
  const ids = await getAccessibleCalendarIds(
    { id: user.id, email: user.email, name: user.name, globalRole: user.globalRole, capabilities: user.capabilities },
    user.orgId
  );
  if (ids.length === 0) return apiSuccess([]);

  const rows = await db.select().from(calendars).where(inArray(calendars.id, ids));
  return apiSuccess(rows.sort((a, b) => a.name.localeCompare(b.name)));
}

export async function POST(request: NextRequest) {
  const auth = await authenticateApiRequest(request);
  if ("error" in auth) return auth.error;

  const { user } = auth;

  if (user.scopes && !hasScope(user.scopes, "calendars:write")) {
    return apiError("Scope calendars:write requis", 403);
  }

  const body = await request.json();
  const { name, description, color, timezone } = body;

  if (!name) return apiError("name requis");

  const slugify = (await import("slugify")).default;
  const crypto = await import("crypto");
  const baseSlug = slugify(name, { lower: true, strict: true });
  const caldavSlug = `${baseSlug}-${crypto.randomBytes(4).toString("hex")}`;

  const [calendar] = await db
    .insert(calendars)
    .values({
      name,
      description,
      color: color || "#3b82f6",
      timezone: timezone || "Europe/Paris",
      type: "personal",
      ownerUserId: user.id,
      caldavSlug,
    })
    .returning();

  return apiSuccess(calendar, undefined, 201);
}
