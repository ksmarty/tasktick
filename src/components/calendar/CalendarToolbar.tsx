'use client';

/**
 * The calendar toolbar — the month name, and nothing else.
 *
 * The bar used to carry a year, prev/next chevrons, a `Today` button and a
 * desktop-only `+`. All of them are gone: paging is a swipe on the grid and
 * creation is the shell's floating action button (or the day detail dialog), so
 * a row of buttons above the month was chrome competing with the two gestures
 * the surface now owns. What is left is the label the grid needs to be readable
 * — the month name, without the year, because the arrow-free month is the whole
 * title.
 *
 * ## One header, not two
 *
 * The app shell owns the single `AppBar`, so this bar *publishes* its month into
 * it rather than stacking a second header under it — that is what `PageHeader`
 * is for, and it is how the safe-area inset, the elevation and the title row
 * stay identical on every screen. The month is therefore the page heading, which
 * is exactly the label the grid is showing.
 *
 * Because that label changes without a navigation, the selected day is announced
 * through an `aria-live` region — that announcement is the only thing this bar
 * owns besides the name.
 */
import Typography from '@mui/material/Typography';
import { PageHeader } from '@/components/app/PageHeader';

/** MUI's visually-hidden recipe, as `sx` (there is no wrapper component here). */
const VISUALLY_HIDDEN = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  border: 0,
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  clip: 'rect(0 0 0 0)',
  clipPath: 'inset(50%)',
} as const;

export interface CalendarToolbarProps {
  /** The visible month alone, e.g. "September". */
  label: string;
  /** The selected day in full, e.g. "Wednesday 16 September 2025". */
  selectedLabel: string;
}

export function CalendarToolbar({ label, selectedLabel }: CalendarToolbarProps) {
  return (
    <>
      <PageHeader title={label} />
      <Typography component="span" aria-live="polite" sx={VISUALLY_HIDDEN}>
        {selectedLabel}
      </Typography>
    </>
  );
}
