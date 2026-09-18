import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * The layout scale, as names.
 *
 * These mirror the `--spacing-*` tokens in `globals.css`. They are listed here
 * because `tailwind-merge` only knows Tailwind's built-in scales: without this,
 * `cn('py-6', 'p-card')` keeps *both* classes, and which one wins is then down
 * to the order Tailwind happened to emit them in the stylesheet — which puts the
 * custom token utilities *before* the numeric scale, so the component's own
 * `py-6` wins and the token is silently ignored.
 *
 * That is exactly the kind of invisible drift this migration exists to remove:
 * a card that asked for `p-card` renders with someone else's padding, and the
 * two screens disagree by 8px with nothing in the source to explain it.
 *
 * Declaring them here makes the token a first-class member of the padding,
 * margin and gap class groups, so the conflict resolves the way `cn()` promises:
 * last one wins, deterministically, whatever the stylesheet order.
 */
const LAYOUT_SPACING = ['gutter', 'card', 'row', 'stack', 'appbar', 'tabbar'];

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      p: [{ p: LAYOUT_SPACING }],
      px: [{ px: LAYOUT_SPACING }],
      py: [{ py: LAYOUT_SPACING }],
      pt: [{ pt: LAYOUT_SPACING }],
      pr: [{ pr: LAYOUT_SPACING }],
      pb: [{ pb: LAYOUT_SPACING }],
      pl: [{ pl: LAYOUT_SPACING }],
      m: [{ m: LAYOUT_SPACING }],
      mx: [{ mx: LAYOUT_SPACING }],
      my: [{ my: LAYOUT_SPACING }],
      mt: [{ mt: LAYOUT_SPACING }],
      mr: [{ mr: LAYOUT_SPACING }],
      mb: [{ mb: LAYOUT_SPACING }],
      ml: [{ ml: LAYOUT_SPACING }],
      gap: [{ gap: LAYOUT_SPACING }],
      'gap-x': [{ 'gap-x': LAYOUT_SPACING }],
      'gap-y': [{ 'gap-y': LAYOUT_SPACING }],
      h: [{ h: LAYOUT_SPACING }],
      w: [{ w: LAYOUT_SPACING }],
      size: [{ size: LAYOUT_SPACING }],
    },
  },
});

/**
 * Conditional class names, with Tailwind conflicts resolved.
 *
 * `twMerge` is what makes this more than `clsx`: given `px-4 px-6` it keeps only
 * the last, so a component's default padding can be overridden by a caller
 * without either side knowing the other's classes. Every component in the app
 * takes a `className` and passes it through here.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
