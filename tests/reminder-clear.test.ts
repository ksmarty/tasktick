/**
 * Clearing a habit's reminder once the habit is done.
 *
 * The interesting part is not that a push goes out — it is which tags go out,
 * what happens when a transport refuses, and that a check-in is never held up by
 * either. Every transport is a seam here, so this file pins the decisions rather
 * than the wiring: yesterday's reminder is cleared along with today's, the Home
 * Assistant copy is asked for through the webhook that is still fresh, and the
 * confirmation replaces the reminder instead of arriving next to it.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { habitReminderTag } from '@/lib/reminder-notification';
import { clearHabitReminders } from '@/server/services/reminder-clear';
import type { HaClearRequest } from '@/server/services/ha-push';
import type { HaDeliveryTarget } from '@/server/services/ha-delivery';
import type { NotificationPayload } from '@/server/services/notifications';
import type { WebPushDelivery } from '@/server/services/web-push';

const ZONE = 'America/Toronto';
// 2026-05-04T13:00:00Z is 09:00 in Toronto, the morning after / during a check-in.
const NOW = Date.UTC(2026, 4, 4, 13, 0, 0);
const WEBHOOK = 'https://ha.example.test/api/webhook/9f2c0a5e';

const DELIVERED: WebPushDelivery = { attempted: true, delivered: 1, pruned: 0, failed: 0 };
const ACCEPTED = { delivered: true, status: 200 };

interface Pushes {
  payloads: NotificationPayload[];
}

function collectors() {
  const pushes: Pushes = { payloads: [] };
  const clears: { webhookUrl: string; request: HaClearRequest }[] = [];
  const targets: string[] = [];
  return {
    pushes,
    clears,
    targets,
    sendPush: async (_userId: string, payload: NotificationPayload) => {
      pushes.payloads.push(payload);
      return DELIVERED;
    },
    loadTarget: async (userId: string) => {
      targets.push(userId);
      return { webhookUrl: WEBHOOK } as HaDeliveryTarget;
    },
    sendClear: async (webhookUrl: string, request: HaClearRequest) => {
      clears.push({ webhookUrl, request });
      return ACCEPTED;
    },
    loadHabit: async () => ({ name: 'Stretch' }),
  };
}

describe('clearHabitReminders', () => {
  it('clears yesterday’s and today’s tags, oldest first', async () => {
    const seams = collectors();

    const result = await clearHabitReminders('u1', 'h1', ZONE, { nowMs: NOW, ...seams });

    expect(result.tags).toEqual([
      habitReminderTag('h1', '2026-05-03'),
      habitReminderTag('h1', '2026-05-04'),
    ]);
    // One request for both: a clear carries the whole set, so a habit reminded
    // twice today is not two round trips.
    expect(seams.pushes.payloads).toHaveLength(1);
    expect(seams.pushes.payloads[0]).toMatchObject({
      clear: true,
      tags: result.tags,
    });
    // Nothing is displayed for this push; the worker only closes.
    expect(seams.pushes.payloads[0].title).toBe('');
    expect(result.pushed).toBe(true);
  });

  it('asks Home Assistant to clear through the registered webhook', async () => {
    const seams = collectors();

    const result = await clearHabitReminders('u1', 'h1', ZONE, { nowMs: NOW, ...seams });

    expect(seams.clears).toHaveLength(1);
    expect(seams.clears[0].webhookUrl).toBe(WEBHOOK);
    expect(seams.clears[0].request).toEqual({
      source: 'habit',
      sourceId: 'h1',
      tags: result.tags,
    });
    expect(result.sentToHomeAssistant).toBe(true);
    // No confirmation was asked for, so nothing is shown and no second push goes.
    expect(result.confirmed).toBe(false);
    expect(seams.pushes.payloads).toHaveLength(1);
  });

  it('shows a confirmation that replaces the reminder, named after the habit', async () => {
    const seams = collectors();

    const result = await clearHabitReminders('u1', 'h1', ZONE, {
      nowMs: NOW,
      confirm: true,
      ...seams,
    });

    expect(seams.clears[0].request.message).toEqual({
      title: 'Stretch',
      body: 'Checked in. Nice work.',
    });
    expect(seams.pushes.payloads).toHaveLength(2);
    const confirmation = seams.pushes.payloads[1];
    expect(confirmation.title).toBe('Stretch');
    expect(confirmation.body).toBe('Checked in. Nice work.');
    // Today's tag, so the shade ends with one line rather than a cleared reminder
    // beside a new one.
    expect(confirmation.tag).toBe(habitReminderTag('h1', '2026-05-04'));
    expect(confirmation.url).toBe('/habits?habit=h1');
    expect(confirmation.data).toEqual({
      source: 'habit',
      sourceId: 'h1',
      occurrenceKey: '2026-05-04:0',
    });
    expect(result.confirmed).toBe(true);
  });

  it('does nothing beyond the app when no Home Assistant is registered', async () => {
    const seams = collectors();

    const result = await clearHabitReminders('u1', 'h1', ZONE, {
      nowMs: NOW,
      ...seams,
      loadTarget: async () => null,
    });

    expect(seams.clears).toHaveLength(0);
    expect(result.sentToHomeAssistant).toBe(false);
    expect(result.pushed).toBe(true);
  });

  it('never throws when every transport fails', async () => {
    const seams = collectors();

    const result = await clearHabitReminders('u1', 'h1', ZONE, {
      nowMs: NOW,
      confirm: true,
      sendPush: async () => {
        throw new Error('gone');
      },
      loadTarget: async () => {
        throw new Error('db');
      },
      loadHabit: async () => {
        throw new Error('db');
      },
    });

    expect(result).toMatchObject({ pushed: false, sentToHomeAssistant: false, confirmed: false });
    // The tags are still reported, so a caller logging the failure knows what it
    // meant to clear.
    expect(result.tags).toHaveLength(2);
    expect(seams.pushes.payloads).toHaveLength(0);
  });

  it('keeps a refusal from Home Assistant apart from a delivery', async () => {
    const result = await clearHabitReminders('u1', 'h1', ZONE, {
      nowMs: NOW,
      confirm: true,
      ...collectors(),
      sendClear: async () => ({ delivered: false, status: 503, error: 'asleep' }),
    });

    expect(result.sentToHomeAssistant).toBe(false);
    // The app's own confirmation is independent of Home Assistant, so it still
    // goes out — the user finished the habit either way.
    expect(result.confirmed).toBe(true);
  });
});

describe('the clear is wired into both ways a habit becomes done', () => {
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

  it('clears from the check-in route once the goal is met', () => {
    const route = read('src/app/api/habits/[id]/checkin/route.ts');
    expect(route).toContain('clearHabitReminders');
    // Guarded on doneToday: a habit that needs four check-ins keeps its nudge
    // until the fourth, which is the same rule the dispatcher uses to stay quiet.
    expect(route).toMatch(/if \(result\.doneToday\)[\s\S]{0,120}clearHabitReminders/);
  });

  it('clears from the notification button, with the confirmation', () => {
    const actions = read('src/server/services/reminder-actions.ts');
    expect(actions).toMatch(/habit\.doneToday[\s\S]{0,160}clearHabitReminders/);
    expect(actions).toContain('confirm: true');
  });

  it('closes by tag in the worker rather than showing anything', () => {
    const worker = read('public/sw.js');
    expect(worker).toMatch(/payload\.clear[\s\S]{0,400}getNotifications/);
    expect(worker).toMatch(/notification\.close\(\)/);
  });

  it('sends the clear to Home Assistant as its own kind of request', () => {
    const push = read('src/server/services/ha-push.ts');
    expect(push).toContain("kind: 'clear'");
  });
});
