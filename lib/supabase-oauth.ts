import "server-only";
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { publicEnv } from "./env";
import { SUPABASE_AUTH_STORAGE_KEY } from "./auth-constants";

/**
 * Server-side Supabase Auth client backed by Next.js cookies.
 *
 * Used only for the Google handshake. `@supabase/ssr` needs both `getAll` and
 * `setAll` so it can persist the PKCE code verifier before the redirect to Google
 * and read it back afterwards. Without that pair the exchange fails
 * intermittently, so both are always provided here.
 */
export async function createSupabaseAuthServerClient() {
  const cookieStore = await cookies();

  return createServerClient(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    cookieOptions: { name: SUPABASE_AUTH_STORAGE_KEY },
    cookies: {
      getAll() {
        return cookieStore.getAll().map(({ name, value }) => ({ name, value }));
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
    auth: {
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: "pkce",
    },
  });
}

/** Removes every Supabase Auth cookie, leaving only the app's own session. */
export async function clearSupabaseAuthCookies() {
  const cookieStore = await cookies();
  for (const cookie of cookieStore.getAll()) {
    if (
      cookie.name === SUPABASE_AUTH_STORAGE_KEY ||
      cookie.name.startsWith(`${SUPABASE_AUTH_STORAGE_KEY}.`) ||
      cookie.name.startsWith(`${SUPABASE_AUTH_STORAGE_KEY}-`)
    ) {
      cookieStore.delete(cookie.name);
    }
  }
}
