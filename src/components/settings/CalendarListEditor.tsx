'use client';

/**
 * The calendars this instance knows about: rename, recolour, hide, set the
 * default, delete.
 *
 * Renaming, recolouring and visibility save on submit from a sheet rather than
 * on every keystroke, because `PATCH /api/calendars/[id]` is a real write that
 * other views re-read.
 *
 * A read-only calendar (one discovered on a CalDAV account that refuses writes)
 * says so and hides the controls that could not work, instead of offering a
 * button that silently fails.
 */
import { useEffect, useRef, useState } from 'react';
import { CalendarDays, Eye, EyeOff, Pencil, Plus, Star, Trash2 } from 'lucide-react';
import {
  Button,
  ColorPicker,
  ConfirmDialog,
  IconButton,
  ListRow,
  Sheet,
  Skeleton,
  Switch,
  TextField,
  useToast,
} from '@/components/ui';
import { accentVar } from '@/lib/colors';
import { api } from '@/lib/api-client';
import { invalidate, useMutation, useResource } from '@/lib/store';
import { SettingsGroup } from './SettingsGroup';
import type { AccentColor, Calendar } from '@/lib/types';

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
          <Button size="sm" variant="plain" icon={Plus} onClick={() => setCreating(true)}>
            Add
          </Button>
        }
        footer="Visibility controls which calendars the calendar view draws. The default is where new events are created."
      >
        {calendars.isInitialLoading ? (
          <div className="space-y-2 px-4 py-3">
            <Skeleton variant="rect" className="h-10" />
            <Skeleton variant="rect" className="h-10" />
          </div>
        ) : list.length === 0 ? (
          <ListRow title="No calendars yet" subtitle="Add a local calendar to start planning." disabled />
        ) : (
          list.map((calendar) => (
            <ListRow
              key={calendar.id}
              title={
                <span className="flex items-center gap-2">
                  <span
                    className="size-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: accentVar(calendar.color) }}
                    aria-hidden
                  />
                  <span className="truncate">{calendar.name}</span>
                  {calendar.isDefault ? <Star className="size-3.5 shrink-0 text-warning" aria-label="Default" /> : null}
                </span>
              }
              subtitle={calendar.provider === 'caldav' ? 'Synced from a CalDAV account' : 'Stored on this server'}
              trailing={
                <span className="flex items-center gap-1">
                  <IconButton
                    icon={calendar.isVisible ? Eye : EyeOff}
                    size="sm"
                    variant="plain"
                    aria-label={calendar.isVisible ? `Hide ${calendar.name}` : `Show ${calendar.name}`}
                    disabled={toggleVisibility.isPending}
                    onClick={() => void toggleVisibility.run(calendar, !calendar.isVisible)}
                  />
                  <IconButton
                    icon={Pencil}
                    size="sm"
                    variant="plain"
                    aria-label={`Edit ${calendar.name}`}
                    onClick={() => setEditing(calendar)}
                  />
                </span>
              }
            />
          ))
        )}
      </SettingsGroup>

      <CalendarSheet
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

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRemoveTarget(null);
        }}
        title={`Delete ${removeTarget?.name ?? 'this calendar'}?`}
        message="Every event in this calendar is deleted. This cannot be undone."
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          if (removeTarget) void remove.run(removeTarget);
          setRemoveTarget(null);
        }}
      />
    </>
  );
}

/** Add or edit one calendar. */
function CalendarSheet({
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
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Edit calendar' : 'New calendar'}
      footer={
        <Button fullWidth size="lg" loading={save.isPending} disabled={readOnly} onClick={() => void save.run()}>
          {editing ? 'Save calendar' : 'Create calendar'}
        </Button>
      }
    >
      <div className="space-y-4 pb-4">
        <TextField
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          maxLength={200}
          disabled={readOnly}
          autoComplete="off"
        />

        <div>
          <p className="mb-2 px-1 text-footnote text-secondary">Colour</p>
          <ColorPicker value={color} onChange={setColor} label="Calendar colour" />
          <p className="pt-2 px-1 text-caption-1 text-tertiary" aria-live="polite">
            Preview:{' '}
            <span className="inline-flex items-center gap-1">
              <span
                className="inline-block size-2.5 rounded-full"
                style={{ backgroundColor: accentVar(color) }}
                aria-hidden
              />
              {name.trim() || 'New calendar'}
            </span>
          </p>
        </div>

        {editing ? (
          <>
            <div className="hairline-t pt-2">
              <Switch label="Visible in the calendar" checked={isVisible} onCheckedChange={setVisible} />
            </div>

            <div className="hairline-t flex items-center justify-between gap-3 pt-2">
              <span className="text-body text-label">Default calendar</span>
              {calendar?.isDefault ? (
                <span className="flex items-center gap-1 text-footnote text-warning">
                  <Star className="size-3.5" aria-hidden /> Default
                </span>
              ) : (
                <Button
                  size="sm"
                  variant="tinted"
                  icon={Star}
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
            </div>

            {readOnly ? (
              <p className="text-footnote text-secondary">
                This calendar comes from a CalDAV account that does not accept changes, so it is read-only here.
              </p>
            ) : null}

            <Button
              fullWidth
              variant="destructive"
              icon={Trash2}
              disabled={calendar === null}
              onClick={() => {
                if (calendar) onRequestDelete(calendar);
              }}
            >
              Delete calendar
            </Button>
          </>
        ) : (
          <p className="flex items-start gap-2 text-footnote text-secondary">
            <CalendarDays className="mt-0.5 size-4 shrink-0 text-tint" aria-hidden />
            A local calendar is stored on your server and syncs to every device that signs in.
          </p>
        )}
      </div>
    </Sheet>
  );
}
