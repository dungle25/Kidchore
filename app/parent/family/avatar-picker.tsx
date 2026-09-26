"use client";

import { useState, useTransition } from "react";
import { setChildAvatar } from "@/app/actions/family-actions";
import Avatar from "@/components/avatar";
import { AVATAR_CHOICES } from "@/lib/avatars";

/**
 * Pick which animal a child shows.
 *
 * Collapsed to a single row until it is opened: a family with three children would
 * otherwise have 48 emoji buttons on the screen at once, and the parent only ever wants
 * one of them.
 *
 * The choice saves immediately rather than waiting for a form submit. There is nothing to
 * confirm - it is a picture next to a name, and the child is looking at the screen while
 * the parent taps through the options.
 */
export default function AvatarPicker({
  childId,
  childName,
  current,
}: {
  childId: string;
  childName: string;
  current: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function choose(key: string | null) {
    setBusy(true);
    setError(null);
    startTransition(async () => {
      const result = await setChildAvatar(childId, key);
      setBusy(false);
      if (!result.ok) {
        setError(result.error ?? "Không đổi được ảnh đại diện.");
        return;
      }
      setValue(key);
      setOpen(false);
    });
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-sm font-medium text-violet-800 hover:bg-violet-100"
      >
        <Avatar value={value} size={22} className="bg-white" />
        {open ? "Đóng" : value ? `Đổi ảnh cho ${childName}` : `Chọn ảnh cho ${childName}`}
      </button>

      {open && (
        <div className="mt-2 rounded-lg border border-slate-200 p-3">
          <div className="grid grid-cols-6 gap-1 sm:grid-cols-10">
            {AVATAR_CHOICES.map((choice) => (
              <button
                key={choice.key}
                type="button"
                onClick={() => choose(choice.key)}
                disabled={busy}
                // The emoji is the label a child reads, but a screen reader says the word.
                aria-label={choice.label}
                title={choice.label}
                aria-pressed={value === choice.key}
                className={`flex h-11 items-center justify-center rounded-lg text-2xl transition disabled:opacity-60 ${
                  value === choice.key
                    ? "bg-violet-100 ring-2 ring-violet-500"
                    : "hover:bg-slate-100"
                }`}
              >
                <span aria-hidden>{choice.emoji}</span>
              </button>
            ))}
          </div>

          <div className="mt-2 flex items-center justify-between gap-2">
            <p className="text-xs text-slate-400">
              Các bé sẽ thấy ảnh này ở màn hình đăng nhập và khi đổi bé.
            </p>
            {value && (
              <button
                type="button"
                onClick={() => choose(null)}
                disabled={busy}
                className="shrink-0 text-xs font-medium text-slate-500 underline disabled:opacity-60"
              >
                Bỏ chọn
              </button>
            )}
          </div>

          {error && (
            <p role="alert" className="mt-2 text-sm text-red-700">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
