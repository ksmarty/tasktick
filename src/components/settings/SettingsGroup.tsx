/**
 * The grouped settings card.
 *
 * The backbone of the whole settings area: a Material `Paper` holding one
 * `List`, with the caption as a `ListSubheader` and the explanation as a
 * footnote below. Every settings screen is a stack of these, so the spacing,
 * the surface and the divider rhythm are defined once instead of being repeated
 * by hand and drifting.
 *
 * Rows are ordinary MUI `ListItem`s (or `ListItemButton`s). The divider between
 * two rows is drawn by the `List` itself — the direct-child selector below
 * touches only this card's own rows, so a `List` nested inside a row (the admin
 * table's own list, say) is never caught by it, and the last row carries no
 * trailing line.
 *
 * `component="div"` on the `List` is deliberate: a card here can hold a table, a
 * form or a multi-line account block as well as plain rows, and none of those
 * are valid children of a `<ul>`.
 */
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListSubheader from '@mui/material/ListSubheader';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';

export interface SettingsGroupProps {
  /** Caption above the card, e.g. `Calendars`. */
  title: ReactNode;
  /** Trailing control in the caption row, e.g. an “Add” button. */
  action?: ReactNode;
  /** Footnote below the card — the place for the explanation. */
  footer?: ReactNode;
  /** Removes the caption (for a card that speaks for itself). */
  hideTitle?: boolean;
  children: ReactNode;
}

export function SettingsGroup({ title, action, footer, hideTitle = false, children }: SettingsGroupProps) {
  return (
    <Box component="section" sx={{ mb: 2 }}>
      <Paper variant="outlined" sx={{ borderRadius: 3, overflow: 'hidden' }}>
        <List
          component="div"
          disablePadding
          subheader={
            hideTitle ? undefined : (
              <ListSubheader
                component="div"
                disableSticky
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 2,
                  pt: 1.5,
                  pb: 0.5,
                  bgcolor: 'transparent',
                  color: 'text.secondary',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  fontSize: 12,
                  fontWeight: 600,
                  lineHeight: 1.6,
                }}
              >
                <Box component="span" sx={{ minWidth: 0, flex: 1 }}>
                  {title}
                </Box>
                {action}
              </ListSubheader>
            )
          }
          sx={{
            // A hairline between the card's own rows, never after the last one.
            // The direct-child selector keeps nested lists out of it.
            '& > .MuiListItem-root:not(:last-of-type)': {
              borderBottom: '1px solid',
              borderColor: 'divider',
            },
            '& > .MuiListItemButton-root:not(:last-of-type)': {
              borderBottom: '1px solid',
              borderColor: 'divider',
            },
          }}
        >
          {children}
        </List>
      </Paper>

      {footer ? (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', px: 2, pt: 1 }}>
          {footer}
        </Typography>
      ) : null}
    </Box>
  );
}
