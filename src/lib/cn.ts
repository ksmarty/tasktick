/**
 * Class-name helper.
 *
 * ## Why tailwind-merge needs teaching here
 *
 * `tailwind-merge` resolves conflicts by recognising which class group a utility
 * belongs to, so the LAST one wins — the whole point of using it. But it ships
 * with Tailwind's default vocabulary, and this project's type ramp and semantic
 * colours are custom (`text-footnote`, `text-secondary`, `rounded-ios-lg`, …).
 *
 * For an unrecognised `text-*` value it cannot tell whether it is a font size or
 * a text colour, so it puts both in the same group and keeps only the last:
 *
 *   twMerge('text-footnote text-secondary')  ->  'text-secondary'
 *
 * The font size silently disappears and the element inherits the body size. That
 * is a quiet, app-wide regression — text just looks slightly wrong everywhere and
 * nothing errors — so the tokens are declared explicitly below.
 *
 * The lists mirror `@theme` in `src/app/globals.css`. If you add a font size or a
 * semantic colour there, add it here too, or it will be dropped the first time
 * someone combines it with another `text-*` class.
 * `tests/cn.test.ts` fails if the two lists drift apart.
 */
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/** The `--text-*` ramp from globals.css. */
export const FONT_SIZE_TOKENS = [
  'large-title',
  'title-1',
  'title-2',
  'title-3',
  'headline',
  'body',
  'callout',
  'subhead',
  'footnote',
  'caption-1',
  'caption-2',
] as const;

/** Every semantic and palette colour usable as `text-<name>`. */
export const TEXT_COLOR_TOKENS = [
  // semantic
  'label',
  'secondary',
  'tertiary',
  'quaternary',
  'on-tint',
  'tint',
  'tint-soft',
  'tint-contrast',
  'success',
  'warning',
  'danger',
  // surfaces, usable as text colours in inverted contexts
  'bg',
  'elevated',
  'card',
  'sheet',
  'inset',
  'chrome',
  'overlay',
  'separator',
  'separator-opaque',
  'fill',
  'fill-secondary',
  'fill-tertiary',
  'fill-quaternary',
  // the iOS system palette
  'ios-blue',
  'ios-indigo',
  'ios-purple',
  'ios-pink',
  'ios-red',
  'ios-orange',
  'ios-yellow',
  'ios-green',
  'ios-teal',
  'ios-cyan',
  'ios-gray',
  'ios-brown',
] as const;

/** The `--radius-ios-*` scale. */
export const RADIUS_TOKENS = ['ios-sm', 'ios', 'ios-md', 'ios-lg', 'ios-xl', 'ios-2xl'] as const;

/** The `--shadow-ios-*` scale. */
export const SHADOW_TOKENS = ['ios-sm', 'ios', 'ios-lg'] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      // Declaring these as siblings is what stops `text-<size>` and
      // `text-<colour>` from being treated as the same conflicting group.
      'font-size': [{ text: [...FONT_SIZE_TOKENS] }],
      'text-color': [{ text: [...TEXT_COLOR_TOKENS] }],
      rounded: [{ rounded: [...RADIUS_TOKENS] }],
      shadow: [{ shadow: [...SHADOW_TOKENS] }],
    },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
