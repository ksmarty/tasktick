'use client';

/**
 * The calendars this instance knows about: rename, recolour, hide, set the
 * default, delete.
 *
 * Renaming, recolouring and visibility save on submit from the dialog rather than
 * on every keystroke, because `PATCH /api/calendars/[id]` is a real write that
 * other views re-read.
 *
 * A read-only calendar (one discovered on a CalDAV account that refuses writes)
 * says so and hides the controls that could not work, instead of offering a
 * button that silently fails.
 *
 * Shape: the rows are `SettingsRow`s with the visibility and edit controls as
 * trailing icon buttons, the editor is a shadcn `Dialog` — the whole viewport on
 * a phone (`SHEET_DIALOG_CLASS`), a centred card above it — and the twelve-colour
 * palette is the shared `AccentSwatches` grid. The MUI version had to pick
 * full-screen with a `useMediaQuery` hook; a `max-sm:` class is applied by the
 * engine before first paint and cannot flash the wrong layout.
 */
import { useEffect, useRef, useState } from 'react';
import { CalendarIcon } from '@svg-animated-icons/react/calendar';
import { EyeClosedIcon } from '@svg-animated-icons/react/eye-closed';
import { EyeOpenIcon } from '@svg-animated-icons/react/eye-open';
import { Pencil1Icon } from '@svg-animated-icons/react/pencil-1';
import { PlusIcon } from '@svg-animated-icons/react/plus';
import { StarIcon } from '@svg-animated-icons/react/star';
import { TrashIcon } from '@svg-animated-icons/react/trash';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/app/Toast';
import { accentHex } from '@/lib/colors';
import { api } from '@/lib/api-client';
import { invalidate, useMutation, useResource } from '@/lib/store';
import { ACCENT_COLORS, type AccentColor, type Calendar } from '@/lib/types';
import { SHEET_DIALOG_CLASS } from './styles';
import { SettingsGroup, SettingsRow } from './SettingsGroup';
import { AccentSwatches } from './swatches';

/** The default colour for a new calendar; the first of the shared palette. */
const DEFAULT_CALENDAR_COLOR: AccentColor = ACCENT_COLORS[0];

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
          <Button size="sm" variant="ghost" onClick={() => setCreating(true)}>
            <PlusIcon />
            Add
          </Button>
        }
        footer="Visibility controls which calendars the calendar view draws. The default is where new events are created."
      >
        {calendars.isInitialLoading ? (
          <SettingsRow stacked>
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </SettingsRow>
        ) : list.length === 0 ? (
          <SettingsRow>
            <span className="min-w-0 flex-1">
              <span className="block text-sm">No calendars yet</span>
              <span className="block text-xs text-muted-foreground">Add a local calendar to start planning.</span>
            </span>
          </SettingsRow>
        ) : (
          list.map((calendar) => (
            <SettingsRow key={calendar.id}>
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: accentHex(calendar.color) }}
              />
              <span className="min-w-0 flex-1">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="min-w-0 truncate text-sm">{calendar.name}</span>
                  {calendar.isDefault ? (
                    <span className="inline-flex shrink-0 items-center text-muted-foreground">
                      <StarIcon />
                      <span className="sr-only">Default</span>
                    </span>
                  ) : null}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {calendar.provider === 'caldav' ? 'Synced from a CalDAV account' : 'Stored on this server'}
                </span>
              </span>

              <span className="flex shrink-0 items-center">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={calendar.isVisible ? `Hide ${calendar.name}` : `Show ${calendar.name}`}
                  disabled={toggleVisibility.isPending}
                  onClick={() => void toggleVisibility.run(calendar, !calendar.isVisible)}
                >
                  {calendar.isVisible ? <EyeOpenIcon /> : <EyeClosedIcon />}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Edit ${calendar.name}`}
                  onClick={() => setEditing(calendar)}
                >
                  <Pencil1Icon />
                </Button>
              </span>
            </SettingsRow>
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

      <Dialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{`Delete ${removeTarget?.name ?? 'this calendar'}?`}</DialogTitle>
            <DialogDescription>Every event in this calendar is deleted. This cannot be undone.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRemoveTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (removeTarget) void remove.run(removeTarget);
                setRemoveTarget(null);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
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
  const editing = calendar !== null;

  const [name, setName] = useState('');
  const [color, setColor] = useState<AccentColor>(DEFAULT_CALENDAR_COLOR);
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
    setColor(calendar?.color ?? DEFAULT_CALENDAR_COLOR);
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={SHEET_DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit calendar' : 'New calendar'}</DialogTitle>
          <DialogDescription>
            The name, colour and visibility are saved together when you submit.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="calendar-name">Name</Label>
            <Input
              id="calendar-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={readOnly}
              autoComplete="off"
              maxLength={200}
            />
          </div>

          <div className="flex flex-col gap-2">
            <p id="calendar-colour-label" className="text-sm font-medium">
              Colour
            </p>
            <AccentSwatches value={color} onChange={setColor} labelledBy="calendar-colour-label" />
            <p aria-live="polite" className="text-xs text-muted-foreground">
              Preview:{' '}
              <span className="inline-flex items-center gap-1">
                <span
                  aria-hidden
                  className="inline-block size-2.5 rounded-full"
                  style={{ backgroundColor: accentHex(color) }}
                />
                {name.trim() || 'New calendar'}
              </span>
            </p>
          </div>

          {editing ? (
            <>
              <Separator />

              <div className="flex items-center gap-3">
                <Label htmlFor="calendar-visible" className="min-w-0 flex-1">
                  Visible in the calendar
                </Label>
                <Switch
                  id="calendar-visible"
                  aria-label="Visible in the calendar"
                  checked={isVisible}
                  onCheckedChange={setVisible}
                />
              </div>

              <div className="flex items-center justify-between gap-3">
                <p className="text-sm">Default calendar</p>
                {calendar?.isDefault ? (
                  <p className="flex items-center gap-1 text-xs text-muted-foreground">
                    <StarIcon />
                    Default
                  </p>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={readOnly || calendar === null}
                    onClick={() => {
                      if (calendar) {
                        onSetDefault(calendar);
                        onOpenChange(false);
                      }
                    }}
                  >
                    <StarIcon />
                    Make default
                  </Button>
                )}
              </div>

              {readOnly ? (
                <p className="text-xs text-muted-foreground">
                  This calendar comes from a CalDAV account that does not accept changes, so it is read-only here.
                </p>
              ) : null}

              <Button
                variant="destructive"
                className="w-full"
                disabled={calendar === null}
                onClick={() => {
                  if (calendar) onRequestDelete(calendar);
                }}
              >
                <TrashIcon />
                Delete calendar
              </Button>
            </>
          ) : (
            <div className="flex items-start gap-3">
              <CalendarIcon className="mt-0.5 text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                A local calendar is stored on your server and syncs to every device that signs in.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button aria-busy={save.isPending || undefined} disabled={save.isPending || readOnly} onClick={() => void save.run()}>
            {editing ? 'Save calendar' : 'Create calendar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
