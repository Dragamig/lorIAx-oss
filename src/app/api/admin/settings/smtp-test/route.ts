import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/get-user";
import { canCrossOrgBoundary, INSTANCE_ADMIN_ONLY_MESSAGE } from "@/lib/auth/rbac";
import { getEmailConfig, verifySmtp } from "@/lib/email/provider";
import logger from "@/lib/logger";

/**
 * AZ-08, porte dérobée par l'exercice de la configuration.
 *
 * La clé `email` (relais SMTP de l'instance) n'est plus ni lisible ni
 * modifiable par un administrateur d'organisation. Cette route la faisait
 * encore EXERCER : elle ouvrait la connexion sortante avec les identifiants de
 * l'instance et envoyait un courriel à l'appelant. Cela vaut oracle sur le
 * relais partagé (existe-t-il, répond-il, l'authentification passe-t-elle) et
 * expose l'adresse d'expédition de tous les tenants. Le test d'une
 * configuration d'instance appartient à l'administration d'instance.
 *
 * Les paramètres de connexion viennent tous de la base (`getEmailConfig`) :
 * la route n'accepte aucun corps, donc aucun identifiant fourni par
 * l'appelant. Ne jamais en accepter, ce serait un oracle de connexion
 * sortante arbitraire (SSRF authentifiée).
 */
export async function POST() {
  const user = await getSessionUser();
  if (!user || !canCrossOrgBoundary(user.globalRole)) {
    return NextResponse.json(
      { error: INSTANCE_ADMIN_ONLY_MESSAGE },
      { status: 403 }
    );
  }

  try {
    const config = await getEmailConfig();

    if (!config.emailEnabled || !config.smtpHost) {
      return NextResponse.json(
        { error: "SMTP non configuré. Activez-le et renseignez les paramètres." },
        { status: 400 }
      );
    }

    // Verify connection
    await verifySmtp(config);

    // Send test email to the admin via nodemailer directly
    const nodemailer = await import("nodemailer");
    const transporter = nodemailer.default.createTransport({
      host: config.smtpHost,
      port: config.smtpPort || 587,
      secure: config.smtpSecure ?? false,
      auth:
        config.smtpUser && config.smtpPassword
          ? { user: config.smtpUser, pass: config.smtpPassword }
          : undefined,
    });

    const from = config.smtpFrom || `LorIAx <noreply@loriax.local>`;
    await transporter.sendMail({
      from,
      to: user.email,
      subject: "LorIAx — Test SMTP",
      text: "La connexion SMTP fonctionne correctement.",
      html: `<p>La connexion SMTP fonctionne correctement.</p><p style="color:#888;font-size:12px;">Email de test envoyé depuis l'administration LorIAx.</p>`,
    });

    return NextResponse.json({
      message: `Email de test envoyé à ${user.email}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Erreur inconnue";
    logger.error("[smtp-test] Erreur: %s", message);
    return NextResponse.json(
      { error: `Échec de la connexion SMTP : ${message}` },
      { status: 500 }
    );
  }
}
