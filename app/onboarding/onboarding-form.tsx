"use client";

import { useActionState } from "react";
import { completeOnboarding, type ActionState } from "@/app/actions/auth-actions";

const initialState: ActionState = {};

/**
 * First-run setup for a parent who has just signed in with Google.
 *
 * Collects the two things the database needs to create the household: the family
 * name and the parent's display name. Submitting calls `bootstrap_parent`, which is
 * idempotent, so a double submit cannot create two families.
 */
export default function OnboardingForm({ email }: { email: string | null }) {
  const [state, formAction, pending] = useActionState(completeOnboarding, initialState);

  return (
    <form action={formAction} className="space-y-5">
      {email && (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          Đã xác thực Google: <strong>{email}</strong>
        </p>
      )}

      <div>
        <label
          htmlFor="familyName"
          className="block text-sm font-medium text-slate-700"
        >
          Tên gia đình
        </label>
        <input
          id="familyName"
          name="familyName"
          required
          maxLength={100}
          placeholder="Ví dụ: Gia đình nhà Bống"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-violet-500 focus:outline-none"
        />
        <p className="mt-1 text-xs text-slate-400">
          Chỉ hiển thị trong ứng dụng, dùng để phân biệt gia đình bạn.
        </p>
      </div>

      <div>
        <label
          htmlFor="displayName"
          className="block text-sm font-medium text-slate-700"
        >
          Tên của bạn
        </label>
        <input
          id="displayName"
          name="displayName"
          required
          maxLength={50}
          placeholder="Ví dụ: Bố Nam"
          className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-violet-500 focus:outline-none"
        />
      </div>

      {state.error && (
        <p
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
        >
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-violet-600 px-4 py-3 font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
      >
        {pending ? "Đang tạo..." : "Tạo gia đình"}
      </button>
    </form>
  );
}
