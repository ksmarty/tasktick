/**
 * Pure platform detection for the PWA layer.
 *
 * Every function takes its inputs explicitly instead of reading `window` at
 * module scope, so a component can compute one snapshot inside `useEffect`
 * (never during render, which would desync from the server) and so the rules
 * are unit-testable without a DOM.
 */

const IOS_DEVICE = /iPhone|iPad|iPod/;

/**
 * Non-Safari browsers on iOS. They are all WebKit under the hood, but none of
 * them exposes "Add to Home Screen" to the page, so the install hint must not
 * be shown inside them.
 */
const IOS_NON_SAFARI = /CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo|Mercury|YaBrowser|GSA/;

/**
 * Any iOS/iPadOS browser. iPadOS 13+ defaults to a desktop UA that claims to be
 * a Mac, which is why the touch-point count is consulted as well.
 */
export function isIos(userAgent: string, maxTouchPoints = 0): boolean {
  if (IOS_DEVICE.test(userAgent)) return true;
  return /Macintosh/.test(userAgent) && maxTouchPoints > 1;
}

/** iOS/iPadOS Safari specifically — the only iOS browser that can install a PWA. */
export function isIosSafari(userAgent: string, maxTouchPoints = 0): boolean {
  if (!isIos(userAgent, maxTouchPoints)) return false;
  return !IOS_NON_SAFARI.test(userAgent);
}

/**
 * Already installed. iOS Safari predates `display-mode` and sets the legacy
 * non-standard `navigator.standalone` flag, so either signal is enough.
 */
export function isStandalone(navigatorStandalone: boolean, displayModeStandalone: boolean): boolean {
  return navigatorStandalone || displayModeStandalone;
}

/**
 * Versioned key for "the user dismissed the install banner for good".
 * Bump the suffix when the banner's wording changes materially, so a dismissal
 * of the old copy does not silence the new one forever.
 */
export const INSTALL_DISMISS_STORAGE_KEY = 'tasktick:pwa:install-dismissed:v1';
