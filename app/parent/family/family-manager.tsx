"use client";

import { useState, useTransition } from "react";
import {
  adjustPoints,
  createChild,
  renameChild,
  repairChildIdentities,
  setChildPin,
} from "@/app/actions/family-actions";
import { EmptyState } from "@/components/ui";
import type { ParentChild } from "@/lib/domain";

/**
 * Family management: create children, reset PINs, rename, and adjust points.
 *
 * PINs are typed here and passed straight to the database, where they are hashed
 * with bcrypt. Nothing in this component or its server action stores or logs the
 * plaintext, and no screen ever displays an existing PIN.
 */
export default function FamilyManager({ kids }: { kids: ParentChild[] }) {
  const [rows, setRows] = useState(kids);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<{ text: string; ok: boolean } | null>(null);
  const [showAdd, setShowAdd] = useState(kids.length === 0);
  const [, startTransition] = useTransition();

  function onCreate(formData: FormData) {
    const input = {
      displayName: String(formData.get("displayName") ?? ""),
      username: String(formData.get("username") ?? ""),
      pin: String(formData.get("pin") ?? ""),
    };

    setBusy(true);
    setFeedback(null);
    startTransition(async () => {
      const result = await createChild(input);
      setBusy(false);
      if (!result.ok) {
        setFeedback({ text: result.error ?? "Không tạo được.", ok: false });
        return;
      }
      setFeedback({
        text: `Đã tạo tài khoản cho ${input.displayName}. Bé đăng nhập bằng tên “${input.username.toLowerCase()}” và mã PIN vừa đặt.`,
        ok: true,
      });
      setShowAdd(false);
      setRows((current) => [
        ...current,
        {
          id: `pending-${Date.now()}`,
          display_name: input.displayName,
          username: input.username.toLowerCase(),
          avatar_url: null,
          points_balance: 0,
          // create_child provisions both the PIN hash and the auth identity, so a
          // freshly created child can sign in immediately.
          pin_set: true,
          can_sign_in: true,
          pending_review: 0,
          approved_total: 0,
        },
      ]);
    });
  }

  function onResetPin(child: ParentChild, formData: FormData) {
    const pin = String(formData.get("pin") ?? "");
    setBusy(true);
    setFeedback(null);
    startTransition(async () => {
      const result = await setChildPin(child.id, pin);
      setBusy(false);
      setFeedback(
        result.ok
          ? { text: `Đã đổi mã PIN cho ${child.display_name}.`, ok: true }
          : { text: result.error ?? "Không đổi được PIN.", ok: false }
      );
    });
  }

  function onRename(child: ParentChild) {
    const next = window.prompt("Tên mới của bé:", child.display_name);
    if (!next || next.trim() === child.display_name) return;

    setBusy(true);
    setFeedback(null);
    startTransition(async () => {
      const result = await renameChild(child.id, next);
      setBusy(false);
      if (!result.ok) {
        setFeedback({ text: result.error ?? "Không đổi tên được.", ok: false });
        return;
      }
      setRows((current) =>
        current.map((row) =>
          row.id === child.id ? { ...row, display_name: next.trim() } : row
        )
      );
      setFeedback({ text: "Đã đổi tên.", ok: true });
    });
  }

  function onRepair(child: ParentChild) {
    setBusy(true);
    setFeedback(null);
    startTransition(async () => {
      const result = await repairChildIdentities();
      setBusy(false);
      if (!result.ok) {
        setFeedback({ text: result.error ?? "Không sửa được.", ok: false });
        return;
      }
      setRows((current) =>
        current.map((row) =>
          row.id === child.id
            ? { ...row, can_sign_in: row.pin_set, pin_set: true }
            : row
        )
      );
      setFeedback({
        text: "Đã sửa xong. Bé có thể đăng nhập bằng mã PIN ngay bây giờ.",
        ok: true,
      });
    });
  }

  function onAdjust(child: ParentChild, formData: FormData) {
    const amount = Number(formData.get("amount") ?? 0);
    const description = String(formData.get("description") ?? "");

    setBusy(true);
    setFeedback(null);
    startTransition(async () => {
      const result = await adjustPoints({ childId: child.id, amount, description });
      setBusy(false);
      if (!result.ok) {
        setFeedback({ text: result.error ?? "Không điều chỉnh được.", ok: false });
        return;
      }
      setRows((current) =>
        current.map((row) =>
          row.id === child.id
            ? { ...row, points_balance: row.points_balance + amount }
            : row
        )
      );
      setFeedback({
        text: `Đã ${amount > 0 ? "cộng" : "trừ"} ${Math.abs(amount)} điểm cho ${child.display_name}.`,
        ok: true,
      });
    });
  }

  return (
    <div className="space-y-6">
      {feedback && (
        <p
          role="status"
          className={`rounded-lg border p-3 text-sm ${
            feedback.ok
              ? "border-green-200 bg-green-50 text-green-800"
              : "border-red-200 bg-red-50 text-red-700"
          }`}
        >
          {feedback.text}
        </p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => setShowAdd((value) => !value)}
          className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white hover:bg-violet-700"
        >
          {showAdd ? "Đóng" : "+ Thêm bé"}
        </button>
      </div>

      {showAdd && (
        <form
          action={onCreate}
          className="space-y-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
        >
          <h2 className="font-semibold text-slate-800">Thêm bé mới</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-sm">
              <span className="font-medium text-slate-700">Tên của bé</span>
              <input
                name="displayName"
                required
                maxLength={50}
                placeholder="Bống"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-violet-500 focus:outline-none"
              />
            </label>
            <label className="text-sm">
              <span className="font-medium text-slate-700">Tên đăng nhập</span>
              <input
                name="username"
                required
                pattern="[a-zA-Z0-9._-]{3,30}"
                placeholder="bong"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-violet-500 focus:outline-none"
              />
              <span className="mt-1 block text-xs text-slate-400">
                Chữ thường, số, 3-30 ký tự
              </span>
            </label>
            <label className="text-sm">
              <span className="font-medium text-slate-700">Mã PIN</span>
              <input
                name="pin"
                required
                type="password"
                inputMode="numeric"
                pattern="[0-9]{4,8}"
                maxLength={8}
                placeholder="4-8 chữ số"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-violet-500 focus:outline-none"
              />
            </label>
          </div>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-60"
          >
            {busy ? "Đang tạo..." : "Tạo tài khoản cho bé"}
          </button>
        </form>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon="👶"
          title="Chưa có bé nào"
          description="Thêm tài khoản cho con để bắt đầu."
        />
      ) : (
        <div className="space-y-4">
          {rows.map((child) => (
            <section
              key={child.id}
              className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold text-slate-800">
                    {child.display_name}
                  </h2>
                  <p className="text-xs text-slate-400">
                    @{child.username ?? "—"} · {child.points_balance} điểm · đã xong{" "}
                    {child.approved_total} việc
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onRename(child)}
                  disabled={busy}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                >
                  Đổi tên
                </button>
              </div>

              {!child.can_sign_in && (
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
                  <p className="text-sm text-amber-900">
                    Bé này chưa đăng nhập được
                    {child.pin_set ? " (thiếu liên kết đăng nhập)" : " (chưa có mã PIN)"}.
                  </p>
                  {child.pin_set && (
                    <button
                      type="button"
                      onClick={() => onRepair(child)}
                      disabled={busy}
                      className="rounded-lg bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
                    >
                      Sửa ngay
                    </button>
                  )}
                </div>
              )}

              <div className="mt-4 grid grid-cols-1 gap-4 border-t border-slate-100 pt-4 lg:grid-cols-2">
                <form
                  action={(formData) => onResetPin(child, formData)}
                  className="flex items-end gap-2"
                >
                  <label className="flex-1 text-sm">
                    <span className="font-medium text-slate-700">Đặt lại mã PIN</span>
                    <input
                      name="pin"
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]{4,8}"
                      maxLength={8}
                      required
                      placeholder="PIN mới"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-violet-500 focus:outline-none"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    Lưu PIN
                  </button>
                </form>

                <form
                  action={(formData) => onAdjust(child, formData)}
                  className="flex items-end gap-2"
                >
                  <label className="w-24 text-sm">
                    <span className="font-medium text-slate-700">Điểm</span>
                    <input
                      name="amount"
                      type="number"
                      required
                      placeholder="±10"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-violet-500 focus:outline-none"
                    />
                  </label>
                  <label className="flex-1 text-sm">
                    <span className="font-medium text-slate-700">Lý do</span>
                    <input
                      name="description"
                      required
                      placeholder="Thưởng thêm vì giúp mẹ"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 focus:border-violet-500 focus:outline-none"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={busy}
                    className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                  >
                    Điều chỉnh
                  </button>
                </form>
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
