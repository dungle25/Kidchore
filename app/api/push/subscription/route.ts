import { getAuthContext } from "@/lib/dal";
import {
  removePushSubscription,
  savePushSubscription,
  type BrowserSubscription,
} from "@/lib/push";

/**
 * Registers or forgets this browser as a notification target for the signed-in user.
 *
 * A route handler rather than a Server Action because the browser has to post a
 * `PushSubscription` object straight from the Push API, and the reply has to be
 * readable as data: a Server Action returns a re-rendered tree, which the caller of
 * `pushManager.subscribe()` has no use for.
 *
 * The session is resolved here and passed down; nothing about WHO this is comes from
 * the request body. `lib/push.ts` explains why the recipient rules live in the
 * database and not in this file.
 */

const NO_STORE = { "cache-control": "no-store" } as const;

function json(body: unknown, status: number) {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function POST(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return json({ error: "NOT_AUTHENTICATED" }, 401);

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const result = await savePushSubscription(
    ctx,
    payload as BrowserSubscription,
    request.headers.get("user-agent")
  );

  if (!result.ok) return json({ error: result.error }, 400);
  return json({ ok: true }, 201);
}

export async function DELETE(request: Request) {
  const ctx = await getAuthContext();
  if (!ctx) return json({ error: "NOT_AUTHENTICATED" }, 401);

  let payload: { endpoint?: unknown };
  try {
    payload = (await request.json()) as { endpoint?: unknown };
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const result = await removePushSubscription(ctx, payload?.endpoint);
  if (!result.ok) return json({ error: result.error }, 400);
  return json({ ok: true }, 200);
}
