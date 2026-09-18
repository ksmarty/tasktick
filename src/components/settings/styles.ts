/**
 * The settings area's shared style constants.
 *
 * Two shapes repeat across this area and were each re-derived per file in the MUI
 * version — which is exactly the failure the spacing scale exists to prevent:
 * three dialogs that are each *nearly* the same, and two URL boxes with different
 * padding. They are stated once here instead.
 *
 * Both are plain class strings rather than components: they are layout decisions
 * on shadcn's own primitives (`DialogContent`, a `<p>`), and wrapping a primitive
 * just to rename it is what the conventions forbid. `SETTINGS_ROW_CLASS` lives in
 * `./SettingsGroup` because that is the component that owns the row rhythm.
 */

/**
 * The sheet shell for a settings form.
 *
 * Every form here is a bottom sheet on a phone and a centred card from `sm` up: a
 * CalDAV account has seven fields, and a 2rem-inset floating card on a 390px
 * screen leaves a scroll box about three fields tall. Radix's `DialogContent` is
 * centred and viewport-inset by default, so the override is a viewport-sized box
 * on a phone (`h-dvh`, full width, square corners) and nothing above `sm`.
 *
 * The classes are responsive overrides of the primitive's own utilities
 * (`max-sm:` beats the unprefixed one, which is how `w-1/2 md:w-full` has always
 * worked), so no inline style and no arbitrary-value class is involved.
 */
export const SHEET_DIALOG_CLASS =
  'max-sm:h-dvh max-sm:max-w-none max-sm:overflow-y-auto max-sm:rounded-none max-sm:border-0 max-sm:p-card sm:max-w-lg';

/**
 * The box a credential-bearing URL is shown in: invitation links and calendar
 * subscription feeds. Monospace, selectable and wrapping — a long token must not
 * hand the page a horizontal scrollbar.
 */
export const MONO_URL_BOX_CLASS = 'rounded-md bg-muted p-3 font-mono text-xs break-all text-muted-foreground';
