"use client";

import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "./env";
import { SUPABASE_AUTH_STORAGE_KEY } from "./auth-constants";

/**
 * Browser Supabase client, used only to start the Google sign-in redirect.
 *
 * It must persist cookies, because the PKCE code verifier is written before the
 * browser leaves for Google and read back on the return trip. The same storage key
 * is used by the server client so the two halves of the handshake agree.
 */
let client: ReturnType<typeof createBrowserClient> | null = null;

export function getBrowserSupabaseClient() {
  if (!client) {
    client = createBrowserClient(publicEnv.supabaseUrl, publicEnv.supabaseKey, {
      cookieOptions: { name: SUPABASE_AUTH_STORAGE_KEY },
      auth: {
        persistSession: true,
        autoRefreshToken: false,
        detectSessionInUrl: false,
        flowType: "pkce",
      },
    });
  }
  return client;
}
