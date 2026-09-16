'use client';

/**
 * Web Push plumbing for the settings screen.
 *
 * Kept out of the component so the platform rules are explicit and reviewable:
 * iOS only exposes Web Push to a PWA launched from the Home Screen, a denied
 * permission can never be asked for again, and a self-hosted server without VAPID
 * keys cannot deliver anything at all. The UI reports the first condition as an
 * instruction, the second as a dead end, and the third as a configuration gap —
 * never as a generic failure.
 */

/** VAPID keys travel as URL-safe base64; `subscribe()` wants raw bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = padded.replace(/-/g, '+').replace(/_/g, '/');
  const binary = window.atob(normalised);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

export type PushState =
  /** Everything is in place; the switch can be flipped. */
  | 'ready'
  /** This browser has no Notification API at all. */
  | 'unsupported'
  /** iOS in a browser tab: the app has to be installed first. */
  | 'needs-install'
  /** The user said no; the browser will not ask again. */
  | 'denied'
  /** The server has no VAPID keys, so nothing could be delivered. */
  | 'server-not-configured';

export interface PushEnvironment {
  notificationSupported: boolean;
  /** iOS or iPadOS. */
  ios: boolean;
  /** Running from the Home Screen (`display-mode: standalone`). */
  standalone: boolean;
  permission: NotificationPermission | null;
  /** Whether the server reported usable VAPID keys. */
  serverPush: boolean;
}

/** Which of the five situations the device is in, in priority order. */
export function pushStateFor(environment: PushEnvironment): PushState {
  if (!environment.notificationSupported) {
    // On iOS the API is missing *because* the page is not installed, which is a
    // fixable situation and deserves an explanation rather than "unsupported".
    return environment.ios ? 'needs-install' : 'unsupported';
  }
  if (environment.ios && !environment.standalone) return 'needs-install';
  if (!environment.serverPush) return 'server-not-configured';
  if (environment.permission === 'denied') return 'denied';
  return 'ready';
}

/** The sentence shown under the switch for each state. */
export const PUSH_STATE_MESSAGE: Record<PushState, string> = {
  ready: 'Notifications are delivered through your server to this device.',
  unsupported: 'This browser does not support Web Push. On Android, Chrome or Firefox can deliver notifications.',
  'needs-install':
    'On iPhone and iPad, notifications only work once TaskTick is added to the Home Screen. Open the Share menu in Safari, choose “Add to Home Screen”, then open TaskTick from the Home Screen and turn this on.',
  denied:
    'Notifications are blocked for this site. A browser will not ask again — re-enable them in the browser’s site settings, then come back.',
  'server-not-configured':
    'This server has no VAPID keys, so it cannot deliver push notifications. Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, then restart it.',
};

export function pushStateTone(state: PushState): 'default' | 'tint' | 'danger' {
  if (state === 'ready') return 'tint';
  if (state === 'denied' || state === 'server-not-configured') return 'danger';
  return 'default';
}

/** Rejects with `message` if `promise` has not settled inside `timeoutMs`. */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) window.clearTimeout(timer);
  }
}
