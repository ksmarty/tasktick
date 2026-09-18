'use client';

/**
 * Add or edit a CalDAV account.
 *
 * The password is write-only. The API never returns it, so the edit form must not
 * pretend it is there: the field is empty, its hint says "leave blank to keep the
 * current password", and an empty value is simply omitted from the PATCH body.
 * It is never logged, never put in a URL and never rendered back into an input.
 *
 * iCloud is called out explicitly because an iCloud account *will* fail with the
 * Apple Account password, and the fix (an app-specific password) is not
 * discoverable from the 401 the server receives. There is no link, deliberately:
 * the instruction is complete on its own and a deep link into Apple's account
 * pages rots quickly.
 *
 * The MUI `Dialog` becomes the shadcn `Dialog` with the area's sheet shell
 * (`SHEET_DIALOG_CLASS`): the same seven fields, the same conditional iCloud help,
 * the same write-only password and the same translated error, with a real focus
 * trap and a labelled dialog instead of the hand-rolled overlay.
 */
import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { GlobeIcon } from '@svg-animated-icons/react/globe';
import { EnvelopeClosedIcon } from '@svg-animated-icons/react/envelope-closed';
import { LockClosedIcon } from '@svg-animated-icons/react/lock-closed';
import { PersonIcon } from '@svg-animated-icons/react/person';
import { ServerIcon } from '@svg-animated-icons/react/server';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/components/app/Toast';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api-client';
import { useMutation } from '@/lib/store';
import { CALDAV_HELP, caldavErrorMessage, isIcloudServer } from './caldav';
import { SHEET_DIALOG_CLASS } from './styles';
import type { CaldavAccount, SyncDirection } from '@/lib/types';

const INTERVAL_OPTIONS = [
  { value: '5', label: 'Every 5 minutes' },
  { value: '15', label: 'Every 15 minutes' },
  { value: '30', label: 'Every 30 minutes' },
  { value: '60', label: 'Every hour' },
  { value: '240', label: 'Every 4 hours' },
  { value: '1440', label: 'Once a day' },
];

const DIRECTION_OPTIONS: { value: SyncDirection; label: string }[] = [
  { value: 'auto', label: 'Two-way' },
  { value: 'pull', label: 'Read only' },
  { value: 'push', label: 'Write only' },
];

export interface CalDavAccountSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The account being edited, or `null` to add one. */
  account?: CaldavAccount | null;
  onSaved?: () => void;
}

/** A labelled input with a leading glyph and an optional hint/error line. */
function Field({
  id,
  label,
  icon: Icon,
  hint,
  invalid = false,
  className,
  ...input
}: {
  id: string;
  label: string;
  icon: typeof ServerIcon;
  hint?: ReactNode;
  invalid?: boolean;
} & ComponentProps<typeof Input>) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="relative">
        <Icon className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground" />
        <Input id={id} className={cn('pl-9', className)} aria-invalid={invalid || undefined} {...input} />
      </div>
      {hint ? (
        <p className={cn('text-xs', invalid ? 'text-destructive' : 'text-muted-foreground')}>{hint}</p>
      ) : null}
    </div>
  );
}

export function CalDavAccountSheet({ open, onOpenChange, account = null, onSaved }: CalDavAccountSheetProps) {
  const { toast } = useToast();
  const editing = Boolean(account);

  const [name, setName] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(30);
  const [direction, setDirection] = useState<SyncDirection>('auto');
  const [error, setError] = useState<string | null>(null);

  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      hydratedFor.current = null;
      return;
    }
    const key = account?.id ?? 'new';
    if (hydratedFor.current === key) return;
    hydratedFor.current = key;

    setName(account?.name ?? '');
    setServerUrl(account?.serverUrl ?? 'https://caldav.icloud.com');
    setUsername(account?.username ?? '');
    setPassword('');
    setSyncIntervalMinutes(account?.syncIntervalMinutes ?? 30);
    setDirection(account?.direction ?? 'auto');
    setError(null);
  }, [account, open]);

  const save = useMutation(
    async () => {
      const trimmedUrl = serverUrl.trim();
      const trimmedName = name.trim();

      if (!trimmedName) throw new Error('Give the account a name.');
      if (!trimmedUrl) throw new Error('Enter the CalDAV server URL.');
      if (!username.trim()) throw new Error('Enter the username.');
      if (!editing && !password) throw new Error('Enter the password (or an app-specific password).');

      const body: Record<string, unknown> = {
        name: trimmedName,
        serverUrl: trimmedUrl,
        username: username.trim(),
        syncIntervalMinutes,
        direction,
      };
      // An empty password on an edit means "keep the current one" — the API never
      // sends it back, so there is nothing to prefill.
      if (password) body.password = password;

      return editing
        ? await api.patch<CaldavAccount>(`/api/caldav/accounts/${account?.id}`, body)
        : await api.post<CaldavAccount>('/api/caldav/accounts', body);
    },
    {
      invalidates: ['/api/caldav/accounts', '/api/calendars', '/api/bootstrap'],
      onSuccess: () => {
        toast({
          title: editing ? 'Account updated' : 'Account added',
          description: editing ? undefined : 'Run “Discover” on the account to fetch its calendars.',
          variant: 'success',
        });
        onSaved?.();
        onOpenChange(false);
      },
      onError: (message) => {
        // A rejected password is the one failure worth translating into advice.
        setError(caldavErrorMessage(message, serverUrl) ?? message);
      },
    },
  );

  const icloud = isIcloudServer(serverUrl);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={SHEET_DIALOG_CLASS}>
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit calendar account' : 'Add calendar account'}</DialogTitle>
          <DialogDescription>
            TaskTick talks to the CalDAV server directly and keeps both sides in step.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <Field
            id="caldav-name"
            label="Name"
            icon={ServerIcon}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="iCloud"
            autoComplete="off"
            maxLength={200}
          />

          <Field
            id="caldav-url"
            label="Server URL"
            icon={GlobeIcon}
            value={serverUrl}
            onChange={(event) => setServerUrl(event.target.value)}
            placeholder="https://caldav.icloud.com"
            hint={CALDAV_HELP.server}
            autoComplete="url"
            inputMode="url"
            maxLength={500}
          />

          <Field
            id="caldav-username"
            label="Username"
            icon={PersonIcon}
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="you@example.com"
            hint={icloud ? 'Your Apple Account email address.' : undefined}
            autoComplete="username"
            maxLength={320}
          />

          <Field
            id="caldav-password"
            label="Password"
            icon={LockClosedIcon}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder={editing ? 'Leave blank to keep the current password' : 'App-specific password'}
            hint={error ?? CALDAV_HELP.password}
            invalid={Boolean(error)}
            autoComplete="new-password"
            maxLength={500}
          />

          {icloud ? (
            <p className="rounded-md bg-muted p-3 text-xs text-muted-foreground">{CALDAV_HELP.icloud}</p>
          ) : null}

          <div className="flex flex-col gap-2">
            <Label htmlFor="caldav-interval">Sync every</Label>
            <Select
              value={String(syncIntervalMinutes)}
              onValueChange={(value) => setSyncIntervalMinutes(Number.parseInt(value, 10) || 30)}
            >
              <SelectTrigger id="caldav-interval" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {INTERVAL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="caldav-direction">Direction</Label>
            <Select
              value={direction}
              onValueChange={(value) => setDirection(value as SyncDirection)}
            >
              <SelectTrigger id="caldav-direction" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {DIRECTION_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Two-way keeps both sides in step. Read only never writes back to {icloud ? 'iCloud' : 'the server'}.
            </p>
          </div>

          <div className="flex items-start gap-2">
            <EnvelopeClosedIcon className="mt-0.5 shrink-0 text-muted-foreground" />
            <p className="text-xs text-muted-foreground">
              TaskTick talks to the server directly. If your provider emails you about a new sign-in, that message is
              expected.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button aria-busy={save.isPending || undefined} disabled={save.isPending} onClick={() => void save.run()}>
            {editing ? 'Save account' : 'Add account'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
