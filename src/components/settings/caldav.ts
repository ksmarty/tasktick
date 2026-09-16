/**
 * CalDAV presentation helpers.
 *
 * The important one is `caldavErrorMessage`: the server reports what the remote
 * server said, which for iCloud is an opaque 401 that no user can act on. The
 * client's job is to turn that into the instruction they actually need — an
 * app-specific password — because the alternative is a support thread.
 */
import { relativeTimeAgo } from '@/lib/dates';
import type { CaldavAccount } from '@/lib/types';

/** Hosts that will only accept an app-specific password rather than the account password. */
const APP_PASSWORD_HOSTS = [/icloud\.com/i, /me\.com/i, /mac\.com/i];

/** Responses that mean "the credentials were rejected". */
const AUTH_FAILURE = /(401|403|unauthor|forbidden|invalid (credentials|password)|authentication|not authenticated|login failed|access denied)/i;
/** Responses that mean the URL or the well-known path is wrong. */
const URL_FAILURE = /(404|405|not found|no principal|well-known|bad url|invalid url)/i;
/** Transport-level failures, which are usually worth retrying. */
const NETWORK_FAILURE = /(fetch failed|network|timeout|timed out|econnrefused|enotfound|socket|502|503|504)/i;

export function isIcloudServer(serverUrl: string): boolean {
  return APP_PASSWORD_HOSTS.some((pattern) => pattern.test(serverUrl));
}

/**
 * A message a person can act on, or `null` when there is no error.
 *
 * `serverUrl` decides which advice is offered: an iCloud account whose password
 * was rejected needs an app-specific password, and telling the user that is more
 * useful than echoing "CalDAV request failed with status 401".
 */
export function caldavErrorMessage(error: string | null | undefined, serverUrl: string): string | null {
  if (!error) return null;

  if (AUTH_FAILURE.test(error)) {
    if (isIcloudServer(serverUrl)) {
      return 'iCloud rejected that password. iCloud does not accept your Apple Account password for CalDAV — create an app-specific password at appleid.apple.com under Sign-In & Security, then paste that here instead.';
    }
    return `The server rejected those credentials. Check the username, and use an app-specific password if your provider offers them. (${error})`;
  }

  if (URL_FAILURE.test(error)) {
    return `No calendars were found at that address. For Apple, the server URL is https://caldav.icloud.com; for Fastmail it is https://caldav.fastmail.com. (${error})`;
  }

  if (NETWORK_FAILURE.test(error)) {
    return `The server could not be reached. If this is a local address, check that TaskTick can route to it from its container. (${error})`;
  }

  return error;
}

/** `Synced 5m ago`, `Syncing…`, `Never synced`. */
export function syncStatusLabel(account: Pick<CaldavAccount, 'lastSyncAtMs' | 'lastSyncStatus' | 'enabled'>, nowMs = Date.now()): string {
  if (!account.enabled) return 'Disabled';
  if (account.lastSyncStatus === 'running') return 'Syncing…';
  if (!account.lastSyncAtMs) return 'Never synced';
  const ago = relativeTimeAgo(account.lastSyncAtMs, nowMs);
  return ago === 'just now' ? 'Synced just now' : `Synced ${ago}`;
}

/** Badge tone for the account's last run. */
export function syncStatusTone(account: Pick<CaldavAccount, 'lastSyncStatus' | 'lastError' | 'enabled'>): 'default' | 'tint' | 'danger' {
  if (!account.enabled) return 'default';
  if (account.lastSyncStatus === 'error' || account.lastError) return 'danger';
  if (account.lastSyncStatus === 'running') return 'tint';
  return 'default';
}

/** Short status word for the badge. */
export function syncStatusWord(account: Pick<CaldavAccount, 'lastSyncStatus' | 'lastError' | 'enabled'>): string {
  if (!account.enabled) return 'Off';
  if (account.lastError) return 'Error';
  if (account.lastSyncStatus === 'running') return 'Syncing';
  if (account.lastSyncStatus === 'success') return 'OK';
  return 'Idle';
}

/** Advice about how to connect, shown in the account form. */
export const CALDAV_HELP = {
  icloud:
    'iCloud requires an app-specific password: sign in at appleid.apple.com, open Sign-In & Security, choose App-Specific Passwords and generate one for TaskTick. Your Apple Account password will not work.',
  server: 'The server URL is the CalDAV root, for example https://caldav.icloud.com or https://caldav.fastmail.com.',
  password: 'Stored encrypted on your server and never sent back to this page, so it is write-only after saving.',
} as const;
