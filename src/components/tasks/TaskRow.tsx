'use client';

/**
 * The signature list row — Material's `ListItem`, not the old hand-built one.
 *
 * Leading edge: a real MUI `Checkbox` inside its own touch target. Body: a
 * `ListItemButton` wrapping a `ListItemText` whose primary line carries the
 * title, the pin and the trailing due date, and whose secondary line is the
 * derived meta (`TaskMeta`). Behind the row a swipe-left reveals Complete and
 * Delete, which are MUI `Button`s. A long press either lifts the row for
 * reordering (on touch) or opens a MUI `Menu` of the extra actions (on a mouse)
 * — never both, so a finger drag is never mistaken for a context menu.
 *
 * A pinned task carries a pin glyph beside its title, which is the one mark the
 * row adds to say "this one was pinned deliberately": it belongs on the name,
 * not down in the meta line where the derived facts live.
 *
 * ## The coloured edge
 *
 * Material has no equivalent of the iOS grouped-list coloured edge, so it is
 * drawn explicitly as a `borderLeft` on the section card (see `TaskListSection`)
 * — three pixels in the colour of the list most of the section's rows belong to,
 * or the theme's error colour for Overdue. The row inherits it by sitting inside
 * the card rather than painting anything of its own.
 *
 * ## The drag grip
 *
 * A grip is only drawn where a pointer can actually use it. Which input the
 * device has is a capability question, not a width one, so this is a
 * `(hover: hover) and (pointer: fine)` test rather than a breakpoint.
 * Long-press-to-lift still works on touch because that path is driven by
 * `pointerType`, not by the grip.
 */
import { useEffect, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent, type Ref } from 'react';
import { keyframes } from '@emotion/react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Checkbox from '@mui/material/Checkbox';
import ListItem from '@mui/material/ListItem';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import useMediaQuery from '@mui/material/useMediaQuery';
import BlockIcon from '@mui/icons-material/Block';
import CheckIcon from '@mui/icons-material/Check';
import DeleteIcon from '@mui/icons-material/Delete';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import PushPinIcon from '@mui/icons-material/PushPin';
import type { Task } from '@/lib/types';
import { DueDateLabel, TaskMeta } from './TaskMeta';

/** Width of the revealed Complete + Delete pair (2 × 76px). */
export const SWIPE_ACTION_WIDTH = 152;
/** How long a press must last before it lifts the row or opens the actions. */
const LONG_PRESS_MS = 550;
/** Movement that cancels a long press and decides the gesture axis. */
const GESTURE_SLOP_PX = 8;
/** True only on a device whose primary input can hover and point precisely. */
const FINE_POINTER_QUERY = '(hover: hover) and (pointer: fine)';

/** The tick's little pop. Material has no equivalent; it is a state cue, not decoration. */
const pop = keyframes`
  0% { transform: scale(0.82); }
  55% { transform: scale(1.12); }
  100% { transform: scale(1); }
`;

/** Reorder wiring, supplied by `TaskListSection`. */
export interface TaskRowDrag {
  draggable: boolean;
  isLifted: boolean;
  /** Vertical offset of the lifted row, so it follows the finger. */
  liftOffset: number;
  /** Where the drop indicator is drawn for this row. */
  dropEdge: 'before' | 'after' | null;
  onDragStart: (event: DragEvent<HTMLElement>) => void;
  onDragEnd: (event: DragEvent<HTMLElement>) => void;
  onDragOver: (event: DragEvent<HTMLElement>) => void;
  onDrop: (event: DragEvent<HTMLElement>) => void;
  onLiftStart: (event: ReactPointerEvent<HTMLElement>) => void;
  onLiftMove: (event: ReactPointerEvent<HTMLElement>) => void;
  onLiftEnd: (event: ReactPointerEvent<HTMLElement>) => void;
}

export interface TaskRowProps {
  task: Task;
  zone: string;
  timeFormat: '12h' | '24h';
  /** Ticks the task off, or un-ticks it when it is already done. */
  onToggle: (task: Task) => void;
  /** Opens the editor dialog. */
  onOpen: (task: Task) => void;
  onDelete?: (task: Task) => void;
  onWontDo?: (task: Task) => void;
  /** Writes are unavailable (offline). */
  disabled?: boolean;
  selectionMode?: boolean;
  selected?: boolean;
  onSelect?: (task: Task) => void;
  drag?: TaskRowDrag | null;
  /** Rounds the bottom corner of the last row of a card. */
  last?: boolean;
  /** Rounds the top corner of the first row of a card. */
  first?: boolean;
  className?: string;
  ref?: Ref<HTMLLIElement>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function TaskRow({
  task,
  zone,
  timeFormat,
  onToggle,
  onOpen,
  onDelete,
  onWontDo,
  disabled = false,
  selectionMode = false,
  selected = false,
  onSelect,
  drag,
  last = false,
  first = false,
  className,
  ref,
}: TaskRowProps) {
  const [offsetX, setOffsetX] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [justCompleted, setJustCompleted] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const contentRef = useRef<HTMLDivElement>(null);
  const gesture = useRef({ x: 0, y: 0, active: false, axis: null as null | 'x' | 'y', timer: 0, lifted: false });

  const completed = task.status === 'completed';
  const wontDo = task.status === 'wont_do';
  const draggable = Boolean(drag?.draggable) && !selectionMode && !disabled;
  // Resolved after hydration, so touch never flashes a grip it cannot use.
  const finePointer = useMediaQuery(FINE_POINTER_QUERY);
  const gripVisible = draggable && finePointer;

  // The pop needs to end, or the next render keeps the row mid-animation.
  useEffect(() => {
    if (!justCompleted) return;
    const timer = window.setTimeout(() => setJustCompleted(false), 320);
    return () => window.clearTimeout(timer);
  }, [justCompleted]);

  // A press that outlives the component must not touch a detached node.
  useEffect(() => () => window.clearTimeout(gesture.current.timer), []);

  // A click anywhere else, or a scroll, puts the revealed actions away.
  useEffect(() => {
    if (!revealed) return;
    const close = () => {
      setRevealed(false);
      setOffsetX(0);
    };
    document.addEventListener('pointerdown', close, true);
    return () => document.removeEventListener('pointerdown', close, true);
  }, [revealed]);

  function closeReveal() {
    setRevealed(false);
    setOffsetX(0);
  }

  function cancelLongPress() {
    if (gesture.current.timer) {
      window.clearTimeout(gesture.current.timer);
      gesture.current.timer = 0;
    }
  }

  function toggle() {
    if (disabled) return;
    if (!completed) setJustCompleted(true);
    onToggle(task);
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (disabled || selectionMode) return;
    if (revealed) {
      closeReveal();
      return;
    }
    if (event.button !== 0 && event.pointerType === 'mouse') return;

    const state = gesture.current;
    state.x = event.clientX;
    state.y = event.clientY;
    state.active = true;
    state.axis = null;
    state.lifted = false;
    state.timer = 0;

    if (!draggable || !drag) return;
    state.timer = window.setTimeout(() => {
      state.timer = 0;
      if (event.pointerType === 'mouse') {
        setAnchorEl(contentRef.current);
        return;
      }
      state.lifted = true;
      contentRef.current?.setPointerCapture(event.pointerId);
      drag.onLiftStart(event);
    }, LONG_PRESS_MS);
  }

  function onPointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    const state = gesture.current;
    if (!state.active) return;

    if (state.lifted) {
      drag?.onLiftMove(event);
      return;
    }

    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;

    if (state.axis === null) {
      if (Math.abs(dx) < GESTURE_SLOP_PX && Math.abs(dy) < GESTURE_SLOP_PX) return;
      state.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      cancelLongPress();
      if (state.axis === 'y') {
        // The user is scrolling the list, not the row.
        state.active = false;
        return;
      }
      contentRef.current?.setPointerCapture(event.pointerId);
    }

    if (state.axis === 'x') {
      const base = revealed ? -SWIPE_ACTION_WIDTH : 0;
      setOffsetX(clamp(base + dx, -SWIPE_ACTION_WIDTH, 0));
    }
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const state = gesture.current;
    cancelLongPress();

    if (state.lifted) {
      state.active = false;
      state.lifted = false;
      drag?.onLiftEnd(event);
      return;
    }

    if (state.axis === 'x') {
      const open = offsetX <= -SWIPE_ACTION_WIDTH / 2;
      setRevealed(open);
      setOffsetX(open ? -SWIPE_ACTION_WIDTH : 0);
    }

    state.active = false;
    state.axis = null;
  }

  const lifted = Boolean(drag?.isLifted);

  return (
    <ListItem
      ref={ref}
      disablePadding
      className={className}
      sx={{
        position: 'relative',
        // The lifted row must paint over its siblings, so the raised z-index has
        // to live on the list item rather than only on its content.
        zIndex: lifted ? 20 : undefined,
        borderRadius: last ? '0 0 8px 8px' : first ? '8px 8px 0 0' : undefined,
        overflow: 'hidden',
      }}
    >
      {drag?.dropEdge === 'before' ? (
        <Box
          aria-hidden
          sx={{ pointerEvents: 'none', position: 'absolute', inset: '0 0 auto 0', zIndex: 30, height: 2, bgcolor: 'primary.main' }}
        />
      ) : null}
      {drag?.dropEdge === 'after' ? (
        <Box
          aria-hidden
          sx={{ pointerEvents: 'none', position: 'absolute', inset: 'auto 0 0 0', zIndex: 30, height: 2, bgcolor: 'primary.main' }}
        />
      ) : null}

      {/*
       * Revealed by a swipe-left; kept mounted so the reveal can animate.
       *
       * These actions sit UNDER the row content, which is why they are invisible
       * in the common case — but only because the row paints over them. At the
       * card's rounded corners the parent clips the row's background and the
       * buttons show through as red and green crescents. So they are translated
       * fully out of the card until the row is actually revealed.
       */}
      <Box
        aria-hidden={!revealed}
        sx={{
          position: 'absolute',
          top: 0,
          bottom: 0,
          right: 0,
          display: 'flex',
          transform: revealed ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 200ms cubic-bezier(0.32, 0.72, 0, 1)',
          pointerEvents: revealed ? 'auto' : 'none',
        }}
      >
        <Button
          tabIndex={revealed ? 0 : -1}
          disabled={disabled}
          aria-label={`Complete ${task.title}`}
          onClick={() => {
            closeReveal();
            toggle();
          }}
          sx={{
            minWidth: SWIPE_ACTION_WIDTH / 2,
            borderRadius: 0,
            bgcolor: 'success.main',
            color: 'success.contrastText',
            fontWeight: 600,
            '&:hover': { bgcolor: 'success.dark' },
          }}
        >
          Complete
        </Button>
        {onDelete ? (
          <Button
            tabIndex={revealed ? 0 : -1}
            disabled={disabled}
            aria-label={`Delete ${task.title}`}
            onClick={() => {
              closeReveal();
              onDelete(task);
            }}
            sx={{
              minWidth: SWIPE_ACTION_WIDTH / 2,
              borderRadius: 0,
              bgcolor: 'error.main',
              color: 'error.contrastText',
              fontWeight: 600,
              '&:hover': { bgcolor: 'error.dark' },
            }}
          >
            Delete
          </Button>
        ) : null}
      </Box>

      <Box
        ref={contentRef}
        onDragOver={(event) => drag?.onDragOver(event)}
        onDrop={(event) => drag?.onDrop(event)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          transform: `translate(${offsetX}px, ${lifted ? (drag?.liftOffset ?? 0) : 0}px)`,
          transition: gesture.current.axis === 'x' || lifted ? 'none' : 'transform 220ms cubic-bezier(0.32, 0.72, 0, 1)',
          touchAction: 'pan-y',
        }}
        sx={{
          // No background of its own: the card is the surface, so a translucent
          // one reads as a single grouped list rather than N white slices. The
          // lifted row needs its own solid paint, since it travels over others.
          position: 'relative',
          zIndex: lifted ? 20 : 10,
          display: 'flex',
          minHeight: 44,
          width: '100%',
          alignItems: 'center',
          gap: 1.5,
          px: 1.5,
          ...(lifted ? { bgcolor: 'background.paper', boxShadow: 6 } : {}),
          ...(disabled ? { opacity: 0.6 } : {}),
        }}
      >
        <Checkbox
          checked={completed}
          indeterminate={wontDo && !completed}
          disabled={disabled}
          onChange={toggle}
          slotProps={{
            input: {
              'aria-label': completed ? `Mark ${task.title} incomplete` : `Complete ${task.title}`,
              // The native `indeterminate` state is announced as mixed, but the
              // explicit attribute is what the old row exposed; keep it.
              'aria-checked': completed ? true : wontDo ? 'mixed' : false,
            },
          }}
          sx={{
            p: 1.25,
            ml: -1.25,
            flexShrink: 0,
            '& .MuiSvgIcon-root': { fontSize: 24 },
            ...(wontDo && !completed ? { color: 'text.disabled' } : {}),
            ...(justCompleted ? { animation: `${pop} 320ms ease` } : {}),
          }}
        />

        <ListItemButton
          onClick={() => {
            if (disabled) return;
            // A tap on a swiped-open row just puts the actions away, the way iOS does.
            if (revealed) {
              closeReveal();
              return;
            }
            if (selectionMode) onSelect?.(task);
            else onOpen(task);
          }}
          aria-pressed={selectionMode ? selected : undefined}
          aria-label={selectionMode ? `${selected ? 'Deselect' : 'Select'} ${task.title}` : `Open ${task.title}`}
          sx={{ flex: 1, minWidth: 0, borderRadius: 1, px: 0.5, py: 0.75 }}
        >
          <ListItemText
            slotProps={{
              primary: { component: 'div', sx: { margin: 0 } },
              secondary: { component: 'div', sx: { margin: 0 } },
            }}
            primary={
              /*
               * The title, with the due date pinned to the row's trailing edge.
               *
               * The date is `flexShrink: 0` and the title grows into whatever is
               * left, so the two share the line whenever the title fits beside
               * the date, and when it does not, the *date* wraps to its own
               * right-aligned line rather than the title ellipsising to make
               * room for it.
               */
              <Box sx={{ display: 'flex', width: '100%', minWidth: 0, flexWrap: 'wrap', alignItems: 'center', columnGap: 1.5, rowGap: 0.25 }}>
                <Box
                  component="span"
                  sx={{
                    minWidth: 0,
                    flexGrow: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    typography: 'body1',
                    ...(completed ? { color: 'text.secondary', textDecoration: 'line-through' } : {}),
                    ...(wontDo ? { color: 'text.disabled', textDecoration: 'line-through' } : {}),
                  }}
                >
                  {task.title}
                </Box>
                {task.isPinned ? (
                  <Box component="span" sx={{ display: 'inline-flex', flexShrink: 0, alignItems: 'center', color: 'primary.main' }}>
                    <PushPinIcon sx={{ fontSize: 14 }} aria-hidden />
                    <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                      Pinned
                    </Box>
                  </Box>
                ) : null}
                <DueDateLabel task={task} zone={zone} timeFormat={timeFormat} sx={{ ml: 'auto' }} />
              </Box>
            }
            secondary={<TaskMeta task={task} />}
          />
        </ListItemButton>

        {selectionMode ? (
          <Box
            aria-hidden
            sx={{
              display: 'flex',
              width: 24,
              height: 24,
              flexShrink: 0,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 1,
              border: 1.5,
              borderColor: selected ? 'primary.main' : 'divider',
              bgcolor: selected ? 'primary.main' : 'transparent',
              color: 'primary.contrastText',
            }}
          >
            {selected ? <CheckIcon sx={{ fontSize: 16 }} /> : null}
          </Box>
        ) : gripVisible ? (
          // The grip is the pointer drag handle: keeping the HTML5 drag here and
          // not on the whole row leaves the row free for the swipe gesture.
          <Box
            component="span"
            draggable
            onDragStart={(event: DragEvent<HTMLElement>) => drag?.onDragStart(event)}
            onDragEnd={(event: DragEvent<HTMLElement>) => drag?.onDragEnd(event)}
            aria-hidden
            sx={{
              mr: -1,
              display: 'flex',
              width: 32,
              flexShrink: 0,
              cursor: 'grab',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'text.disabled',
              '&:active': { cursor: 'grabbing' },
            }}
          >
            <DragIndicatorIcon sx={{ fontSize: 16 }} />
          </Box>
        ) : null}
      </Box>

      <Menu
        open={anchorEl !== null}
        anchorEl={anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      >
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            onToggle(task);
          }}
        >
          <ListItemIcon>
            {completed ? <BlockIcon fontSize="small" /> : <CheckIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText>{completed ? 'Mark as not done' : 'Complete'}</ListItemText>
        </MenuItem>
        {onWontDo && !wontDo ? (
          <MenuItem
            onClick={() => {
              setAnchorEl(null);
              onWontDo(task);
            }}
          >
            <ListItemIcon>
              <BlockIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText>Mark as won&apos;t do</ListItemText>
          </MenuItem>
        ) : null}
        {onDelete ? (
          <MenuItem
            onClick={() => {
              setAnchorEl(null);
              onDelete(task);
            }}
            sx={{ color: 'error.main' }}
          >
            <ListItemIcon>
              <DeleteIcon fontSize="small" sx={{ color: 'error.main' }} />
            </ListItemIcon>
            <ListItemText>Delete</ListItemText>
          </MenuItem>
        ) : null}
      </Menu>
    </ListItem>
  );
}
