"use client";

import { useEffect, useState } from "react";

/**
 * "Turn on notifications" for this device.
 *
 * Everything here is dictated by how Safari on iOS and iPadOS actually works, so the
 * constraints are worth stating plainly:
 *
 *  - Web Push exists only for a web app that has been added to the Home Screen. In a
 *    normal Safari tab `window.pushManager` is not even defined, which is why the most
 *    useful thing this component can do in that case is explain the install step
 *    rather than offer a button that cannot work.
 *  - iOS/iPadOS 18.4 and later can display a notification with no service worker at
 *    all (Declarative Web Push). This app deliberately ships no service worker: there
 *    is nothing worth caching, and a stale cache is a much worse failure for a family
 *    app than a missing notification. So this is the only path supported.
 *  - The permission prompt has to come from a tap. iOS ignores a request made on page
 *    load, so it lives inside the click handler below and nowhere else.
 */

declare global {
  interface Window {
    /**
     * Declarative Web Push exposes the Push API on `window`, so a subscription no
     * longer requires a service worker registration. Not in TypeScript's DOM lib yet.
     */
    pushManager?: {
      subscribe(options: {
        userVisibleOnly: boolean;
        applicationServerKey: BufferSource;
      }): Promise<PushSubscription>;
      getSubscription(): Promise<PushSubscription | null>;
    };
  }
}

type Status = "checking" | "hidden" | "needs-install" | "ready" | "denied" | "working";

const DISMISS_KEY = "kidchore:push-prompt-dismissed";

/**
 * The VAPID key arrives base64url; the Push API wants raw bytes.
 *
 * The return type is spelled `Uint8Array<ArrayBuffer>` rather than plain `Uint8Array`
 * on purpose: since TypeScript 5.7 the bare form is generic over `ArrayBufferLike`,
 * which includes `SharedArrayBuffer` and is not assignable to `BufferSource`.
 */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(normalised);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) {
    bytes[index] = raw.charCodeAt(index);
  }
  return bytes;
}

function isIos(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

function isDismissed(): boolean {
  return window.localStorage.getItem(DISMISS_KEY) === "1";
}

/** Posts a subscription so the server can attach it to the signed-in session. */
async function publishSubscription(subscription: PushSubscription): Promise<boolean> {
  const response = await fetch("/api/push/subscription", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(subscription.toJSON()),
  });
  return response.ok;
}

/**
 * Works out what, if anything, this device needs to be told.
 *
 * Async on purpose. The result can only be known in the browser, so it cannot be part
 * of the first render, but resolving it through a promise keeps the state update out
 * of the effect body - a synchronous `setState` there forces a second render before
 * the browser has painted anything.
 */
async function detect(vapidPublicKey: string): Promise<Status> {
  if (!vapidPublicKey || !("Notification" in window)) return "hidden";

  // Already agreed: refresh silently. This is what keeps the stored row's
  // last_seen_at honest and repairs an endpoint Safari has rotated since last visit.
  if (Notification.permission === "granted" && window.pushManager) {
    try {
      const existing = await window.pushManager.getSubscription();
      if (existing) await publishSubscription(existing);
    } catch {
      // A failed refresh changes nothing for the user; the next open tries again.
    }
    return "hidden";
  }

  if (Notification.permission === "denied") {
    return isDismissed() ? "hidden" : "denied";
  }

  // The case that actually confuses people: on an iPhone in a Safari tab there is no
  // push at all, and no amount of tapping would change that.
  if (!window.pushManager) {
    return isIos() && !isDismissed() ? "needs-install" : "hidden";
  }

  return isDismissed() ? "hidden" : "ready";
}

export default function EnableNotifications({ vapidPublicKey }: { vapidPublicKey: string }) {
  const [status, setStatus] = useState<Status>("checking");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void detect(vapidPublicKey).then((next) => {
      if (!cancelled) setStatus(next);
    });
    return () => {
      cancelled = true;
    };
  }, [vapidPublicKey]);

  async function enable() {
    setStatus("working");
    setMessage(null);
    try {
      // Must be inside the tap handler: iOS ignores a permission request that is not
      // tied to a user gesture.
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setStatus(permission === "denied" ? "denied" : "ready");
        return;
      }

      const subscription = await window.pushManager?.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      });

      if (!subscription) {
        setStatus("ready");
        setMessage("Thiết bị chưa tạo được đăng ký nhận thông báo.");
        return;
      }

      if (!(await publishSubscription(subscription))) {
        setStatus("ready");
        setMessage("Không lưu được đăng ký. Thử lại sau nhé.");
        return;
      }

      setStatus("hidden");
    } catch (error) {
      setStatus("ready");
      setMessage(
        error instanceof Error
          ? `Không bật được thông báo: ${error.message}`
          : "Không bật được thông báo."
      );
    }
  }

  function dismiss() {
    window.localStorage.setItem(DISMISS_KEY, "1");
    setStatus("hidden");
  }

  if (status === "checking" || status === "hidden") return null;

  return (
    <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm">
      {status === "needs-install" ? (
        <>
          <p className="font-semibold text-violet-900">Bật thông báo trên iPhone/iPad</p>
          <p className="mt-1 text-slate-700">
            Safari chỉ cho web app nhận thông báo khi đã được thêm vào Màn hình chính.
          </p>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-slate-700">
            <li>
              Mở trang này bằng <strong>Safari</strong> (không dùng Chrome hay Cốc Cốc).
            </li>
            <li>
              Bấm nút <strong>Chia sẻ</strong> (hình vuông có mũi tên chỉ lên).
            </li>
            <li>
              Chọn <strong>Thêm vào Màn hình chính</strong>.
            </li>
            <li>Mở KidChore từ biểu tượng vừa thêm, rồi quay lại đây bật thông báo.</li>
          </ol>
        </>
      ) : status === "denied" ? (
        <>
          <p className="font-semibold text-violet-900">Thông báo đang bị tắt</p>
          <p className="mt-1 text-slate-700">
            Vào <strong>Cài đặt → Thông báo → KidChore</strong> và bật lại, rồi mở lại app.
          </p>
        </>
      ) : (
        <>
          <p className="font-semibold text-violet-900">Bật thông báo cho thiết bị này</p>
          <p className="mt-1 text-slate-700">
            Báo khi bé làm xong việc cần duyệt, khi bé được thưởng điểm, hoặc khi yêu cầu đổi
            quà được duyệt.
          </p>
          {message ? <p className="mt-2 text-rose-700">{message}</p> : null}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                void enable();
              }}
              disabled={status === "working"}
              className="rounded-lg bg-violet-600 px-4 py-2 font-semibold text-white transition hover:bg-violet-700 disabled:opacity-60"
            >
              {status === "working" ? "Đang bật..." : "Bật thông báo"}
            </button>
            <button
              type="button"
              onClick={dismiss}
              className="rounded-lg px-4 py-2 font-medium text-slate-600 transition hover:bg-violet-100"
            >
              Để sau
            </button>
          </div>
        </>
      )}

      {status === "needs-install" || status === "denied" ? (
        <button
          type="button"
          onClick={dismiss}
          className="mt-3 rounded-lg px-3 py-1.5 text-xs font-medium text-slate-600 transition hover:bg-violet-100"
        >
          Để sau
        </button>
      ) : null}
    </div>
  );
}
