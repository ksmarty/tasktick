/**
 * Turns the `?error=` code on a failed single sign-on round trip into a sentence.
 *
 * better-auth routes every OAuth callback failure through one redirect helper
 * (`redirectOnError` in `node_modules/better-auth/dist/oauth2/errors.mjs`) with a
 * machine-readable code from `OAUTH_CALLBACK_ERROR_CODES`. Without a
 * `errorCallbackURL` it lands on the library's own error page, which is why a
 * failed second leg looked like "sign-in did nothing": the app was never told.
 * `startOidcSignIn()` now sends `errorCallbackURL: '/login'`, so the code arrives
 * here instead.
 *
 * Client-safe by construction: pure strings, no imports, so both the server
 * component that reads the query and the client component that renders it can
 * use it.
 */

/**
 * Known failures, phrased for someone who cannot read the server's logs.
 *
 * Every message ends with the advice that actually resolves it, and the raw code
 * is appended by the caller so a report to the admin is actionable.
 */
const CALLBACK_ERRORS: Record<string, string> = {
  unable_to_get_user_info:
    'The identity provider accepted the sign-in but the app could not read your account details from it. ' +
    'Try again — if it keeps happening, check that the server can fetch the provider’s signing keys.',
  invalid_code:
    'The provider’s reply was no longer valid when it arrived, so the sign-in was not completed. Try again.',
  no_code: 'The provider sent no sign-in code. Try again, and check the provider is configured for this app.',
  state_mismatch:
    'The reply did not match the sign-in attempt that started it, so it was rejected. Try again.',
  oauth_state_not_found:
    'The sign-in attempt expired before it finished. Try again and complete the provider’s login without delay.',
  please_restart_the_process:
    'The sign-in attempt expired before it finished. Try again and complete the provider’s login without delay.',
  issuer_missing:
    'The provider’s response did not say which issuer it came from. Check OIDC_ISSUER on the server and at the provider.',
  issuer_mismatch:
    'The provider’s response came from a different issuer than the one configured. Check OIDC_ISSUER on the server.',
  oauth_provider_not_found:
    'The server does not have the provider registered. Check OIDC_ISSUER, then try again.',
  provider_not_found: 'The server does not have the provider registered. Check OIDC_ISSUER, then try again.',
  no_callback_url: 'The sign-in had nowhere to return to. Try again from the sign-in page.',
  unable_to_link_account:
    'An account with your email already exists and could not be linked to this provider. Sign in with your password, then link the provider from settings.',
  account_already_linked_to_different_user:
    'This provider account is already linked to a different TaskTick user.',
  email_does_not_match:
    'The provider returned an email that does not match the account it is linked to.',
  email_not_found:
    'The provider did not return an email address, and TaskTick needs one to identify you.',
  email_not_verified: 'The provider returned an unverified email address. Verify it there, then try again.',
  access_denied: 'The sign-in was cancelled at the provider.',
  /*
   * Not an OIDC code: raised by the reminder-link endpoint when the token in a
   * notification has aged out (see `src/server/reminder-link.ts`). It belongs
   * here because this is the slot the sign-in page renders it in, and the
   * sentence has to say what to do next rather than that something failed.
   */
  expired_reminder_link:
    'That reminder link has expired. Sign in below and you will still land on the item it pointed at.',
};

/**
 * A sentence for the failed round trip, or `null` when there is nothing to say.
 *
 * An unknown code is still reported — with the code itself, so the person can
 * paste it into a bug report — because silence was the original complaint. A
 * provider-supplied `error_description` is shown when it exists, since the
 * provider usually knows more than the code does.
 */
export function describeOidcCallbackError(
  code: string | string[] | undefined,
  description?: string | string[] | undefined,
): string | null {
  const value = firstValue(code);
  const detail = firstValue(description);
  if (!value) return null;

  const known = CALLBACK_ERRORS[value];
  const base =
    known ??
    (detail
      ? `Single sign-on did not complete: ${detail}`
      : 'Single sign-on did not complete, and the server gave no reason');

  // The raw code stays visible: it is what turns "it didn't work" into a fix.
  return `${base} (${value})`;
}

function firstValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0] || undefined;
  return value || undefined;
}
