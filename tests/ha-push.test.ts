/**
 * The Home Assistant transport itself.
 *
 * A webhook POST is the one place this app talks to a Home Assistant, so what
 * matters here is what it sends, what counts as acceptance, and that nothing it
 * can encounter escapes as an exception — the sweep reads the result to decide
 * whether to fall back to the app's own push, and a throw would skip that.
 */
import { describe, expect, it } from 'vitest';
import { HA_PUSH_TIMEOUT_MS, sendToHomeAssistant } from '@/server/services/ha-push';
import type { NotificationPayload } from '@/server/services/notifications';

const WEBHOOK = 'https://ha.example.test/api/webhook/9f2c0a5e';

const PAYLOAD: NotificationPayload = {
  title: 'Pay rent',
  body: 'Task due',
  type: 'info',
  url: '/tasks?task=abc',
  tag: 'task-abc',
  actions: [{ action: 'complete', title: 'Complete' }],
  data: { source: 'task', sourceId: 'abc', occurrenceKey: 'rem-1' },
};

interface Recorded {
  url: string;
  init: RequestInit;
}

function stubFetch(response: Response | Error): { fetchImpl: typeof fetch; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe('sendToHomeAssistant', () => {
  it('posts the app’s own payload as JSON, with a timeout', async () => {
    const { fetchImpl, calls } = stubFetch(new Response(null, { status: 200 }));

    await expect(sendToHomeAssistant(WEBHOOK, PAYLOAD, fetchImpl)).resolves.toEqual({
      delivered: true,
      status: 200,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(WEBHOOK);
    expect(calls[0].init.method).toBe('POST');
    expect((calls[0].init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    // The same fields the app's own push carries, which is what lets the
    // integration build a button that completes the item.
    expect(JSON.parse(calls[0].init.body as string)).toEqual(PAYLOAD);
    expect(HA_PUSH_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it('treats a 404 as a refusal, not as delivery', async () => {
    // The integration was removed while TaskTick still had the URL: the
    // fallback is the whole point of getting this right.
    const { fetchImpl } = stubFetch(new Response('not found', { status: 404 }));

    await expect(sendToHomeAssistant(WEBHOOK, PAYLOAD, fetchImpl)).resolves.toEqual({
      delivered: false,
      status: 404,
      error: 'Home Assistant responded 404',
    });
  });

  it('treats a 5xx as a refusal too', async () => {
    const { fetchImpl } = stubFetch(new Response('boom', { status: 500 }));

    await expect(sendToHomeAssistant(WEBHOOK, PAYLOAD, fetchImpl)).resolves.toMatchObject({
      delivered: false,
      status: 500,
    });
  });

  it('reports a transport that threw rather than throwing itself', async () => {
    const { fetchImpl } = stubFetch(new Error('connect ECONNREFUSED'));

    await expect(sendToHomeAssistant(WEBHOOK, PAYLOAD, fetchImpl)).resolves.toEqual({
      delivered: false,
      error: 'connect ECONNREFUSED',
    });
  });

  it('refuses a webhook with no address in it without calling the network', async () => {
    const { fetchImpl, calls } = stubFetch(new Response(null, { status: 200 }));

    await expect(sendToHomeAssistant('   ', PAYLOAD, fetchImpl)).resolves.toEqual({
      delivered: false,
      error: 'no-webhook',
    });
    expect(calls).toEqual([]);
  });
});
