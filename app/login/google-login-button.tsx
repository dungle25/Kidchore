"use client";

import { useState } from "react";
import { getBrowserSupabaseClient } from "@/lib/supabase-browser";

/**
 * Starts the Google sign-in redirect.
 *
 * This must run in the browser: Supabase's PKCE flow writes a code verifier that
 * has to survive the round trip to Google, and the browser client owns that
 * cookie. The button is disabled while starting so a double tap cannot open two
 * competing flows.
 */
export default function GoogleLoginButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startGoogleLogin() {
    setPending(true);
    setError(null);

    try {
      const supabase = getBrowserSupabaseClient();
      const { error: authError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: `${window.location.origin}/auth/callback`,
          // No extra Google query parameters are passed on purpose.
          //
          // An earlier version sent `access_type=offline` and `prompt=consent` to obtain
          // a refresh token. Supabase Auth manages provider tokens itself and persists
          // the session server-side, so the app never needs one, while `prompt=consent`
          // forced every family member through the Google consent screen on every single
          // sign-in. Adding provider parameters also gives Google more to reject during
          // the code exchange, which is a common cause of
          // "Unable to exchange external code". The default flow is both simpler and
          // more robust.
        },
      });

      if (authError) {
        setPending(false);
        setError(
          authError.message.includes("provider is not enabled")
            ? "Google chưa được bật trong Supabase. Vào Authentication → Providers → Google để bật."
            : `Không bắt đầu được đăng nhập Google: ${authError.message}`
        );
      }
      // On success the browser navigates away, so leaving `pending` set is correct.
    } catch (unexpected) {
      setPending(false);
      setError(
        unexpected instanceof Error
          ? unexpected.message
          : "Không bắt đầu được đăng nhập Google."
      );
    }
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={startGoogleLogin}
        disabled={pending}
        className="flex w-full items-center justify-center gap-3 rounded-lg border border-slate-300 bg-white px-4 py-3 font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-60"
      >
        <svg className="h-5 w-5" viewBox="0 0 24 24" aria-hidden>
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.27-4.74 3.27-8.1Z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.65l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.11a6.6 6.6 0 0 1 0-4.22V7.05H2.18a11 11 0 0 0 0 9.9l3.66-2.84Z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1A11 11 0 0 0 2.18 7.05l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38Z"
          />
        </svg>
        {pending ? "Đang chuyển tới Google..." : "Đăng nhập bằng Google"}
      </button>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {error}
        </p>
      )}
    </div>
  );
}
