/**
 * Discovery: `.well-known/caldav` → principal → calendar home → collections.
 *
 * Servers differ wildly here — iCloud 301s the well-known URL to a per-account
 * host, Nextcloud answers under `/remote.php/dav/`, Radicale on `/` — so
 * discovery is deliberately layered: try the well-known URL first, fall back to
 * a PROPFIND on `/`, and always resolve relative `href`s against the URL that
 * actually answered (after redirects), because a principal and its calendar
 * home may live on another host.
 */
import { CalDavError } from './errors';
import type { Transport } from './http';
import type { PrincipalInfo, RemoteCalendar } from './types';
import { NS, buildXml, childNamed, childrenNamed, el, textOf, type XmlElement, type XmlNode } from './xml';

/** Properties needed to build a {@link RemoteCalendar}. */
export function calendarProps(): XmlElement[] {
  const property = (name: string, ns: string): XmlElement => el(name, ns);
  return [
    property('resourcetype', NS.DAV),
    property('displayname', NS.DAV),
    property('calendar-color', NS.APPLE),
    property('calendar-description', NS.CALDAV),
    property('supported-calendar-component-set', NS.CALDAV),
    property('calendar-timezone', NS.CALDAV),
    property('getctag', NS.CALENDARSERVER),
    property('sync-token', NS.DAV),
    property('current-user-privilege-set', NS.DAV),
  ];
}

/** `<D:propfind><D:prop>…</D:prop></D:propfind>` around the given properties. */
export function propfindBody(props: XmlElement[]): string {
  return buildXml(el('propfind', NS.DAV, { children: [el('prop', NS.DAV, { children: props })] }));
}

const PRINCIPAL_BODY = propfindBody([el('current-user-principal', NS.DAV)]);
const HOME_BODY = propfindBody([el('calendar-home-set', NS.CALDAV), el('displayname', NS.DAV)]);

const WRITE_PRIVILEGES = new Set(['write', 'write-content', 'write-properties', 'all', 'bind', 'unbind']);

/**
 * Resolves the principal and the calendar home. Nothing is cached here — the
 * client memoises the result so a sync run discovers once, not per collection.
 */
export async function discoverPrincipal(transport: Transport): Promise<PrincipalInfo> {
  const wellKnown = transport.resolve('/.well-known/caldav');
  const principalUrl =
    (await locatePrincipal(transport, wellKnown)) ?? (await locatePrincipal(transport, transport.resolve('/')));
  if (!principalUrl) {
    throw new CalDavError(
      `No CalDAV principal found — PROPFIND ${wellKnown} and ${transport.baseUrl}/ both lacked current-user-principal`,
      { status: 0, method: 'PROPFIND', url: wellKnown, retryable: false },
    );
  }

  const home = await transport.expectMultistatus({
    method: 'PROPFIND',
    url: principalUrl,
    headers: { Depth: '0' },
    body: HOME_BODY,
  });
  const response = home.multistatus!.responses[0];
  const calendarHomeHref = response ? hrefOfProp(response.props, 'calendar-home-set', NS.CALDAV) : null;

  return {
    principalUrl,
    // A server may point the home at a different host; resolve against the URL
    // that actually answered.
    calendarHomeUrl: calendarHomeHref ? transport.resolve(calendarHomeHref, home.finalUrl) : principalUrl,
    displayName: response ? propText(response.props, 'displayname', NS.DAV) : null,
  };
}

/**
 * PROPFIND for `current-user-principal`; `null` when this URL has no answer
 * (wrong path, method refused). Auth failures and 5xx still surface.
 */
async function locatePrincipal(transport: Transport, url: string): Promise<string | null> {
  const result = await transport.multistatus({
    method: 'PROPFIND',
    url,
    headers: { Depth: '0' },
    body: PRINCIPAL_BODY,
  });
  if (result.status === 401) transport.throwForStatus(result, 'PROPFIND');
  if (!result.multistatus) {
    if (result.status >= 500 || result.status === 429) transport.throwForStatus(result, 'PROPFIND');
    return null; // 400/403/404/405/501 → try the next candidate URL
  }
  const href = result.multistatus.responses
    .map((response) => hrefOfProp(response.props, 'current-user-principal', NS.DAV))
    .find((value): value is string => Boolean(value));
  return href ? transport.resolve(href, result.finalUrl) : null;
}

/** Depth:1 enumeration of the calendar home; non-calendar collections are skipped. */
export async function listRemoteCalendars(
  transport: Transport,
  homeUrl: string,
  options: { syncCollectionSupported?: boolean } = {},
): Promise<RemoteCalendar[]> {
  const result = await transport.expectMultistatus({
    method: 'PROPFIND',
    url: homeUrl,
    headers: { Depth: '1' },
    body: propfindBody(calendarProps()),
  });
  const multistatus = result.multistatus!;
  const supported = options.syncCollectionSupported ?? (await probeSyncCollection(transport, homeUrl));
  const home = withTrailingSlash(homeUrl);
  const calendars: RemoteCalendar[] = [];

  for (const response of multistatus.responses) {
    if (!response.href) continue;
    const href = transport.resolve(response.href, result.finalUrl);
    if (withTrailingSlash(href) === home) continue;

    const resourceType = propNode(response.props, 'resourcetype', NS.DAV);
    const kinds = resourceType ? resourceType.children.map((child) => child.localName.toLowerCase()) : [];
    if (!kinds.includes('calendar')) continue; // the home itself, or a plain collection

    calendars.push({
      href,
      displayName: propText(response.props, 'displayname', NS.DAV) ?? decodeURIComponent(lastSegment(href)),
      color: propText(response.props, 'calendar-color', NS.APPLE),
      description: propText(response.props, 'calendar-description', NS.CALDAV),
      supportedComponents: supportedComponentsOf(response.props),
      readOnly: isReadOnly(response.props),
      timezone: timezoneOf(response.props),
      ctag: propText(response.props, 'getctag', NS.CALENDARSERVER),
      // A sync token is only useful when the server implements delta sync.
      syncToken: supported ? propText(response.props, 'sync-token', NS.DAV) : null,
    });
  }
  return calendars;
}

/**
 * `true` when the server advertises RFC 6578 in the `DAV:` header of an
 * `OPTIONS` request — and also when OPTIONS tells us nothing at all, since the
 * REPORT itself is then the source of truth. `false` only when the header is
 * present and does not list `sync-collection`.
 */
export async function probeSyncCollection(transport: Transport, url: string): Promise<boolean> {
  const response = await transport.options(url);
  if (response.status < 200 || response.status >= 300) return true;
  return davCapabilities(response.headers.get('dav')).has('sync-collection');
}

/** Parses a `DAV:` capability header into a lower-cased token set. */
export function davCapabilities(header: string | null | undefined): Set<string> {
  if (!header) return new Set();
  return new Set(
    header
      .split(',')
      .map((token) => token.trim().toLowerCase())
      .filter(Boolean),
  );
}

/* -------------------------------------------------------------------------- */
/* property helpers                                                           */
/* -------------------------------------------------------------------------- */

/** Finds a property node by local name, preferring an exact namespace match. */
export function propNode(props: XmlNode[], localName: string, ns?: string): XmlNode | null {
  const matches = props.filter((prop) => prop.localName === localName);
  const exact = ns === undefined ? matches : matches.filter((prop) => prop.ns === ns);
  return (exact.length > 0 ? exact : matches)[0] ?? null;
}

/** Text of a property, preferring `ns` but accepting a misnamespaced server. */
export function propText(props: XmlNode[], localName: string, ns?: string): string | null {
  const value = textOf(propNode(props, localName, ns));
  return value === '' ? null : value;
}

/** `<C:calendar-home-set><D:href>…</D:href></C:calendar-home-set>` → the href. */
export function hrefOfProp(props: XmlNode[], localName: string, ns?: string): string | null {
  const container = propNode(props, localName, ns);
  const value = textOf(container ? childNamed(container, 'href', NS.DAV) : null);
  return value === '' ? null : value;
}

/** `supported-calendar-component-set` → `['VEVENT','VTODO']`. */
export function supportedComponentsOf(props: XmlNode[]): string[] {
  const set = propNode(props, 'supported-calendar-component-set', NS.CALDAV);
  if (!set) return ['VEVENT']; // conservative default: never push VTODOs blindly
  return childrenNamed(set, 'comp', NS.CALDAV)
    .map((comp) => (comp.attributes.name ?? '').toUpperCase())
    .filter(Boolean);
}

/** `true` only when the server described privileges and none of them write. */
export function isReadOnly(props: XmlNode[]): boolean {
  const set = propNode(props, 'current-user-privilege-set', NS.DAV);
  if (!set) return false; // no opinion → assume writable
  const privileges = childrenNamed(set, 'privilege', NS.DAV).flatMap((privilege) =>
    privilege.children.map((child) => child.localName.toLowerCase()),
  );
  if (privileges.length === 0) return false;
  return !privileges.some((privilege) => WRITE_PRIVILEGES.has(privilege));
}

/** `calendar-timezone` holds a whole VTIMEZONE; we only need its `TZID`. */
export function timezoneOf(props: XmlNode[]): string | null {
  const blob = propText(props, 'calendar-timezone', NS.CALDAV);
  if (!blob) return null;
  const match = /TZID:([^\r\n;]+)/.exec(blob);
  const tzid = match?.[1]?.trim();
  if (!tzid) return null;
  // Only path-style vendor TZIDs (`/freeassociation…/Tzfile/Europe/Berlin`) need splitting.
  return tzid.startsWith('/') ? (tzid.split('/').pop() ?? tzid) : tzid;
}

function lastSegment(href: string): string {
  try {
    const path = new URL(href).pathname.replace(/\/+$/, '');
    return path.slice(path.lastIndexOf('/') + 1);
  } catch {
    return href;
  }
}

function withTrailingSlash(href: string): string {
  return href.endsWith('/') ? href : `${href}/`;
}
