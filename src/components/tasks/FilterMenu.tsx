'use client';

/**
 * The one menu behind the list screen's header button: filtering and sorting.
 *
 * They are two halves of the same question — "what is in this list, and in what
 * order" — so they share a sheet rather than a filter button plus a separate
 * sort select that the user had to find on its own.
 *
 * Each filter dimension is a single-choice list, so the URL state can only ever
 * hold one of each, and the active sort is a single-choice list too. Picking any
 * row applies it and closes the sheet — see `choose` below.
 */
import type { ReactNode } from 'react';
import Box from '@mui/material/Box';
import Check from '@mui/icons-material/Check';
import Drawer from '@mui/material/Drawer';
import Flag from '@mui/icons-material/Flag';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import ListSubheader from '@mui/material/ListSubheader';
import Sort from '@mui/icons-material/Sort';
import Typography from '@mui/material/Typography';
import { accentHex } from '@/lib/colors';
import type { List as TaskList, Tag } from '@/lib/types';
import { TASK_SORTS, TASK_WINDOWS, type TaskViewState } from './filters';
import { PRIORITY_ITEMS } from './priority';

export interface TaskFilterSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: TaskViewState;
  lists: readonly TaskList[];
  tags: readonly Tag[];
  onChange: (patch: Partial<TaskViewState>) => void;
}

interface OptionRowProps {
  selected: boolean;
  label: string;
  onSelect: () => void;
  leading?: ReactNode;
}

/** Section heading inside the sheet; the sheet owns the spacing, not the list. */
const HEADING_SX = { bgcolor: 'transparent', px: 2, pt: 3, pb: 0.5 } as const;

function OptionRow({ selected, label, onSelect, leading }: OptionRowProps) {
  return (
    <ListItemButton role="radio" aria-checked={selected} onClick={onSelect}>
      <ListItemIcon sx={{ minWidth: 32 }}>{leading ?? <Box component="span" aria-hidden />}</ListItemIcon>
      <ListItemText
        primary={label}
        slotProps={{
          primary: { noWrap: true, sx: { color: selected ? 'primary.main' : 'text.primary' } },
        }}
      />
      {selected ? <Check sx={{ fontSize: 20, color: 'primary.main' }} aria-hidden /> : null}
    </ListItemButton>
  );
}

export function TaskFilterSheet({ open, onOpenChange, state, lists, tags, onChange }: TaskFilterSheetProps) {
  /**
   * Applies a choice, then gets out of the way.
   *
   * Every row here is a single choice that takes effect behind the sheet, so
   * there is nothing left to do once it has been picked — leaving the sheet up
   * made the user dismiss a menu they had already finished with. The patch goes
   * in first, so the list behind is already updated when the sheet slides away.
   *
   * Sort closes too. It is the same kind of row as the filters — one choice out
   * of a fixed set — and a user comparing two orders is served better by one
   * consistent rule than by a special case they have to learn: pick, look, and
   * reopen in one tap if it was not the one.
   */
  function choose(patch: Partial<TaskViewState>) {
    onChange(patch);
    onOpenChange(false);
  }

  return (
    <Drawer
      anchor="bottom"
      open={open}
      onClose={() => onOpenChange(false)}
      slotProps={{
        paper: {
          role: 'dialog',
          'aria-modal': true,
          'aria-label': 'Filter & Sort',
          sx: { borderTopLeftRadius: 3, borderTopRightRadius: 3, maxHeight: '90dvh' },
        },
      }}
    >
      <Box
        sx={{
          borderTopLeftRadius: 3,
          borderTopRightRadius: 3,
          pb: 2,
          maxHeight: '90dvh',
          overflowY: 'auto',
        }}
      >
        <Typography variant="h6" sx={{ px: 2, pt: 2, pb: 1 }}>
          Filter &amp; Sort
        </Typography>

        <ListSubheader component="div" disableSticky sx={{ ...HEADING_SX, pt: 1 }}>
          Due
        </ListSubheader>
        <List role="radiogroup" aria-label="Due window" sx={{ py: 0 }}>
          {TASK_WINDOWS.map((option) => (
            <OptionRow
              key={option.value}
              selected={state.window === option.value}
              label={option.label}
              onSelect={() => choose({ window: option.value })}
            />
          ))}
        </List>

        <ListSubheader component="div" disableSticky sx={HEADING_SX}>
          Priority
        </ListSubheader>
        <List role="radiogroup" aria-label="Priority" sx={{ py: 0 }}>
          {PRIORITY_ITEMS.map((item) => (
            <OptionRow
              key={item.value}
              selected={state.priority === item.value}
              label={item.label}
              leading={<Flag sx={{ fontSize: 20, color: item.color }} aria-hidden />}
              onSelect={() => choose({ priority: state.priority === item.value ? null : item.value })}
            />
          ))}
        </List>

        {lists.length ? (
          <>
            <ListSubheader component="div" disableSticky sx={HEADING_SX}>
              Lists
            </ListSubheader>
            <List role="radiogroup" aria-label="List" sx={{ py: 0 }}>
              <OptionRow
                selected={state.listId === null}
                label="All lists"
                onSelect={() => choose({ listId: null })}
              />
              {lists.map((list) => (
                <OptionRow
                  key={list.id}
                  selected={state.listId === list.id}
                  label={list.name}
                  leading={
                    <Box
                      aria-hidden
                      sx={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        flexShrink: 0,
                        bgcolor: accentHex(list.color),
                      }}
                    />
                  }
                  onSelect={() => choose({ listId: state.listId === list.id ? null : list.id })}
                />
              ))}
            </List>
          </>
        ) : null}

        {tags.length ? (
          <>
            <ListSubheader component="div" disableSticky sx={HEADING_SX}>
              Tags
            </ListSubheader>
            <List role="radiogroup" aria-label="Tag" sx={{ py: 0 }}>
              {tags.map((tag) => (
                <OptionRow
                  key={tag.id}
                  selected={state.tagId === tag.id}
                  label={`#${tag.name}`}
                  onSelect={() => choose({ tagId: state.tagId === tag.id ? null : tag.id })}
                />
              ))}
            </List>
          </>
        ) : null}

        <ListSubheader component="div" disableSticky sx={HEADING_SX}>
          Sort
        </ListSubheader>
        <List role="radiogroup" aria-label="Sort" sx={{ py: 0 }}>
          {TASK_SORTS.map((option) => (
            <OptionRow
              key={option.value}
              selected={state.sort === option.value}
              label={option.label}
              leading={<Sort sx={{ fontSize: 20, color: 'text.secondary' }} aria-hidden />}
              onSelect={() => choose({ sort: option.value })}
            />
          ))}
        </List>
      </Box>
    </Drawer>
  );
}
