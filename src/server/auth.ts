/**
 * Authentication.
 *
 * Delegated entirely to better-auth — we do not hand-roll password hashing,
 * session tokens, CSRF or OAuth state. better-auth owns the `user`, `session`,
 * `account` and `verification` tables and hashes passwords with scrypt.
 *
 * What lives here is only TaskTick-specific policy:
 *   - who is allowed to register (`REGISTRATION_MODE`, invite codes)
 *   - first-registered-user-becomes-admin bootstrap
 *   - optional generic OIDC single sign-on
 *   - provisioning of a new account's Inbox, default calendar and settings
 */
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { genericOAuth } from 'better-auth/plugins';
import { nextCookies } from 'better-auth/next-js';
import { eq, sql } from 'drizzle-orm';
import { getDb } from './db';
import { currentDialect } from './db/dialect';
import { schema } from './db/schema';
import { invites, user as userTable } from './db/schema';
import { newId } from './crypto';
import { getEnv, oidcConfigured } from '@/lib/env';
import { ensureUserBootstrap } from './bootstrap';

const { user, session, account, verification } = schema;

/** Minimal shape better-auth hands the `before` hook. */
interface IncomingUser {
  id?: string;
  name?: string;
  email?: string;
  image?: string | null;
  [key: string]: unknown;
}

interface HookContext {
  body?: unknown;
  query?: unknown;
  headers?: Headers;
  /** better-auth exposes the matched endpoint here, e.g. `/sign-up/email`. */
  context?: { path?: string };
  path?: string;
}

/**
 * Distinguishes a credential signup from a first-time OIDC login.
 *
 * The endpoint path is authoritative when present; the presence of a password
 * in the body is the fallback signal. Getting this wrong in the permissive
 * direction would let OIDC logins bypass the invite gate.
 */
function isEmailSignup(ctx: HookContext | undefined, body: unknown): boolean {
  const path = String(ctx?.context?.path ?? ctx?.path ?? '');
  if (path) return path.includes('sign-up');
  return typeof body === 'object' && body !== null && 'password' in body;
}

function readInviteToken(ctx: HookContext | undefined): string | null {
  const fromBody = (ctx?.body as { inviteToken?: unknown } | undefined)?.inviteToken;
  if (typeof fromBody === 'string' && fromBody) return fromBody;

  const fromQuery = (ctx?.query as { invite?: unknown } | undefined)?.invite;
  if (typeof fromQuery === 'string' && fromQuery) return fromQuery;

  // Also accept `?invite=` on the request URL, which is how the emailed link
  // arrives when a client posts to the register endpoint directly.
  const header = ctx?.headers?.get('referer');
  if (header) {
    try {
      const url = new URL(header);
      const invite = url.searchParams.get('invite');
      if (invite) return invite;
    } catch {
      /* ignore unparseable referer */
    }
  }
  return null;
}

function buildOAuthPlugins() {
  if (!oidcConfigured()) return [];

  const env = getEnv();
  const issuer = env.OIDC_ISSUER!.replace(/\/$/, '');
  const discoveryUrl = env.OIDC_DISCOVERY_URL ?? `${issuer}/.well-known/openid-configuration`;

  return [
    genericOAuth({
      config: [
        {
          providerId: 'oidc',
          discoveryUrl,
          clientId: env.OIDC_CLIENT_ID!,
          clientSecret: env.OIDC_CLIENT_SECRET!,
          scopes: ['openid', 'email', 'profile'],
          pkce: true,
          mapProfileToUser: (profile: Record<string, unknown>) => ({
            name: (profile.name as string) ?? (profile.preferred_username as string) ?? (profile.email as string),
            email: profile.email as string,
            image: (profile.picture as string) ?? null,
          }),
        },
      ],
    }),
  ];
}

/**
 * Decides whether a signup may proceed, and whether it gets admin rights.
 *
 * OIDC sign-ins also pass through here on first login, but they must NOT be
 * gated by invite codes (the identity provider is the gate). `provider` is
 * threaded through so the two paths can be distinguished.
 */
async function authorizeRegistration(usersEmail: string, inviteToken: string | null, viaOidc: boolean) {
  const env = getEnv();
  const db = getDb();

  const firstRow = await db.select({ count: sql<number>`count(*)` }).from(userTable).limit(1);
  const isFirstUser = Number(firstRow[0]?.count ?? 0) === 0;

  // The first account on a fresh instance always wins, whatever the mode. This
  // is what makes `docker compose up` usable with no CLI step.
  if (isFirstUser) return { isAdmin: true };

  const email = usersEmail.toLowerCase();

  if (viaOidc) {
    const allowed = env.OIDC_ALLOWED_DOMAINS?.split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean);
    if (allowed?.length && !allowed.some((domain) => email.endsWith(`@${domain}`))) {
      throw new Error('Your email domain is not permitted on this instance.');
    }
    return { isAdmin: false };
  }

  if (env.REGISTRATION_MODE === 'closed') {
    throw new Error('Registration is disabled on this instance.');
  }
  if (env.REGISTRATION_MODE === 'open') {
    return { isAdmin: false };
  }

  if (!inviteToken) {
    throw new Error('An invite code is required to register on this instance.');
  }

  const [invite] = await db.select().from(invites).where(eq(invites.token, inviteToken)).limit(1);

  if (!invite) throw new Error('That invite code is not valid.');
  if (invite.acceptedAtMs) throw new Error('That invite code has already been used.');
  if (invite.expiresAtMs < Date.now()) throw new Error('That invite code has expired.');
  if (invite.email.toLowerCase() !== email) {
    throw new Error('That invite code was issued to a different email address.');
  }

  return { isAdmin: invite.isAdmin };
}

function createAuth() {
  const env = getEnv();

  return betterAuth({
    appName: 'TaskTick',
    baseURL: env.APP_URL,
    secret: env.BETTER_AUTH_SECRET,

    database: drizzleAdapter(getDb(), {
      provider: currentDialect() === 'postgres' ? 'pg' : 'sqlite',
      schema: { user, session, account, verification },
    }),

    emailAndPassword: {
      enabled: true,
      minPasswordLength: 8,
      maxPasswordLength: 200,
      autoSignIn: true,
      // Self-hosted instances rarely have SMTP. Account recovery is an admin
      // action (reset link) rather than an email loop.
      requireEmailVerification: false,
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      // A short signed cookie cache avoids a DB round-trip on every request
      // without extending the revocation window beyond five minutes.
      cookieCache: { enabled: true, maxAge: 5 * 60 },
    },

    user: {
      additionalFields: {
        isAdmin: { type: 'boolean', defaultValue: false, input: false },
        timezone: { type: 'string', defaultValue: env.DEFAULT_TIMEZONE, input: false },
        banned: { type: 'boolean', defaultValue: false, input: false },
      },
    },

    advanced: {
      useSecureCookies: env.APP_URL.startsWith('https://'),
      cookiePrefix: 'tasktick',
    },

    trustedOrigins: [env.APP_URL],

    databaseHooks: {
      user: {
        create: {
          before: async (incoming, ctx) => {
            const candidate = incoming as IncomingUser;
            const email = String(candidate.email ?? '').toLowerCase();
            const hookCtx = ctx as HookContext | undefined;
            const inviteToken = readInviteToken(hookCtx);
            const viaOidc = !isEmailSignup(hookCtx, ctx?.body);

            const { isAdmin } = await authorizeRegistration(email, inviteToken, viaOidc);

            return { data: { ...candidate, id: candidate.id ?? newId(), isAdmin } as IncomingUser };
          },

          after: async (created) => {
            const email = String(created.email ?? '').toLowerCase();

            // Burn the invite now that the account exists.
            await getDb()
              .update(invites)
              .set({ acceptedAtMs: Date.now() })
              .where(eq(invites.email, email));

            // Give every new account a usable starting state: an Inbox, a local
            // calendar and a settings row. Without this the UI has nothing to
            // render and the user must build plumbing before their first task.
            await ensureUserBootstrap(String(created.id), env.DEFAULT_TIMEZONE, env.DEFAULT_WEEK_START);
          },
        },
      },
    },

    plugins: [...buildOAuthPlugins(), nextCookies()],
  });
}

export type Auth = ReturnType<typeof createAuth>;

let cached: Auth | null = null;

/** Lazily constructed so importing this module never touches the database. */
export function getAuth(): Auth {
  if (!cached) cached = createAuth();
  return cached;
}

/** The handler mounted at `app/api/auth/[...all]/route.ts`. */
export function getAuthHandler() {
  return getAuth().handler;
}

export function resetAuthCache(): void {
  cached = null;
}
