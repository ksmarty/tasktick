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
 */
import { useEffect, useRef, useState } from 'react';
import { Cloud, KeyRound, Mail, Server, User } from 'lucide-react';
import { Button, Select, Sheet, TextField, useToast } from '@/components/ui';
import { api } from '@/lib/api-client';
import { useMutation } from '@/lib/store';
import { CALDAV_HELP, caldavErrorMessage, isIcloudServer } from './caldav';
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
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={editing ? 'Edit calendar account' : 'Add calendar account'}
      snapPoints={[0.7, 0.95]}
      footer={
        <Button fullWidth size="lg" loading={save.isPending} onClick={() => void save.run()}>
          {editing ? 'Save account' : 'Add account'}
        </Button>
      }
    >
      <div className="space-y-4 pb-4">
        <TextField
          label="Name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="iCloud"
          leading={<Cloud className="size-4" aria-hidden />}
          maxLength={200}
          autoComplete="off"
        />
        <TextField
          label="Server URL"
          value={serverUrl}
          onChange={(event) => setServerUrl(event.target.value)}
          placeholder="https://caldav.icloud.com"
          leading={<Server className="size-4" aria-hidden />}
          hint={CALDAV_HELP.server}
          inputMode="url"
          autoComplete="url"
          maxLength={500}
        />
        <TextField
          label="Username"
          value={username}
          onChange={(event) => setUsername(event.target.value)}
          placeholder="you@example.com"
          leading={<User className="size-4" aria-hidden />}
          hint={icloud ? 'Your Apple Account email address.' : undefined}
          autoComplete="username"
          maxLength={320}
        />
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={editing ? 'Leave blank to keep the current password' : 'App-specific password'}
          leading={<KeyRound className="size-4" aria-hidden />}
          hint={CALDAV_HELP.password}
          autoComplete="new-password"
          maxLength={500}
          error={error}
        />
        {icloud ? (
          <p className="rounded-ios-md bg-tint-soft px-3 py-2.5 text-footnote text-label">{CALDAV_HELP.icloud}</p>
        ) : null}

        <div>
          <p className="mb-1.5 px-1 text-footnote text-secondary">Sync every</p>
          <Select
            value={String(syncIntervalMinutes)}
            onChange={(value) => setSyncIntervalMinutes(Number.parseInt(value, 10) || 30)}
            options={INTERVAL_OPTIONS}
            label="Sync interval"
          />
        </div>

        <div>
          <p className="mb-1.5 px-1 text-footnote text-secondary">Direction</p>
          <Select
            value={direction}
            onChange={(value) => setDirection(value as SyncDirection)}
            options={DIRECTION_OPTIONS}
            label="Sync direction"
          />
          <p className="px-1 pt-1.5 text-caption-1 text-tertiary">
            Two-way keeps both sides in step. Read only never writes back to {icloud ? 'iCloud' : 'the server'}.
          </p>
        </div>

        <p className="flex items-start gap-1.5 px-1 text-caption-1 text-tertiary">
          <Mail className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          TaskTick talks to the server directly. If your provider emails you about a new sign-in, that message is expected.
        </p>
      </div>
    </Sheet>
  );
}
