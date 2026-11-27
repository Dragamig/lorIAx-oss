// Imported from @auth/core/errors (the module next-auth re-exports it from) so
// that tests mocking "next-auth" wholesale can still load this file.
import { CredentialsSignin } from "@auth/core/errors";

/**
 * Raised after a correct LOCAL password on a self-service account whose email
 * is not verified yet. next-auth forwards `code` to the client `signIn` result.
 */
export class EmailNotVerifiedError extends CredentialsSignin {
  code = "email_not_verified";
}
