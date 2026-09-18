/**
 * The curated habit icon set.
 *
 * Only the *name* of the icon is persisted (`habits.icon` is a short string),
 * which keeps the database free of a React dependency and lets the set grow
 * without a migration. An unknown or missing name falls back to a target rather
 * than rendering nothing.
 *
 * The names are unchanged from the old set — they are the stored contract — but
 * each one now resolves to a Material icon (`@mui/icons-material`), so the
 * renderer is `SvgIconComponent` rather than a lucide component.
 */
import type { SvgIconComponent } from '@mui/icons-material';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import BoltIcon from '@mui/icons-material/Bolt';
import DarkModeIcon from '@mui/icons-material/DarkMode';
import DirectionsBikeIcon from '@mui/icons-material/DirectionsBike';
import DirectionsWalkIcon from '@mui/icons-material/DirectionsWalk';
import EnergySavingsLeafIcon from '@mui/icons-material/EnergySavingsLeaf';
import FavoriteIcon from '@mui/icons-material/Favorite';
import FitnessCenterIcon from '@mui/icons-material/FitnessCenter';
import LocalCafeIcon from '@mui/icons-material/LocalCafe';
import LocalDrinkIcon from '@mui/icons-material/LocalDrink';
import LocalFireDepartmentIcon from '@mui/icons-material/LocalFireDepartment';
import MedicationIcon from '@mui/icons-material/Medication';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import MoodIcon from '@mui/icons-material/Mood';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import PsychologyIcon from '@mui/icons-material/Psychology';
import RestaurantIcon from '@mui/icons-material/Restaurant';
import StarIcon from '@mui/icons-material/Star';
import TimerIcon from '@mui/icons-material/Timer';
import TrackChangesIcon from '@mui/icons-material/TrackChanges';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import WbSunnyIcon from '@mui/icons-material/WbSunny';

export const HABIT_ICONS = {
  target: TrackChangesIcon,
  droplets: WaterDropIcon,
  'glass-water': LocalDrinkIcon,
  dumbbell: FitnessCenterIcon,
  bike: DirectionsBikeIcon,
  footprints: DirectionsWalkIcon,
  heart: FavoriteIcon,
  brain: PsychologyIcon,
  pill: MedicationIcon,
  leaf: EnergySavingsLeafIcon,
  sun: WbSunnyIcon,
  moon: DarkModeIcon,
  coffee: LocalCafeIcon,
  utensils: RestaurantIcon,
  book: MenuBookIcon,
  music: MusicNoteIcon,
  sparkles: AutoAwesomeIcon,
  star: StarIcon,
  timer: TimerIcon,
  zap: BoltIcon,
  flame: LocalFireDepartmentIcon,
  smile: MoodIcon,
} as const satisfies Record<string, SvgIconComponent>;

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
export function habitIcon(name: string | null | undefined): SvgIconComponent {
  if (name && name in HABIT_ICONS) return HABIT_ICONS[name as HabitIconName];
  return HABIT_ICONS[DEFAULT_HABIT_ICON];
}

/** Narrows an arbitrary string to a known icon name (used by the editor). */
export function asHabitIconName(name: string | null | undefined): HabitIconName {
  return name && name in HABIT_ICONS ? (name as HabitIconName) : DEFAULT_HABIT_ICON;
}
