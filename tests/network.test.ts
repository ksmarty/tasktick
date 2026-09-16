import { describe, expect, it } from 'vitest';
import { isLocalNetworkHost, isLocalNetworkOrigin, originFromRequest, parseOriginList } from '@/lib/network';

/**
 * The boundary cases matter more than the happy path: a false positive here
 * would make the CSRF origin check accept a public attacker's page, and a false
 * negative would break LAN access again.
 */
describe('isLocalNetworkHost — local names', () => {
  it('accepts loopback names', () => {
    expect(isLocalNetworkHost('localhost')).toBe(true);
    expect(isLocalNetworkHost('LOCALHOST')).toBe(true);
    expect(isLocalNetworkHost('app.localhost')).toBe(true);
  });

  it('accepts mDNS and internal-only suffixes', () => {
    expect(isLocalNetworkHost('nas.local')).toBe(true);
    expect(isLocalNetworkHost('tasktick.home.arpa')).toBe(true);
    expect(isLocalNetworkHost('vault.internal')).toBe(true);
  });

  it('accepts a bare single-label hostname', () => {
    // `nas` has no dot, so it can only resolve via the local DNS suffix.
    expect(isLocalNetworkHost('nas')).toBe(true);
    expect(isLocalNetworkHost('server')).toBe(true);
  });

  it('rejects a dotted public hostname', () => {
    expect(isLocalNetworkHost('example.com')).toBe(false);
    expect(isLocalNetworkHost('evil.com')).toBe(false);
    expect(isLocalNetworkHost('github.com')).toBe(false);
    expect(isLocalNetworkHost('nas.example.com')).toBe(false);
  });
});

describe('isLocalNetworkHost — IPv4', () => {
  it('accepts RFC 1918 ranges', () => {
    expect(isLocalNetworkHost('10.0.0.1')).toBe(true);
    expect(isLocalNetworkHost('10.255.255.254')).toBe(true);
    expect(isLocalNetworkHost('192.168.0.1')).toBe(true);
    expect(isLocalNetworkHost('192.168.1.50')).toBe(true);
    expect(isLocalNetworkHost('172.16.0.1')).toBe(true);
    expect(isLocalNetworkHost('172.31.255.254')).toBe(true);
  });

  it('stops exactly at the 172.16/12 boundaries', () => {
    // 172.16.0.0/12 covers 172.16 through 172.31 only.
    expect(isLocalNetworkHost('172.15.255.255')).toBe(false);
    expect(isLocalNetworkHost('172.32.0.0')).toBe(false);
  });

  it('accepts loopback, link-local and CGNAT (Tailscale uses 100.64/10)', () => {
    expect(isLocalNetworkHost('127.0.0.1')).toBe(true);
    expect(isLocalNetworkHost('127.1.2.3')).toBe(true);
    expect(isLocalNetworkHost('169.254.1.1')).toBe(true);
    expect(isLocalNetworkHost('100.64.0.1')).toBe(true);
    expect(isLocalNetworkHost('100.127.255.255')).toBe(true);
  });

  it('stops exactly at the CGNAT boundaries', () => {
    expect(isLocalNetworkHost('100.63.255.255')).toBe(false);
    expect(isLocalNetworkHost('100.128.0.0')).toBe(false);
  });

  it('rejects public addresses', () => {
    expect(isLocalNetworkHost('8.8.8.8')).toBe(false);
    expect(isLocalNetworkHost('1.1.1.1')).toBe(false);
    expect(isLocalNetworkHost('11.0.0.1')).toBe(false);
    expect(isLocalNetworkHost('192.169.0.1')).toBe(false);
    expect(isLocalNetworkHost('203.0.113.10')).toBe(false);
  });

  it('rejects octets out of range and leading-zero ambiguity', () => {
    expect(isLocalNetworkHost('256.1.1.1')).toBe(false);
    expect(isLocalNetworkHost('192.168.1.256')).toBe(false);
    // "010" is octal in some parsers, so accepting it would be ambiguous.
    expect(isLocalNetworkHost('010.0.0.1')).toBe(false);
    expect(isLocalNetworkHost('192.168.001.1')).toBe(false);
  });

  it('handles host:port', () => {
    expect(isLocalNetworkHost('192.168.1.50:3000')).toBe(true);
    expect(isLocalNetworkHost('localhost:3000')).toBe(true);
    expect(isLocalNetworkHost('example.com:443')).toBe(false);
  });
});

describe('isLocalNetworkHost — IPv6', () => {
  it('accepts loopback, ULA and link-local', () => {
    expect(isLocalNetworkHost('::1')).toBe(true);
    expect(isLocalNetworkHost('[::1]:3000')).toBe(true);
    expect(isLocalNetworkHost('fd00::1')).toBe(true);
    expect(isLocalNetworkHost('fc00::1')).toBe(true);
    expect(isLocalNetworkHost('fe80::1')).toBe(true);
    expect(isLocalNetworkHost('[fe80::1%eth0]:3000')).toBe(true);
  });

  it('checks the embedded address of an IPv4-mapped address', () => {
    expect(isLocalNetworkHost('::ffff:192.168.1.5')).toBe(true);
    expect(isLocalNetworkHost('::ffff:8.8.8.8')).toBe(false);
  });

  it('rejects a global IPv6 address', () => {
    expect(isLocalNetworkHost('2001:4860:4860::8888')).toBe(false);
    expect(isLocalNetworkHost('[2606:4700::1111]:443')).toBe(false);
  });
});

describe('isLocalNetworkHost — malformed input', () => {
  it('rejects empty and nonsense values rather than guessing', () => {
    expect(isLocalNetworkHost('')).toBe(false);
    expect(isLocalNetworkHost('   ')).toBe(false);
    expect(isLocalNetworkHost('not a host')).toBe(false);
    // Regression: 'http://example.com' contains exactly one colon, so a loose
    // port-stripping rule reduced it to 'http' and then trusted it as a bare
    // LAN hostname.
    expect(isLocalNetworkHost('http://example.com')).toBe(false);
    expect(isLocalNetworkHost('http://192.168.1.5')).toBe(false);
    expect(isLocalNetworkHost('ftp://nas')).toBe(false);
  });
});

describe('isLocalNetworkOrigin', () => {
  it('accepts private origins with any port or scheme', () => {
    expect(isLocalNetworkOrigin('http://192.168.1.50:3000')).toBe(true);
    expect(isLocalNetworkOrigin('https://192.168.1.50')).toBe(true);
    expect(isLocalNetworkOrigin('http://localhost:3000')).toBe(true);
    expect(isLocalNetworkOrigin('http://nas:3000')).toBe(true);
    expect(isLocalNetworkOrigin('https://tasktick.local')).toBe(true);
    expect(isLocalNetworkOrigin('http://[fd00::1]:3000')).toBe(true);
  });

  it('rejects public origins — this is the CSRF boundary', () => {
    expect(isLocalNetworkOrigin('https://evil.com')).toBe(false);
    expect(isLocalNetworkOrigin('https://tasks.example.com')).toBe(false);
    expect(isLocalNetworkOrigin('http://8.8.8.8')).toBe(false);
  });

  it('rejects non-web schemes and malformed values', () => {
    expect(isLocalNetworkOrigin('file:///etc/passwd')).toBe(false);
    expect(isLocalNetworkOrigin('ftp://192.168.1.1')).toBe(false);
    expect(isLocalNetworkOrigin('not-a-url')).toBe(false);
    expect(isLocalNetworkOrigin('')).toBe(false);
    expect(isLocalNetworkOrigin(null)).toBe(false);
    expect(isLocalNetworkOrigin(undefined)).toBe(false);
  });
});

describe('originFromRequest', () => {
  // A function declaration rather than an arrow returning an asserted object
  // literal: the latter reads as a block to the parser.
  function withOrigin(value: string | null): Request {
    return {
      headers: { get: (name: string) => (name.toLowerCase() === 'origin' ? value : null) },
    } as unknown as Request;
  }

  it('normalises an origin to scheme + host + port', () => {
    expect(originFromRequest(withOrigin('http://192.168.1.50:3000'))).toBe('http://192.168.1.50:3000');
    // A path or trailing slash is stripped by URL normalisation.
    expect(originFromRequest(withOrigin('http://192.168.1.50:3000/api/auth'))).toBe('http://192.168.1.50:3000');
  });

  it('rejects the literal "null" origin', () => {
    // Sandboxed iframes and file:// documents send this. Treating it as an
    // origin would let it match itself and defeat the check entirely.
    expect(originFromRequest(withOrigin('null'))).toBeNull();
  });

  it('returns null for a missing or unparseable origin', () => {
    expect(originFromRequest(withOrigin(null))).toBeNull();
    expect(originFromRequest(withOrigin('') )).toBeNull();
    expect(originFromRequest(withOrigin('garbage'))).toBeNull();
    expect(originFromRequest(undefined)).toBeNull();
    expect(originFromRequest(null)).toBeNull();
  });
});

describe('parseOriginList', () => {
  it('splits, trims and drops empties', () => {
    expect(parseOriginList('https://a.example, https://b.example')).toEqual(['https://a.example', 'https://b.example']);
    expect(parseOriginList('https://a.example,,  ,')).toEqual(['https://a.example']);
  });

  it('returns an empty array for missing input', () => {
    expect(parseOriginList(undefined)).toEqual([]);
    expect(parseOriginList(null)).toEqual([]);
    expect(parseOriginList('')).toEqual([]);
  });
});
