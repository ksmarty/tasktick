/**
 * Shared styling for the accent/calendar colour swatches.
 *
 * Both pickers are a `ToggleButtonGroup` of round swatches, and MUI's group
 * styles deliberately square off the corners of the first, middle and last
 * buttons so a segmented control reads as one track. A swatch grid is not a
 * track, so those overrides have to be undone — at the group's own specificity,
 * which is why this lives in one place rather than being re-derived (and got
 * subtly wrong) in each picker.
 */
import type { Theme } from '@mui/material/styles';

/**
 * Applied to the `ToggleButtonGroup` that holds the swatches.
 *
 * Left un-annotated on purpose: `sx` accepts a plain style object, and an
 * explicit `SxProps` annotation would make it an array-or-object union that
 * cannot be spread or composed again at the call site.
 */
export const SWATCH_GROUP_SX = {
  flexWrap: 'wrap',
  gap: 1,
  border: 0,
  '& .MuiToggleButtonGroup-grouped': {
    border: 0,
    '&:not(:first-of-type)': { marginLeft: 0, borderLeft: 0 },
  },
  // Undo the group's corner-squaring, at equal specificity so the later sx wins.
  '& .MuiToggleButtonGroup-firstButton, & .MuiToggleButtonGroup-middleButton': {
    borderTopRightRadius: '50%',
    borderBottomRightRadius: '50%',
  },
  '& .MuiToggleButtonGroup-lastButton, & .MuiToggleButtonGroup-middleButton': {
    marginLeft: 0,
    borderLeft: 0,
    borderTopLeftRadius: '50%',
    borderBottomLeftRadius: '50%',
  },
};

/** One round swatch in the given colour, with its own selected ring. */
export function swatchSx(hex: string) {
  return {
    width: 40,
    height: 40,
    minWidth: 40,
    p: 0,
    border: 0,
    borderRadius: '50%',
    bgcolor: hex,
    color: 'common.white',
    '&:hover': { bgcolor: hex },
    '&.Mui-selected': {
      bgcolor: hex,
      '&:hover': { bgcolor: hex },
      // The ring is drawn in the foreground colour so it is visible on every
      // swatch, including the yellow one.
      boxShadow: (theme: Theme) =>
        `0 0 0 2px ${theme.palette.background.paper}, 0 0 0 4px ${theme.palette.text.primary}`,
    },
  };
}
