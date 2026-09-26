"use client";

import { useActionState, useState } from "react";
import {
  acceptFamilyInvite,
  completeOnboarding,
  type ActionState,
} from "@/app/actions/auth-actions";
import { formatInviteCode, hasUnusableCharacters, isCompleteInviteCode } from "@/lib/invite-code";

const initialState: ActionState = {};

type Mode = "create" | "join";

/**
 * First-run setup for a parent who has just signed in with Google.
 *
 * Two ways in, and until now only the first one existed: start a household, or join one
 * you were invited to. The second is what makes a spouse able to use the app at all -
 * without it every Google account got its own empty family, and the children's PIN
 * accounts stayed behind in the other one.
 *
 * Both forms are Server Actions attached to real `<form>` elements, so they submit
 * without JavaScript and a test can replay them.
 */
export default function OnboardingForm({
  email,
  presetCode,
}: {
  email: string | null;
  /** Pre-filled from an invitation link, when the person arrived through one. */
  presetCode?: string;
}) {
  const [mode, setMode] = useState<Mode>(presetCode ? "join" : "create");
  // Formatted on the way in as well as on the way out: the code arrives from the
  // invitation cookie as twelve unbroken characters, and an invitation that lands in an
  // unreadable field looks like the link was broken.
  const [code, setCode] = useState(() => formatInviteCode(presetCode ?? ""));

  const [createState, createAction, creating] = useActionState(
    completeOnboarding,
    initialState
  );
  const [joinState, joinAction, joining] = useActionState(acceptFamilyInvite, initialState);

  const typedCodeWarning = hasUnusableCharacters(code)
    ? "Mã mời không có các chữ I, O và các số 0, 1. Bạn kiểm tra lại giúp nhé."
    : null;

  async function pasteCode() {
    try {
      const text = await navigator.clipboard.readText();
      setCode(formatInviteCode(text));
    } catch {
      // Clipboard access can be refused; the field is there to type into.
    }
  }

  return (
    <div className="space-y-5">
      {email && (
        <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-600">
          Đã xác thực Google: <strong>{email}</strong>
        </p>
      )}

      <div className="flex rounded-lg bg-slate-100 p-1 text-sm font-medium">
        <button
          type="button"
          onClick={() => setMode("create")}
          className={`flex-1 rounded-md px-3 py-2 transition ${
            mode === "create" ? "bg-white text-violet-800 shadow-sm" : "text-slate-600"
          }`}
        >
          Tạo gia đình mới
        </button>
        <button
          type="button"
          onClick={() => setMode("join")}
          className={`flex-1 rounded-md px-3 py-2 transition ${
            mode === "join" ? "bg-white text-violet-800 shadow-sm" : "text-slate-600"
          }`}
        >
          Tham gia gia đình có sẵn
        </button>
      </div>

      {mode === "create" ? (
        <form action={createAction} className="space-y-4">
          <div>
            <label htmlFor="familyName" className="block text-sm font-medium text-slate-700">
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
            <label htmlFor="displayName" className="block text-sm font-medium text-slate-700">
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

          {createState.error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {createState.error}
            </p>
          )}

          <button
            type="submit"
            disabled={creating}
            className="w-full rounded-lg bg-violet-600 px-4 py-3 font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
          >
            {creating ? "Đang tạo..." : "Tạo gia đình"}
          </button>
        </form>
      ) : (
        <form action={joinAction} className="space-y-4">
          <div>
            <label htmlFor="inviteCode" className="block text-sm font-medium text-slate-700">
              Mã mời
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="inviteCode"
                name="inviteCode"
                required
                autoComplete="off"
                spellCheck={false}
                value={code}
                onChange={(event) => setCode(formatInviteCode(event.target.value))}
                placeholder="XXXX-XXXX-XXXX"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-lg font-semibold tracking-wider uppercase focus:border-violet-500 focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void pasteCode()}
                className="shrink-0 rounded-lg border border-slate-300 px-3 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Dán
              </button>
            </div>
            {typedCodeWarning ? (
              <p className="mt-1 text-xs text-amber-700">{typedCodeWarning}</p>
            ) : (
              <p className="mt-1 text-xs text-slate-400">
                Mã gồm 12 chữ và số, do người trong gia đình gửi cho bạn.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="joinDisplayName" className="block text-sm font-medium text-slate-700">
              Tên của bạn
            </label>
            <input
              id="joinDisplayName"
              name="displayName"
              required
              maxLength={50}
              placeholder="Ví dụ: Mẹ Mai"
              className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-violet-500 focus:outline-none"
            />
            <p className="mt-1 text-xs text-slate-400">
              Các bé sẽ thấy tên này, ví dụ &ldquo;Mẹ Mai đã duyệt&rdquo;.
            </p>
          </div>

          {joinState.error && (
            <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {joinState.error}
            </p>
          )}

          <button
            type="submit"
            disabled={joining || !isCompleteInviteCode(code)}
            className="w-full rounded-lg bg-violet-600 px-4 py-3 font-semibold text-white transition hover:bg-violet-700 disabled:opacity-50"
          >
            {joining ? "Đang tham gia..." : "Tham gia gia đình"}
          </button>
        </form>
      )}

      <p className="text-xs text-slate-400">
        Mỗi tài khoản Google thuộc về đúng một gia đình. Nếu bạn đã ở trong một gia đình
        rồi thì đăng nhập bình thường, không cần mã mời.
      </p>
    </div>
  );
}
