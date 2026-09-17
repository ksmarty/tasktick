/**
 * The app background per appearance, for the OS-drawn chrome.
 *
 * These mirror `--bg` in `globals.css` (`#f2f2f7` light, `#000000` dark). They
 * are duplicated rather than read from the stylesheet because `theme-color` has
 * to be correct in the very first HTML response — before any CSS is parsed and
 * long before a script could read a custom property back out.
 *
 * Keep them in step with `--bg`. If `--bg` ever changes, this is the other place.
 */
export const THEME_COLOR = {
  light: '#f2f2f7',
  dark: '#000000',
} as const;

export type ResolvedAppearance = keyof typeof THEME_COLOR;
