'use client';

/**
 * The calendars this instance knows about: rename, recolour, hide, set the
 * default, delete.
 *
 * Renaming, recolouring and visibility save on submit from a dialog rather than
 * on every keystroke, because `PATCH /api/calendars/[id]` is a real write that
 * other views re-read.
 *
 * A read-only calendar (one discovered on a CalDAV account that refuses writes)
 * says so and hides the controls that could not work, instead of offering a
 * button that silently fails.
 *
 * Material shape: the rows are `ListItem`s with the visibility and edit controls
 * as trailing `IconButton`s, the editor is a `Dialog` (full-screen on a phone),
 * and the twelve-colour palette is a `ToggleButtonGroup` of swatches.
 */
import { useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControlLabel from '@mui/material/FormControlLabel';
import IconButton from '@mui/material/IconButton';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import TextField from '@mui/material/TextField';
import ToggleButton from '@mui/material/ToggleButton';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import Typography from '@mui/material/Typography';
import useMediaQuery from '@mui/material/useMediaQuery';
import { useTheme } from '@mui/material/styles';
import AddIcon from '@mui/icons-material/Add';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import CheckIcon from '@mui/icons-material/Check';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import StarIcon from '@mui/icons-material/Star';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { useToast } from '@/components/app/Toast';
import { ACCENT_LABEL, accentHex } from '@/lib/colors';
import { api } from '@/lib/api-client';
import { invalidate, useMutation, useResource } from '@/lib/store';
import { ACCENT_COLORS, type AccentColor, type Calendar } from '@/lib/types';
import { SettingsGroup } from './SettingsGroup';
import { SWATCH_GROUP_SX, swatchSx } from './swatches';

export function CalendarListEditor() {
  const { toast } = useToast();
  const calendars = useResource<Calendar[]>('/api/calendars');
  const [editing, setEditing] = useState<Calendar | null>(null);
  const [creating, setCreating] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<Calendar | null>(null);

  const list = calendars.data ?? [];

  const refresh = () => {
    invalidate('/api/calendars');
    invalidate('/api/bootstrap');
    void calendars.refresh();
  };

  const toggleVisibility = useMutation(
    async (calendar: Calendar, isVisible: boolean) =>
      api.patch<Calendar>(`/api/calendars/${calendar.id}`, { isVisible }),
    {
      invalidates: ['/api/calendars', '/api/bootstrap'],
      onSuccess: refresh,
      onError: (message) => toast({ title: 'Could not change visibility', description: message, variant: 'error' }),
    },
  );

  const setDefault = useMutation(
    async (calendar: Calendar) => api.patch<Calendar>(`/api/calendars/${calendar.id}`, { isDefault: true }),
    {
      invalidates: ['/api/calendars', '/api/bootstrap'],
      onSuccess: (_result, [calendar]) => {
        toast({ title: `${calendar.name} is now the default calendar`, variant: 'success' });
        refresh();
      },
      onError: (message) => toast({ title: 'Could not set the default', description: message, variant: 'error' }),
    },
  );

  const remove = useMutation(async (calendar: Calendar) => api.delete<{ deleted: boolean }>(`/api/calendars/${calendar.id}`), {
    invalidates: ['/api/calendars', '/api/bootstrap'],
    onSuccess: (_result, [calendar]) => {
      toast({ title: `${calendar.name} deleted`, description: 'Its events were removed too.', variant: 'success' });
      refresh();
    },
    onError: (message) => toast({ title: 'Could not delete that calendar', description: message, variant: 'error' }),
  });

  return (
    <>
      <SettingsGroup
        title="Calendars"
        action={
          <Button size="small" variant="text" startIcon={<AddIcon aria-hidden />} onClick={() => setCreating(true)}>
            Add
          </Button>
        }
        footer="Visibility controls which calendars the calendar view draws. The default is where new events are created."
      >
        {calendars.isInitialLoading ? (
          <ListItem sx={{ display: 'block', px: 2, py: 1.5 }}>
            <Stack spacing={1}>
              <Skeleton variant="rounded" height={40} />
              <Skeleton variant="rounded" height={40} />
            </Stack>
          </ListItem>
        ) : list.length === 0 ? (
          <ListItem>
            <ListItemText primary="No calendars yet" secondary="Add a local calendar to start planning." />
          </ListItem>
        ) : (
          list.map((calendar) => (
            <ListItem
              key={calendar.id}
              secondaryAction={
                <Stack direction="row" spacing={0.5}>
                  <IconButton
                    aria-label={calendar.isVisible ? `Hide ${calendar.name}` : `Show ${calendar.name}`}
                    disabled={toggleVisibility.isPending}
                    onClick={() => void toggleVisibility.run(calendar, !calendar.isVisible)}
                  >
                    {calendar.isVisible ? <VisibilityIcon aria-hidden /> : <VisibilityOffIcon aria-hidden />}
                  </IconButton>
                  <IconButton aria-label={`Edit ${calendar.name}`} onClick={() => setEditing(calendar)}>
                    <EditIcon aria-hidden />
                  </IconButton>
                </Stack>
              }
            >
              <ListItemIcon sx={{ minWidth: 32 }}>
                <Box
                  aria-hidden
                  sx={{ width: 10, height: 10, borderRadius: '50%', bgcolor: accentHex(calendar.color) }}
                />
              </ListItemIcon>
              <ListItemText
                primary={
                  <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
                    <Box
                      component="span"
                      sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                    >
                      {calendar.name}
                    </Box>
                    {calendar.isDefault ? (
                      <StarIcon aria-label="Default" sx={{ fontSize: 16, flexShrink: 0, color: 'warning.main' }} />
                    ) : null}
                  </Box>
                }
                secondary={calendar.provider === 'caldav' ? 'Synced from a CalDAV account' : 'Stored on this server'}
              />
            </ListItem>
          ))
        )}
      </SettingsGroup>

      <CalendarDialog
        open={creating || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setCreating(false);
            setEditing(null);
          }
        }}
        calendar={editing}
        onSaved={refresh}
        onRequestDelete={(calendar) => {
          setEditing(null);
          setRemoveTarget(calendar);
        }}
        onSetDefault={(calendar) => void setDefault.run(calendar)}
      />

      <Dialog open={removeTarget !== null} onClose={() => setRemoveTarget(null)}>
        <DialogTitle>{`Delete ${removeTarget?.name ?? 'this calendar'}?`}</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            Every event in this calendar is deleted. This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button variant="text" onClick={() => setRemoveTarget(null)}>
            Cancel
          </Button>
          <Button
            variant="contained"
            color="error"
            onClick={() => {
              if (removeTarget) void remove.run(removeTarget);
              setRemoveTarget(null);
            }}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

/** Add or edit one calendar. */
function CalendarDialog({
  open,
  onOpenChange,
  calendar,
  onSaved,
  onRequestDelete,
  onSetDefault,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  calendar: Calendar | null;
  onSaved: () => void;
  onRequestDelete: (calendar: Calendar) => void;
  onSetDefault: (calendar: Calendar) => void;
}) {
  const { toast } = useToast();
  const theme = useTheme();
  const fullScreen = useMediaQuery(theme.breakpoints.down('sm'));
  const editing = calendar !== null;

  const [name, setName] = useState('');
  const [color, setColor] = useState<AccentColor>('blue');
  const [isVisible, setVisible] = useState(true);
  const readOnly = calendar?.readOnly ?? false;

  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      hydratedFor.current = null;
      return;
    }
    const key = calendar?.id ?? 'new';
    if (hydratedFor.current === key) return;
    hydratedFor.current = key;

    setName(calendar?.name ?? '');
    setColor(calendar?.color ?? 'blue');
    setVisible(calendar?.isVisible ?? true);
  }, [calendar, open]);

  const save = useMutation(
    async () => {
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Give the calendar a name.');
      return editing
        ? await api.patch<Calendar>(`/api/calendars/${calendar?.id}`, { name: trimmed, color, isVisible })
        : await api.post<Calendar>('/api/calendars', { name: trimmed, color, isVisible });
    },
    {
      invalidates: ['/api/calendars', '/api/bootstrap'],
      onSuccess: () => {
        toast({ title: editing ? 'Calendar updated' : 'Calendar created', variant: 'success' });
        onSaved();
        onOpenChange(false);
      },
      onError: (message) => toast({ title: 'Could not save the calendar', description: message, variant: 'error' }),
    },
  );

  return (
    <Dialog open={open} onClose={() => onOpenChange(false)} fullScreen={fullScreen} fullWidth maxWidth="sm">
      <DialogTitle>{editing ? 'Edit calendar' : 'New calendar'}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={3} sx={{ pb: 2 }}>
          <TextField
            fullWidth
            label="Name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={readOnly}
            autoComplete="off"
            slotProps={{ htmlInput: { maxLength: 200 } }}
          />

          <Box>
            <Typography variant="caption" color="text.secondary" id="calendar-colour-label" sx={{ display: 'block', px: 1, pb: 1 }}>
              Colour
            </Typography>
            <ToggleButtonGroup
              exclusive
              value={color}
              onChange={(_event, next: AccentColor | null) => {
                if (next) setColor(next);
              }}
              aria-labelledby="calendar-colour-label"
              sx={[SWATCH_GROUP_SX, { px: 1 }]}
            >
              {ACCENT_COLORS.map((option) => (
                <ToggleButton
                  key={option}
                  value={option}
                  aria-label={ACCENT_LABEL[option]}
                  sx={swatchSx(accentHex(option))}
                >
                  {option === color ? <CheckIcon fontSize="small" aria-hidden /> : null}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
            <Typography variant="caption" color="text.disabled" aria-live="polite" sx={{ display: 'block', px: 1, pt: 1 }}>
              Preview:{' '}
              <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                <Box
                  aria-hidden
                  sx={{ display: 'inline-block', width: 10, height: 10, borderRadius: '50%', bgcolor: accentHex(color) }}
                />
                {name.trim() || 'New calendar'}
              </Box>
            </Typography>
          </Box>

          {editing ? (
            <>
              <Box sx={{ borderTop: 1, borderColor: 'divider', pt: 1 }}>
                <FormControlLabel
                  sx={{ m: 0, display: 'flex', width: '100%', justifyContent: 'space-between' }}
                  labelPlacement="start"
                  label="Visible in the calendar"
                  control={
                    <Switch
                      checked={isVisible}
                      onChange={(_event, next) => setVisible(next)}
                      slotProps={{ input: { 'aria-label': 'Visible in the calendar' } }}
                    />
                  }
                />
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, borderTop: 1, borderColor: 'divider', pt: 1.5 }}>
                <Typography variant="body1">Default calendar</Typography>
                {calendar?.isDefault ? (
                  <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', color: 'warning.main' }}>
                    <StarIcon sx={{ fontSize: 16 }} aria-hidden />
                    <Typography variant="caption" color="warning.main">
                      Default
                    </Typography>
                  </Stack>
                ) : (
                  <Button
                    size="small"
                    variant="outlined"
                    startIcon={<StarIcon aria-hidden />}
                    disabled={readOnly || calendar === null}
                    onClick={() => {
                      if (calendar) {
                        onSetDefault(calendar);
                        onOpenChange(false);
                      }
                    }}
                  >
                    Make default
                  </Button>
                )}
              </Box>

              {readOnly ? (
                <Typography variant="caption" color="text.secondary">
                  This calendar comes from a CalDAV account that does not accept changes, so it is read-only here.
                </Typography>
              ) : null}

              <Button
                fullWidth
                variant="contained"
                color="error"
                startIcon={<DeleteIcon aria-hidden />}
                disabled={calendar === null}
                onClick={() => {
                  if (calendar) onRequestDelete(calendar);
                }}
              >
                Delete calendar
              </Button>
            </>
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
              <CalendarMonthIcon fontSize="small" aria-hidden sx={{ mt: 0.25, color: 'primary.main' }} />
              <Typography variant="caption" color="text.secondary">
                A local calendar is stored on your server and syncs to every device that signs in.
              </Typography>
            </Box>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button variant="text" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button variant="contained" loading={save.isPending} disabled={readOnly} onClick={() => void save.run()}>
          {editing ? 'Save calendar' : 'Create calendar'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
