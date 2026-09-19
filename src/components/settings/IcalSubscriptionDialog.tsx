'use client';

/**
 * Add or edit one inbound iCal subscription.
 *
 * The feed URL is the subscription's identity: `calendars` is unique on
 * `(user_id, remote_href)`, so a changed URL is not a rename — the server
 * treats it as re-subscribing (see `updateIcalSubscription`). The copy says so
 * rather than leaving the user to discover that changing the URL re-imports
 * everything.
 *
 * ## The colour is the calendar's own
 *
 * No second colour field is invented. A palette choice goes in `color`; a
 * custom `#rrggbb` goes in `colorOverride`, which is exactly what
 * `calendarColorHex` and `itemHex` already resolve on the calendar screen and
 * the task-list colour strip. Picking a swatch clears the custom colour and
 * picking a custom colour deselects the swatches, so the two cannot disagree
 * about what is in force.
 */
import { useEffect, useRef, useState } from 'react';
import { ColorWheelIcon } from '@svg-animated-icons/react/color-wheel';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { api, errorMessage } from '@/lib/api-client';
import { useToast } from '@/components/app/Toast';
import { accentHex } from '@/lib/colors';
import { customCalendarHex } from '@/components/calendar/colors';
import { ACCENT_COLORS, type AccentColor, type Calendar } from '@/lib/types';
import { SHEET_DIALOG_CLASS } from './styles';
import { AccentSwatches } from './swatches';

/** The default colour for a new subscription; the first of the shared palette. */
const DEFAULT_SUBSCRIPTION_COLOR: AccentColor = ACCENT_COLORS[0];

export interface IcalSubscriptionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The subscription to edit; `null` creates a new one. */
  subscription: Calendar | null;
  onSaved: () => void;
}

export function IcalSubscriptionDialog({ open, onOpenChange, subscription, onSaved }: IcalSubscriptionDialogProps) {
  const { toast } = useToast();
  const editing = subscription !== null;

  const [url, setUrl] = useState('');
  const [name, setName] = useState('');
  const [color, setColor] = useState<AccentColor>(DEFAULT_SUBSCRIPTION_COLOR);
  /** A literal the user picked, or `null` while a palette swatch is in force. */
  const [customHex, setCustomHex] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Radix focuses the first control on open; on the edit path that is the URL
  // field, where a stray keystroke would re-subscribe. Take focus instead.
  const contentRef = useRef<HTMLDivElement>(null);

  const hydratedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!open) {
      hydratedFor.current = null;
      return;
    }
    const key = subscription?.id ?? 'new';
    if (hydratedFor.current === key) return;
    hydratedFor.current = key;

    setUrl(subscription?.remoteHref ?? '');
    setName(subscription?.name ?? '');
    setColor(subscription?.color ?? DEFAULT_SUBSCRIPTION_COLOR);
    setCustomHex(customCalendarHex(subscription?.colorOverride));
    setFormError(null);
  }, [open, subscription]);

  const canSubmit = url.trim().length > 0 && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setFormError(null);
    try {
      // `colorOverride: null` is deliberate: it clears a custom colour when the
      // user goes back to a palette swatch.
      const payload = {
        url: url.trim(),
        ...(name.trim() ? { name: name.trim() } : {}),
        color,
        colorOverride: customHex,
      };

      if (editing) {
        const result = await api.patch<{ calendar: Calendar; sync: { created: number } | null }>(
          `/api/ical/subscriptions/${subscription.id}`,
          payload,
        );
        const imported = result.sync?.created ?? 0;
        toast({
          title: 'Subscription updated',
          description: result.sync
            ? `Re-subscribed and imported ${imported} event${imported === 1 ? '' : 's'}.`
            : `${result.calendar.name} was updated.`,
          variant: 'success',
        });
      } else {
        const result = await api.post<{ calendar: Calendar; imported: number }>(
          '/api/ical/subscriptions',
          payload,
        );
        toast({
          title: 'Subscribed',
          description: `Imported ${result.imported} event${result.imported === 1 ? '' : 's'}.`,
          variant: 'success',
        });
      }

      onOpenChange(false);
      onSaved();
    } catch (error) {
      // The server distinguishes a bad URL from a private address from an
      // unreachable host, and that distinction is the value of the message.
      setFormError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={contentRef}
        className={SHEET_DIALOG_CLASS}
        onOpenAutoFocus={(event) => {
          if (!editing) return;
          event.preventDefault();
          contentRef.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit subscription' : 'Add a feed'}</DialogTitle>
          <DialogDescription>
            {editing
              ? 'The name and colour save in place. Changing the URL re-subscribes: the old events are dropped and the new feed imported.'
              : 'TaskTick pulls the feed on a schedule and never writes back to it.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="ical-feed-url">Calendar URL</Label>
            <Input
              id="ical-feed-url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/calendar.ics"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              aria-invalid={Boolean(formError)}
              aria-describedby={formError ? 'ical-feed-error' : 'ical-feed-hint'}
            />
            <p id="ical-feed-hint" className="text-xs text-muted-foreground">
              Any URL ending in <code>.ics</code>, including <code>webcal://</code> links.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="ical-feed-name">
              Name <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="ical-feed-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="Taken from the feed if left blank"
              autoComplete="off"
              maxLength={120}
            />
          </div>

          <div className="flex flex-col gap-2">
            <p id="ical-colour-label" className="flex items-center gap-2 text-sm font-medium">
              <ColorWheelIcon className="text-muted-foreground" />
              Colour
            </p>
            <AccentSwatches
              value={customHex ? null : color}
              onChange={(next) => {
                // A subscription always has a colour; null is not offered here.

                if (next) setColor(next);
                setCustomHex(null);
              }}
              labelledBy="ical-colour-label"
            />

            <div className="flex items-center gap-3">
              <Label htmlFor="ical-colour-custom" className="min-w-0 flex-1">
                Custom colour
              </Label>
              {/*
               * The native picker is the one control whose value genuinely
               * cannot be a class, so the swatch is an inline background and
               * everything else is Tailwind. No dependency is added for this.
               */}
              <input
                id="ical-colour-custom"
                type="color"
                aria-label="Custom colour"
                value={customHex ?? accentHex(color)}
                onChange={(event) => setCustomHex(event.target.value)}
                className="h-9 w-14 shrink-0 cursor-pointer rounded-md border border-border bg-transparent p-1"
              />
            </div>

            <p aria-live="polite" className="flex items-center gap-2 text-xs text-muted-foreground">
              <span
                aria-hidden
                className="inline-block size-2.5 rounded-full"
                style={{ backgroundColor: customHex ?? accentHex(color) }}
              />
              {customHex ? `Custom ${customHex}` : 'Palette colour'}
              {customHex ? (
                <Button type="button" size="sm" variant="ghost" onClick={() => setCustomHex(null)}>
                  Use a palette colour
                </Button>
              ) : null}
            </p>
          </div>

          {formError ? (
            <p id="ical-feed-error" role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button aria-busy={busy || undefined} disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? (editing ? 'Saving…' : 'Checking…') : editing ? 'Save subscription' : 'Subscribe'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
