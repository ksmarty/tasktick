/**
 * Centralised environment parsing.
 *
 * Everything is read once, validated, and exported as a frozen object so that a
 * misconfiguration fails loudly at boot instead of surfacing as a confusing
 * runtime error three features later.
 */
import { z } from 'zod';

const bool = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const int = (def: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === '' ? def : Number.parseInt(v, 10)))
    .pipe(z.number().int());

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  /** `file:/data/app.db` (default) or `postgres://user:pass@host:5432/db`. */
  DATABASE_URL: z.string().default('file:./data/tasktick.db'),

  /** Signs session cookies and derives the field-encryption key. */
  BETTER_AUTH_SECRET: z.string().min(1).optional(),

  /** Public origin of this instance, e.g. `https://tasks.example.com`. */
  APP_URL: z.string().default('http://localhost:3000'),

  /** `open` | `invite` | `closed` — controls who may create an account. */
  REGISTRATION_MODE: z.enum(['open', 'invite', 'closed']).default('invite'),

  /* ---- optional generic OIDC provider (Authentik, Keycloak, Pocket ID, ...) ---- */

  OIDC_ISSUER: z.string().optional(),
  OIDC_CLIENT_ID: z.string().optional(),
  OIDC_CLIENT_SECRET: z.string().optional(),
  OIDC_DISCOVERY_URL: z.string().optional(),
  /** Button label shown on the login screen, e.g. "Authentik". */
  OIDC_PROVIDER_NAME: z.string().optional(),
  /** Restrict OIDC sign-in to these comma-separated email domains. */
  OIDC_ALLOWED_DOMAINS: z.string().optional(),

  /* ---- Web Push (VAPID) ---- */

  VAPID_PUBLIC_KEY: z.string().optional(),
  VAPID_PRIVATE_KEY: z.string().optional(),
  VAPID_SUBJECT: z.string().default('mailto:admin@localhost'),

  /* ---- background CalDAV sync ---- */

  SYNC_ENABLED: bool(true),
  /** How often the in-process scheduler wakes up, in seconds. */
  SYNC_TICK_SECONDS: int(60),
  /** Hard cap on CalDAV requests per sync run, to stay polite to providers. */
  SYNC_MAX_ITEMS_PER_RUN: int(2000),
  /** Allow self-signed CalDAV certificates (Nextcloud on a LAN, etc.). */
  CALDAV_ALLOW_INSECURE_TLS: bool(false),

  /** Default timezone for new users when the browser cannot tell us. */
  DEFAULT_TIMEZONE: z.string().default('UTC'),
  DEFAULT_TIME_FORMAT: z.enum(['12h', '24h']).default('24h'),
  DEFAULT_WEEK_START: int(1),

  /** Set to `1` behind a reverse proxy you control, so `X-Forwarded-For` is trusted. */
  TRUST_PROXY: bool(false),
});

export type Env = z.infer<typeof schema> & { BETTER_AUTH_SECRET: string };

let cached: Env | null = null;

/** Dev-only fallback so `npm run dev` works with zero configuration. */
const DEV_SECRET = 'tasktick-development-secret-do-not-use-in-production-000000';

/**
 * The value `APP_URL` ships with. Treated as "not explicitly configured", which
 * lets request-derived URLs fill in when the operator never set it.
 */
export const DEFAULT_APP_URL = 'http://localhost:3000';

/**
 * Secrets that appear in this repository and must never be used to run an
 * instance. A documented default is worse than no default: it looks configured,
 * so nobody notices that session cookies are signed with a value anyone can
 * read on GitHub.
 */
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  DEV_SECRET,
  'change-me-openssl-rand-base64-32',
  'build-time-placeholder-not-a-real-secret',
  'ci-dummy-secret-not-used-outside-ci-000000',
]);

export function getEnv(): Env {
  if (cached) return cached;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${detail}`);
  }

  const raw = parsed.data;
  let secret = raw.BETTER_AUTH_SECRET;

  if (!secret) {
    if (raw.NODE_ENV === 'production') {
      throw new Error(
        'BETTER_AUTH_SECRET is required in production. Generate one with:\n' +
          '  openssl rand -base64 32',
      );
    }
    secret = DEV_SECRET;
  }

  cached = { ...raw, BETTER_AUTH_SECRET: secret };
  return cached;
}

/** Test seam — lets suites inject a config without mutating `process.env`. */
export function resetEnvCache(): void {
  cached = null;
}

export const isProduction = () => getEnv().NODE_ENV === 'production';

/** True when `APP_URL` was never explicitly configured. */
export const isAppUrlDefault = () => getEnv().APP_URL.replace(/\/$/, '') === DEFAULT_APP_URL;

/**
 * True when the session secret is a value published in this repository, or is
 * too short to be a real key. Reported as a warning at boot rather than a hard
 * failure: refusing to start would lock an operator out of their own data.
 */
export function isWeakSecret(): boolean {
  const secret = getEnv().BETTER_AUTH_SECRET;
  return KNOWN_PLACEHOLDER_SECRETS.has(secret) || secret.length < 32;
}

export const oidcConfigured = () => {
  const e = getEnv();
  return Boolean(e.OIDC_ISSUER && e.OIDC_CLIENT_ID && e.OIDC_CLIENT_SECRET);
};

export const pushConfigured = () => {
  const e = getEnv();
  return Boolean(e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY);
};

/** Parsed dialect + the filesystem path for SQLite (defaults to `<cwd>/data`). */
export function describeDatabase(): { dialect: 'sqlite' | 'postgres'; location: string } {
  const url = getEnv().DATABASE_URL;
  if (url.startsWith('postgres://') || url.startsWith('postgresql://')) {
    // Strip credentials before this ever reaches a log line.
    try {
      const u = new URL(url);
      return { dialect: 'postgres', location: `${u.host}${u.pathname}` };
    } catch {
      return { dialect: 'postgres', location: '(unparseable)' };
    }
  }
  return { dialect: 'sqlite', location: url.replace(/^file:/, '') };
}
