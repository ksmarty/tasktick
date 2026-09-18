/**
 * The curated habit icon set.
 *
 * Only the *name* of the icon is persisted (`habits.icon` is a short string),
 * which keeps the database free of a React dependency and lets the set grow
 * without a migration. An unknown or missing name falls back to a target rather
 * than rendering nothing.
 *
 * The names are unchanged from the old set — they are the stored contract — but
 * each one now resolves to an icon component rather than to Material's
 * `SvgIconComponent`. `@svg-animated-icons/react` supplies every glyph the set
 * has one for (`target`, `heart`, `star`, `sun`, `moon`, `timer`, `zap`), and
 * `lucide-react` covers the rest: a habit icon is decoration, and the animated
 * set has no droplet, dumbbell or coffee cup.
 *
 * Both sets are exposed through one prop shape (`className`, plus the animated
 * set's `disableHover`), and both draw at `1em`, so a caller sizes a glyph with
 * a text-size class — `text-xl` is a 20px icon in either set. That is the only
 * reason for the `lucideReact` adapter below: the animated icons are `1em` by
 * their own stylesheet, and lucide's default is a fixed 24px attribute.
 */
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Bike,
  Book,
  Brain,
  Coffee,
  Droplets,
  Dumbbell,
  Flame,
  Footprints,
  GlassWater,
  Leaf,
  Music,
  Pill,
  Smile,
  Sparkles,
  Utensils,
} from 'lucide-react';
import { HeartIcon } from '@svg-animated-icons/react/heart';
import { LightningBoltIcon } from '@svg-animated-icons/react/lightning-bolt';
import { MoonIcon } from '@svg-animated-icons/react/moon';
import { StarIcon } from '@svg-animated-icons/react/star';
import { SunIcon } from '@svg-animated-icons/react/sun';
import { TargetIcon } from '@svg-animated-icons/react/target';
import { TimerIcon } from '@svg-animated-icons/react/timer';

/** The prop shape every habit glyph accepts. */
export type HabitIconProps = {
  className?: string;
  /** Animated set only: draw the resting frame, never the hover animation. */
  disableHover?: boolean;
};

export type HabitIconComponent = ComponentType<HabitIconProps>;

/** Wraps a lucide glyph so it draws at `1em` and stays out of the a11y tree. */
function lucideIcon(Icon: LucideIcon): HabitIconComponent {
  function LucideGlyph({ className }: HabitIconProps) {
    return <Icon className={className} width="1em" height="1em" aria-hidden focusable="false" />;
  }
  LucideGlyph.displayName = `HabitIcon(${Icon.displayName ?? 'lucide'})`;
  return LucideGlyph;
}

export const HABIT_ICONS = {
  target: TargetIcon,
  droplets: lucideIcon(Droplets),
  'glass-water': lucideIcon(GlassWater),
  dumbbell: lucideIcon(Dumbbell),
  bike: lucideIcon(Bike),
  footprints: lucideIcon(Footprints),
  heart: HeartIcon,
  brain: lucideIcon(Brain),
  pill: lucideIcon(Pill),
  leaf: lucideIcon(Leaf),
  sun: SunIcon,
  moon: MoonIcon,
  coffee: lucideIcon(Coffee),
  utensils: lucideIcon(Utensils),
  book: lucideIcon(Book),
  music: lucideIcon(Music),
  sparkles: lucideIcon(Sparkles),
  star: StarIcon,
  timer: TimerIcon,
  zap: LightningBoltIcon,
  flame: lucideIcon(Flame),
  smile: lucideIcon(Smile),
} as const satisfies Record<string, HabitIconComponent>;

export type HabitIconName = keyof typeof HABIT_ICONS;

/** The names offered by the picker, in display order. */
export const HABIT_ICON_NAMES: readonly HabitIconName[] = Object.keys(HABIT_ICONS) as HabitIconName[];

export const DEFAULT_HABIT_ICON: HabitIconName = 'target';

/** Accessible name for each icon, so a picker swatch is announceable. */
const ICON_LABEL: Record<HabitIconName, string> = {
  target: 'Target',
  droplets: 'Droplets',
  'glass-water': 'Glass of water',
  dumbbell: 'Dumbbell',
  bike: 'Bike',
  footprints: 'Footprints',
  heart: 'Heart',
  brain: 'Brain',
  pill: 'Pill',
  leaf: 'Leaf',
  sun: 'Sun',
  moon: 'Moon',
  coffee: 'Coffee',
  utensils: 'Utensils',
  book: 'Book',
  music: 'Music',
  sparkles: 'Sparkles',
  star: 'Star',
  timer: 'Timer',
  zap: 'Zap',
  flame: 'Flame',
  smile: 'Smile',
};

export function habitIconLabel(name: string | null | undefined): string {
  if (name && name in ICON_LABEL) return ICON_LABEL[name as HabitIconName];
  return ICON_LABEL[DEFAULT_HABIT_ICON];
}

/** Resolves a stored icon name to a component, falling back when unknown. */
export function habitIcon(name: string | null | undefined): HabitIconComponent {
  if (name && name in HABIT_ICONS) return HABIT_ICONS[name as HabitIconName];
  return HABIT_ICONS[DEFAULT_HABIT_ICON];
}

/** Narrows an arbitrary string to a known icon name (used by the editor). */
export function asHabitIconName(name: string | null | undefined): HabitIconName {
  return name && name in HABIT_ICONS ? (name as HabitIconName) : DEFAULT_HABIT_ICON;
}
