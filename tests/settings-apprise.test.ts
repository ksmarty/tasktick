/**
 * The Apprise transport.
 *
 * Every request goes through a scripted in-memory `fetchImpl`, so nothing here
 * touches the network — the same pattern the CalDAV client tests use. The
 * contract that matters most is the failure one: a bad URL or an unreachable
 * gateway must come back as a result, never as a thrown error into the reminder
 * pipeline.
 */
import { describe, expect, it } from 'vitest';
import {
  buildAppriseBody,
  buildAppriseEndpoint,
  deliverUserNotification,
  isHttpUrl,
  sendApprise,
  type AppriseDelivery,
} from '@/server/services/notifications';
import type { AppriseConfig } from '@/server/repos/settings';

interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
}

function fakeFetch(handler: (request: RecordedRequest) => Response | Promise<Response>) {
  const calls: RecordedRequest[] = [];
  const fetchImpl = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String((input as { url?: string })?.url ?? input);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries((init?.headers ?? {}) as Record<string, string>)) {
      headers[key.toLowerCase()] = String(value);
    }
    const request: RecordedRequest = {
      method: (init?.method ?? 'GET').toUpperCase(),
      url,
      headers,
      body: typeof init?.body === 'string' ? init.body : '',
    };
    calls.push(request);
    return handler(request);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const CONFIG: AppriseConfig = { url: 'https://apprise.example.com/', key: 'abc123', tags: null };

describe('buildAppriseEndpoint', () => {
  it('appends /notify/<key> and trims a trailing slash', () => {
    expect(buildAppriseEndpoint('https://apprise.example.com/', 'abc')).toBe(
      'https://apprise.example.com/notify/abc',
    );
  });

  it('encodes a key that contains reserved characters', () => {
    expect(buildAppriseEndpoint('https://apprise.example.com', 'a/b c')).toBe(
      'https://apprise.example.com/notify/a%2Fb%20c',
    );
  });
});

describe('buildAppriseBody', () => {
  it('uses the documented title/body/type shape', () => {
    expect(buildAppriseBody({ title: 'Hi', body: 'There', type: 'warning' }, null)).toEqual({
      title: 'Hi',
      body: 'There',
      type: 'warning',
    });
  });

  it('defaults the type to info', () => {
    expect(buildAppriseBody({ title: 'Hi', body: 'There' }, null).type).toBe('info');
  });

  it('adds a comma-separated tag only when tags are present', () => {
    expect(buildAppriseBody({ title: 'Hi', body: 'There' }, ['work', 'urgent']).tag).toBe('work,urgent');
    expect(buildAppriseBody({ title: 'Hi', body: 'There' }, [])).not.toHaveProperty('tag');
    expect(buildAppriseBody({ title: 'Hi', body: 'There' }, ['  '])).not.toHaveProperty('tag');
  });
});

describe('isHttpUrl', () => {
  it('accepts http and https and rejects everything else', () => {
    expect(isHttpUrl('https://apprise.example.com')).toBe(true);
    expect(isHttpUrl('http://192.168.1.4:8000')).toBe(true);
    expect(isHttpUrl('ftp://example.com')).toBe(false);
    expect(isHttpUrl('not a url')).toBe(false);
    expect(isHttpUrl('')).toBe(false);
  });
});

describe('sendApprise', () => {
  it('POSTs the JSON body to /notify/<key>', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response('{}', { status: 200 }));
    const result = await sendApprise(CONFIG, { title: 'Task due', body: 'Buy milk', type: 'info' }, fetchImpl);

    expect(result).toEqual({ attempted: true, delivered: true, status: 200 });
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://apprise.example.com/notify/abc123');
    expect(calls[0].headers['content-type']).toBe('application/json');
    expect(JSON.parse(calls[0].body)).toEqual({ title: 'Task due', body: 'Buy milk', type: 'info' });
  });

  it('includes tags in the body', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response('{}', { status: 200 }));
    await sendApprise({ ...CONFIG, tags: ['work'] }, { title: 'a', body: 'b' }, fetchImpl);
    expect(JSON.parse(calls[0].body).tag).toBe('work');
  });

  it('reports a non-2xx gateway response without throwing', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('nope', { status: 502 }));
    const result = await sendApprise(CONFIG, { title: 'a', body: 'b' }, fetchImpl);
    expect(result).toEqual({ attempted: true, delivered: false, status: 502, error: 'Apprise responded 502' });
  });

  it('reports a network failure without throwing', async () => {
    const { fetchImpl } = fakeFetch(() => {
      throw new Error('ECONNREFUSED');
    });
    const result = await sendApprise(CONFIG, { title: 'a', body: 'b' }, fetchImpl);
    expect(result).toMatchObject({ attempted: true, delivered: false, error: 'ECONNREFUSED' });
  });

  it('rejects a malformed URL before any request is made', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response('{}', { status: 200 }));
    const result = await sendApprise({ url: 'not a url', key: 'abc', tags: null }, { title: 'a', body: 'b' }, fetchImpl);
    expect(result).toEqual({ attempted: true, delivered: false, error: 'invalid-url' });
    expect(calls).toHaveLength(0);
  });

  it('does not attempt anything when unconfigured', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response('{}', { status: 200 }));
    const result = await sendApprise({ url: '', key: '', tags: null }, { title: 'a', body: 'b' }, fetchImpl);
    expect(result).toEqual({ attempted: false, delivered: false, error: 'not-configured' });
    expect(calls).toHaveLength(0);
  });
});

describe('deliverUserNotification', () => {
  it('is a no-op when the user has no Apprise config', async () => {
    const { fetchImpl, calls } = fakeFetch(() => new Response('{}', { status: 200 }));
    const outcome = await deliverUserNotification('user-1', { title: 'a', body: 'b' }, {
      fetchImpl,
      getConfig: async () => null,
    });
    expect(outcome.apprise).toEqual({ attempted: false, delivered: false, error: 'not-configured' });
    expect(calls).toHaveLength(0);
  });

  it('never throws when the configured URL is bad, so the reminder path survives', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('{}', { status: 200 }));
    const outcome = await deliverUserNotification('user-1', { title: 'a', body: 'b' }, {
      fetchImpl,
      getConfig: async () => ({ url: '::::', key: 'abc', tags: null }),
    });
    expect(outcome.apprise.attempted).toBe(true);
    expect(outcome.apprise.delivered).toBe(false);
  });

  it('delivers when the gateway accepts it', async () => {
    const { fetchImpl } = fakeFetch(() => new Response('{}', { status: 200 }));
    const outcome: { apprise: AppriseDelivery } = await deliverUserNotification(
      'user-1',
      { title: 'a', body: 'b' },
      { fetchImpl, getConfig: async () => CONFIG },
    );
    expect(outcome.apprise.delivered).toBe(true);
  });
});
