"use client";

import { useEffect } from "react";

/**
 * Pings the session renewal endpoint once when an authenticated layout mounts.
 *
 * Renewal cannot happen in the proxy (see app/api/auth/keepalive/route.ts), so it is
 * triggered from the client instead. The endpoint is a no-op unless the session is
 * within a week of expiring, so the usual case costs one cheap request per page load
 * of the layout and no cookie change.
 *
 * Renders nothing and never surfaces an error: if it fails, the user simply stays on
 * their current session.
 */
export default function SessionKeepAlive() {
  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/auth/keepalive", {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal,
    }).catch(() => {
      // Intentionally ignored: renewal is best-effort.
    });

    return () => controller.abort();
  }, []);

  return null;
}
