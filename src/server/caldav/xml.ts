/**
 * Namespace-correct WebDAV/CalDAV XML.
 *
 * WebDAV responses mix at least four namespaces (`DAV:`, CalDAV, the
 * calendarserver extensions and Apple's `/ns/ical/`) and different servers
 * spell the same tag differently — `D:href`, `d:href` or a bare `href` under a
 * default `xmlns="DAV:"`. The parser therefore keeps the raw prefix *and*
 * resolves it to a namespace URI, and every lookup is
 * "namespace first, local name as fallback" so a sloppy server still works
 * while a correct one is parsed strictly.
 *
 * `fast-xml-parser` is configured with `preserveOrder` (so `<propstat>` order
 * and repetition survive) and `processEntities` + `htmlEntities` (so the
 * `&#13;` line endings iCloud uses inside `<C:calendar-data>` are decoded).
 */
import { XMLParser } from 'fast-xml-parser';

export const NS = {
  DAV: 'DAV:',
  CALDAV: 'urn:ietf:params:xml:ns:caldav',
  CALENDARSERVER: 'http://calendarserver.org/ns/',
  APPLE: 'http://apple.com/ns/ical/',
} as const;

/** Prefixes used when *building* requests; servers ignore the choice. */
export const NS_PREFIX: Readonly<Record<string, string>> = {
  [NS.DAV]: 'D',
  [NS.CALDAV]: 'C',
  [NS.CALENDARSERVER]: 'CS',
  [NS.APPLE]: 'A',
};

export interface XmlNode {
  /** Raw tag name as it appeared, e.g. `D:href`. */
  name: string;
  /** Tag name without its prefix, e.g. `href`. */
  localName: string;
  /** Resolved namespace URI, or `null` when the document never declared it. */
  ns: string | null;
  /** Attributes with raw names (`name`, `xmlns:C`, ...). */
  attributes: Record<string, string>;
  /** Concatenated *direct* text children, not trimmed. */
  text: string;
  children: XmlNode[];
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  preserveOrder: true,
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: true,
  htmlEntities: true,
  ignoreDeclaration: true,
});

type RawNode = Record<string, unknown> & { ':@'?: Record<string, string> };

/** Parses an XML document into a tree of {@link XmlNode}s under a synthetic root. */
export function parseXml(xml: string): XmlNode {
  const raw = parser.parse(xml) as RawNode[];
  const root: XmlNode = { name: '#document', localName: '#document', ns: null, attributes: {}, text: '', children: [] };
  convertInto(raw, new Map(), root);
  return root;
}

function convertInto(rawList: RawNode[], scope: Map<string, string>, parent: XmlNode): void {
  for (const raw of rawList) {
    for (const [key, value] of Object.entries(raw)) {
      if (key === ':@') continue;
      if (key.startsWith('#')) {
        // `#text`, `#cdata`, ... — direct character data of the enclosing element.
        parent.text += String(value);
        continue;
      }
      if (key.startsWith('?')) continue; // processing instruction
      const attributes = raw[':@'] ?? {};
      const localScope = new Map(scope);
      for (const [attr, attrValue] of Object.entries(attributes)) {
        if (attr === 'xmlns') localScope.set('', attrValue);
        else if (attr.startsWith('xmlns:')) localScope.set(attr.slice('xmlns:'.length), attrValue);
      }
      const colon = key.indexOf(':');
      const prefix = colon === -1 ? '' : key.slice(0, colon);
      const node: XmlNode = {
        name: key,
        localName: colon === -1 ? key : key.slice(colon + 1),
        ns: localScope.get(prefix) ?? null,
        attributes,
        text: '',
        children: [],
      };
      if (Array.isArray(value)) convertInto(value as RawNode[], localScope, node);
      parent.children.push(node);
    }
  }
}

/** Direct text of a node, trimmed; `''` for a missing node. */
export function textOf(node: XmlNode | null | undefined): string {
  return node ? node.text.trim() : '';
}

/** Children with `localName`, preferring an exact namespace match when `ns` is given. */
export function childrenNamed(node: XmlNode, localName: string, ns?: string): XmlNode[] {
  const byName = node.children.filter((child) => child.localName === localName);
  if (ns === undefined) return byName;
  const exact = byName.filter((child) => child.ns === ns);
  return exact.length > 0 ? exact : byName;
}

/** First child with `localName`, preferring `ns` when given. */
export function childNamed(node: XmlNode, localName: string, ns?: string): XmlNode | null {
  return childrenNamed(node, localName, ns)[0] ?? null;
}

/* -------------------------------------------------------------------------- */
/* multistatus                                                                */
/* -------------------------------------------------------------------------- */

export interface MultiStatusPropStat {
  status: number;
  /** Children of the `<D:prop>` inside this `<D:propstat>`. */
  props: XmlNode[];
}

export interface MultiStatusResponse {
  /** Raw `<D:href>` text; relative to the request URL, never absolutised here. */
  href: string;
  /** Direct `<D:status>`, else the best propstat status. */
  status: number;
  propstats: MultiStatusPropStat[];
  /** Union of the props of every *successful* propstat (all, if none succeeded). */
  props: XmlNode[];
}

export interface MultiStatus {
  responses: MultiStatusResponse[];
  /** Collection-level `<D:sync-token>`, when the server sent one. */
  syncToken: string | null;
}

/** `HTTP/1.1 200 OK` (or `HTTP/2 207`) → `200`; `0` when unparseable. */
export function parseStatusLine(line: string): number {
  const match = /\s(\d{3})(?:\s|$)/.exec(line.trim());
  if (!match) return 0;
  const status = Number.parseInt(match[1]!, 10);
  return Number.isFinite(status) ? status : 0;
}

/** Parses a `207 Multi-Status` body. Throws `Error` when the body is not XML. */
export function parseMultiStatus(xml: string): MultiStatus {
  const root = childNamed(parseXml(xml), 'multistatus', NS.DAV);
  if (!root) throw new Error('response is not a WebDAV multistatus document');

  const responses: MultiStatusResponse[] = [];
  for (const response of childrenNamed(root, 'response', NS.DAV)) {
    const propstats: MultiStatusPropStat[] = [];
    for (const propstat of childrenNamed(response, 'propstat', NS.DAV)) {
      propstats.push({
        status: parseStatusLine(textOf(childNamed(propstat, 'status', NS.DAV))),
        props: childNamed(propstat, 'prop', NS.DAV)?.children ?? [],
      });
    }
    const ok = propstats.filter((p) => p.status >= 200 && p.status < 300);
    const directStatus = parseStatusLine(textOf(childNamed(response, 'status', NS.DAV)));
    responses.push({
      href: textOf(childNamed(response, 'href', NS.DAV)),
      status: directStatus || (ok[0]?.status ?? propstats[0]?.status ?? 0),
      propstats,
      props: (ok.length > 0 ? ok : propstats).flatMap((p) => p.props),
    });
  }

  const syncTokenNode = childNamed(root, 'sync-token', NS.DAV) ?? childNamed(root, 'sync-token', NS.CALENDARSERVER);
  return { responses, syncToken: textOf(syncTokenNode) || null };
}

/**
 * Precondition element names inside a `<D:error>` body, e.g.
 * `valid-sync-token`, `supported-report`, `number-of-matches-within-limits`.
 */
export function errorPreconditions(xml: string): Set<string> {
  const names = new Set<string>();
  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch {
    return names;
  }
  const collect = (node: XmlNode): void => {
    for (const child of node.children) {
      if (child.localName === 'error') collect(child);
      else {
        names.add(child.localName);
        collect(child);
      }
    }
  };
  collect(root);
  return names;
}

/* -------------------------------------------------------------------------- */
/* building                                                                   */
/* -------------------------------------------------------------------------- */

export interface XmlElement {
  /** Local name, e.g. `propfind`. */
  name: string;
  /** Namespace URI; omit for an unnamespaced element. */
  ns?: string;
  attributes?: Record<string, string>;
  text?: string | null;
  children?: XmlElement[];
}

/** Terse element constructor. */
export function el(name: string, ns: string | undefined, extra?: Omit<XmlElement, 'name' | 'ns'>): XmlElement {
  return { name, ns, ...extra };
}

/** Serialises an element tree, declaring every namespace it uses on the root. */
export function buildXml(root: XmlElement, options?: { declaration?: boolean }): string {
  const used: string[] = [];
  collectNamespaces(root, used);
  const prefixFor = new Map<string, string>();
  let generated = 0;
  for (const ns of used) {
    let prefix = NS_PREFIX[ns];
    if (!prefix) {
      do {
        generated += 1;
        prefix = `N${generated}`;
      } while ([...prefixFor.values()].includes(prefix));
    }
    prefixFor.set(ns, prefix);
  }

  const declarations = [...prefixFor.entries()].map(([ns, prefix]) => ` xmlns:${prefix}="${escapeAttribute(ns)}"`).join('');
  const body = serialize(root, prefixFor, declarations);
  return options?.declaration === false ? body : `<?xml version="1.0" encoding="utf-8"?>${body}`;
}

function collectNamespaces(node: XmlElement, acc: string[]): void {
  if (node.ns && !acc.includes(node.ns)) acc.push(node.ns);
  for (const child of node.children ?? []) collectNamespaces(child, acc);
}

function serialize(node: XmlElement, prefixFor: Map<string, string>, rootDeclarations: string): string {
  const prefix = node.ns ? prefixFor.get(node.ns) : undefined;
  const tag = prefix ? `${prefix}:${node.name}` : node.name;
  const attributes = { ...(node.attributes ?? {}) };
  const rendered = Object.entries(attributes)
    .map(([key, value]) => ` ${key}="${escapeAttribute(value)}"`)
    .join('');
  const inner = (node.children ?? []).map((child) => serialize(child, prefixFor, '')).join('');
  const text = node.text ? escapeText(node.text) : '';
  if (!inner && !text) return `<${tag}${rendered}${rootDeclarations}/>`;
  return `<${tag}${rendered}${rootDeclarations}>${text}${inner}</${tag}>`;
}

export function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
}

export function escapeAttribute(value: string): string {
  return value.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;'));
}
