/**
 * XML layer tests: prefixes must be resolved to namespaces (servers disagree on
 * both), entity-escaped iCalendar payloads must survive, and the builder must
 * declare every namespace it uses.
 */
import { describe, expect, it } from 'vitest';
import {
  NS,
  buildXml,
  childNamed,
  childrenNamed,
  el,
  errorPreconditions,
  escapeAttribute,
  parseMultiStatus,
  parseStatusLine,
  parseXml,
} from '@/server/caldav/xml';

describe('parseXml', () => {
  it('resolves prefixed and default-namespaced elements', () => {
    const root = parseXml(
      `<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
         <D:response><D:href>/a.ics</D:href></D:response>
         <C:calendar xmlns="DAV:"><displayname>Default ns</displayname></C:calendar>
       </D:multistatus>`,
    );

    const multistatus = childNamed(root, 'multistatus', NS.DAV)!;
    expect(multistatus.ns).toBe(NS.DAV);
    expect(childNamed(multistatus, 'response', NS.DAV)!.ns).toBe(NS.DAV);

    const calendar = childNamed(multistatus, 'calendar', NS.CALDAV)!;
    const displayname = childNamed(calendar, 'displayname')!;
    expect(displayname.text).toBe('Default ns');
    expect(displayname.ns).toBe(NS.DAV); // inherited from the default xmlns
  });

  it('prefers an exact namespace match over a same-named stranger', () => {
    const document = parseXml(
      `<root xmlns:D="DAV:" xmlns:X="urn:x"><X:getetag>"wrong"</X:getetag><D:getetag>"right"</D:getetag></root>`,
    );
    const root = childNamed(document, 'root')!;
    expect(childNamed(root, 'getetag', NS.DAV)!.text).toBe('"right"');
    expect(childrenNamed(root, 'getetag')).toHaveLength(2);
  });

  it('decodes numeric and named entities exactly once', () => {
    const document = parseXml(
      `<r><a>BEGIN:VCALENDAR&#13;&#10;SUMMARY:x&#13;&#10;END:VCALENDAR&#13;&#10;</a><b>&lt;tag&gt; &amp;amp;</b></r>`,
    );
    const root = childNamed(document, 'r')!;
    expect(childNamed(root, 'a')!.text).toBe('BEGIN:VCALENDAR\r\nSUMMARY:x\r\nEND:VCALENDAR\r\n');
    expect(childNamed(root, 'b')!.text).toBe('<tag> &amp;');
  });
});

describe('parseMultiStatus', () => {
  const body = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:response>
    <D:href>/1234/calendars/home/a.ics</D:href>
    <D:propstat>
      <D:prop><D:getetag>"e1"</D:getetag></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
    <D:propstat>
      <D:prop><C:calendar-data/></D:prop>
      <D:status>HTTP/1.1 404 Not Found</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/1234/calendars/home/gone.ics</D:href>
    <D:status>HTTP/1.1 404 Not Found</D:status>
  </D:response>
  <D:sync-token>https://example.com/sync/7</D:sync-token>
</D:multistatus>`;

  it('keeps per-propstat statuses and only surfaces successful properties', () => {
    const multistatus = parseMultiStatus(body);

    expect(multistatus.syncToken).toBe('https://example.com/sync/7');
    expect(multistatus.responses).toHaveLength(2);

    const [changed, deleted] = multistatus.responses;
    expect(changed!.href).toBe('/1234/calendars/home/a.ics');
    expect(changed!.status).toBe(200);
    expect(changed!.propstats.map((propstat) => propstat.status)).toEqual([200, 404]);
    // The 404 propstat is not folded into `props`: only successful ones are.
    expect(changed!.props.map((prop) => prop.localName)).toEqual(['getetag']);

    expect(deleted!.status).toBe(404);
    expect(deleted!.props).toEqual([]);
  });

  it('maps status lines and preconditions', () => {
    expect(parseStatusLine('HTTP/1.1 207 Multi-Status')).toBe(207);
    expect(parseStatusLine('HTTP/2 200')).toBe(200);
    expect(parseStatusLine('nonsense')).toBe(0);

    const preconditions = errorPreconditions(
      `<D:error xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav"><D:valid-sync-token/></D:error>`,
    );
    expect(preconditions.has('valid-sync-token')).toBe(true);
    expect(errorPreconditions('not xml').size).toBe(0);
  });

  it('throws on a body that is not a multistatus', () => {
    expect(() => parseMultiStatus('<html><body>502 Bad Gateway</body></html>')).toThrow(/multistatus/i);
  });
});

describe('buildXml', () => {
  it('declares every namespace on the root and prefixes children', () => {
    const xml = buildXml(
      el('propfind', NS.DAV, {
        children: [
          el('prop', NS.DAV, {
            children: [el('getetag', NS.DAV), el('calendar-data', NS.CALDAV)],
          }),
        ],
      }),
    );

    expect(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    expect(xml).toContain('<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">');
    // Empty elements stay self-closing — that is what `<D:getetag/>` requires.
    expect(xml).toContain('<D:getetag/>');
    expect(xml).toContain('<C:calendar-data/>');
  });

  it('escapes text and attributes and invents a prefix for unknown namespaces', () => {
    const xml = buildXml(
      el('x', 'urn:custom', {
        attributes: { name: 'a"b<c' },
        text: '1 < 2 && 3 > 2',
      }),
    );
    expect(xml).toContain('xmlns:N1="urn:custom"');
    expect(xml).toContain('name="a&quot;b&lt;c"');
    expect(xml).toContain('1 &lt; 2 &amp;&amp; 3 &gt; 2');
    expect(escapeAttribute('a"b&c<d>e')).toBe('a&quot;b&amp;c&lt;d&gt;e');
  });

  it('round-trips through its own parser', () => {
    const xml = buildXml(el('mkcalendar', NS.CALDAV, { children: [el('displayname', NS.DAV, { text: 'Trips & co' })] }));
    const root = parseXml(xml);
    const mkcalendar = childNamed(root, 'mkcalendar', NS.CALDAV)!;
    expect(childNamed(mkcalendar, 'displayname', NS.DAV)!.text).toBe('Trips & co');
  });
});
