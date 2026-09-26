"use client";

import { useActionState } from "react";
import { signInWithPin, type ActionState } from "@/app/actions/auth-actions";
import type { ChildProfile } from "@/lib/domain";

const initialState: ActionState = {};

/**
 * PIN keypad sign-in for children.
 *
 * Big touch targets and no free-text entry: a child picks their avatar and taps
 * digits. The username travels in a hidden field, so the PIN is the only thing
 * typed on a shared family tablet.
 */
export default function PinLoginForm({ profiles }: { profiles: ChildProfile[] }) {
  const [state, formAction, pending] = useActionState(signInWithPin, initialState);

  if (profiles.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Chưa có bé nào được tạo. Nhờ bố/mẹ đăng nhập bằng Google rồi thêm bé trong
        mục <strong>Gia đình</strong>.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {profiles.map((profile) => (
        <form
          key={profile.username}
          action={formAction}
          className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <input type="hidden" name="username" value={profile.username} />

          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-100 text-xl">
              {profile.avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={profile.avatar_url}
                  alt=""
                  className="h-12 w-12 rounded-full object-cover"
                />
              ) : (
                <span aria-hidden>🙂</span>
              )}
            </div>
            <div className="flex-1">
              <p className="text-lg font-semibold text-slate-800">
                {profile.display_name}
              </p>
              <p className="text-xs text-slate-400">@{profile.username}</p>
            </div>
          </div>

          <div className="mt-3 flex gap-2">
            <input
              name="pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]*"
              maxLength={8}
              placeholder="Mã PIN"
              aria-label={`Mã PIN của ${profile.display_name}`}
              className="flex-1 rounded-lg border border-slate-300 px-3 py-3 text-center text-xl tracking-[0.4em] focus:border-violet-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-violet-600 px-5 py-3 font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
            >
              {pending ? "..." : "Vào"}
            </button>
          </div>
        </form>
      ))}

      {state.error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {state.error}
        </p>
      )}
    </div>
  );
}
