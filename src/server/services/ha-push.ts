/**
 * The Home Assistant transport: one POST to the webhook the integration registered.
 *
 * ## Why a webhook rather than an HA service call in TaskTick
 *
 * The other direction would need Home Assistant to be reachable from this app or
 * a long-lived token held here. It is the integration that is already talking to
 * TaskTick — it authenticates with the user's API token on every poll — so Home
 * Assistant owns the endpoint and this app only has to POST to the URL it was
 * given. Nothing else about the integration is reachable from TaskTick, and no
 * Home Assistant credential is ever stored here.
 *
 * ## What is sent
 *
 * The payload is exactly the app's own {@link NotificationPayload}, which is what
 * makes the two transports interchangeable: title, body, the app path a tap opens,
 * the tag that collapses a repeated reminder, and the buttons with the item they
 * report back. The integration turns that into a notification and absolutizes the
 * path with the server address it was configured with.
 *
 * ## Failure is never fatal
 *
 * Like the other transports here, this one resolves rather than throwing, and
 * reports whether Home Assistant took the reminder. The caller (`deliverQuietly`
 * in `src/server/services/reminders.ts`) falls back to the app's own push when it
 * did not, so a Home Assistant that is down — or a webhook that was removed —
 * costs a slower notification rather than a lost one.
 */
import type { NotificationPayload } from './notifications';

/** A Home Assistant that is not answering must not hold the reminder loop open. */
export const HA_PUSH_TIMEOUT_MS = 10_000;

/** The result of one attempt. Never thrown — always returned. */
export interface HaPushDelivery {
  /** True when Home Assistant accepted the reminder. */
  delivered: boolean;
  status?: number;
  error?: string;
}

/**
 * POSTs one reminder to a registered Home Assistant webhook.
 *
 * `fetchImpl` is a seam for tests, the same one `sendApprise` uses. Only a 2xx is
 * an acceptance: Home Assistant answers 404 for a webhook that no longer exists
 * (the integration was removed while TaskTick still had the URL) and 5xx when the
 * delivery itself failed, and both have to bring the fallback into play.
 */
export async function sendToHomeAssistant(
  webhookUrl: string,
  payload: NotificationPayload,
  fetchImpl: typeof fetch = fetch,
): Promise<HaPushDelivery> {
  const url = webhookUrl?.trim() ?? '';
  if (!url) return { delivered: false, error: 'no-webhook' };

  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(HA_PUSH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        delivered: false,
        status: response.status,
        error: `Home Assistant responded ${response.status}`,
      };
    }
    return { delivered: true, status: response.status };
  } catch (error) {
    return {
      delivered: false,
      error: error instanceof Error ? error.message : 'Home Assistant request failed',
    };
  }
}
