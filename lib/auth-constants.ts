/**
 * Cookie and session constants shared by both the browser and the server.
 *
 * Kept in a neutral module on purpose: a Client Component must be able to import
 * the Supabase Auth storage key, so it cannot live in a `server-only` file.
 */

/** The app's own session cookie. Holds a signed JWT. */
export const SESSION_COOKIE = "kidchore_session";

/** Session lifetime in seconds (30 days). */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

/**
 * Where `@supabase/ssr` keeps the PKCE code verifier and the temporary Supabase
 * session during the Google handshake. Deliberately distinct from SESSION_COOKIE:
 * Supabase Auth only performs the handshake, while the app is authorized by its
 * own signed JWT.
 */
export const SUPABASE_AUTH_STORAGE_KEY = "kidchore-supabase-auth";

/** Short-lived cookie carrying the Google session through onboarding. */
export const GOOGLE_COOKIE = "kidchore_google";
export const GOOGLE_COOKIE_MAX_AGE = 60 * 15;

/**
 * Carries an invite code across the Google sign-in round trip.
 *
 * Somebody who taps an invitation link is not signed in yet, so the code has to survive
 * a redirect to Google and back. A cookie is the only place for it: the code must not
 * appear in a URL that ends up in browser history or a server access log, and it must
 * not be readable by page scripts.
 */
export const INVITE_COOKIE = "kidchore_invite";
export const INVITE_COOKIE_MAX_AGE = 60 * 15;
