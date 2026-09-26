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
 * A client with no user identity at all: the publishable key in the `apikey` header
 * and no `Authorization` header, so PostgREST treats the request as the `anon` role.
 *
 * This is the right client for the handful of reads that must work before anybody has
 * signed in. They are reachable by anyone who can load the sign-in page, and they are
 * safe because the database functions behind them are deliberately granted to `anon`
 * and return display data only. Using the service-role client for the same calls would
 * work identically today and be a landmine tomorrow: the moment one of those functions
 * stopped being anon-safe, the call would keep succeeding.
 */
export function createAnonClient() {
  return createClient(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
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
 * Exactly two things need it, and both are because no user identity can authorize the
 * operation:
 *
 *  1. Verifying a child's PIN, which by definition happens before a session exists.
 *     `child_login_subject` is granted to service_role only - not to `anon` - so this
 *     is required, not just convenient.
 *  2. Uploading a proof image to Storage. The bucket has no policy for authenticated
 *     users, and the object path is built from the family id that the database just
 *     returned, never from the client. Giving authenticated users their own bucket
 *     policy would remove this use; until then, it is a reviewed and accepted cost.
 *
 * Never use it to read page data: doing so would bypass every authorization rule in
 * the database, which is the whole point of the schema.
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
