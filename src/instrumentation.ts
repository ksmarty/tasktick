/**
 * Next.js instrumentation hook — the only place that runs exactly once when the
 * server process boots.
 *
 * This is where the background CalDAV scheduler is started. Doing it here rather
 * than in a route means syncs continue even when nobody has a page open (a
 * reminder must be pushed, and an edit made on a phone must appear on the
 * desktop without the user having to reload anything).
 *
 * It is also where an unusable production configuration is turned into a loud,
 * early failure rather than a confusing runtime error hours later.
 */
export async function register(): Promise<void> {
  // Guard: instrumentation is also evaluated for the edge runtime, which has no
  // database and no timers to speak of.
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { getEnv } = await import('@/lib/env');

  let env;
  try {
    env = getEnv();
  } catch (error) {
    console.error('[startup] invalid configuration — the server cannot start correctly.');
    console.error(error instanceof Error ? error.message : error);
    throw error;
  }

  const { describeDatabase } = await import('@/lib/env');
  const database = describeDatabase();
  console.log(`[startup] TaskTick booting — ${env.NODE_ENV}, database ${database.dialect} at ${database.location}`);

  if (!env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.startsWith('tasktick-development-secret')) {
    console.warn(
      '[startup] BETTER_AUTH_SECRET is the development default. Set a real one before exposing this instance:\n' +
        '          openssl rand -base64 32',
    );
  }

  if (env.SYNC_ENABLED) {
    try {
      const { startSyncScheduler } = await import('@/server/sync');
      startSyncScheduler();
    } catch (error) {
      // A failed scheduler must not take the web server down with it: a user can
      // still manage their tasks manually and trigger a sync from Settings.
      console.error('[startup] CalDAV sync scheduler failed to start:', error);
    }
  } else {
    console.log('[startup] CalDAV sync scheduler disabled (SYNC_ENABLED=false)');
  }
}
