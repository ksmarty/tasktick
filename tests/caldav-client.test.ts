/**
 * Transport-level tests for `createCalDavClient` — every request goes through a
 * scripted in-memory `fetchImpl`, so nothing here touches the network.
 *
 * The fixture shapes (multistatus bodies, `DAV:` headers, ETags) mirror what
 * iCloud, Nextcloud and Radicale actually answer.
 */
import { describe, expect, it } from 'vitest';
import {
  CalDavAuthError,
  CalDavError,
  CalDavNotFoundError,
  CalDavPreconditionFailedError,
  CalDavUnsupportedError,
  createCalDavClient,
  type CalDavClientOptions,
} from '@/server/caldav';

interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string;
  signal: AbortSignal | undefined;
}

type Handler = (request: RecordedRequest) => Response | Promise<Response>;

function fakeFetch(handler: Handler): { fetchImpl: typeof fetch; calls: RecordedRequest[] } {
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
      signal: init?.signal ?? undefined,
    };
    calls.push(request);
    return handler(request);
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const CREDENTIALS = {
  serverUrl: 'https://caldav.example.com',
  username: 'ada@example.com',
  password: 'app-specific-password',
};

const PRINCIPAL_URL = 'https://caldav.example.com/1234/principal/';
const HOME_URL = 'https://caldav.example.com/1234/calendars/';
const CALENDAR_URL = 'https://caldav.example.com/1234/calendars/home/';

const client = (
  handler: Handler,
  options: CalDavClientOptions = {},
  credentials: Partial<typeof CREDENTIALS> = {},
) => {
  const { fetchImpl, calls } = fakeFetch(handler);
  return { caldav: createCalDavClient({ ...CREDENTIALS, ...credentials }, { fetchImpl, ...options }), calls };
};

function multistatus(xml: string, init?: { status?: number; headers?: Record<string, string> }): Response {
  return new Response(xml, {
    status: init?.status ?? 207,
    headers: { 'Content-Type': 'application/xml; charset=utf-8', ...(init?.headers ?? {}) },
  });
}

function propfind(xml: string, headers: Record<string, string> = {}): Response {
  return multistatus(xml, { headers });
}

/* -------------------------------------------------------------------------- */
/* discovery                                                                  */
/* -------------------------------------------------------------------------- */

describe('discovery', () => {
  /** iCloud answers `/.well-known/caldav` with a 301 to a per-account host. */
  const icloudHandler: Handler = (request) => {
    if (request.url === 'https://caldav.icloud.com/.well-known/caldav') {
      return new Response(null, { status: 301, headers: { Location: 'https://p42-caldav.icloud.com/' } });
    }
    if (request.url === 'https://p42-caldav.icloud.com/' && request.method === 'PROPFIND') {
      return propfind(
        `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/</D:href>
    <D:propstat>
      <D:prop><D:current-user-principal><D:href>/9876543210/principal/</D:href></D:current-user-principal></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`,
      );
    }
    if (request.url === 'https://p42-caldav.icloud.com/9876543210/principal/') {
      return propfind(
        `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/9876543210/principal/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>Ada Lovelace</D:displayname>
        <C:calendar-home-set><D:href>/9876543210/calendars/</D:href></C:calendar-home-set>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`,
      );
    }
    return new Response('not found', { status: 404 });
  };

  it('follows the well-known 301 and resolves the principal on the redirected host', async () => {
    const { caldav, calls } = client(icloudHandler, {}, { serverUrl: 'https://caldav.icloud.com' });

    const principal = await caldav.testConnection();

    expect(principal).toEqual({
      principalUrl: 'https://p42-caldav.icloud.com/9876543210/principal/',
      calendarHomeUrl: 'https://p42-caldav.icloud.com/9876543210/calendars/',
      displayName: 'Ada Lovelace',
    });
    // The PROPFIND survived the redirect hop and every request was authenticated.
    expect(calls[0]!.method).toBe('PROPFIND');
    expect(calls[1]!.url).toBe('https://p42-caldav.icloud.com/');
    for (const call of calls) {
      expect(call.headers.authorization).toBe(`Basic ${btoa('ada@example.com:app-specific-password')}`);
      expect(call.headers['user-agent']).toMatch(/tasktick/i);
      expect(call.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('falls back to a PROPFIND on / when /.well-known/caldav is absent', async () => {
    const seen: string[] = [];
    const { caldav } = client((request) => {
      seen.push(request.url);
      if (request.url.endsWith('/.well-known/caldav')) return new Response('nope', { status: 404 });
      if (request.url === 'https://caldav.example.com/' && request.body.includes('current-user-principal')) {
        return propfind(
          `<D:multistatus xmlns:D="DAV:"><D:response><D:href>/</D:href><D:propstat><D:prop>
            <D:current-user-principal><D:href>/principals/ada/</D:href></D:current-user-principal>
          </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`,
        );
      }
      if (request.url === 'https://caldav.example.com/principals/ada/') {
        return propfind(
          `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response><D:href>/principals/ada/</D:href>
           <D:propstat><D:prop><C:calendar-home-set><D:href>/calendars/ada/</D:href></C:calendar-home-set></D:prop>
           <D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`,
        );
      }
      return new Response('unexpected', { status: 500 });
    });

    const principal = await caldav.testConnection();
    expect(principal.calendarHomeUrl).toBe('https://caldav.example.com/calendars/ada/');
    expect(seen[1]).toBe('https://caldav.example.com/');
  });

  it('memoises discovery so a sync run does not re-discover per collection', async () => {
    const { caldav, calls } = client(icloudHandler, {}, { serverUrl: 'https://caldav.icloud.com' });
    await caldav.testConnection();
    const afterFirst = calls.length;
    await caldav.testConnection();
    await caldav.testConnection();
    expect(calls.length).toBe(afterFirst);
  });

  it('surfaces a 401 as CalDavAuthError without leaking the password', async () => {
    const { caldav } = client(() => new Response('Unauthorized', { status: 401 }));
    await expect(caldav.testConnection()).rejects.toBeInstanceOf(CalDavAuthError);
    try {
      await caldav.testConnection();
    } catch (error) {
      expect((error as Error).message).not.toContain(CREDENTIALS.password);
      expect((error as Error).message).not.toContain('ada@example.com:');
    }
  });

  it('refuses plain HTTP unless allowInsecureTls is set', async () => {
    const insecure = client(
      () => new Response('', { status: 200 }),
      {},
      { serverUrl: 'http://nextcloud.lan/remote.php/dav' },
    );

    await expect(insecure.caldav.testConnection()).rejects.toThrow(/https/i);
    // The policy is enforced before any credential leaves the process.
    expect(insecure.calls).toHaveLength(0);

    const allowed = client(
      () =>
        propfind(
          `<D:multistatus xmlns:D="DAV:"><D:response><D:href>/</D:href><D:propstat><D:prop>
           <D:current-user-principal><D:href>/p/</D:href></D:current-user-principal></D:prop>
           <D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`,
        ),
      { allowInsecureTls: true },
      { serverUrl: 'http://nextcloud.lan/remote.php/dav' },
    );
    expect(allowed.calls).toHaveLength(0);
    await expect(allowed.caldav.testConnection()).resolves.toMatchObject({
      principalUrl: 'http://nextcloud.lan/p/',
    });
  });
});

/* -------------------------------------------------------------------------- */
/* listCalendars                                                              */
/* -------------------------------------------------------------------------- */

const CALENDARS_BODY = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav" xmlns:CS="http://calendarserver.org/ns/" xmlns:A="http://apple.com/ns/ical/">
  <D:response>
    <D:href>/1234/calendars/</D:href>
    <D:propstat>
      <D:prop><D:resourcetype><D:collection/></D:resourcetype><D:displayname>calendars</D:displayname></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/1234/calendars/home/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
        <D:displayname>Home</D:displayname>
        <A:calendar-color>#FF2D55FF</A:calendar-color>
        <C:calendar-description>Everything at home</C:calendar-description>
        <C:supported-calendar-component-set><C:comp name="VEVENT"/><C:comp name="VTODO"/></C:supported-calendar-component-set>
        <C:calendar-timezone>BEGIN:VCALENDAR&#13;&#10;BEGIN:VTIMEZONE&#13;&#10;TZID:Europe/Berlin&#13;&#10;END:VTIMEZONE&#13;&#10;END:VCALENDAR&#13;&#10;</C:calendar-timezone>
        <CS:getctag>"ctag-1"</CS:getctag>
        <D:sync-token>https://caldav.example.com/ns/sync/42</D:sync-token>
        <D:current-user-privilege-set><D:privilege><D:read/></D:privilege><D:privilege><D:write/></D:privilege></D:current-user-privilege-set>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/1234/calendars/tasks/</D:href>
    <D:propstat>
      <D:prop>
        <D:resourcetype><D:collection/><C:calendar/></D:resourcetype>
        <D:displayname>Reminders</D:displayname>
        <C:supported-calendar-component-set><C:comp name="VTODO"/></C:supported-calendar-component-set>
        <D:current-user-privilege-set><D:privilege><D:read/></D:privilege></D:current-user-privilege-set>
        <D:sync-token>https://caldav.example.com/ns/sync/43</D:sync-token>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/1234/calendars/notes.txt</D:href>
    <D:propstat>
      <D:prop><D:getetag>"txt"</D:getetag></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;

function discoveryHandler(options: { syncCollection: boolean; calendarsBody?: string }): Handler {
  return (request) => {
    if (request.url.endsWith('/.well-known/caldav')) {
      return propfind(
        `<D:multistatus xmlns:D="DAV:"><D:response><D:href>/</D:href><D:propstat><D:prop>
          <D:current-user-principal><D:href>${new URL(PRINCIPAL_URL).pathname}</D:href></D:current-user-principal>
        </D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`,
      );
    }
    if (request.url === PRINCIPAL_URL) {
      return propfind(
        `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response><D:href>${new URL(PRINCIPAL_URL).pathname}</D:href>
         <D:propstat><D:prop><C:calendar-home-set><D:href>${new URL(HOME_URL).pathname}</D:href></C:calendar-home-set></D:prop>
         <D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`,
      );
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 200,
        headers: { DAV: options.syncCollection ? '1, 2, 3, calendar-access, sync-collection' : '1, 2, calendar-access' },
      });
    }
    if (request.url === HOME_URL && request.method === 'PROPFIND') {
      return propfind(options.calendarsBody ?? CALENDARS_BODY);
    }
    return new Response('unexpected', { status: 500 });
  };
}

describe('listCalendars', () => {
  it('enumerates calendars with Depth:1 and skips non-calendar collections', async () => {
    const { caldav, calls } = client(discoveryHandler({ syncCollection: true }));
    const calendars = await caldav.listCalendars();

    expect(calendars.map((c) => c.href)).toEqual([`${HOME_URL}home/`, `${HOME_URL}tasks/`]);
    const [home, tasks] = calendars;
    expect(home).toMatchObject({
      displayName: 'Home',
      color: '#FF2D55FF',
      description: 'Everything at home',
      supportedComponents: ['VEVENT', 'VTODO'],
      readOnly: false,
      timezone: 'Europe/Berlin',
      ctag: '"ctag-1"',
      syncToken: 'https://caldav.example.com/ns/sync/42',
    });
    expect(tasks).toMatchObject({ displayName: 'Reminders', supportedComponents: ['VTODO'], readOnly: true, ctag: null });
    expect(tasks!.timezone).toBeNull();

    const propfindCall = calls.find((call) => call.url === HOME_URL && call.method === 'PROPFIND')!;
    expect(propfindCall.headers.depth).toBe('1');
    expect(propfindCall.body).toContain('supported-calendar-component-set');
    expect(propfindCall.body).toContain('current-user-privilege-set');
  });

  it('reports syncToken as null when the server does not advertise sync-collection', async () => {
    const { caldav, calls } = client(discoveryHandler({ syncCollection: false }));
    const calendars = await caldav.listCalendars();

    expect(calendars.every((calendar) => calendar.syncToken === null)).toBe(true);
    expect(calls.some((call) => call.method === 'OPTIONS')).toBe(true);

    const delta = await caldav.syncCollection(calendars[0]!.href, 'stale-token');
    expect(delta).toEqual({ syncToken: null, changed: [], deleted: [], truncated: true });
    // No REPORT was even attempted: the caller falls back to listObjects().
    expect(calls.some((call) => call.method === 'REPORT')).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* sync-collection                                                            */
/* -------------------------------------------------------------------------- */

const SYNC_BODY = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/1234/calendars/home/party.ics</D:href>
    <D:propstat>
      <D:prop>
        <D:getetag>"etag-2"</D:getetag>
        <C:calendar-data>BEGIN:VCALENDAR&#13;&#10;VERSION:2.0&#13;&#10;BEGIN:VEVENT&#13;&#10;UID:party@example.com&#13;&#10;DTSTART:20240309T130000Z&#13;&#10;SUMMARY:Party&#13;&#10;END:VEVENT&#13;&#10;END:VCALENDAR&#13;&#10;</C:calendar-data>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/1234/calendars/home/gone.ics</D:href>
    <D:status>HTTP/1.1 404 Not Found</D:status>
  </D:response>
  <D:sync-token>https://caldav.example.com/ns/sync/99</D:sync-token>
</D:multistatus>`;

describe('syncCollection', () => {
  it('returns changed objects and 404 tombstones, and decodes escaped iCalendar text', async () => {
    const { caldav, calls } = client((request) => {
      if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers: { DAV: '1, sync-collection' } });
      if (request.method === 'REPORT') return multistatus(SYNC_BODY);
      return new Response('unexpected', { status: 500 });
    });

    const delta = await caldav.syncCollection(CALENDAR_URL, 'https://caldav.example.com/ns/sync/42');

    expect(delta.syncToken).toBe('https://caldav.example.com/ns/sync/99');
    expect(delta.truncated).toBe(false);
    expect(delta.changed).toEqual([
      {
        href: `${CALENDAR_URL}party.ics`,
        etag: '"etag-2"',
        // `&#13;&#10;` becomes real CRLF, so the payload is parseable iCalendar.
        data: expect.stringContaining('BEGIN:VCALENDAR\r\n'),
      },
    ]);
    expect(delta.deleted).toEqual([`${CALENDAR_URL}gone.ics`]);

    const report = calls.find((call) => call.method === 'REPORT')!;
    expect(report.headers.depth).toBe('1');
    expect(report.body).toContain('<D:sync-level>1</D:sync-level>');
    expect(report.body).toContain('>https://caldav.example.com/ns/sync/42</D:sync-token>');
    expect(report.body).toContain('<D:getetag/>');
    expect(report.body).toContain('<C:calendar-data/>');
  });

  it('treats an expired sync token (403 valid-sync-token) as truncation', async () => {
    const { caldav } = client((request) => {
      if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers: { DAV: '1, sync-collection' } });
      return multistatus(
        `<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:valid-sync-token/></D:error>`,
        { status: 403 },
      );
    });

    await expect(caldav.syncCollection(CALENDAR_URL, 'expired')).resolves.toEqual({
      syncToken: null,
      changed: [],
      deleted: [],
      truncated: true,
    });
  });

  it('sends an empty sync-token element for an initial sync', async () => {
    const { caldav, calls } = client((request) => {
      if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers: { DAV: '1, sync-collection' } });
      return multistatus(`<D:multistatus xmlns:D="DAV:"><D:sync-token>t1</D:sync-token></D:multistatus>`);
    });

    await caldav.syncCollection(CALENDAR_URL, null);
    const report = calls.find((call) => call.method === 'REPORT')!;
    expect(report.body).toContain('<D:sync-token/>');
  });

  it('fetches a missing body instead of dropping a changed object', async () => {
    const { caldav } = client((request) => {
      if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers: { DAV: '1, sync-collection' } });
      if (request.method === 'REPORT') {
        return multistatus(
          `<D:multistatus xmlns:D="DAV:"><D:response><D:href>/1234/calendars/home/x.ics</D:href>
           <D:propstat><D:prop><D:getetag>"e3"</D:getetag></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
           </D:response><D:sync-token>t2</D:sync-token></D:multistatus>`,
        );
      }
      return new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', {
        status: 200,
        headers: { ETag: '"e3"', 'Content-Type': 'text/calendar' },
      });
    });

    const delta = await caldav.syncCollection(CALENDAR_URL, 't1');
    expect(delta.changed).toEqual([{ href: `${CALENDAR_URL}x.ics`, etag: '"e3"', data: expect.stringContaining('BEGIN:VCALENDAR') }]);
    expect(delta.truncated).toBe(false);
  });

  it('flags a truncated result set when the server says so', async () => {
    const { caldav } = client((request) => {
      if (request.method === 'OPTIONS') return new Response(null, { status: 200, headers: { DAV: '1, sync-collection' } });
      return multistatus(
        `<D:error xmlns:D="DAV:"><D:number-of-matches-within-limits/></D:error>`,
        { status: 507 },
      );
    });

    const delta = await caldav.syncCollection(CALENDAR_URL, 't1');
    expect(delta.truncated).toBe(true);
    expect(delta.changed).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */
/* listObjects / getObject / queryObjects                                     */
/* -------------------------------------------------------------------------- */

describe('object reads', () => {
  const LIST_BODY = `<?xml version="1.0"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/1234/calendars/home/</D:href>
    <D:propstat><D:prop><D:resourcetype><D:collection/><C:calendar/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  </D:response>
  <D:response>
    <D:href>/1234/calendars/home/a.ics</D:href>
    <D:propstat><D:prop><D:getetag>"a1"</D:getetag><C:calendar-data>BEGIN:VCALENDAR&#13;&#10;END:VCALENDAR&#13;&#10;</C:calendar-data></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  </D:response>
  <D:response>
    <D:href>/1234/calendars/home/sub/</D:href>
    <D:propstat><D:prop><D:resourcetype><D:collection/></D:resourcetype></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat>
  </D:response>
  <D:response>
    <D:href>/1234/calendars/home/broken.ics</D:href>
    <D:status>HTTP/1.1 403 Forbidden</D:status>
  </D:response>
</D:multistatus>`;

  it('lists objects, skipping the collection itself and per-resource failures', async () => {
    const { caldav } = client((request) => {
      if (request.method === 'PROPFIND') return propfind(LIST_BODY);
      return new Response('unexpected', { status: 500 });
    });

    const objects = await caldav.listObjects(CALENDAR_URL);
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatchObject({ href: `${CALENDAR_URL}a.ics`, etag: '"a1"' });
    // Surrounding XML whitespace is trimmed, the payload itself is intact.
    expect(objects[0]!.data).toMatch(/^BEGIN:VCALENDAR\r\nEND:VCALENDAR\r?\n?$/);
  });

  it('falls back to a calendar-query REPORT when PROPFIND is refused', async () => {
    const { caldav, calls } = client((request) => {
      if (request.method === 'PROPFIND') return new Response('Method Not Allowed', { status: 405 });
      if (request.method === 'REPORT') {
        return multistatus(
          `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response><D:href>/1234/calendars/home/c.ics</D:href>
           <D:propstat><D:prop><D:getetag>"c1"</D:getetag><C:calendar-data>BEGIN:VCALENDAR</C:calendar-data></D:prop>
           <D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`,
        );
      }
      return new Response('unexpected', { status: 500 });
    });

    const objects = await caldav.listObjects(CALENDAR_URL);
    expect(objects[0]!.href).toBe(`${CALENDAR_URL}c.ics`);
    expect(calls.some((call) => call.method === 'REPORT')).toBe(true);
  });

  it('returns null for a deleted object and the ETag for a live one', async () => {
    const { caldav } = client((request) => {
      if (request.url.endsWith('gone.ics')) return new Response('', { status: 404 });
      return new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', { status: 200, headers: { ETag: '"v9"' } });
    });

    await expect(caldav.getObject(`${CALENDAR_URL}gone.ics`)).resolves.toBeNull();
    await expect(caldav.getObject(`${CALENDAR_URL}live.ics`)).resolves.toEqual({
      href: `${CALENDAR_URL}live.ics`,
      etag: '"v9"',
      data: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n',
    });
  });

  it('bounds queryObjects with a UTC time-range filter', async () => {
    const { caldav, calls } = client(() =>
      multistatus(
        `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:response><D:href>/1234/calendars/home/d.ics</D:href>
         <D:propstat><D:prop><D:getetag>"d1"</D:getetag><C:calendar-data>BEGIN:VCALENDAR</C:calendar-data></D:prop>
         <D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`,
      ),
    );

    const objects = await caldav.queryObjects(CALENDAR_URL, {
      start: new Date('2024-03-01T00:00:00Z'),
      end: new Date('2024-04-01T00:00:00Z'),
    });

    expect(objects).toHaveLength(1);
    const reports = calls.filter((call) => call.method === 'REPORT');
    expect(reports).toHaveLength(2); // VEVENT + VTODO windows
    expect(reports[0]!.body).toContain('<C:time-range start="20240301T000000Z" end="20240401T000000Z"');
  });
});

/* -------------------------------------------------------------------------- */
/* writes                                                                     */
/* -------------------------------------------------------------------------- */

describe('writes', () => {
  it('round-trips ETags: If-Match on update, If-None-Match on create, new ETag from the response', async () => {
    let stored: string | null = null;
    const { caldav, calls } = client((request) => {
      if (request.method === 'PUT') {
        stored = '"etag-2"';
        return new Response(null, { status: 204, headers: { ETag: stored } });
      }
      return new Response('unexpected', { status: 500 });
    });

    const created = await caldav.putObject(`${CALENDAR_URL}new.ics`, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', {
      ifNoneMatch: true,
    });
    expect(created).toEqual({ href: `${CALENDAR_URL}new.ics`, etag: '"etag-2"' });
    expect(calls[0]!.headers['if-none-match']).toBe('*');
    expect(calls[0]!.headers['if-match']).toBeUndefined();
    expect(calls[0]!.headers['content-type']).toBe('text/calendar; charset=utf-8');

    const updated = await caldav.putObject(`${CALENDAR_URL}new.ics`, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', {
      etag: created.etag,
    });
    expect(updated.etag).toBe('"etag-2"');
    expect(calls[1]!.headers['if-match']).toBe('"etag-2"');
    expect(calls[1]!.headers['if-none-match']).toBeUndefined();
  });

  it('sends neither conditional header on an optimistic create', async () => {
    const { caldav, calls } = client(() => new Response(null, { status: 201 }));
    await caldav.putObject(`${CALENDAR_URL}optimistic.ics`, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n');
    expect(calls[0]!.headers['if-match']).toBeUndefined();
    expect(calls[0]!.headers['if-none-match']).toBeUndefined();
  });

  it('maps 412 to CalDavPreconditionFailedError and never retries the write', async () => {
    const { caldav, calls } = client(() => new Response('Precondition Failed', { status: 412 }));

    const error = await caldav
      .putObject(`${CALENDAR_URL}conflict.ics`, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', { etag: '"stale"' })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(CalDavPreconditionFailedError);
    expect(error).toMatchObject({ status: 412, method: 'PUT', retryable: false });
    expect((error as CalDavPreconditionFailedError).url).toBe(`${CALENDAR_URL}conflict.ics`);
    expect(calls).toHaveLength(1);
  });

  it('deletes with If-Match and surfaces a missing object as CalDavNotFoundError', async () => {
    const { caldav, calls } = client((request) =>
      request.url.endsWith('missing.ics')
        ? new Response('', { status: 404 })
        : new Response(null, { status: 204 }),
    );

    await caldav.deleteObject(`${CALENDAR_URL}live.ics`, '"e1"');
    expect(calls[0]!.headers['if-match']).toBe('"e1"');

    await expect(caldav.deleteObject(`${CALENDAR_URL}missing.ics`)).rejects.toBeInstanceOf(CalDavNotFoundError);
  });

  it('creates a calendar with MKCALENDAR and reports servers without it', async () => {
    const { caldav, calls } = client((request) =>
      request.url.endsWith('/new/')
        ? request.method === 'MKCALENDAR'
          ? new Response(null, { status: 201 })
          : new Response('', { status: 500 })
        : new Response('Method Not Allowed', { status: 405 }),
    );

    await caldav.createCalendar(`${HOME_URL}new/`, 'Trips', ['VEVENT', 'VTODO'], '#007AFF');
    const body = calls[0]!.body;
    expect(body).toContain('mkcalendar');
    expect(body).toContain('<D:displayname');
    expect(body).toContain('name="VTODO"');
    expect(body).toContain('calendar-color');

    await expect(caldav.createCalendar(`${HOME_URL}other/`, 'Nope', ['VEVENT'])).rejects.toBeInstanceOf(
      CalDavUnsupportedError,
    );
  });

  it('reads the ctag with a Depth:0 PROPFIND and returns null when absent', async () => {
    const { caldav, calls } = client((request) =>
      request.url === CALENDAR_URL
        ? propfind(
            `<D:multistatus xmlns:D="DAV:" xmlns:CS="http://calendarserver.org/ns/"><D:response><D:href>/1234/calendars/home/</D:href>
             <D:propstat><D:prop><CS:getctag>"ctag-9"</CS:getctag></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`,
          )
        : propfind(
            `<D:multistatus xmlns:D="DAV:"><D:response><D:href>/x/</D:href><D:propstat><D:prop/><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`,
          ),
    );

    await expect(caldav.getCtag(CALENDAR_URL)).resolves.toBe('"ctag-9"');
    expect(calls[0]!.headers.depth).toBe('0');
    await expect(caldav.getCtag(`${HOME_URL}none/`)).resolves.toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* retries                                                                    */
/* -------------------------------------------------------------------------- */

describe('retries', () => {
  it('retries an idempotent PROPFIND on 503 and honours Retry-After', async () => {
    let attempts = 0;
    const { caldav, calls } = client((request) => {
      if (request.method === 'PROPFIND') {
        attempts += 1;
        if (attempts < 3) return new Response('busy', { status: 503, headers: { 'Retry-After': '0' } });
        return propfind(
          `<D:multistatus xmlns:D="DAV:"><D:response><D:href>/1234/calendars/home/</D:href><D:propstat><D:prop><D:getctag>"ok"</D:getctag></D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`,
        );
      }
      return new Response('unexpected', { status: 500 });
    });

    await expect(caldav.getCtag(CALENDAR_URL)).resolves.toBe('"ok"');
    expect(calls).toHaveLength(3);
  });

  it('never retries a PUT on 503', async () => {
    const { caldav, calls } = client(() => new Response('busy', { status: 503, headers: { 'Retry-After': '0' } }));

    const error = await caldav
      .putObject(`${CALENDAR_URL}x.ics`, 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', { etag: '"e"' })
      .catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(CalDavError);
    expect((error as CalDavError).retryable).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('never retries a DELETE on 500', async () => {
    const { caldav, calls } = client(() => new Response('boom', { status: 500 }));
    await expect(caldav.deleteObject(`${CALENDAR_URL}x.ics`)).rejects.toBeInstanceOf(CalDavError);
    expect(calls).toHaveLength(1);
  });
});
