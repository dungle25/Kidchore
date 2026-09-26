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

/**
 * Normalises the Supabase project URL.
 *
 * The value must be the bare project URL. Supabase's dashboard also shows a REST
 * endpoint ending in `/rest/v1/`, and pasting that instead is an easy mistake: the
 * values look nearly identical and both are labelled as URLs.
 *
 * The failure it causes is very hard to read. `auth-js` appends `/auth/v1/authorize` to
 * whatever it is given, so a value ending in `/rest/v1/` sends the browser to
 * `/rest/v1/auth/v1/authorize`. That path belongs to PostgREST, which answers
 * `{"message":"No API key found in request"}`, so the error points at the API key rather
 * than at the URL and sends you looking in the wrong place entirely.
 *
 * Stripping the path here turns that silent, misleading failure into either a correct
 * request or an explicit error at startup.
 */
function normaliseSupabaseUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(
      `NEXT_PUBLIC_SUPABASE_URL is not a valid absolute URL: ${JSON.stringify(raw)}`
    );
  }

  const hadPath = parsed.pathname !== "/" && parsed.pathname !== "";

  if (hadPath) {
    // Warn loudly rather than failing: the project URL is still recoverable, and a hard
    // failure would break a deployment that could otherwise work.
    console.warn(
      `[env] NEXT_PUBLIC_SUPABASE_URL has a path ("${parsed.pathname}") that is being ignored. ` +
        `It should be only the project URL, for example https://<ref>.supabase.co. ` +
        `A value ending in /rest/v1/ breaks sign-in with a confusing "No API key found" error.`
    );
  }

  // Drop any path, query and trailing slash, keeping scheme and host.
  return `${parsed.protocol}//${parsed.host}`;
}

/** Safe on the client: these are public by design. */
export const publicEnv = {
  supabaseUrl: normaliseSupabaseUrl(
    required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL)
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
