'use client';

/**
 * Add or edit a CalDAV account.
 *
 * The password is write-only. The API never returns it, so the edit form must not
 * pretend it is there: the field is empty, its hint says "leave blank to keep the
 * current password", and an empty value is simply omitted from the PATCH body.
 * It is never logged, never put in a URL and never rendered back into an input.
 *
 * ## Adding is a three-step flow
 *
 * Creating an account starts on a provider picker — iCloud, Fastmail and Custom —
 * whose only job is to pre-fill the server URL with a value that is actually
 * correct for that provider (see `CALDAV_PROVIDERS`). Choosing one drops the user
 * into the very same form that used to be the whole dialog, unchanged; Custom
 * leaves the URL blank. Editing skips the picker entirely, because the account
 * already knows where it lives.
 *
 * On create the server then does the whole handshake for the user: create →
 * discover → sync. A `discover`/`sync` failure never rolls back the account — the
 * account exists from the first response and the row's own Discover/Sync buttons
 * remain the retry path — it is reported and the account stays.
 *
 * ## Errors land on the field that caused them
 *
 * Client-side validation is per-field before the request, and a rejected
 * credential (the one failure the server can report that the user must fix on a
 * control) comes back to the password field; a URL failure goes to the server
 * URL; anything else is a form-level message. Previously every failure was
 * rendered under the password field, which is why a missing name warned about the
 * password.
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
import { ArrowLeftIcon } from '@svg-animated-icons/react/arrow-left';
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
import { api, errorMessage } from '@/lib/api-client';
import { useMutation } from '@/lib/store';
import {
  CALDAV_HELP,
  CALDAV_PROVIDERS,
  caldavErrorField,
  caldavErrorMessage,
  isIcloudServer,
  type CaldavProvider,
} from './caldav';
import { syncResultSummary } from './CalDavAccountRow';
import { SHEET_DIALOG_CLASS } from './styles';
import type { CaldavAccount, SyncDirection } from '@/lib/types';
import type { SyncRunPayload } from '@/lib/view-types';

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

/** Which step of the add flow the dialog is on. Edit is always `form`. */
type Step = 'provider' | 'form';
/** The create handshake, shown live while it runs. */
type Phase = 'creating' | 'discovering' | 'syncing';

type ErrorKey = 'name' | 'serverUrl' | 'username' | 'password' | 'form';
type FormErrors = Partial<Record<ErrorKey, string>>;

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

/** A failed create-handshake step. */
function stepFailed(result: SyncRunPayload | null): boolean {
  return Boolean(result && (result.status === 'error' || result.error));
}

export function CalDavAccountSheet({ open, onOpenChange, account = null, onSaved }: CalDavAccountSheetProps) {
  const { toast } = useToast();
  const editing = Boolean(account);

  const [step, setStep] = useState<Step>('provider');
  const [phase, setPhase] = useState<Phase | null>(null);
  const [errors, setErrors] = useState<FormErrors>({});

  const [name, setName] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [syncIntervalMinutes, setSyncIntervalMinutes] = useState(30);
  const [direction, setDirection] = useState<SyncDirection>('auto');

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
    setServerUrl(account?.serverUrl ?? '');
    setUsername(account?.username ?? '');
    setPassword('');
    setSyncIntervalMinutes(account?.syncIntervalMinutes ?? 30);
    setDirection(account?.direction ?? 'auto');
    setErrors({});
    setPhase(null);
    setStep(account ? 'form' : 'provider');
  }, [account, open]);

  function clearError(field: ErrorKey) {
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  function chooseProvider(provider: CaldavProvider) {
    setServerUrl(provider.serverUrl);
    if (provider.id !== 'custom' && !name.trim()) setName(provider.label);
    setErrors({});
    setStep('form');
  }

  /** Field-level validation, before any request goes out. */
  function validate(): FormErrors {
    const next: FormErrors = {};
    if (!name.trim()) next.name = 'Give the account a name.';
    if (!serverUrl.trim()) next.serverUrl = 'Enter the CalDAV server URL.';
    if (!username.trim()) next.username = 'Enter the username.';
    if (!editing && !password) next.password = 'Enter the password (or an app-specific password).';
    return next;
  }

  async function runStep<T>(fn: () => Promise<T>, fallback: string): Promise<{ value: T | null; error: string | null }> {
    try {
      return { value: await fn(), error: null };
    } catch (error) {
      return { value: null, error: errorMessage(error) || fallback };
    }
  }

  const save = useMutation(
    async () => {
      const trimmedUrl = serverUrl.trim();
      const trimmedName = name.trim();

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

      if (editing) {
        setPhase('creating');
        const updated = await api.patch<CaldavAccount>(`/api/caldav/accounts/${account?.id}`, body);
        return { account: updated, discovery: null, sync: null, created: false };
      }

      setPhase('creating');
      const created = await api.post<CaldavAccount>('/api/caldav/accounts', body);

      // From here on the account exists. Discovery and sync are best-effort: a
      // failure is captured and reported, never thrown, so `useMutation` still
      // invalidates and the new account cannot be lost from the UI.
      setPhase('discovering');
      const discovery = await runStep<SyncRunPayload>(
        () => api.post<SyncRunPayload>(`/api/caldav/accounts/${created.id}/discover`),
        'Discovery failed.',
      );
      const discoveryResult: SyncRunPayload =
        discovery.value ??
        ({ kind: 'discover', status: 'error', pulled: 0, pushed: 0, deletedRemote: 0, deletedLocal: 0, conflicts: 0, error: discovery.error } as SyncRunPayload);

      let syncResult: SyncRunPayload | null = null;
      // Nothing was discovered, so a sync would only repeat the same failure.
      if (!stepFailed(discoveryResult)) {
        setPhase('syncing');
        const sync = await runStep<SyncRunPayload>(
          () => api.post<SyncRunPayload>(`/api/caldav/accounts/${created.id}/sync`, { kind: 'incremental' }),
          'The first sync failed.',
        );
        syncResult =
          sync.value ??
          ({ kind: 'incremental', status: 'error', pulled: 0, pushed: 0, deletedRemote: 0, deletedLocal: 0, conflicts: 0, error: sync.error } as SyncRunPayload);
      }

      return { account: created, discovery: discoveryResult, sync: syncResult, created: true };
    },
    {
      invalidates: ['/api/caldav/accounts', '/api/calendars', '/api/bootstrap'],
      onSuccess: (result) => {
        if (!result) return;
        if (!result.created) {
          toast({ title: 'Account updated', variant: 'success' });
        } else if (stepFailed(result.discovery)) {
          toast({
            title: 'Account added, but discovery failed',
            description: caldavErrorMessage(result.discovery?.error, serverUrl) ?? 'The calendars could not be listed.',
            variant: 'error',
          });
        } else if (stepFailed(result.sync)) {
          toast({
            title: 'Account added, but the first sync failed',
            description: caldavErrorMessage(result.sync?.error, serverUrl) ?? 'The first sync could not finish.',
            variant: 'error',
          });
        } else {
          toast({
            title: 'Account added and synced',
            description: result.sync ? syncResultSummary(result.sync) : undefined,
            variant: 'success',
          });
        }
        setPhase(null);
        onSaved?.();
        onOpenChange(false);
      },
      onError: (message) => {
        // Creation itself failed, so there is no account to keep. Attribute the
        // failure to the field the server's message points at.
        const advice = caldavErrorMessage(message, serverUrl) ?? message;
        const field = caldavErrorField(message);
        setPhase(null);
        setErrors(field === 'form' ? { form: advice } : { [field]: advice });
      },
    },
  );

  const icloud = isIcloudServer(serverUrl);
  const phaseMessage =
    phase === 'creating'
      ? editing
        ? 'Saving the account…'
        : 'Adding the account…'
      : phase === 'discovering'
        ? 'Discovering calendars…'
        : phase === 'syncing'
          ? 'Syncing the first time…'
          : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
       * The provider picker is only three rows, so it stays a centred card on a
       * phone; the form behind it keeps the full-height sheet it has always had
       * (seven fields need the room).
       */}
      <DialogContent className={step === 'provider' ? undefined : SHEET_DIALOG_CLASS}>
        {step === 'provider' ? (
          <>
            <DialogHeader>
              <DialogTitle>Add calendar account</DialogTitle>
              <DialogDescription>
                Pick your provider and the server address is filled in for you. You can still edit it on the next
                step.
              </DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2">
              {CALDAV_PROVIDERS.map((provider) => (
                <Button
                  key={provider.id}
                  type="button"
                  variant="outline"
                  className="h-auto w-full justify-start gap-3 px-3 py-3 text-left whitespace-normal"
                  onClick={() => chooseProvider(provider)}
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">
                    {provider.id === 'icloud' ? (
                      <LockClosedIcon />
                    ) : provider.id === 'fastmail' ? (
                      <PersonIcon />
                    ) : provider.id === 'google' ? (
                      <EnvelopeClosedIcon />
                    ) : (
                      <GlobeIcon />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{provider.label}</span>
                    <span className="block text-xs font-normal text-muted-foreground">{provider.hint}</span>
                  </span>
                </Button>
              ))}
            </div>

            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
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
                onChange={(event) => {
                  setName(event.target.value);
                  clearError('name');
                }}
                placeholder="iCloud"
                hint={errors.name}
                invalid={Boolean(errors.name)}
                autoComplete="off"
                maxLength={200}
              />

              <Field
                id="caldav-url"
                label="Server URL"
                icon={GlobeIcon}
                value={serverUrl}
                onChange={(event) => {
                  setServerUrl(event.target.value);
                  clearError('serverUrl');
                }}
                placeholder="https://caldav.icloud.com"
                hint={errors.serverUrl ?? CALDAV_HELP.server}
                invalid={Boolean(errors.serverUrl)}
                autoComplete="url"
                inputMode="url"
                maxLength={500}
              />

              <Field
                id="caldav-username"
                label="Username"
                icon={PersonIcon}
                value={username}
                onChange={(event) => {
                  setUsername(event.target.value);
                  clearError('username');
                }}
                placeholder="you@example.com"
                hint={errors.username ?? (icloud ? 'Your Apple Account email address.' : undefined)}
                invalid={Boolean(errors.username)}
                autoComplete="username"
                maxLength={320}
              />

              <Field
                id="caldav-password"
                label="Password"
                icon={LockClosedIcon}
                type="password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  clearError('password');
                }}
                placeholder={editing ? 'Leave blank to keep the current password' : 'App-specific password'}
                hint={errors.password ?? CALDAV_HELP.password}
                invalid={Boolean(errors.password)}
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

              {errors.form ? (
                <p role="alert" className="text-xs text-destructive">
                  {errors.form}
                </p>
              ) : null}
            </div>

            {phaseMessage ? (
              <p aria-live="polite" className="text-xs text-muted-foreground">
                {phaseMessage}
              </p>
            ) : null}

            <DialogFooter>
              {!editing ? (
                <Button
                  variant="ghost"
                  disabled={save.isPending}
                  onClick={() => {
                    setStep('provider');
                    setErrors({});
                  }}
                >
                  <ArrowLeftIcon />
                  Back
                </Button>
              ) : null}
              <Button variant="ghost" disabled={save.isPending} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                aria-busy={save.isPending || undefined}
                disabled={save.isPending}
                onClick={() => {
                  const next = validate();
                  setErrors(next);
                  if (Object.keys(next).length > 0) return;
                  void save.run();
                }}
              >
                {editing ? 'Save account' : 'Add account'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
