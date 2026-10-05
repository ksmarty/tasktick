/**
 * Advertises this instance over mDNS so Home Assistant can find it.
 *
 * ## Why this exists
 *
 * The integration under `integrations/home-assistant/` registers a `zeroconf`
 * matcher for `_tasktick._tcp`, which turns "type the URL and paste a token" into
 * "a card appears with the address already filled in". Without an advertisement
 * the user has to know both, and the second one is a value they have to go and
 * create in Settings.
 *
 * ## Why the TXT record carries the URL and the SRV record does not
 *
 * SRV has to point at something resolvable on the LAN, and this process's own
 * hostname is the only honest answer to that. But the address a person actually
 * browses to is usually a reverse proxy in front of this container, and behind
 * one the container's own address is wrong. So the canonical origin travels in
 * TXT and the integration **prefers it over the SRV host**. Discovery that
 * filled in an unreachable container IP would be worse than no discovery at all.
 *
 * ## Why it is skipped rather than guessed
 *
 * With `APP_URL` unset there is nothing true to advertise — the default is
 * `http://localhost:3000`, which would produce a row in Home Assistant that
 * cannot work from anywhere except the HA host itself. A missing advertisement is
 * a clean failure; a wrong one is a support request.
 *
 * ## Docker
 *
 * mDNS is multicast to 224.0.0.251:5353. A container on the default bridge
 * network does not put that on the LAN, so discovery needs `network_mode: host`
 * (or a macvlan). Without it the integration still works — the config flow asks
 * for the URL by hand — which is why this logs and returns instead of throwing.
 *
 * ## Why the DNS encoding is not hand-rolled
 *
 * The part that can fail silently is protocol correctness against Home
 * Assistant's `python-zeroconf`, and that is exactly the part that cannot be
 * exercised without an HA instance. `bonjour-service` is pure JavaScript (no
 * native build), and its job here is narrow: publish one service record.
 */
import { hostname } from 'node:os';
import type { Service } from 'bonjour-service';
import { isAppUrlDefault } from '@/lib/env';

/** The service type the integration's `zeroconf` matcher is registered against. */
export const MDNS_SERVICE_TYPE = 'tasktick';

/** The DNS-SD name as it appears in the integration's `manifest.json`. */
export const MDNS_FQDN = '_tasktick._tcp.local.';

export interface MdnsAdvertisement {
  name: string;
  type: string;
  protocol: 'tcp';
  port: number;
  host: string;
  txt: Record<string, string>;
}

/**
 * True for an address that only reaches the machine it runs on.
 *
 * `localhost` is the obvious one; the loopback literals matter because a user who
 * sets `APP_URL=http://127.0.0.1:3000` has configured something that works for
 * them and is useless to Home Assistant, and it would otherwise be advertised as
 * though it were reachable.
 */
function isLoopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '::1' || /^127\./.test(hostname);
}

/**
 * The record to publish, or `null` when there is nothing true to publish.
 *
 * Pure on purpose: the shape is the contract the integration's discovery step
 * reads, so it is asserted directly instead of through a multicast socket.
 */
export function buildAdvertisement(input: {
  appUrl: string;
  version: string;
  hostname: string;
  appUrlIsDefault: boolean;
}): MdnsAdvertisement | null {
  if (input.appUrlIsDefault) return null;

  let origin: URL;
  try {
    origin = new URL(input.appUrl);
  } catch {
    return null;
  }

  // Reachable from the Home Assistant host and nowhere else, so it is no more
  // useful to advertise than the default it was derived from.
  if (!origin.hostname || isLoopback(origin.hostname)) return null;

  return {
    name: 'TaskTick',
    type: MDNS_SERVICE_TYPE,
    protocol: 'tcp',
    port: Number(origin.port) || (origin.protocol === 'https:' ? 443 : 80),
    host: input.hostname,
    txt: {
      // The integration prefers this over the SRV target. See the file header.
      url: origin.origin,
      path: '/api/graphql',
      version: input.version,
      host: origin.hostname,
    },
  };
}

let bonjour: { destroy: (cb?: () => void) => void } | null = null;
let published: Service | null = null;

/**
 * Starts the advertisement. Idempotent, and never throws.
 *
 * A discovery failure must not take the web server down: everything this
 * advertises is reachable by typing the address by hand.
 */
export async function startMdnsAdvertisement(): Promise<void> {
  if (published) return;

  const advertisement = buildAdvertisement({
    appUrl: (await import('@/lib/env')).getEnv().APP_URL,
    version: process.env.APP_VERSION ?? 'dev',
    hostname: hostname(),
    appUrlIsDefault: isAppUrlDefault(),
  });

  if (!advertisement) {
    console.log('[startup] mDNS: no reachable APP_URL to advertise — Home Assistant discovery is off.');
    return;
  }

  try {
    const { default: Bonjour } = await import('bonjour-service');
    const instance = new Bonjour();
    published = instance.publish(advertisement);
    bonjour = instance;
    console.log(
      `[startup] mDNS: advertising ${MDNS_FQDN} as ${advertisement.txt.url} (service ${advertisement.type})`,
    );
  } catch (error) {
    console.error('[startup] mDNS advertisement failed to start:', error);
    published = null;
    bonjour = null;
  }
}

/** Stops advertising and sends the goodbye packet. Used by tests and shutdown. */
export function stopMdnsAdvertisement(): void {
  published?.stop?.();
  bonjour?.destroy();
  published = null;
  bonjour = null;
}
