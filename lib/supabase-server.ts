import "server-only";
import { createClient } from "@supabase/supabase-js";
import { publicEnv, getServiceRoleKey } from "./env";

/**
 * Supabase clients used to talk to PostgREST and Storage.
 *
 * Authorization always comes from the caller's session token, never from the
 * publishable key. The publishable key travels in the `apikey` header, which
 * identifies the project and grants no data access on its own: RLS is enabled on
 * every table with no policies for `anon` (see db/migrations), so that key reads
 * nothing.
 */

/**
 * A client that talks to Supabase as a specific end user.
 *
 * The Authorization header carries our signed session JWT, which is what lets
 * PostgREST resolve `auth.uid()` to the real user so the SECURITY DEFINER
 * functions in the database can authorize the call.
 */
export function createUserClient(userToken: string) {
  return createClient(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
    global: {
      headers: { Authorization: `Bearer ${userToken}` },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

/**
 * Service-role client. Bypasses RLS entirely.
 *
 * Used only by the sign-in flow, where no session exists yet and a PIN must be
 * verified before one can be issued. Never use it to serve authenticated page
 * data: doing so would bypass every authorization rule in the database.
 */
export function createAdminClient() {
  return createClient(publicEnv.supabaseUrl, getServiceRoleKey(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}
