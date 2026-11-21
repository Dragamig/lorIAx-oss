import { db } from "@/lib/db";
import {
  calendars,
  calendarEvents,
  calendarEventAttendees,
  users,
} from "@/lib/db/schema";
import { eq, and, or, isNull } from "drizzle-orm";
import { generateICalendar } from "@/lib/calendar/ical";
import { checkCalendarAccess } from "@/lib/calendar/permissions";
import { getRequestOrgId } from "@/lib/org/get-request-org";
import {
  AUTH_ACCOUNT_TIERS,
  AUTH_FAILURE_TIERS,
  AUTH_IP_TIERS,
  authIdentityBucket,
  consumeQuota,
  getClientIpOrNull,
  ipKeyPart,
  peekQuotaExceeded,
  resetQuota,
} from "@/lib/rate-limit";
import { hasScope, type ApiKeyScope } from "@/lib/auth/api-key";
import type { SessionUser, UserCapability } from "@/types";
import crypto from "crypto";

// ---------------------------------------------------------------------------
// CalDAV XML helpers
// ---------------------------------------------------------------------------

const DAV = "DAV:";
const CALDAV = "urn:ietf:params:xml:ns:caldav";
const CS = "http://calendarserver.org/ns/";

function xmlTag(ns: string, tag: string, content: string, attrs = ""): string {
  const prefix = ns === DAV ? "D" : ns === CALDAV ? "C" : "CS";
  return `<${prefix}:${tag}${attrs}>${content}</${prefix}:${tag}>`;
}

function xmlSelfClose(ns: string, tag: string): string {
  const prefix = ns === DAV ? "D" : ns === CALDAV ? "C" : "CS";
  return `<${prefix}:${tag}/>`;
}

function wrapMultistatus(body: string): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<D:multistatus xmlns:D="${DAV}" xmlns:C="${CALDAV}" xmlns:CS="${CS}">`,
    body,
    "</D:multistatus>",
  ].join("\n");
}

function wrapResponse(href: string, propstats: string): string {
  return xmlTag(DAV, "response", xmlTag(DAV, "href", href) + propstats);
}

function propstatOk(props: string): string {
  return xmlTag(
    DAV,
    "propstat",
    xmlTag(DAV, "prop", props) +
      xmlTag(DAV, "status", "HTTP/1.1 200 OK")
  );
}

function _propstatNotFound(props: string): string {
  return xmlTag(
    DAV,
    "propstat",
    xmlTag(DAV, "prop", props) +
      xmlTag(DAV, "status", "HTTP/1.1 404 Not Found")
  );
}

// ---------------------------------------------------------------------------
// Compute ETag / CTag
// ---------------------------------------------------------------------------

function computeETag(event: { uid: string; sequence: number; updatedAt: Date }): string {
  const data = `${event.uid}-${event.sequence}-${event.updatedAt.toISOString()}`;
  return `"${crypto.createHash("md5").update(data).digest("hex")}"`;
}

function computeCTag(dates: Date[]): string {
  if (dates.length === 0) return '"empty"';
  const latest = dates.reduce((a, b) => (a > b ? a : b));
  return `"${latest.getTime()}"`;
}

// ---------------------------------------------------------------------------
// Auth helper — Basic Auth for CalDAV
// ---------------------------------------------------------------------------

/**
 * Frein de bruteforce de la voie CalDAV : on ne fait PAS payer le succès.
 *
 * AZ-23 : ce chemin accepte le mot de passe COMPLET du compte et n'avait aucun
 * frein, alors que le formulaire de connexion, lui, en a un (AZ-04). Il offrait
 * donc un bruteforce hors de portée de la surveillance du formulaire.
 *
 * La première version consommait un jeton à CHAQUE requête, avant même la
 * vérification du mot de passe, avec des paliers de 5 par minute, 10 par quart
 * d'heure et 20 par heure. Elle verrouillait de vrais clients. Il faut pour le
 * voir regarder la forme réelle du protocole, telle que la sert
 * `src/app/api/caldav/[...path]/route.ts` : toutes les méthodes sauf la
 * découverte OPTIONS passent par `authenticateCalDAV`, et un client de bureau
 * ou de téléphone enchaîne, à chaque cycle de synchronisation, un PROPFIND sur
 * le principal, un PROPFIND sur la maison de calendriers, un PROPFIND de
 * propriétés (dont le CTag) sur chaque calendrier, un REPORT de synchronisation
 * puis un GET par événement modifié. Cinq requêtes authentifiées par cycle est
 * un plancher, pas un pic. Un envoi initial, lui, fait un PUT PAR ÉVÉNEMENT :
 * un agenda de cent entrées, c'est cent requêtes authentifiées en rafale. Avec
 * une synchronisation toutes les quinze minutes, le palier horaire de vingt
 * tombait dès la première heure, et le palier par adresse ne rattrapait rien
 * puisqu'il était du même ordre.
 *
 * Le frein ne compte donc QUE les échecs d'authentification, et un succès remet
 * les seaux du compte à zéro. Un client qui présente des identifiants valides
 * peut enchaîner autant de requêtes que le protocole en demande ; un attaquant
 * qui se trompe reste bloqué. Les paliers eux-mêmes sont ceux de la connexion,
 * partagés avec elle (`AUTH_FAILURE_TIERS`, `AUTH_ACCOUNT_TIERS`,
 * `AUTH_IP_TIERS`) : une règle de sécurité recopiée diverge.
 *
 * Le déni de service processeur reste fermé : la consultation des seaux est
 * faite AVANT la lecture en base et avant le calcul bcrypt, et chaque échec
 * consomme un jeton. Cinq calculs bcrypt par minute et par couple compte plus
 * adresse en est le plafond.
 */

/**
 * Scopes qui ouvrent la voie CalDAV à une clé d'API.
 *
 * AZ-23 : toute clé valide était acceptée, quels que soient ses scopes. Une clé
 * créée avec le seul scope `search` donnait donc un accès complet au
 * calendrier. CalDAV expose au minimum la lecture des calendriers : le scope
 * `calendars:read` est exigé, `calendars:write` valant permission plus large.
 */
const CALDAV_SCOPES: readonly ApiKeyScope[] = ["calendars:read", "calendars:write"];

/** Les clés de quota d'une tentative d'authentification CalDAV. */
function caldavQuotaKeys(identity: string, ip: string | null) {
  const bucket = authIdentityBucket(identity);
  return {
    couple: `caldav:acct:${bucket}:${ipKeyPart(ip)}`,
    account: `caldav:acct:${bucket}`,
    ip: ip ? `caldav:${ipKeyPart(ip)}` : null,
  };
}

/** Consultation seule : aucun jeton consommé, donc un succès ne coûte rien. */
async function isCalDavQuotaExceeded(identity: string, ip: string | null): Promise<boolean> {
  const keys = caldavQuotaKeys(identity, ip);
  if (await peekQuotaExceeded(keys.couple, AUTH_FAILURE_TIERS)) return true;
  if (await peekQuotaExceeded(keys.account, AUTH_ACCOUNT_TIERS)) return true;
  if (keys.ip && (await peekQuotaExceeded(keys.ip, AUTH_IP_TIERS))) return true;
  return false;
}

/** Comptabilise un échec d'authentification CalDAV. */
async function recordCalDavFailure(identity: string, ip: string | null): Promise<void> {
  const keys = caldavQuotaKeys(identity, ip);
  await consumeQuota(keys.couple, AUTH_FAILURE_TIERS);
  await consumeQuota(keys.account, AUTH_ACCOUNT_TIERS);
  if (keys.ip) await consumeQuota(keys.ip, AUTH_IP_TIERS);
}

/**
 * Remet à zéro les seaux du compte après une authentification réussie. Le seau
 * par adresse seule n'est pas effacé : un attaquant disposant d'un compte à lui
 * pourrait sinon nettoyer son compteur d'échecs entre deux salves.
 */
async function resetCalDavQuota(identity: string, ip: string | null): Promise<void> {
  const keys = caldavQuotaKeys(identity, ip);
  await resetQuota(keys.couple, AUTH_FAILURE_TIERS);
  await resetQuota(keys.account, AUTH_ACCOUNT_TIERS);
}

/**
 * Authentification de la voie CalDAV, en authentification basique ou par clé
 * d'API.
 *
 * Trois gardes, absentes avant AZ-23 :
 *  - un frein de bruteforce, consulté AVANT la lecture en base et avant le
 *    calcul bcrypt, sur la variante asynchrone donc sur le compteur partagé
 *    (AZ-26), et qui ne compte que les échecs (voir plus haut) ;
 *  - le respect de `mustResetPassword` : un compte dont le mot de passe doit
 *    être changé n'a pas d'accès applicatif, il n'a aucune raison d'en avoir un
 *    par CalDAV, qui serait précisément le contournement de la contrainte ;
 *  - l'exigence d'un scope de calendrier sur le chemin par clé d'API.
 *
 * L'adresse IP est lue par `getClientIpOrNull` : sans en-tête exploitable elle
 * vaut absence, et le seau porte alors la marque `noip`, distincte de celle des
 * clients identifiés. Compter la constante « adresse inconnue » comme une
 * adresse ferait de quelques échecs de n'importe qui un déni de service global
 * (AZ-25).
 */
export async function authenticateCalDAV(
  request: Request
): Promise<SessionUser | null> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;

  const ip = getClientIpOrNull(request);

  // Basic Auth
  if (authHeader.startsWith("Basic ")) {
    const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf-8");
    const separator = decoded.indexOf(":");
    if (separator <= 0) return null;
    const email = decoded.slice(0, separator).toLowerCase();
    const password = decoded.slice(separator + 1);
    if (!email || !password) return null;

    if (await isCalDavQuotaExceeded(email, ip)) return null;

    const bcrypt = (await import("bcryptjs")).default;
    const user = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (user.length === 0 || !user[0].passwordHash) {
      await recordCalDavFailure(email, ip);
      return null;
    }
    const valid = await bcrypt.compare(password, user[0].passwordHash);
    if (!valid) {
      await recordCalDavFailure(email, ip);
      return null;
    }

    // Le mot de passe était juste : ce n'est pas un échec d'authentification,
    // le seau n'a pas à s'en nourrir. Le refus tient à la contrainte de
    // changement de mot de passe, que rien ne permet de contourner en insistant.
    await resetCalDavQuota(email, ip);
    if (user[0].mustResetPassword) return null;

    return {
      id: user[0].id,
      email: user[0].email,
      name: user[0].name,
      globalRole: user[0].globalRole as SessionUser["globalRole"],
      capabilities: (user[0].capabilities ?? []) as UserCapability[],
      avatarUrl: user[0].avatarUrl,
    };
  }

  // Bearer token (API key)
  if (authHeader.startsWith("Bearer ")) {
    const apiKey = authHeader.slice(7);
    // La clé elle-même tient lieu d'identité : un client synchronisant avec une
    // clé valide ne consomme rien, une clé refusée nourrit son propre seau.
    if (await isCalDavQuotaExceeded(apiKey, ip)) return null;

    const { resolveApiKey } = await import("@/lib/auth/api-key");
    const resolved = await resolveApiKey(apiKey);
    if (!resolved) {
      await recordCalDavFailure(apiKey, ip);
      return null;
    }

    const scopes = resolved.scopes ?? [];
    if (!CALDAV_SCOPES.some((scope) => hasScope(scopes, scope))) {
      await recordCalDavFailure(apiKey, ip);
      return null;
    }

    const user = await db
      .select()
      .from(users)
      .where(eq(users.id, resolved.userId))
      .limit(1);

    if (user.length === 0) {
      await recordCalDavFailure(apiKey, ip);
      return null;
    }
    await resetCalDavQuota(apiKey, ip);
    if (user[0].mustResetPassword) return null;
    return {
      id: user[0].id,
      email: user[0].email,
      name: user[0].name,
      globalRole: user[0].globalRole as SessionUser["globalRole"],
      capabilities: (user[0].capabilities ?? []) as UserCapability[],
      avatarUrl: user[0].avatarUrl,
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Organisation de la requête CalDAV
// ---------------------------------------------------------------------------

/**
 * Organisation de la requête CalDAV, pour le cloisonnement multi-tenant.
 *
 * La voie CalDAV n'a ni session NextAuth ni contexte applicatif : elle
 * s'authentifie en Basic Auth ou par clé d'API. Elle a en revanche un
 * sous-domaine, et le proxy (`src/proxy.ts`) injecte `x-org-slug` sur
 * `/api/caldav/**` exactement comme sur les autres routes d'API. L'organisation
 * est donc lisible ici par le chemin normal du produit, `getRequestOrgId`, qui
 * applique le contrôle d'appartenance et rend `null` si l'organisation est
 * introuvable, inactive, ou si le compte n'en est pas membre.
 *
 * Aucun repli permissif n'est inventé : hors contexte de requête Next
 * (`headers()` indisponible), on rend `null`, et `checkCalendarAccess` traduit
 * ce `null` en refus. Un client de bureau sur l'apex tombe sur l'organisation
 * partagée par défaut et garde ses calendriers personnels (org-neutres) ; sur
 * `acme.example.com`, il ne voit que les calendriers d'`acme`.
 */
async function caldavOrgId(user: SessionUser): Promise<string | null> {
  try {
    return await getRequestOrgId(user);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Parse CalDAV path
// ---------------------------------------------------------------------------

interface CalDAVPath {
  type: "principal" | "home" | "calendar" | "event" | "unknown";
  principalId?: string; // userId
  calendarSlug?: string;
  eventFilename?: string; // e.g. "uid@loriax.ics"
}

export function parseCalDAVPath(pathSegments: string[]): CalDAVPath {
  // /caldav/:principalId/
  // /caldav/:principalId/:calendarSlug/
  // /caldav/:principalId/:calendarSlug/:eventFilename.ics

  if (pathSegments.length === 0) {
    return { type: "unknown" };
  }

  const principalId = pathSegments[0];

  if (pathSegments.length === 1) {
    return { type: "principal", principalId };
  }

  const calendarSlug = pathSegments[1];

  if (pathSegments.length === 2) {
    return { type: calendarSlug === "" ? "home" : "calendar", principalId, calendarSlug };
  }

  const eventFilename = pathSegments[2];
  if (eventFilename.endsWith(".ics")) {
    return { type: "event", principalId, calendarSlug, eventFilename };
  }

  return { type: "unknown", principalId, calendarSlug };
}

// ---------------------------------------------------------------------------
// PROPFIND handler
// ---------------------------------------------------------------------------

export async function handlePropfind(
  user: SessionUser,
  path: CalDAVPath,
  _body: string,
  baseUrl: string
): Promise<{ status: number; body: string }> {
  const caldavBase = `${baseUrl}/api/caldav`;

  if (path.type === "principal") {
    // Return principal resource + calendar-home-set
    const responses = wrapResponse(
      `${caldavBase}/${path.principalId}/`,
      propstatOk(
        xmlTag(DAV, "displayname", user.name) +
          xmlTag(DAV, "resourcetype", xmlSelfClose(DAV, "principal")) +
          xmlTag(
            CALDAV,
            "calendar-home-set",
            xmlTag(DAV, "href", `${caldavBase}/${path.principalId}/`)
          )
      )
    );
    return { status: 207, body: wrapMultistatus(responses) };
  }

  if (path.type === "home" || (path.type === "calendar" && !path.calendarSlug)) {
    // Calendriers du compte, confinés à l'organisation de la requête : les
    // siens dans cette organisation, plus ses calendriers personnels
    // (org-neutres). Même couple que `getAccessibleCalendarIds` et que
    // `checkCalendarAccess`, pour qu'un client ne puisse pas monter un
    // calendrier d'un autre tenant qui lui serait ensuite refusé.
    const orgId = await caldavOrgId(user);
    const userCalendars = orgId
      ? await db
          .select()
          .from(calendars)
          .where(
            and(
              eq(calendars.ownerUserId, user.id),
              or(eq(calendars.organizationId, orgId), isNull(calendars.organizationId))
            )
          )
      : [];

    let responses = wrapResponse(
      `${caldavBase}/${path.principalId}/`,
      propstatOk(
        xmlTag(DAV, "displayname", "Calendriers") +
          xmlTag(
            DAV,
            "resourcetype",
            xmlSelfClose(DAV, "collection")
          )
      )
    );

    for (const cal of userCalendars) {
      const events = await db
        .select({ updatedAt: calendarEvents.updatedAt })
        .from(calendarEvents)
        .where(eq(calendarEvents.calendarId, cal.id));

      const ctag = computeCTag(events.map((e) => e.updatedAt));

      responses += wrapResponse(
        `${caldavBase}/${path.principalId}/${cal.caldavSlug}/`,
        propstatOk(
          xmlTag(DAV, "displayname", cal.name) +
            xmlTag(
              DAV,
              "resourcetype",
              xmlSelfClose(DAV, "collection") +
                xmlSelfClose(CALDAV, "calendar")
            ) +
            xmlTag(CS, "getctag", ctag) +
            xmlTag(
              CALDAV,
              "supported-calendar-component-set",
              `<C:comp name="VEVENT"/>`
            ) +
            xmlTag(
              CALDAV,
              "calendar-timezone",
              cal.timezone
            ) +
            xmlTag(
              DAV,
              "supported-report-set",
              xmlTag(DAV, "supported-report", xmlTag(DAV, "report", xmlSelfClose(CALDAV, "calendar-multiget"))) +
                xmlTag(DAV, "supported-report", xmlTag(DAV, "report", xmlSelfClose(CALDAV, "calendar-query")))
            )
        )
      );
    }

    return { status: 207, body: wrapMultistatus(responses) };
  }

  if (path.type === "calendar" && path.calendarSlug) {
    // List events in calendar
    const cal = await db
      .select()
      .from(calendars)
      .where(eq(calendars.caldavSlug, path.calendarSlug!))
      .limit(1);

    if (cal.length === 0) return { status: 404, body: "Calendar not found" };

    const hasAccess = await checkCalendarAccess(user.id, cal[0].id, "read", await caldavOrgId(user));
    if (!hasAccess) return { status: 403, body: "Forbidden" };

    const events = await db
      .select()
      .from(calendarEvents)
      .where(eq(calendarEvents.calendarId, cal[0].id));

    const ctag = computeCTag(events.map((e) => e.updatedAt));

    let responses = wrapResponse(
      `${caldavBase}/${path.principalId}/${path.calendarSlug}/`,
      propstatOk(
        xmlTag(DAV, "displayname", cal[0].name) +
          xmlTag(
            DAV,
            "resourcetype",
            xmlSelfClose(DAV, "collection") +
              xmlSelfClose(CALDAV, "calendar")
          ) +
          xmlTag(CS, "getctag", ctag)
      )
    );

    for (const event of events) {
      const etag = computeETag(event);
      responses += wrapResponse(
        `${caldavBase}/${path.principalId}/${path.calendarSlug}/${event.uid}.ics`,
        propstatOk(
          xmlTag(DAV, "getetag", etag) +
            xmlTag(DAV, "getcontenttype", "text/calendar; charset=utf-8")
        )
      );
    }

    return { status: 207, body: wrapMultistatus(responses) };
  }

  return { status: 404, body: "Not found" };
}

// ---------------------------------------------------------------------------
// REPORT handler (calendar-query, calendar-multiget)
// ---------------------------------------------------------------------------

export async function handleReport(
  user: SessionUser,
  path: CalDAVPath,
  _body: string,
  baseUrl: string
): Promise<{ status: number; body: string }> {
  const caldavBase = `${baseUrl}/api/caldav`;

  if (path.type !== "calendar" || !path.calendarSlug) {
    return { status: 400, body: "REPORT only supported on calendar collections" };
  }

  const cal = await db
    .select()
    .from(calendars)
    .where(eq(calendars.caldavSlug, path.calendarSlug))
    .limit(1);

  if (cal.length === 0) return { status: 404, body: "Calendar not found" };

  const hasAccess = await checkCalendarAccess(user.id, cal[0].id, "read", await caldavOrgId(user));
  if (!hasAccess) return { status: 403, body: "Forbidden" };

  const events = await db
    .select()
    .from(calendarEvents)
    .where(eq(calendarEvents.calendarId, cal[0].id));

  // Fetch attendees for all events
  const eventIds = events.map((e) => e.id);
  let allAttendees: (typeof calendarEventAttendees.$inferSelect)[] = [];
  if (eventIds.length > 0) {
    const { inArray } = await import("drizzle-orm");
    allAttendees = await db
      .select()
      .from(calendarEventAttendees)
      .where(inArray(calendarEventAttendees.eventId, eventIds));
  }

  const attendeesByEvent = new Map<string, typeof allAttendees>();
  for (const a of allAttendees) {
    const list = attendeesByEvent.get(a.eventId) || [];
    list.push(a);
    attendeesByEvent.set(a.eventId, list);
  }

  let responses = "";
  for (const event of events) {
    const etag = computeETag(event);
    const eventWithAttendees = {
      ...event,
      attendees: attendeesByEvent.get(event.id) || [],
    };
    const icsData = generateICalendar(cal[0].name, [eventWithAttendees]);

    responses += wrapResponse(
      `${caldavBase}/${path.principalId}/${path.calendarSlug}/${event.uid}.ics`,
      propstatOk(
        xmlTag(DAV, "getetag", etag) +
          xmlTag(CALDAV, "calendar-data", escapeXml(icsData))
      )
    );
  }

  return { status: 207, body: wrapMultistatus(responses) };
}

// ---------------------------------------------------------------------------
// GET single .ics event
// ---------------------------------------------------------------------------

export async function handleGetEvent(
  user: SessionUser,
  path: CalDAVPath
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  if (path.type !== "event" || !path.calendarSlug || !path.eventFilename) {
    return { status: 404, body: "Not found", headers: {} };
  }

  const cal = await db
    .select()
    .from(calendars)
    .where(eq(calendars.caldavSlug, path.calendarSlug))
    .limit(1);

  if (cal.length === 0) return { status: 404, body: "Calendar not found", headers: {} };

  const hasAccess = await checkCalendarAccess(user.id, cal[0].id, "read", await caldavOrgId(user));
  if (!hasAccess) return { status: 403, body: "Forbidden", headers: {} };

  const uid = path.eventFilename.replace(/\.ics$/, "");
  const event = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.calendarId, cal[0].id),
        eq(calendarEvents.uid, uid)
      )
    )
    .limit(1);

  if (event.length === 0) return { status: 404, body: "Event not found", headers: {} };

  const attendees = await db
    .select()
    .from(calendarEventAttendees)
    .where(eq(calendarEventAttendees.eventId, event[0].id));

  const icsData = generateICalendar(cal[0].name, [
    { ...event[0], attendees },
  ]);

  const etag = computeETag(event[0]);

  return {
    status: 200,
    body: icsData,
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      ETag: etag,
    },
  };
}

// ---------------------------------------------------------------------------
// PUT — create or update event from .ics
// ---------------------------------------------------------------------------

export async function handlePutEvent(
  user: SessionUser,
  path: CalDAVPath,
  body: string
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  if (path.type !== "event" || !path.calendarSlug || !path.eventFilename) {
    return { status: 404, body: "Not found", headers: {} };
  }

  const cal = await db
    .select()
    .from(calendars)
    .where(eq(calendars.caldavSlug, path.calendarSlug))
    .limit(1);

  if (cal.length === 0) return { status: 404, body: "Calendar not found", headers: {} };

  const hasAccess = await checkCalendarAccess(user.id, cal[0].id, "write", await caldavOrgId(user));
  if (!hasAccess) return { status: 403, body: "Forbidden", headers: {} };

  const { parseICalendar } = await import("@/lib/calendar/ical");
  const parsed = parseICalendar(body);
  if (parsed.length === 0) {
    return { status: 400, body: "No VEVENT found in body", headers: {} };
  }

  const eventData = parsed[0];
  const uid = path.eventFilename.replace(/\.ics$/, "");

  // Check if event exists
  const existing = await db
    .select()
    .from(calendarEvents)
    .where(
      and(
        eq(calendarEvents.calendarId, cal[0].id),
        eq(calendarEvents.uid, uid)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    // Update
    const [updated] = await db
      .update(calendarEvents)
      .set({
        title: eventData.title,
        description: eventData.description,
        location: eventData.location,
        startAt: eventData.startAt,
        endAt: eventData.endAt || eventData.startAt,
        allDay: eventData.allDay,
        recurrenceRule: eventData.recurrenceRule,
        recurrenceExceptions: eventData.recurrenceExceptions
          ? JSON.stringify(eventData.recurrenceExceptions)
          : "[]",
        status: eventData.status || "confirmed",
        visibility: eventData.visibility || "public",
        sequence: (eventData.sequence ?? existing[0].sequence) + 1,
        updatedAt: new Date(),
      })
      .where(eq(calendarEvents.id, existing[0].id))
      .returning();

    const etag = computeETag(updated);
    return { status: 204, body: "", headers: { ETag: etag } };
  }

  // Create
  const [created] = await db
    .insert(calendarEvents)
    .values({
      calendarId: cal[0].id,
      title: eventData.title,
      description: eventData.description,
      location: eventData.location,
      startAt: eventData.startAt,
      endAt: eventData.endAt || eventData.startAt,
      allDay: eventData.allDay,
      recurrenceRule: eventData.recurrenceRule,
      recurrenceExceptions: eventData.recurrenceExceptions
        ? JSON.stringify(eventData.recurrenceExceptions)
        : "[]",
      status: eventData.status || "confirmed",
      visibility: eventData.visibility || "public",
      sequence: eventData.sequence || 0,
      progress: eventData.progress || 0,
      uid,
      createdBy: user.id,
    })
    .returning();

  const etag = computeETag(created);
  return { status: 201, body: "", headers: { ETag: etag } };
}

// ---------------------------------------------------------------------------
// DELETE event
// ---------------------------------------------------------------------------

export async function handleDeleteEvent(
  user: SessionUser,
  path: CalDAVPath
): Promise<{ status: number; body: string }> {
  if (path.type !== "event" || !path.calendarSlug || !path.eventFilename) {
    return { status: 404, body: "Not found" };
  }

  const cal = await db
    .select()
    .from(calendars)
    .where(eq(calendars.caldavSlug, path.calendarSlug))
    .limit(1);

  if (cal.length === 0) return { status: 404, body: "Calendar not found" };

  const hasAccess = await checkCalendarAccess(user.id, cal[0].id, "write", await caldavOrgId(user));
  if (!hasAccess) return { status: 403, body: "Forbidden" };

  const uid = path.eventFilename.replace(/\.ics$/, "");
  const deleted = await db
    .delete(calendarEvents)
    .where(
      and(
        eq(calendarEvents.calendarId, cal[0].id),
        eq(calendarEvents.uid, uid)
      )
    )
    .returning();

  if (deleted.length === 0) return { status: 404, body: "Event not found" };
  return { status: 204, body: "" };
}

// ---------------------------------------------------------------------------
// OPTIONS handler
// ---------------------------------------------------------------------------

export function handleOptions(): { status: number; headers: Record<string, string> } {
  return {
    status: 200,
    headers: {
      Allow: "OPTIONS, GET, PUT, DELETE, PROPFIND, REPORT",
      DAV: "1, 2, calendar-access",
      "Access-Control-Allow-Methods": "OPTIONS, GET, PUT, DELETE, PROPFIND, REPORT",
      "Access-Control-Allow-Headers": "Authorization, Content-Type, Depth, If-Match, If-None-Match",
    },
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
