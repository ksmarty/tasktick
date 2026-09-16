/**
 * `CalDavClient` — the HTTP face of the CalDAV transport.
 *
 * Everything here is about *talking* to a server: discovery, PROPFIND/REPORT/
 * PUT/DELETE/OPTIONS/MKCALENDAR, ETag bookkeeping and per-resource statuses
 * inside a `207 Multi-Status`. Diffing, merging and scheduling live one layer
 * up in `src/server/sync/**`.
 *
 * Decisions worth knowing about:
 *   - The resolved principal and calendar home are memoised per client
 *     instance, so a sync run discovers once instead of per collection.
 *   - A `207` is a *batch* answer: an individual resource failing inside it
 *     never fails the call. Failures that would lose data (a changed object
 *     whose body we cannot fetch) flip `truncated` instead, which tells the
 *     caller to fall back to a full enumeration.
 *   - `href` on a returned object is the identity the *caller* asked about
 *     (absolute); hrefs that came from the server are resolved against the
 *     final, post-redirect response URL.
 */
import { CalDavAuthError, CalDavError, CalDavUnsupportedError } from './errors';
import { createTransport, type Transport } from './http';
import {
  discoverPrincipal,
  listRemoteCalendars,
  probeSyncCollection,
  propNode,
  propText,
  propfindBody,
} from './discovery';
import type {
  CalDavClient,
  CalDavClientOptions,
  CalDavCredentials,
  PrincipalInfo,
  PutOptions,
  PutResult,
  RemoteCalendar,
  RemoteObject,
  SyncCollectionDelta,
} from './types';
import { NS, buildXml, el, errorPreconditions, type MultiStatus, type XmlElement } from './xml';

class CalDavClientImpl implements CalDavClient {
  readonly transport: Transport;
  #discovery: Promise<PrincipalInfo> | null = null;

  constructor(credentials: CalDavCredentials, options: CalDavClientOptions = {}) {
    this.transport = createTransport(credentials, options);
  }

  /* ---- discovery ------------------------------------------------------ */

  async testConnection(): Promise<PrincipalInfo> {
    return this.#principal();
  }

  /** Memoised discovery; a failure clears the cache so the next run retries. */
  #principal(): Promise<PrincipalInfo> {
    if (!this.#discovery) {
      this.#discovery = discoverPrincipal(this.transport).catch((error: unknown) => {
        this.#discovery = null;
        throw error;
      });
    }
    return this.#discovery;
  }

  async listCalendars(): Promise<RemoteCalendar[]> {
    const principal = await this.#principal();
    return listRemoteCalendars(this.transport, principal.calendarHomeUrl);
  }

  /* ---- reading -------------------------------------------------------- */

  async syncCollection(href: string, syncToken: string | null): Promise<SyncCollectionDelta> {
    const url = this.transport.resolve(href);
    if (!(await probeSyncCollection(this.transport, url))) return truncatedDelta();

    const body = buildXml(
      el('sync-collection', NS.DAV, {
        children: [
          // An empty element means "initial sync": send me everything.
          el('sync-token', NS.DAV, { text: syncToken ?? '' }),
          el('sync-level', NS.DAV, { text: '1' }),
          el('prop', NS.DAV, { children: [el('getetag', NS.DAV), el('calendar-data', NS.CALDAV)] }),
        ],
      }),
    );
    const result = await this.transport.multistatus({
      method: 'REPORT',
      url,
      headers: { Depth: '1' },
      body,
    });

    if (!result.multistatus) {
      const preconditions = errorPreconditions(result.body);
      // An expired token, a refused report and a result set the server will not
      // send all mean the same thing to the caller: re-enumerate, which is
      // always correct, just slower.
      const truncatingStatuses = [400, 405, 501, 507];
      if (
        preconditions.has('valid-sync-token') ||
        preconditions.has('supported-report') ||
        preconditions.has('number-of-matches-within-limits') ||
        truncatingStatuses.includes(result.status)
      ) {
        return truncatedDelta();
      }
      this.transport.throwForStatus(result, 'REPORT');
    }

    const multistatus = result.multistatus!;
    const changed: RemoteObject[] = [];
    const deleted: string[] = [];
    let truncated = false;

    for (const response of multistatus.responses) {
      if (!response.href) continue;
      const absolute = this.transport.resolve(response.href, result.finalUrl);
      if (response.status === 404 || response.status === 410) {
        deleted.push(absolute);
        continue;
      }
      if (response.status === 507) {
        truncated = true;
        continue;
      }
      if (response.status < 200 || response.status >= 300) continue; // one bad resource, not a bad batch

      const etag = propText(response.props, 'getetag', NS.DAV);
      const data = propText(response.props, 'calendar-data', NS.CALDAV);
      if (data) {
        changed.push({ href: absolute, etag, data });
        continue;
      }
      // Some servers omit calendar-data in a delta; without the body the caller
      // cannot merge, so fetch it — and if that fails, force a full re-read.
      let fetched: RemoteObject | null;
      try {
        fetched = await this.getObject(absolute);
      } catch (error) {
        if (error instanceof CalDavAuthError) throw error;
        truncated = true; // unreadable body → make the caller re-enumerate
        continue;
      }
      if (fetched === null) deleted.push(absolute);
      else if (fetched.data) changed.push({ href: absolute, etag: etag ?? fetched.etag, data: fetched.data });
      else truncated = true;
    }

    return { syncToken: multistatus.syncToken, changed, deleted, truncated };
  }

  /** Full enumeration: PROPFIND Depth:1, with a calendar-query REPORT fallback. */
  async listObjects(href: string): Promise<RemoteObject[]> {
    const url = this.transport.resolve(href);
    const result = await this.transport.multistatus({
      method: 'PROPFIND',
      url,
      headers: { Depth: '1' },
      body: propfindBody([el('resourcetype', NS.DAV), el('getetag', NS.DAV), el('calendar-data', NS.CALDAV)]),
    });
    if (result.multistatus) return this.#collectObjects(result.multistatus, result.finalUrl, url);

    const preconditions = errorPreconditions(result.body);
    const refused =
      result.status === 405 ||
      result.status === 501 ||
      (result.status === 400 && (preconditions.has('supported-report') || preconditions.size === 0));
    if (!refused) this.transport.throwForStatus(result, 'PROPFIND');
    return this.#calendarQuery(url, null);
  }

  async getObject(href: string): Promise<RemoteObject | null> {
    const url = this.transport.resolve(href);
    const response = await this.transport.request({ method: 'GET', url });
    if (response.status === 404 || response.status === 410) return null;
    if (response.status < 200 || response.status >= 300) this.transport.throwForStatus(response, 'GET');
    return { href: url, etag: normalizeEtag(response.headers.get('etag')), data: response.body };
  }

  /** Time-bounded `calendar-query`; VEVENTs and VTODOs are queried separately. */
  async queryObjects(href: string, range: { start: Date; end: Date }): Promise<RemoteObject[]> {
    const url = this.transport.resolve(href);
    const window = { start: compactUtc(range.start), end: compactUtc(range.end) };
    const events = await this.#calendarQuery(url, { component: 'VEVENT', ...window });

    let todos: RemoteObject[] = [];
    try {
      todos = await this.#calendarQuery(url, { component: 'VTODO', ...window });
    } catch (error) {
      // A server that has no VTODOs (or does not understand the filter) only
      // means "no tasks in this window"; everything else must surface.
      const tolerable =
        error instanceof CalDavUnsupportedError || (error instanceof CalDavError && error.status === 400);
      if (!tolerable) throw error;
    }

    const merged = new Map<string, RemoteObject>();
    for (const object of [...events, ...todos]) merged.set(object.href, object);
    return [...merged.values()];
  }

  async getCtag(href: string): Promise<string | null> {
    const url = this.transport.resolve(href);
    const result = await this.transport.expectMultistatus({
      method: 'PROPFIND',
      url,
      headers: { Depth: '0' },
      body: propfindBody([el('getctag', NS.CALENDARSERVER), el('sync-token', NS.DAV)]),
    });
    const response = result.multistatus!.responses[0];
    if (!response) return null;
    return propText(response.props, 'getctag', NS.CALENDARSERVER) ?? propText(response.props, 'getctag', NS.DAV);
  }

  /* ---- writing -------------------------------------------------------- */

  /**
   * `PUT` with optimistic locking. A `412` means somebody else wrote first and
   * surfaces as {@link CalDavPreconditionFailedError}; writes are never retried.
   */
  async putObject(href: string, ics: string, options?: PutOptions): Promise<PutResult> {
    const url = this.transport.resolve(href);
    const headers: Record<string, string> = { 'Content-Type': 'text/calendar; charset=utf-8' };
    const etag = options?.etag;
    if (typeof etag === 'string' && etag !== '') headers['If-Match'] = ensureQuoted(etag);
    else if (options?.ifNoneMatch === true) headers['If-None-Match'] = '*';

    const response = await this.transport.expect({ method: 'PUT', url, body: ics, headers, retryable: false });
    return { href: url, etag: normalizeEtag(response.headers.get('etag')) };
  }

  async deleteObject(href: string, etag?: string | null): Promise<void> {
    const url = this.transport.resolve(href);
    const headers: Record<string, string> = {};
    if (typeof etag === 'string' && etag !== '') headers['If-Match'] = ensureQuoted(etag);
    await this.transport.expect({ method: 'DELETE', url, headers, retryable: false });
  }

  async createCalendar(
    href: string,
    displayName: string,
    components: string[],
    color?: string | null,
  ): Promise<void> {
    const url = this.transport.resolve(href);
    const props: XmlElement[] = [
      el('displayname', NS.DAV, { text: displayName }),
      el('supported-calendar-component-set', NS.CALDAV, {
        children: components.map((component) => el('comp', NS.CALDAV, { attributes: { name: component.toUpperCase() } })),
      }),
    ];
    if (color) props.push(el('calendar-color', NS.APPLE, { text: color }));

    const body = buildXml(
      el('mkcalendar', NS.CALDAV, {
        children: [el('set', NS.DAV, { children: [el('prop', NS.DAV, { children: props })] })],
      }),
    );
    // 405/501 → CalDavUnsupportedError: "this server has no MKCALENDAR".
    await this.transport.expect({
      method: 'MKCALENDAR',
      url,
      body,
      headers: { 'Content-Type': 'application/xml; charset=utf-8' },
      retryable: false,
    });
  }

  /* ---- internals ------------------------------------------------------ */

  async #calendarQuery(
    url: string,
    window: { component: string; start: string; end: string } | null,
  ): Promise<RemoteObject[]> {
    const compFilter = window
      ? el('comp-filter', NS.CALDAV, {
          attributes: { name: 'VCALENDAR' },
          children: [
            el('comp-filter', NS.CALDAV, {
              attributes: { name: window.component },
              children: [
                el('time-range', NS.CALDAV, { attributes: { start: window.start, end: window.end } }),
              ],
            }),
          ],
        })
      : el('comp-filter', NS.CALDAV, { attributes: { name: 'VCALENDAR' } });

    const body = buildXml(
      el('calendar-query', NS.CALDAV, {
        children: [
          el('prop', NS.DAV, { children: [el('getetag', NS.DAV), el('calendar-data', NS.CALDAV)] }),
          el('filter', NS.CALDAV, { children: [compFilter] }),
        ],
      }),
    );
    const result = await this.transport.expectMultistatus({
      method: 'REPORT',
      url,
      headers: { Depth: '1' },
      body,
    });
    return this.#collectObjects(result.multistatus!, result.finalUrl, url);
  }

  /** Turns a multistatus into objects, skipping sub-collections and failed resources. */
  async #collectObjects(multistatus: MultiStatus, finalUrl: string, collectionUrl: string): Promise<RemoteObject[]> {
    const objects: RemoteObject[] = [];
    for (const response of multistatus.responses) {
      if (!response.href) continue;
      const absolute = this.transport.resolve(response.href, finalUrl);
      if (withTrailingSlash(absolute) === withTrailingSlash(collectionUrl)) continue;
      if (response.status < 200 || response.status >= 300) continue;

      const resourceType = propNode(response.props, 'resourcetype', NS.DAV);
      const kinds = resourceType?.children.map((child) => child.localName.toLowerCase()) ?? [];
      if (kinds.includes('collection')) continue; // a sub-collection is not an object

      const etag = propText(response.props, 'getetag', NS.DAV);
      const data = propText(response.props, 'calendar-data', NS.CALDAV);
      if (data) {
        objects.push({ href: absolute, etag, data });
        continue;
      }
      // The server did not inline the body — GET it rather than lose the object.
      const fetched = await this.getObject(absolute);
      if (fetched) objects.push({ href: absolute, etag: etag ?? fetched.etag, data: fetched.data });
    }
    return objects;
  }
}

/**
 * Builds a client bound to one account. Discovery results are memoised on the
 * instance, so create one client per sync run rather than per request.
 */
export function createCalDavClient(credentials: CalDavCredentials, options: CalDavClientOptions = {}): CalDavClient {
  return new CalDavClientImpl(credentials, options);
}

function truncatedDelta(): SyncCollectionDelta {
  return { syncToken: null, changed: [], deleted: [], truncated: true };
}

/** `2024-03-09T13:00:00Z` → `20240309T130000Z` (CalDAV always wants UTC here). */
function compactUtc(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`;
}

/** Keeps a server's `ETag` byte-for-byte; only whitespace is trimmed. */
function normalizeEtag(raw: string | null): string | null {
  if (raw === null) return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/** `If-Match` requires a quoted entity-tag, even when a proxy stripped the quotes. */
function ensureQuoted(etag: string): string {
  const trimmed = etag.trim();
  if (trimmed.startsWith('W/"') || trimmed.startsWith('"')) return trimmed;
  return `"${trimmed}"`;
}

function withTrailingSlash(href: string): string {
  return href.endsWith('/') ? href : `${href}/`;
}
