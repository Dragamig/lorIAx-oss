import { wrapInLayout } from "./base-layout";

interface OrgInvitationTemplateParams {
  inviteUrl: string;
  orgName: string;
  inviterName: string;
}

export function orgInvitationEmail(params: OrgInvitationTemplateParams) {
  const html = wrapInLayout(`
    <h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">
      Invitation à rejoindre ${params.orgName}
    </h2>
    <p style="margin:0 0 16px;font-size:14px;color:#3f3f46;line-height:1.6;">
      Bonjour,
    </p>
    <p style="margin:0 0 24px;font-size:14px;color:#3f3f46;line-height:1.6;">
      ${params.inviterName} vous a invité à rejoindre l'organisation <strong>${params.orgName}</strong> sur LorIAx.
      Cliquez sur le bouton ci-dessous pour définir votre mot de passe et accéder à l'espace.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px;">
      <tr>
        <td style="background-color:#18181b;border-radius:8px;padding:12px 24px;">
          <a href="${params.inviteUrl}" style="color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">
            Rejoindre ${params.orgName}
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#71717a;line-height:1.5;">
      Si vous n'attendiez pas cette invitation, vous pouvez ignorer cet email.
    </p>
  `);

  const text = `Bonjour,

${params.inviterName} vous a invité à rejoindre l'organisation ${params.orgName} sur LorIAx.
Cliquez sur ce lien pour définir votre mot de passe et accéder à l'espace :

${params.inviteUrl}

Si vous n'attendiez pas cette invitation, ignorez cet email.`;

  return {
    subject: `LorIAx — Invitation à rejoindre ${params.orgName}`,
    html,
    text,
  };
}
