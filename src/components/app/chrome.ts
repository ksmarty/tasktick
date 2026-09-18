/**
 * The shell's bottom chrome, stated once.
 *
 * On a phone the bottom band is the tab-bar pill plus the home-indicator
 * clearance, and a bottom sheet has to line its content up with the same edge.
 * Both the band (`AppShell`) and the sheet primitive (`godui/drawer`) read the
 * clearance from here so the two cannot drift: the sheet's content bottom lands
 * on the band's bottom instead of floating a safe-area above it.
 *
 * The value is a class rather than a number because `env()` is a device value,
 * not a design one — it has to stay in the utility so the safe-area inset and
 * the band's own reserve can be combined in `calc()`. `1.125rem` is the part of
 * the home-indicator inset the pill's own padding already covers, so the band
 * sits a third closer to the screen edge than the raw inset would allow.
 */
export const BOTTOM_BAND_CLEARANCE =
  'pb-[max(0.125rem,calc(env(safe-area-inset-bottom,0px)-1.125rem))]';
