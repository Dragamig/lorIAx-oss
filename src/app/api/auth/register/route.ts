import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { users, spaces } from "@/lib/db/schema";
import { organizationMembers } from "@/lib/db/schema-org";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import slugify from "slugify";
import { initRepository } from "@/lib/git/repository";
import { checkRateLimitAsync, RATE_LIMITS, getClientIpOrNull } from "@/lib/rate-limit";
import { z } from "zod";
import logger from "@/lib/logger";
import { ensurePersonalCalendar } from "@/lib/calendar/auto-provision";
import { getHooks } from "@/lib/modules/hooks";
import { getDefaultOrgId } from "@/lib/org/get-org-id";
import { sendEmail } from "@/lib/email/send";
import { getRegistrationRefusal } from "@/lib/auth/registration-policy";
import { isRegistrationOpen } from "@/lib/auth/registration-setting";
import { sendVerificationEmail } from "@/lib/auth/email-verification";
import { sendPasswordResetEmail } from "@/lib/auth/password-reset";

/**
 * Message unique de la route, aligné sur /api/auth/register-org et sur le
 * patron de /api/auth/forgot-password.
 *
 * Défaut relevé par la revue du lot 6 : le quota avait été posé sur les deux
 * routes d'inscription, l'uniformisation de réponse sur une seule. Celle-ci
 * répondait encore 409 « Un compte avec cet email existe deja », c'est-à-dire
 * exactement l'oracle d'énumération que l'autre route venait de fermer, sur une
 * route non authentifiée elle aussi.
 */
const REPONSE_UNIFORME = {
  message:
    "Votre demande a été enregistrée. Si un lien de vérification est nécessaire, il vient de vous être envoyé par email.",
} as const;

function demandeEnregistree() {
  return NextResponse.json(REPONSE_UNIFORME, { status: 200 });
}

/**
 * Prévient le titulaire d'un compte existant qu'une inscription a été tentée
 * avec son adresse. Contrepartie honnête de la réponse uniforme : l'appelant
 * légitime qui avait oublié son compte est informé, l'attaquant ne voit rien.
 */
async function notifyExistingAccount(email: string): Promise<void> {
  const baseUrl =
    process.env.NEXTAUTH_URL || process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  const text = [
    "Bonjour,",
    "",
    "Une inscription vient d'être tentée avec cette adresse, qui est déjà rattachée à un compte LorIAx.",
    "",
    "Aucun nouveau compte n'a été créé. Si la demande vient de toi, connecte-toi avec ton compte existant :",
    baseUrl + "/login",
    "",
    "Si tu as oublié ton mot de passe, utilise le lien de réinitialisation depuis cette page.",
    "",
    "Si elle ne vient pas de toi, tu peux ignorer ce message : personne n'a appris quoi que ce soit sur ton compte.",
  ].join("\n");

  try {
    await sendEmail({
      to: email,
      subject: "Tentative d'inscription avec ton adresse",
      html: text.split("\n").map((line) => `<p>${line}</p>`).join(""),
      text,
    });
  } catch (err) {
    // Un échec d'envoi ne doit rien changer à la réponse : la faire varier
    // rouvrirait exactement l'oracle qu'on vient de fermer.
    logger.warn({ err }, "[register] Échec de la notification de compte existant");
  }
}

/** Never lets a mail failure change the (uniform) response. */
async function trySendVerification(user: { id: string; name: string; email: string }): Promise<void> {
  try {
    await sendVerificationEmail(user);
  } catch (err) {
    logger.warn({ err }, "[register] Verification email failed");
  }
}

/**
 * Known address, not yet verified: a reset link, never a verification link,
 * against pre-verification account takeover (decision 21/11/2026). The
 * response stays uniform whatever happens to the mail.
 */
async function trySendReset(user: { id: string; name: string; email: string }): Promise<void> {
  try {
    await sendPasswordResetEmail(user);
  } catch (err) {
    logger.warn({ err }, "[register] Password reset email failed");
  }
}

const REGISTRATION_CLOSED_BODY = {
  error: "Les inscriptions sont fermées.",
  code: "registration_closed",
} as const;

const registerSchema = z.object({
  name: z.string().min(2, "Le nom doit faire au moins 2 caracteres"),
  email: z.string().email("Email invalide"),
  password: z.string().min(8, "Le mot de passe doit faire au moins 8 caracteres"),
});

export async function POST(request: Request) {
  // Rate limiting. AZ-26 : compteur PARTAGÉ. AZ-25 : sans adresse déterminable
  // le palier par IP est sauté, le palier par adresse électronique (plus bas)
  // restant, lui, appliqué dans tous les cas.
  const ip = getClientIpOrNull(request);
  if (ip) {
    const rateLimitResult = await checkRateLimitAsync(
      `register:${ip}`,
      RATE_LIMITS.auth
    );
    if (!rateLimitResult.success) {
      return NextResponse.json(
        { error: "Trop de tentatives. Réessayez plus tard." },
        { status: 429 }
      );
    }
  }

  if (!(await isRegistrationOpen())) {
    return NextResponse.json(REGISTRATION_CLOSED_BODY, { status: 403 });
  }

  try {
    const body = await request.json();
    const parsed = registerSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 }
      );
    }

    const { name, password } = parsed.data;
    const email = parsed.data.email.toLowerCase().trim();

    // Palier par adresse électronique : toujours actif, y compris sans adresse
    // IP exploitable. Consommé AVANT la lecture en base, pour que le quota borne
    // aussi le rythme d'interrogation de l'oracle d'existence de compte.
    const emailRateLimit = await checkRateLimitAsync(
      `register:email:${email}`,
      RATE_LIMITS.auth
    );
    if (!emailRateLimit.success) {
      return NextResponse.json(
        { error: "Trop de tentatives. Réessayez plus tard." },
        { status: 429 }
      );
    }

    // Politique d'inscription (C1) : réglage « Inscription ouverte » et instance
    // non amorcée. Indépendante de l'adresse, donc sans effet d'oracle.
    const refusal = await getRegistrationRefusal();
    if (refusal) {
      return NextResponse.json(
        { error: refusal.error, code: REGISTRATION_CLOSED_BODY.code },
        { status: refusal.status },
      );
    }

    // ORDRE DES CONTROLES. Les refus qui ne dépendent PAS de l'adresse (absence
    // d'organisation d'accueil, quota d'utilisateurs de la licence) sont
    // prononcés avant de regarder la table des comptes. Autrement, sur une
    // instance vierge ou saturée, l'attaquant lisait la différence entre le
    // refus et la réponse uniforme, et l'oracle refermé plus bas se rouvrait
    // par la bande.

    // Résoudre l'organisation d'accueil AVANT toute écriture : `/register` rejoint
    // une instance déjà provisionnée. Sur une instance vierge, aucune org n'existe
    // — il faut passer par `/register-org`. On vérifie ici pour ne pas insérer un
    // utilisateur orphelin (la route n'est pas transactionnelle) ni renvoyer une 500.
    let orgId: string;
    try {
      orgId = await getDefaultOrgId();
    } catch {
      return NextResponse.json(
        {
          error:
            "Aucune organisation n'existe encore sur cette instance. Créez-en une d'abord.",
          needsOrg: true,
        },
        { status: 409 }
      );
    }

    // Vérifier le quota utilisateurs de l'organisation d'accueil (scopé par tenant)
    const usersStatus = await getHooks().usage.checkUsersLimit(orgId);
    if (usersStatus.exceeded) {
      return NextResponse.json(
        { error: `Quota d'utilisateurs atteint (${usersStatus.current}/${usersStatus.max}). Mettez à niveau votre licence.` },
        { status: 403 }
      );
    }

    // Verifier si l'email existe deja. Aucun écart observable ne doit en
    // découler : on ne crée rien, on prévient le titulaire par courriel, et on
    // rend EXACTEMENT la réponse du succès.
    const [existing] = await db
      .select({ id: users.id, name: users.name, emailVerifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existing) {
      if (existing.emailVerifiedAt === null) {
        // Unverified account: reset link, never touch the stored password.
        await trySendReset({ id: existing.id, name: existing.name, email });
      } else {
        await notifyExistingAccount(email);
      }
      logger.info("[register] Adresse déjà connue, aucune création");
      return demandeEnregistree();
    }

    const passwordHash = await bcrypt.hash(password, 12);

    // Creer l'utilisateur
    const [user] = await db
      .insert(users)
      .values({ name, email, passwordHash, emailVerifiedAt: null })
      .returning();

    // Rattacher l'utilisateur à son organisation d'accueil (cloisonnement
    // multi-tenant : sans cette ligne, il serait exclu d'une org isolée).
    await db
      .insert(organizationMembers)
      .values({ organizationId: orgId, userId: user.id, role: "member" })
      .onConflictDoNothing();

    // Creer l'espace personnel
    const slug = slugify(name, { lower: true, strict: true });
    const gitRepoPath = `personal/${user.id}`;

    await db.insert(spaces).values({
      name: `Espace de ${name}`,
      slug: `personal-${slug}`,
      type: "personal",
      ownerUserId: user.id,
      gitRepoPath,
      organizationId: orgId,
    });

    // Initialiser le repo git de l'espace
    await initRepository(gitRepoPath);

    // Créer le calendrier personnel par défaut
    await ensurePersonalCalendar(user.id, name).catch((err) =>
      logger.error({ err }, "[register] Erreur création calendrier personnel")
    );

    await trySendVerification({ id: user.id, name, email });

    // Même corps, même statut que la branche « adresse déjà connue » : plus
    // aucun champ (`userId` compris) ne dépend de la branche empruntée.
    return demandeEnregistree();
  } catch (error) {
    logger.error({ err: error }, "[register] Erreur inscription utilisateur");
    return NextResponse.json(
      { error: "Erreur serveur" },
      { status: 500 }
    );
  }
}
