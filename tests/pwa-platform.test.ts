/**
 * `src/components/pwa/platform.ts` — the detection rules that decide whether
 * the user sees an install hint, an install button, or nothing at all.
 *
 * These are plain string/touch-point rules precisely so they can be pinned
 * here: the interesting cases (Chrome on iOS, iPadOS masquerading as a Mac)
 * cannot be exercised from the app itself.
 */
import { describe, expect, it } from 'vitest';
import {
  INSTALL_DISMISS_STORAGE_KEY,
  isIos,
  isIosSafari,
  isStandalone,
} from '@/components/pwa/platform';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.6261.62 Mobile/15E148 Safari/604.1';
const IPHONE_FIREFOX =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/124.0 Mobile/15E148 Safari/605.1.15';
const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36';
const MAC_SAFARI =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
/** iPadOS 13+ in desktop mode: says Macintosh, but reports touch points. */
const IPAD_DESKTOP_MODE = MAC_SAFARI;

describe('isIosSafari', () => {
  it('accepts iOS Safari', () => {
    expect(isIosSafari(IPHONE_SAFARI)).toBe(true);
  });

  it('rejects Chrome and Firefox on iOS, which cannot install a PWA', () => {
    expect(isIosSafari(IPHONE_CHROME)).toBe(false);
    expect(isIosSafari(IPHONE_FIREFOX)).toBe(false);
    expect(isIos(IPHONE_CHROME)).toBe(true); // still iOS, just not Safari
  });

  it('rejects Android and desktop browsers', () => {
    expect(isIosSafari(ANDROID_CHROME)).toBe(false);
    expect(isIosSafari(MAC_SAFARI, 0)).toBe(false);
  });

  it('accepts an iPad in desktop mode via the touch-point count', () => {
    expect(isIosSafari(IPAD_DESKTOP_MODE, 5)).toBe(true);
    expect(isIosSafari(IPAD_DESKTOP_MODE, 0)).toBe(false);
  });
});

describe('isStandalone', () => {
  it('honours either the iOS flag or the display-mode media query', () => {
    expect(isStandalone(true, false)).toBe(true);
    expect(isStandalone(false, true)).toBe(true);
    expect(isStandalone(true, true)).toBe(true);
    expect(isStandalone(false, false)).toBe(false);
  });
});

describe('install dismissal key', () => {
  it('is namespaced and versioned, so a copy change can re-ask', () => {
    expect(INSTALL_DISMISS_STORAGE_KEY).toBe('tasktick:pwa:install-dismissed:v1');
  });
});
