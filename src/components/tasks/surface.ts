/**
 * Shared presentation constants for the task screens.
 *
 * The section cards, the Today summary card and the empty states are all GodUI
 * `LiquidGlassCard`s. Their tint is stated once here so the three cannot drift:
 * a near-card surface with a touch of foreground mixed in, which is what makes
 * the panel read as a distinct sheet in *both* appearances — the palette's
 * `--card` is white in light mode and near-white is the page, so a plain
 * translucent white would vanish on a light background.
 */
export const GLASS_TINT = 'color-mix(in oklab, var(--card) 94%, var(--foreground))';
