/**
 * The curated habit icon set.
 *
 * Only the *name* of the icon is persisted (`habits.icon` is a short string),
 * which keeps the database free of a React dependency and lets the set grow
 * without a migration. An unknown or missing name falls back to a target rather
 * than rendering nothing.
 */
import {
  Bike,
  BookOpen,
  Brain,
  Coffee,
  Droplets,
  Dumbbell,
  Flame,
  Footprints,
  GlassWater,
  Heart,
  Leaf,
  Moon,
  Music,
  Pill,
  Smile,
  Sparkles,
  Star,
  Sun,
  Target,
  Timer,
  Utensils,
  Zap,
  type LucideIcon,
} from 'lucide-react';

export const HABIT_ICONS = {
  target: Target,
  droplets: Droplets,
  'glass-water': GlassWater,
  dumbbell: Dumbbell,
  bike: Bike,
  footprints: Footprints,
  heart: Heart,
  brain: Brain,
  pill: Pill,
  leaf: Leaf,
  sun: Sun,
  moon: Moon,
  coffee: Coffee,
  utensils: Utensils,
  book: BookOpen,
  music: Music,
  sparkles: Sparkles,
  star: Star,
  timer: Timer,
  zap: Zap,
  flame: Flame,
  smile: Smile,
} as const satisfies Record<string, LucideIcon>;

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
export function habitIcon(name: string | null | undefined): LucideIcon {
  if (name && name in HABIT_ICONS) return HABIT_ICONS[name as HabitIconName];
  return HABIT_ICONS[DEFAULT_HABIT_ICON];
}

/** Narrows an arbitrary string to a known icon name (used by the editor). */
export function asHabitIconName(name: string | null | undefined): HabitIconName {
  return name && name in HABIT_ICONS ? (name as HabitIconName) : DEFAULT_HABIT_ICON;
}
