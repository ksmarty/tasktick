'use client';

/**
 * The page header's week strip: one column per day, the selected day filled.
 *
 * Deliberately schedule-free — the habit's own week strip used to live inside
 * every card and said the same seven things over and over. Here the week is the
 * page's, and picking a day scopes the card list to it.
 *
 * The shape matches the calendar's week strip so the two screens read as
 * siblings: caption weekday letters, a plain date number, and a filled circle
 * for the selection. Days outside the selectable range — after today, or before
 * the earliest habit started — are dimmed and inert rather than hidden, so the
 * week keeps its shape. Each day is a MUI `ButtonBase`, which is what keeps the
 * 48dp touch target and the press state Material expects.
 */
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Typography from '@mui/material/Typography';
import { WEEKDAY_SHORT, longDateLabel, weekOfDays } from './period';
import type { DateOnly } from '@/lib/types';

export interface HabitWeekStripProps {
  /** The week shown is the one containing `today`; this marks the chosen day. */
  selected: DateOnly;
  today: DateOnly;
  weekStartsOn: number;
  /** Earlier than this cannot be selected (the earliest habit's start date). */
  earliest?: DateOnly | null;
  onSelect: (date: DateOnly) => void;
  className?: string;
}

export function HabitWeekStrip({
  selected,
  today,
  weekStartsOn,
  earliest = null,
  onSelect,
  className,
}: HabitWeekStripProps) {
  const days = weekOfDays(today, weekStartsOn);

  return (
    <Box
      role="group"
      aria-label="Week"
      className={className}
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
        gap: 0.5,
        px: 1.5,
        pt: 0.5,
        pb: 1,
      }}
    >
      {days.map((day) => {
        const isSelected = day.date === selected;
        const isToday = day.date === today;
        const outOfRange = day.date > today || (earliest !== null && day.date < earliest);

        return (
          <ButtonBase
            key={day.date}
            disabled={outOfRange}
            aria-pressed={isSelected}
            aria-label={`${WEEKDAY_SHORT[day.weekday]}, ${longDateLabel(day.date)}`}
            onClick={() => onSelect(day.date)}
            sx={{
              display: 'flex',
              minHeight: 44,
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0.5,
              borderRadius: 1,
              py: 0.5,
            }}
          >
            <Typography
              component="span"
              variant="caption"
              aria-hidden
              sx={{ lineHeight: 1, color: outOfRange ? 'text.disabled' : 'text.secondary' }}
            >
              {day.letter}
            </Typography>
            <Box
              component="span"
              aria-hidden
              sx={{
                display: 'flex',
                width: 32,
                height: 32,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '50%',
                lineHeight: 1,
                fontVariantNumeric: 'tabular-nums',
                ...(isSelected
                  ? { bgcolor: 'primary.main', color: 'primary.contrastText', fontWeight: 600 }
                  : outOfRange
                    ? { color: 'text.disabled' }
                    : isToday
                      ? { color: 'primary.main', fontWeight: 600 }
                      : { color: 'text.primary' }),
              }}
            >
              {day.dayOfMonth}
            </Box>
          </ButtonBase>
        );
      })}
    </Box>
  );
}
