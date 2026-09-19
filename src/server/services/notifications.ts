/**
 * Outbound notification transport: Apprise.
 *
 * ## Why Apprise
 *
 * Web Push in an installed iOS PWA is unreliable once the app is closed — the
 * push service can drop a delivery and iOS gives no background wake-up — so a
 * self-hosted reminder is best fanned out through a gateway the user already
 * runs. [Apprise](https://github.com/caronc/apprise-api) is that gateway: it
 * accepts one HTTP POST and fans it out to ~100 services.
 *
 * ## The shape
 *
 * The Apprise API endpoint is `POST {base}/notify/{key}` with a JSON body of
 * `{ "title", "body", "type" }` (plus an optional `tag`). This is a plain
 * `fetch` — deliberately no dependency.
 *
 * ## Failure is never fatal
 *
 * Every function here resolves; none throws. A gateway that is down, a URL that
 * is malformed, a DNS failure or a timeout all come back as
 * `{ delivered: false, error }` and are logged by the caller. The reminder
 * pipeline must never break because a notification could not be sent.
 *
 * ## Where this sits in the delivery path
 *
 * Recon of this repository found **no server-side Web Push sender**: there is no
 * `web-push` dependency, nothing ever reads the stored `push_subscriptions`, and
 * the only `push` handler is the service worker's display path
 * (`public/sw.js`). `task_reminders` rows are created and marked `sent` on task
 * completion, but nothing dispatches them. So `deliverUserNotification` is the
 * single fan-out seam a dispatcher should call: it reads the user's Apprise
 * config and sends. When a Web Push sender is added, it belongs here, beside
 * Apprise, so a user with both configured gets both.
 */
import { getAppriseConfig, type AppriseConfig } from '@/server/repos/settings';

/** The notification types Apprise documents. */
export type AppriseNotificationType = 'info' | 'success' | 'warning' | 'failure';

export interface NotificationPayload {
  title: string;
  body: string;
  type?: AppriseNotificationType;
}

/** The result of one Apprise attempt. Never thrown — always returned. */
export interface AppriseDelivery {
  /** False when Apprise is not configured, so nothing was sent. */
  attempted: boolean;
  delivered: boolean;
  status?: number;
  error?: string;
}

/** A hung gateway must not hold the reminder loop open. */
export const APPRISE_TIMEOUT_MS = 10_000;

/** Only http(s) is usable, because the transport is `fetch`. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/** `https://gateway.example.com` + `abc` -> `https://gateway.example.com/notify/abc`. */
export function buildAppriseEndpoint(baseUrl: string, key: string): string {
  return `${baseUrl.trim().replace(/\/+$/, '')}/notify/${encodeURIComponent(key.trim())}`;
}

/**
 * The documented Apprise body. `tag` is only present when the user targets
 * specific tags, and is a comma-separated list, which is the shape the Apprise
 * API documents.
 */
export function buildAppriseBody(payload: NotificationPayload, tags: readonly string[] | null | undefined): Record<string, unknown> {
  const body: Record<string, unknown> = {
    title: payload.title,
    body: payload.body,
    type: payload.type ?? 'info',
  };
  const cleanTags = (tags ?? []).map((tag) => tag.trim()).filter(Boolean);
  if (cleanTags.length > 0) body.tag = cleanTags.join(',');
  return body;
}

/**
 * Sends one notification through Apprise. Resolves on every outcome; the caller
 * decides whether a failure is worth surfacing. `fetchImpl` is injectable so the
 * transport is testable without a network.
 */
export async function sendApprise(
  config: AppriseConfig,
  payload: NotificationPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<AppriseDelivery> {
  const base = config.url?.trim() ?? '';
  const key = config.key?.trim() ?? '';

  if (!base || !key) return { attempted: false, delivered: false, error: 'not-configured' };
  if (!isHttpUrl(base)) return { attempted: true, delivered: false, error: 'invalid-url' };

  try {
    const response = await fetchImpl(buildAppriseEndpoint(base, key), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(buildAppriseBody(payload, config.tags)),
      signal: AbortSignal.timeout(APPRISE_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        attempted: true,
        delivered: false,
        status: response.status,
        error: `Apprise responded ${response.status}`,
      };
    }
    return { attempted: true, delivered: true, status: response.status };
  } catch (error) {
    return {
      attempted: true,
      delivered: false,
      error: error instanceof Error ? error.message : 'Apprise request failed',
    };
  }
}

/**
 * The fan-out seam for a real notification. Today it delivers through Apprise
 * when the user has configured it; it is the place a Web Push sender belongs
 * too, so the two are additive rather than exclusive. It never throws, so a
 * scheduler tick can call it without a try/catch.
 */
export async function deliverUserNotification(
  userId: string,
  payload: NotificationPayload,
  deps: { fetchImpl?: typeof fetch; getConfig?: (userId: string) => Promise<AppriseConfig | null> } = {},
): Promise<{ apprise: AppriseDelivery }> {
  const config = await (deps.getConfig ?? getAppriseConfig)(userId).catch(() => null);
  const apprise = config
    ? await sendApprise(config, payload, deps.fetchImpl)
    : ({ attempted: false, delivered: false, error: 'not-configured' } as AppriseDelivery);

  if (apprise.attempted && !apprise.delivered) {
    console.warn(`[notify] Apprise delivery failed for user ${userId}: ${apprise.error ?? 'unknown error'}`);
  }
  return { apprise };
}

/** The body of the Settings "Send test notification" action. */
export const APPRISE_TEST_PAYLOAD: NotificationPayload = {
  title: 'TaskTick test notification',
  body: 'If you can read this, Apprise is configured correctly for this account.',
  type: 'info',
};
