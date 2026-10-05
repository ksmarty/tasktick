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

  const { isWeakSecret, isAppUrlDefault } = await import('@/lib/env');

  if (isWeakSecret()) {
    // Not fatal: refusing to boot would lock an operator out of their own data.
    // But a secret from this repository means anyone who has read it can forge a
    // session cookie, so it must not pass silently.
    console.warn(
      '[startup] ============================================================\n' +
        '[startup] BETTER_AUTH_SECRET is a placeholder value published in this\n' +
        '[startup] repository, or is shorter than 32 characters. Anyone who can\n' +
        '[startup] read the source can forge a session cookie.\n' +
        '[startup]\n' +
        '[startup] In Docker, delete it from your .env and restart: the container\n' +
        '[startup] will generate and persist a real one automatically.\n' +
        '[startup] Otherwise set:  openssl rand -base64 32\n' +
        '[startup] ============================================================',
    );
  }

  if (isAppUrlDefault() && env.NODE_ENV === 'production') {
    console.log(
      '[startup] APP_URL is unset (defaulting to http://localhost:3000). LAN access\n' +
        '          still works, but set APP_URL to the address you browse to so that\n' +
        '          calendar subscription links point somewhere your phone can reach.',
    );
  }

  /*
   * Reminders ride their own ticker, started unconditionally and independently of
   * whether this instance has a calendar integration.
   *
   * It has to be independent: `ensureSyncScheduler` below only starts the sync
   * ticker when there is a syncable account or a feed, so hanging reminders off
   * it would leave an account whose only integrations are habits with a scheduler
   * that never ran — silently, because there is nothing to show an error on. The
   * module it starts imports no CalDAV transport, so this costs almost nothing.
   */
  try {
    const { startReminderScheduler } = await import('@/server/services/reminder-scheduler');
    startReminderScheduler();
  } catch (error) {
    console.error('[startup] reminder scheduler failed to start:', error);
  }

  // The scheduler is started through this indirection on purpose: importing the
  // sync stack directly would load the whole CalDAV transport (~7 MB resident)
  // on every boot, including on instances that have never connected a calendar.
  try {
    const { ensureSyncScheduler } = await import('@/server/services/scheduler');
    await ensureSyncScheduler();
  } catch (error) {
    // A failed scheduler must not take the web server down with it: a user can
    // still manage their tasks manually and trigger a sync from Settings.
    console.error('[startup] CalDAV sync scheduler failed to start:', error);
  }

  /*
   * The mDNS advertisement is best-effort in a way the schedulers above are not:
   * with `APP_URL` unset there is nothing true to advertise, and inside a bridged
   * container the multicast never reaches the LAN. Neither case is fatal — the
   * integration's config flow also accepts a URL typed by hand — so this is a log
   * line rather than an error.
   */
  try {
    const { startMdnsAdvertisement } = await import('@/server/mdns');
    await startMdnsAdvertisement();
  } catch (error) {
    console.error('[startup] mDNS advertisement failed to start:', error);
  }
}
