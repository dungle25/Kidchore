/**
 * Environment access with explicit validation.
 *
 * Secrets are read lazily and only on the server, so a missing secret produces a
 * clear error at the point of use instead of an `undefined` that silently turns
 * into a broken request. `NEXT_PUBLIC_*` values are referenced literally because
 * Next.js inlines them at build time.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.trim() === "") {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env.local and fill it in.`
    );
  }
  return value;
}

/** Safe on the client: these are public by design. */
export const publicEnv = {
  supabaseUrl: required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL
  ),
  supabaseKey: required(
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  ),
};

/**
 * Server-only secrets. Reading these in a Client Component would leak them, so
 * each getter throws unless it is running on the server.
 */
function serverOnly(name: string, value: string | undefined): string {
  if (typeof window !== "undefined") {
    throw new Error(`${name} must never be read on the client.`);
  }
  return required(name, value);
}

/**
 * The Supabase project's JWT secret. Used to mint session tokens for children,
 * who sign in with a PIN instead of Google. Tokens are signed HS256 with the
 * same secret the project's own auth uses, so PostgREST accepts them and
 * `auth.uid()` resolves correctly.
 */
export function getJwtSecret(): string {
  return serverOnly("SUPABASE_JWT_SECRET", process.env.SUPABASE_JWT_SECRET);
}

/**
 * Service role key. Bypasses RLS entirely, so it must only ever be used for
 * administrative scripts, never to serve a user request.
 */
export function getServiceRoleKey(): string {
  return serverOnly(
    "SUPABASE_SERVICE_ROLE_KEY",
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

/** True when the server secrets needed for PIN sign-in are present. */
export function hasAuthSecrets(): boolean {
  return Boolean(process.env.SUPABASE_JWT_SECRET);
}
