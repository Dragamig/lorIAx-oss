import { wrapInLayout } from "./base-layout";

interface EmailVerificationTemplateParams {
  userName: string;
  verifyUrl: string;
  expiresInHours: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function emailVerificationEmail(params: EmailVerificationTemplateParams) {
  const name = escapeHtml(params.userName);
  const url = escapeHtml(params.verifyUrl);

  const html = wrapInLayout(`
    <h2 style="margin:0 0 16px;font-size:18px;font-weight:600;color:#18181b;">
      Vérifiez votre adresse email LorIAx
    </h2>
    <p style="margin:0 0 16px;font-size:14px;color:#3f3f46;line-height:1.6;">
      Bonjour ${name},
    </p>
    <p style="margin:0 0 24px;font-size:14px;color:#3f3f46;line-height:1.6;">
      Confirmez votre adresse pour activer votre compte LorIAx.
    </p>
    <table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 0 24px;">
      <tr>
        <td style="background-color:#18181b;border-radius:8px;padding:12px 24px;">
          <a href="${url}" style="color:#ffffff;text-decoration:none;font-size:14px;font-weight:600;">
            Vérifier mon adresse
          </a>
        </td>
      </tr>
    </table>
    <p style="margin:0;font-size:13px;color:#71717a;line-height:1.5;">
      Ce lien expire dans ${params.expiresInHours} h. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.
    </p>
  `);

  const text = `Bonjour ${params.userName},

Confirmez votre adresse pour activer votre compte LorIAx.

${params.verifyUrl}

Ce lien expire dans ${params.expiresInHours} h. Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.`;

  return {
    subject: "Vérifiez votre adresse email LorIAx",
    html,
    text,
  };
}
