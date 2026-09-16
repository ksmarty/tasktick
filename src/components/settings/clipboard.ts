'use client';

/**
 * Clipboard helpers for the very short strings this app copies: invitation links
 * and calendar subscription URLs.
 *
 * `navigator.clipboard` needs a secure context and, on some browsers, a
 * permission; the deprecated `execCommand('copy')` path is kept as the fallback
 * because a self-hosted instance on plain HTTP over a LAN would otherwise have
 * no way to copy at all. Both outcomes are reported so the caller can toast the
 * truth instead of pretending the copy worked.
 */

/** Copies `text`, returning whether it actually made it to the clipboard. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '0';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}

/**
 * The Apple Calendar variant of a subscription URL.
 *
 * `webcal://` is what makes iOS and macOS hand the URL to Calendar instead of
 * showing the file as text; the server only ever needs to serve the `https://`
 * form.
 */
export function toWebcal(url: string): string {
  return url.replace(/^https?:\/\//i, 'webcal://');
}

/** The same URL with `http(s)://` made explicit, for display. */
export function ensureHttp(url: string): string {
  return /^https?:\/\//i.test(url) ? url : `https://${url}`;
}
