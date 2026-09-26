"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { signInWithPin, type ActionState } from "@/app/actions/auth-actions";
import type { ChildProfile } from "@/lib/domain";

const initialState: ActionState = {};

/**
 * PIN entry, used both for signing in and for switching between siblings.
 *
 * Two layouts come from one component:
 *   * several children - pick an avatar, then type the PIN (the sign-in screen)
 *   * one child        - that child's keypad is focused immediately (switching)
 *
 * Switching always requires the PIN. A passwordless "tap to switch" would let one child
 * open a sibling's profile and spend their points, which is precisely what the PIN
 * exists to prevent on a shared family tablet.
 */
export default function PinPad({
  profiles,
  presetUsername,
  autoFocus = false,
}: {
  profiles: ChildProfile[];
  /** When set, only this child's pad is rendered, for a one-tap switch. */
  presetUsername?: string;
  /** Focus the PIN field on mount so a child can type straight away. */
  autoFocus?: boolean;
}) {
  const [state, formAction, pending] = useActionState(signInWithPin, initialState);

  if (profiles.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Chưa có bé nào được tạo. Nhờ bố/mẹ đăng nhập bằng Google rồi thêm bé trong
        mục <strong>Gia đình</strong>.
      </div>
    );
  }

  const visible = presetUsername
    ? profiles.filter((profile) => profile.username === presetUsername)
    : profiles;

  if (visible.length === 0) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        Không tìm thấy bé này.{" "}
        <a href="/login" className="underline">
          Chọn bé khác
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {visible.map((profile) => (
        <PinCard
          key={profile.username}
          profile={profile}
          formAction={formAction}
          pending={pending}
          autoFocus={autoFocus || Boolean(presetUsername)}
          showIdentity={!presetUsername}
        />
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

function PinCard({
  profile,
  formAction,
  pending,
  autoFocus,
  showIdentity,
}: {
  profile: ChildProfile;
  formAction: (payload: FormData) => void;
  pending: boolean;
  autoFocus: boolean;
  showIdentity: boolean;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [value, setValue] = useState("");

  // Focusing on mount is what makes switching feel quick on a tablet.
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  return (
    <form
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
          {showIdentity && (
            <p className="text-xs text-slate-400">@{profile.username}</p>
          )}
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <input
          ref={inputRef}
          name="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]*"
          maxLength={8}
          required
          value={value}
          onChange={(event) => {
            // Digits only, so the numeric keypad cannot submit a stray character.
            setValue(event.target.value.replace(/\D/g, "").slice(0, 8));
          }}
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
  );
}
