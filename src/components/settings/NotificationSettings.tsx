'use client';

/**
 * Notifications.
 *
 * Three platform rules shape this screen:
 *
 *   1. Permission is requested from the tap handler and nowhere else. Asking on
 *      load is the classic way to earn a permanent, unrecoverable "denied".
 *   2. iOS 16.4+ only exposes Web Push to a PWA launched from the Home Screen,
 *      so in an iOS *browser* `Notification` is undefined. That is a
 *      precondition to explain, not an error to swallow.
 *   3. Once permission is `denied` the browser will never ask again, so the
 *      screen stops offering a button and points at the site settings instead.
 *
 * Nothing is claimed that cannot be checked: the switch only reads "on" after
 * `/api/push/subscribe` has accepted the subscription, and the test button is
 * explicit about what it tests.
 *
 * Material shape: each toggle is a `Switch` inside a `FormControlLabel` in a
 * `ListItem` row, so the whole row is the label and the touch target is the row.
 */
import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import FormControlLabel from '@mui/material/FormControlLabel';
import ListItem from '@mui/material/ListItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import SendIcon from '@mui/icons-material/Send';
import SmartphoneIcon from '@mui/icons-material/Smartphone';
import { useToast } from '@/components/app/Toast';
import { IosInstallHint } from '@/components/pwa';
import { isIos, isStandalone } from '@/components/pwa/platform';
import { api, errorMessage } from '@/lib/api-client';
import { PUSH_STATE_MESSAGE, pushStateFor, urlBase64ToUint8Array, withTimeout, type PushEnvironment } from './push';
import { SettingsGroup } from './SettingsGroup';
import type { SettingsPayload } from '@/lib/view-types';
import type { UserSettings } from '@/lib/types';

/** How long to wait for a controlling service worker before giving up. */
const WORKER_TIMEOUT_MS = 8_000;

export interface NotificationSettingsProps {
  payload: SettingsPayload;
  /** Called after a successful subscription so the device count refreshes. */
  onChanged?: () => void;
}

export function NotificationSettings({ payload, onChanged }: NotificationSettingsProps) {
  const { toast } = useToast();

  const [environment, setEnvironment] = useState<PushEnvironment | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Detection runs in an effect: nothing is rendered until the client knows the
  // real platform state, which keeps SSR and hydration identical.
  useEffect(() => {
    const nav = navigator as Navigator & { standalone?: boolean };
    const notificationSupported = 'Notification' in window;

    setEnvironment({
      notificationSupported,
      ios: isIos(nav.userAgent, nav.maxTouchPoints),
      standalone: isStandalone(nav.standalone === true, window.matchMedia('(display-mode: standalone)').matches),
      permission: notificationSupported ? Notification.permission : null,
      serverPush: payload.capabilities.push && Boolean(payload.capabilities.vapidPublicKey),
    });

    if (notificationSupported && Notification.permission === 'granted' && 'serviceWorker' in navigator) {
      // Permission alone does not mean an active subscription.
      navigator.serviceWorker
        .getRegistration()
        .then((registration) => registration?.pushManager.getSubscription())
        .then((subscription) => setSubscribed(Boolean(subscription)))
        .catch(() => setSubscribed(false));
    }
  }, [payload.capabilities.push, payload.capabilities.vapidPublicKey]);

  const state = environment ? pushStateFor(environment) : null;

  const enable = useCallback(async () => {
    const vapidKey = payload.capabilities.vapidPublicKey;
    if (!vapidKey) {
      toast({ title: 'Push is not configured on this server', variant: 'error' });
      return;
    }

    setBusy(true);
    try {
      const permission = await Notification.requestPermission();
      setEnvironment((current) => (current ? { ...current, permission } : current));
      // 'default' means the prompt was dismissed — say nothing and let them try
      // again; 'denied' is picked up by the state machine and explained there.
      if (permission !== 'granted') return;

      const registration = await withTimeout(
        navigator.serviceWorker.ready,
        WORKER_TIMEOUT_MS,
        'No service worker is active yet. Reload the page, or install the app to your Home Screen first.',
      );

      const existing = await registration.pushManager.getSubscription();
      const subscription =
        existing ??
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(vapidKey),
        }));

      const json = subscription.toJSON();
      const p256dh = json.keys?.p256dh;
      const auth = json.keys?.auth;
      if (!p256dh || !auth) throw new Error('The browser returned an incomplete subscription.');

      const result = await api.post<{ subscribed: boolean; reason?: string }>('/api/push/subscribe', {
        endpoint: subscription.endpoint,
        keys: { p256dh, auth },
        userAgent: navigator.userAgent,
      });

      if (!result.subscribed) {
        // A subscription the server never stored would silently drop every
        // notification, so roll our own back and report why.
        if (!existing) await subscription.unsubscribe().catch(() => false);
        throw new Error(
          result.reason === 'push-not-configured'
            ? 'The server has no VAPID keys, so it cannot deliver notifications.'
            : 'The server did not accept the subscription.',
        );
      }

      setSubscribed(true);
      onChanged?.();
      toast({ title: 'Notifications are on', description: 'This device will receive reminders.', variant: 'success' });
    } catch (error) {
      toast({ title: 'Could not enable notifications', description: errorMessage(error), variant: 'error' });
    } finally {
      setBusy(false);
    }
  }, [onChanged, payload.capabilities.vapidPublicKey, toast]);

  /**
   * Turns push off for this browser.
   *
   * The browser subscription really is removed — the push service stops sending
   * to this endpoint — but the server's own record cannot be deleted from here
   * (that endpoint needs a JSON body on a DELETE, which the API client does not
   * send), so the toast says exactly that instead of implying a clean removal.
   */
  const disable = useCallback(async () => {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
      setSubscribed(false);
      toast({
        title: 'Notifications are off in this browser',
        description: 'Your server keeps its record of this device, so the count above may still include it.',
      });
    } catch (error) {
      toast({ title: 'Could not turn notifications off', description: errorMessage(error), variant: 'error' });
    } finally {
      setBusy(false);
    }
  }, [toast]);

  const test = useCallback(async () => {
    try {
      const registration = await withTimeout(
        navigator.serviceWorker.ready,
        WORKER_TIMEOUT_MS,
        'No service worker is active yet.',
      );
      await registration.showNotification('TaskTick', {
        body: 'This is a test: notifications on this device are working.',
        tag: 'tasktick-test',
        icon: '/icons/icon-192.png',
      });
      toast({ title: 'Test notification sent', description: 'It came from this device, not from the server.' });
    } catch (error) {
      toast({ title: 'Could not show a test notification', description: errorMessage(error), variant: 'error' });
    }
  }, [toast]);

  const reminders = payload.settings.notificationsEnabled;

  return (
    <>
      <SettingsGroup
        title="Push notifications"
        footer={
          environment && state
            ? PUSH_STATE_MESSAGE[state]
            : 'Checking what this device supports…'
        }
      >
        <ListItem sx={{ display: 'block', px: 2, py: 1.5 }}>
          {state === 'needs-install' ? (
            <Box sx={{ pb: 2 }}>
              <IosInstallHint />
            </Box>
          ) : null}

          {/*
           * A switch is rendered only when it can actually do something.
           *
           * This was a permanently `disabled` Switch whenever the server had no
           * VAPID keys, which is indistinguishable from a broken toggle: it looks
           * like every other switch, it is the first control on the page, and
           * tapping it does nothing, forever. That is what users reported as "the
           * toggles do not work". When the control cannot work, it should not be
           * drawn — show a status row and say why instead.
           */}
          {state === 'ready' ? (
            <FormControlLabel
              sx={{ m: 0, display: 'flex', justifyContent: 'space-between' }}
              labelPlacement="start"
              label="Notifications on this device"
              control={
                <Switch
                  checked={subscribed}
                  disabled={busy}
                  onChange={(_event, next) => {
                    // Only ever from this tap; `checked` is server-confirmed, so
                    // the switch is not optimistically flipped.
                    if (next) void enable();
                    else void disable();
                  }}
                  slotProps={{ input: { 'aria-label': 'Notifications on this device' } }}
                />
              }
            />
          ) : (
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
              <NotificationsActiveIcon aria-hidden sx={{ mt: 0.25, color: 'text.disabled' }} />
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="body1">Notifications on this device</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pt: 0.25 }}>
                  {state ? PUSH_STATE_MESSAGE[state] : 'Checking what this device supports\u2026'}
                </Typography>
              </Box>
            </Box>
          )}
        </ListItem>

        <ListItem>
          <ListItemIcon sx={{ minWidth: 40 }}>
            <SmartphoneIcon aria-hidden />
          </ListItemIcon>
          <ListItemText primary="Registered devices" secondary="Devices that have accepted notifications" />
          <Typography variant="body1" sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>
            {payload.pushDevices}
          </Typography>
        </ListItem>

        <ListItem sx={{ display: 'block', px: 2, py: 1.5 }}>
          <Button
            fullWidth
            variant="outlined"
            startIcon={<SendIcon aria-hidden />}
            disabled={!subscribed || state !== 'ready'}
            onClick={() => void test()}
          >
            Test on this device
          </Button>
          {/* When the server has no VAPID keys the group's own footer already
              says so — repeating it here in grey on grey only looked like a
              rendering fault. */}
          {state === 'server-not-configured' ? null : (
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', pt: 1 }}>
              Shows a notification through this device’s service worker. It proves the device side works; a message from
              the server would arrive the same way.
            </Typography>
          )}
        </ListItem>
      </SettingsGroup>

      <SettingsGroup title="Reminders" footer="Controls whether TaskTick sends due-task reminders at all. Push for this device is set above.">
        <ListItem>
          <ReminderSwitch enabled={reminders} onChanged={onChanged} />
        </ListItem>
      </SettingsGroup>
    </>
  );
}

/** The stored preference, written separately so the write has its own toast. */
function ReminderSwitch({ enabled, onChanged }: { enabled: boolean; onChanged?: () => void }) {
  const { toast } = useToast();
  const [checked, setChecked] = useState(enabled);
  const [busy, setBusy] = useState(false);

  useEffect(() => setChecked(enabled), [enabled]);

  async function toggle(next: boolean) {
    setChecked(next);
    setBusy(true);
    try {
      await api.patch<UserSettings>('/api/settings', { notificationsEnabled: next });
      onChanged?.();
    } catch (error) {
      setChecked(!next);
      toast({ title: 'Could not save that preference', description: errorMessage(error), variant: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormControlLabel
      sx={{ m: 0, flex: 1, justifyContent: 'space-between' }}
      labelPlacement="start"
      label="Task reminders"
      control={
        <Switch
          checked={checked}
          disabled={busy}
          onChange={(_event, next) => void toggle(next)}
          slotProps={{ input: { 'aria-label': 'Task reminders' } }}
        />
      }
    />
  );
}
