import logger from "@/lib/logger";

/**
 * Vérifie un token hCaptcha côté serveur.
 *
 * Activé seulement si `HCAPTCHA_SECRET` est défini ; sinon retourne true
 * (skip silencieux pour dev/self-hosted minimal). Le site key public
 * correspondant est exposé au client via `NEXT_PUBLIC_HCAPTCHA_SITE_KEY`.
 */
export function isCaptchaEnabled(): boolean {
  return !!process.env.HCAPTCHA_SECRET;
}

export async function verifyHCaptcha(
  token: string | undefined,
  remoteIp?: string,
): Promise<boolean> {
  const secret = process.env.HCAPTCHA_SECRET;
  if (!secret) return true;
  if (!token || typeof token !== "string") return false;

  try {
    const params = new URLSearchParams({ secret, response: token });
    if (remoteIp && remoteIp !== "unknown") params.set("remoteip", remoteIp);

    const res = await fetch("https://api.hcaptcha.com/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, "[public-form-captcha] siteverify HTTP error");
      return false;
    }
    const data = await res.json();
    if (typeof data !== 'object' || data === null) return false;
    return data.success === true;
  } catch (err) {
    logger.warn({ err }, "[public-form-captcha] siteverify exception");
    return false;
  }
}
