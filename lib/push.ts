import "server-only";
import { headers } from "next/headers";
import webpush from "web-push";
import { callRpc, type AuthContext } from "./dal";
import { getVapidDetails, hasPushConfig, vapidPublicKey } from "./env";

/**
 * Sending web push notifications.
 *
 * The split of responsibility is deliberate and worth stating, because the obvious
 * design - read the recipients' subscriptions with the service role and send - is the
 * one that must not be used here:
 *
 *   * the database decides WHO may be told about an event, and what the message says
 *     (public.push_recipients), authorized from the caller's own session;
 *   * this file only encrypts and delivers what it is handed.
 *
 * That keeps identity resolution in one place, next to the data, instead of spread
 * across a server action and a service-role query.
 *
 * Nothing here ever throws. A push is a courtesy on top of an action the family
 * already performed; failing to deliver it must not fail the action that triggered it,
 * or a flaky push service becomes "I can't approve my child's chore".
 */

export type PushEventKind =
  | "TASK_SUBMITTED"
  | "REWARD_REQUESTED"
  | "TASK_APPROVED"
  | "TASK_REJECTED"
  | "TASK_ASSIGNED"
  | "REDEMPTION_APPROVED"
  | "REDEMPTION_REJECTED"
  | "POINTS_CHANGED";

/** One row of public.push_recipients(): a device, and the message to show on it. */
interface PushTarget {
  recipient_user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  title: string;
  body: string;
  url: string;
  tag: string | null;
}

export interface PushOutcome {
  /** How many messages the push service accepted. */
  sent: number;
  /** Devices the push service says are gone. Their rows are left alone; see below. */
  expired: number;
  /** Anything else that went wrong, one line each, already formatted for a log. */
  errors: string[];
  /** Set when nothing was attempted, with the reason. */
  skipped?: "not-configured" | "no-recipients";
}

/**
 * The shape a browser hands back from `pushManager.subscribe()`.
 *
 * `keys` is optional in the type on purpose: a malformed or truncated subscription is
 * something a caller can actually receive, and it must be rejected by a clear check
 * rather than by a crash on `subscription.keys.p256dh` further down.
 */
export interface BrowserSubscription {
  endpoint?: unknown;
  keys?: { p256dh?: unknown; auth?: unknown };
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Stores this device's subscription for the signed-in user.
 *
 * The user id is not a parameter: `register_push_subscription` reads it from the
 * session, so a caller cannot attach their device to somebody else's account. The
 * database is also where the endpoint shape is validated - see the migration for why
 * that check belongs there rather than here.
 *
 * Called again on every app open, which is what keeps `last_seen_at` meaningful and
 * repairs an endpoint the browser has rotated.
 */
export async function savePushSubscription(
  ctx: AuthContext,
  subscription: BrowserSubscription,
  userAgent: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const endpoint = asString(subscription?.endpoint);
  const p256dh = asString(subscription?.keys?.p256dh);
  const auth = asString(subscription?.keys?.auth);

  if (!endpoint || !p256dh || !auth) {
    return { ok: false, error: "INVALID_SUBSCRIPTION" };
  }

  try {
    await callRpc(ctx.db, "register_push_subscription", {
      p_endpoint: endpoint,
      p_p256dh: p256dh,
      p_auth: auth,
      // Truncated in the database; the column is a diagnostic aid, not data.
      p_user_agent: userAgent,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "UNKNOWN",
    };
  }
}

/**
 * Forgets this device. Only the caller's own rows can be deleted, so passing somebody
 * else's endpoint is a no-op rather than a cross-account write.
 */
export async function removePushSubscription(
  ctx: AuthContext,
  endpoint: unknown
): Promise<{ ok: true } | { ok: false; error: string }> {
  const value = asString(endpoint);
  if (!value) return { ok: false, error: "INVALID_ENDPOINT" };

  try {
    await callRpc(ctx.db, "delete_push_subscription", { p_endpoint: value });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "UNKNOWN",
    };
  }
}

let vapidConfigured = false;

/** Configures the VAPID pair once per process. Throws only on a malformed subject. */
function ensureVapid() {
  if (vapidConfigured) return;
  const { privateKey, subject } = getVapidDetails();
  // `web-push` validates the subject here and rejects anything that is neither a
  // mailto: address nor an https: URL, so a bad VAPID_SUBJECT fails once with a clear
  // message instead of on every single notification.
  webpush.setVapidDetails(subject, vapidPublicKey, privateKey);
  vapidConfigured = true;
}

/**
 * The absolute origin to navigate to when a notification is tapped.
 *
 * A push payload must not carry a relative URL: the notification is displayed by the
 * browser with no page context, so there is nothing to resolve against. Behind
 * Vercel the real host is in `x-forwarded-host`; `host` is the fallback for a local
 * run.
 */
async function appOrigin(): Promise<string> {
  const store = await headers();
  const host = store.get("x-forwarded-host") ?? store.get("host") ?? "localhost:3000";
  const proto = store.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * The payload body.
 *
 * This is the Declarative Web Push format: `web_push: 8030` opts the message into it,
 * and the browser can then display the notification itself, without a service worker.
 * Every device in this family is on iOS/iPadOS 18.4 or later, which is where Safari
 * shipped it, so the app deliberately has no service worker at all.
 *
 * The `navigate` key is what makes the notification useful rather than decorative: it
 * is where the browser goes when the notification is tapped. Older browsers pass the
 * JSON to a service worker instead; there is none here, so on iOS 16.4-18.3 a push
 * would be accepted and not shown. That is a deliberate trade for not shipping a
 * service worker, and it is why this is documented rather than silently assumed.
 */
function buildPayload(target: PushTarget, origin: string) {
  return JSON.stringify({
    web_push: 8030,
    notification: {
      title: target.title,
      body: target.body,
      navigate: new URL(target.url, origin).toString(),
      lang: "vi",
      dir: "ltr",
      silent: false,
      ...(target.tag ? { tag: target.tag } : {}),
    },
  });
}

/** True when the push service says this subscription no longer exists. */
function isGone(error: unknown): boolean {
  const status = (error as { statusCode?: number })?.statusCode;
  return status === 404 || status === 410;
}

/**
 * Tells the right people about something that just happened.
 *
 * Call it *after* the database write it describes, and await it: on a serverless
 * platform the process may be frozen the moment the response is sent, so a
 * fire-and-forget promise is a promise that never runs.
 */
export async function notifyEvent(
  ctx: AuthContext,
  kind: PushEventKind,
  subjectId: string,
  options: { amount?: number } = {}
): Promise<PushOutcome> {
  const outcome: PushOutcome = { sent: 0, expired: 0, errors: [] };

  if (!hasPushConfig()) {
    outcome.skipped = "not-configured";
    return outcome;
  }

  let targets: PushTarget[];
  try {
    targets = await callRpc<PushTarget[]>(ctx.db, "push_recipients", {
      p_kind: kind,
      p_subject_id: subjectId,
      p_amount: options.amount ?? null,
    });
  } catch (error) {
    // A rejection here is a bug in the call site - a wrong subject id, or an event
    // raised by the wrong role - and the database message says which. It must still
    // not break the action that triggered it, but it should be visible.
    outcome.errors.push(
      `push_recipients(${kind}) failed: ${error instanceof Error ? error.message : String(error)}`
    );
    console.error("[push]", outcome.errors[outcome.errors.length - 1]);
    return outcome;
  }

  if (!targets || targets.length === 0) {
    outcome.skipped = "no-recipients";
    return outcome;
  }

  let origin: string;
  try {
    origin = await appOrigin();
    ensureVapid();
  } catch (error) {
    outcome.errors.push(error instanceof Error ? error.message : String(error));
    console.error("[push] could not configure VAPID:", outcome.errors[0]);
    return outcome;
  }

  const results = await Promise.allSettled(
    targets.map((target) =>
      webpush.sendNotification(
        { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
        buildPayload(target, origin),
        {
          // Keep the message for half a day: a notification about a finished chore is
          // still worth seeing this evening, and pointless tomorrow.
          TTL: 12 * 60 * 60,
          headers: { Urgency: "high" },
        }
      )
    )
  );

  results.forEach((result, index) => {
    if (result.status === "fulfilled") {
      outcome.sent += 1;
      return;
    }
    if (isGone(result.reason)) {
      // The device unsubscribed or was wiped. The row is deliberately NOT deleted
      // here: deleting another user's row is exactly the kind of cross-account write
      // the schema forbids, and a child's session must not be able to prune a
      // parent's device. The owner's next app open re-registers or replaces it, and
      // scripts/cleanup-fixtures.mjs can prune rows nobody has refreshed in months.
      outcome.expired += 1;
      console.info(
        `[push] ${kind}: subscription for user ${targets[index].recipient_user_id} is gone (${result.reason?.statusCode})`
      );
      return;
    }
    const message = result.reason instanceof Error ? result.reason.message : String(result.reason);
    outcome.errors.push(message);
    console.error(`[push] ${kind} to ${targets[index].recipient_user_id} failed:`, message);
  });

  return outcome;
}
