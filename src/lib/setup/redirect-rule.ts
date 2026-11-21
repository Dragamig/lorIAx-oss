import { hasGlobalRole } from "@/lib/auth/rbac";

/**
 * Regle de redirection vers l'assistant d'installation depuis la mise en page
 * de l'application.
 *
 * Seul un super administrateur est redirige, comme en 1.21.1 : l'assistant
 * etant ferme aux autres, y renvoyer un membre l'enfermerait sur l'ecran du
 * jeton d'amorcage sans issue. Le cookie « Plus tard » suspend la redirection.
 */
export function shouldRedirectToSetup(input: {
  user: { globalRole: string } | null;
  completed: boolean;
  skipped: boolean;
}): boolean {
  if (!input.user || !hasGlobalRole(input.user.globalRole as never, "super_admin")) return false;
  if (input.completed) return false;
  return !input.skipped;
}
