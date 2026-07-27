import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { systemSettings, users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getSessionUser } from "@/lib/auth/get-user";
import { hasGlobalRole } from "@/lib/auth/rbac";

/**
 * Comment l'accès a été accordé à une route /api/setup/*.
 * - "bootstrap"    : instance réellement vierge (aucun utilisateur en base).
 * - "wizard"       : continuation du wizard, prouvée par un ticket signé émis
 *                    au moment où le wizard a créé les premiers comptes.
 * - "super_admin"  : session authentifiée avec le rôle super_admin.
 */
export type SetupAccessMode = "bootstrap" | "wizard" | "super_admin";

export type SetupAccess =
  | { allowed: true; mode: SetupAccessMode }
  | { allowed: false; response: NextResponse };

const WIZARD_TICKET_COOKIE = "setup_wizard_ticket";
const WIZARD_TICKET_PATH = "/api/setup";
/** Durée de vie du ticket de continuation du wizard (60 minutes). */
const WIZARD_TICKET_TTL_MS = 60 * 60 * 1000;

function getTicketSecret(): string | null {
  return process.env.NEXTAUTH_SECRET || null;
}

function signTicket(expiresAt: number, secret: string): string {
  return createHmac("sha256", secret)
    .update(`${WIZARD_TICKET_COOKIE}:${expiresAt}`)
    .digest("hex");
}

function buildTicket(): string | null {
  const secret = getTicketSecret();
  if (!secret) return null;
  const expiresAt = Date.now() + WIZARD_TICKET_TTL_MS;
  return `${expiresAt}.${signTicket(expiresAt, secret)}`;
}

function isTicketValid(rawTicket: string | undefined): boolean {
  if (!rawTicket) return false;

  const secret = getTicketSecret();
  if (!secret) return false;

  const [expiresRaw, signature] = rawTicket.split(".");
  if (!expiresRaw || !signature) return false;

  const expiresAt = Number(expiresRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

  const expected = signTicket(expiresAt, secret);
  const provided = Buffer.from(signature, "hex");
  const reference = Buffer.from(expected, "hex");
  if (provided.length !== reference.length) return false;

  return timingSafeEqual(provided, reference);
}

/** Vrai si le drapeau system_settings.setup_completed est posé. */
export async function isSetupCompleted(): Promise<boolean> {
  const [row] = await db
    .select({ value: systemSettings.value })
    .from(systemSettings)
    .where(eq(systemSettings.key, "setup_completed"))
    .limit(1);

  return row?.value === true;
}

/** Vrai dès qu'au moins un compte existe en base. */
export async function hasAnyUser(): Promise<boolean> {
  const [row] = await db.select({ id: users.id }).from(users).limit(1);
  return Boolean(row);
}

/**
 * Pose le drapeau system_settings.setup_completed.
 * Partagé par /api/setup/complete et /api/setup/skip : les deux ferment le wizard.
 */
export async function markSetupCompleted(): Promise<void> {
  const now = new Date();
  await db
    .insert(systemSettings)
    .values({ key: "setup_completed", value: true, updatedAt: now })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: { value: true, updatedAt: now },
    });
}

/**
 * Garde commune à toutes les routes /api/setup/*.
 *
 * L'accès est libre uniquement si l'instance est réellement vierge : drapeau
 * setup_completed absent ET aucun utilisateur en base. Dès qu'un compte existe,
 * il faut une session authentifiée avec le rôle super_admin, sauf pour le client
 * qui vient de créer les premiers comptes via le wizard et présente le ticket
 * signé émis à ce moment-là (le wizard n'ouvre pas de session).
 *
 * À appeler en tête de chaque handler /api/setup/*.
 */
export async function guardSetupAccess(): Promise<SetupAccess> {
  if (await isSetupCompleted()) {
    return {
      allowed: false,
      response: NextResponse.json(
        { error: "L'instance est déjà configurée" },
        { status: 403 }
      ),
    };
  }

  if (!(await hasAnyUser())) {
    return { allowed: true, mode: "bootstrap" };
  }

  const cookieStore = await cookies();
  if (isTicketValid(cookieStore.get(WIZARD_TICKET_COOKIE)?.value)) {
    return { allowed: true, mode: "wizard" };
  }

  const user = await getSessionUser();
  if (!user) {
    return {
      allowed: false,
      response: NextResponse.json({ error: "Non authentifié" }, { status: 401 }),
    };
  }

  if (!hasGlobalRole(user.globalRole, "super_admin")) {
    return {
      allowed: false,
      response: NextResponse.json(
        { error: "Accès refusé : réservé aux super administrateurs" },
        { status: 403 }
      ),
    };
  }

  return { allowed: true, mode: "super_admin" };
}

/**
 * Attache le ticket de continuation du wizard à la réponse.
 * Émis une seule fois, quand le wizard vient de créer les premiers comptes sur
 * une instance vierge : sans lui, la garde se refermerait au milieu du parcours.
 */
export function issueWizardTicket(response: NextResponse): NextResponse {
  const ticket = buildTicket();
  if (!ticket) return response;

  response.cookies.set(WIZARD_TICKET_COOKIE, ticket, {
    path: WIZARD_TICKET_PATH,
    maxAge: WIZARD_TICKET_TTL_MS / 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
  return response;
}

/** Révoque le ticket de continuation (fin ou abandon du wizard). */
export function clearWizardTicket(response: NextResponse): NextResponse {
  response.cookies.set(WIZARD_TICKET_COOKIE, "", {
    path: WIZARD_TICKET_PATH,
    maxAge: 0,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
  });
  return response;
}
