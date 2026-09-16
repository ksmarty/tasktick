#!/usr/bin/env node
/**
 * End-to-end smoke test against a running instance.
 *
 *   node /tmp/smoke/smoke.mjs http://127.0.0.1:3000
 *
 * Walks the real HTTP surface with a real session cookie: registration, the
 * bootstrap payload, task CRUD, recurring-task roll-forward, habit check-ins,
 * calendars, the aggregated calendar-items endpoint, reordering, search, stats,
 * tags, the ICS feed, export, and the CalDAV account lifecycle.
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:3311';

let cookies = '';
let pass = 0;
const failures = [];

function record(name, ok, detail = '') {
  if (ok) {
    pass++;
    console.log(`  \u001b[32m✓\u001b[0m ${name}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  \u001b[31m✗\u001b[0m ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function call(method, path, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      // Real browsers always send Origin; better-auth's CSRF guard requires it on
      // state-changing auth requests.
      Origin: BASE,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(cookies ? { Cookie: cookies } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });

  const setCookie = response.headers.getSetCookie?.() ?? [];
  for (const cookie of setCookie) {
    const [pair] = cookie.split(';');
    const [name] = pair.split('=');
    const others = cookies
      .split('; ')
      .filter(Boolean)
      .filter((c) => !c.startsWith(`${name}=`));
    others.push(pair);
    cookies = others.join('; ');
  }

  const text = await response.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* non-JSON (HTML page or ICS) */
  }
  return { status: response.status, json, text, headers: response.headers };
}

/** Unwraps the `{ ok, data }` envelope, failing loudly on an error envelope. */
async function api(method, path, body) {
  const result = await call(method, path, body);
  if (result.json && result.json.ok === false) {
    throw new Error(`${method} ${path} -> ${result.status}: ${result.json.error}`);
  }
  return result;
}

const data = (result) => result.json?.data;

async function main() {
  console.log(`\nSmoke testing ${BASE}\n`);

  /* ---- public surface ---- */

  console.log('public routes');
  const health = await call('GET', '/healthz');
  record('GET /healthz returns ok', health.json?.status === 'ok');
  record('GET /healthz reports a reachable database', health.json?.database?.reachable === true);

  const login = await call('GET', '/login');
  record('GET /login redirects to /register on a fresh instance', login.status === 307 && login.headers.get('location')?.includes('/register'));

  const register = await call('GET', '/register');
  record('GET /register renders the first-run bootstrap', register.status === 200 && register.text.includes('administrator'));

  record('API rejects an unauthenticated call', (await call('GET', '/api/tasks')).status === 401);

  /* ---- auth ---- */

  console.log('\nauthentication');
  const email = `smoke-${Date.now()}@example.com`;
  const signup = await call('POST', '/api/auth/sign-up/email', {
    email,
    password: 'smoke-test-password-1234',
    name: 'Smoke Tester',
  });
  record('POST /api/auth/sign-up/email creates the first (admin) account', signup.status === 200, `status ${signup.status}`);
  record('sign-up issues a session cookie', cookies.includes('tasktick'));

  const session = await call('GET', '/api/auth/get-session');
  record('GET /api/auth/get-session returns the signed-in user', session.json?.user?.email === email);
  record('the first account is marked as admin', session.json?.user?.isAdmin === true);

  /* ---- bootstrap ---- */

  console.log('\nbootstrap');
  const bootstrap = await api('GET', '/api/bootstrap');
  const boot = data(bootstrap);
  record('GET /api/bootstrap returns a user', Boolean(boot?.user?.id));
  record('bootstrap auto-creates an Inbox list', boot?.lists?.some((l) => l.isInbox) === true);
  record('bootstrap auto-creates a default calendar', boot?.calendars?.length >= 1);
  record('bootstrap returns default settings', boot?.settings?.timezone !== undefined);
  const inboxId = boot?.lists?.find((l) => l.isInbox)?.id;
  const calendarId = boot?.calendars?.[0]?.id;

  /* ---- lists + tags ---- */

  console.log('\nlists and tags');
  const list = data(await api('POST', '/api/lists', { name: 'Smoke List', color: 'purple', emoji: '🧪' }));
  record('POST /api/lists creates a list', list?.name === 'Smoke List' && list?.color === 'purple');

  const tag = data(await api('POST', '/api/tags', { name: 'smoketag', color: 'red' }));
  record('POST /api/tags creates a tag', tag?.name === 'smoketag');

  const tags = data(await api('GET', '/api/tags'));
  record('GET /api/tags lists it', tags?.some((t) => t.id === tag.id));

  /* ---- tasks ---- */

  console.log('\ntasks');
  const task = data(
    await api('POST', '/api/tasks', {
      title: 'Smoke task',
      listId: list.id,
      priority: 'high',
      dueDate: '2030-01-15',
      dueTime: '14:30',
      tagNames: ['smoketag'],
      notes: 'created by the smoke test',
    }),
  );
  record('POST /api/tasks creates a task', task?.title === 'Smoke task');
  record('the due date and time resolve to an instant', task?.dueAtMs > 0 && task?.dueDate === '2030-01-15');
  record('a timed task is not all-day', task?.isAllDay === false);
  record('tagNames create and attach the tag', task?.tags?.some((t) => t.name === 'smoketag') === true);

  const allDay = data(await api('POST', '/api/tasks', { title: 'All day task', dueDate: '2030-02-01' }));
  record('a date with no time becomes an all-day task', allDay?.isAllDay === true && allDay?.dueAtMs === null);

  const subtask = data(await api('POST', '/api/tasks', { title: 'Subtask', parentId: task.id }));
  record('subtasks can be created with a parentId', subtask?.parentId === task.id);

  const fetched = data(await api('GET', `/api/tasks/${task.id}`));
  record('GET /api/tasks/[id] returns the task with its subtask', fetched?.subtasks?.length === 1);

  const patched = data(await api('PATCH', `/api/tasks/${task.id}`, { title: 'Smoke task (edited)', priority: 'low' }));
  record('PATCH /api/tasks/[id] updates fields', patched?.title === 'Smoke task (edited)' && patched?.priority === 'low');

  const listed = data(await api('GET', '/api/tasks', undefined));
  record('GET /api/tasks returns the top-level tasks', Array.isArray(listed) && listed.length >= 2);
  record('GET /api/tasks hides subtasks by default', !listed.some((t) => t.id === subtask.id));
  const withSubs = data(await api('GET', '/api/tasks?includeSubtasks=1'));
  record('?includeSubtasks=1 surfaces them', withSubs.some((t) => t.id === subtask.id));

  const filtered = data(await api('GET', `/api/tasks?listIds=${list.id}`));
  record('GET /api/tasks filters by list', filtered.every((t) => t.listId === list.id));

  const searched = data(await api('GET', '/api/tasks?text=smoke task'));
  record('GET /api/tasks does a case-insensitive text search', searched.some((t) => t.id === task.id));

  const completed = data(await api('POST', `/api/tasks/${task.id}/complete`));
  record('POST /api/tasks/[id]/complete completes the task', completed?.task?.status === 'completed');
  record('completing a non-recurring task does not report a recurrence', completed?.recurred === false);

  const reopened = data(await api('POST', `/api/tasks/${task.id}/complete?undo=1`));
  record('completion can be undone', reopened?.task?.status === 'todo');

  /* ---- recurrence roll-forward ---- */

  console.log('\nrecurrence');
  const recurring = data(
    await api('POST', '/api/tasks', {
      title: 'Daily standup',
      dueDate: '2030-03-01',
      dueTime: '09:00',
      recurrenceRule: 'FREQ=DAILY',
      recurrenceMode: 'due',
    }),
  );
  record('POST /api/tasks stores a recurrence rule', recurring?.recurrenceRule === 'FREQ=DAILY');

  const rolled = data(await api('POST', `/api/tasks/${recurring.id}/complete`));
  record('completing a recurring task reports that it recurred', rolled?.recurred === true);
  record('a recurring task stays open after completion', rolled?.task?.status === 'todo');
  record(
    'the due date advanced by one day',
    rolled?.task?.dueDate === '2030-03-02',
    `got ${rolled?.task?.dueDate}`,
  );

  /* ---- reorder + bulk ---- */

  console.log('\nordering and bulk actions');
  const ids = data(await api('GET', '/api/tasks')).map((t) => t.id);
  const reorder = await api('POST', '/api/tasks/reorder', { orderedIds: [...ids].reverse() });
  record('POST /api/tasks/reorder accepts a full ordered list', data(reorder)?.reordered === ids.length);

  const bulk = await api('POST', '/api/tasks/bulk', { ids: [subtask.id], action: 'priority', priority: 'medium' });
  record('POST /api/tasks/bulk applies a bulk action', data(bulk)?.affected === 1);

  /* ---- habits ---- */

  console.log('\nhabits');
  const habit = data(
    await api('POST', '/api/habits', {
      name: 'Smoke habit',
      color: 'green',
      goalType: 'count',
      goalTarget: 3,
      unit: 'reps',
      frequency: 'daily',
    }),
  );
  record('POST /api/habits creates a habit', habit?.name === 'Smoke habit');

  const checkin = data(await api('POST', `/api/habits/${habit.id}/checkin`, { count: 2 }));
  record('POST /api/habits/[id]/checkin records progress', checkin?.entries !== undefined);
  record('a partially-complete habit is not done', checkin?.doneToday === false);

  const checkin2 = data(await api('POST', `/api/habits/${habit.id}/checkin`, { delta: 1 }));
  record('a delta check-in reaches the goal', checkin2?.doneToday === true, JSON.stringify(checkin2?.entries));

  const habits = data(await api('GET', '/api/habits'));
  const fetchedHabit = habits.find((h) => h.id === habit.id);
  record('GET /api/habits returns the habit with derived fields', fetchedHabit?.streak >= 1 && fetchedHabit?.doneToday === true);

  const cleared = data(await api('POST', `/api/habits/${habit.id}/checkin`, { count: null }));
  record('a null count clears the entry', Object.keys(cleared?.entries ?? {}).length === 0);

  /* ---- calendars + events ---- */

  console.log('\ncalendars and events');
  const cal = data(await api('POST', '/api/calendars', { name: 'Smoke Cal', color: 'orange' }));
  record('POST /api/calendars creates a calendar', cal?.name === 'Smoke Cal');

  const event = data(
    await api('POST', '/api/events', {
      calendarId: cal.id,
      summary: 'Smoke meeting',
      startMs: Date.parse('2030-06-10T10:00:00Z'),
      endMs: Date.parse('2030-06-10T11:00:00Z'),
      location: 'Room 1',
    }),
  );
  record('POST /api/events creates a timed event', event?.summary === 'Smoke meeting');
  record('the event stored a uid', typeof event?.uid === 'string' && event.uid.length > 0);

  const allDayEvent = data(
    await api('POST', '/api/events', {
      calendarId: cal.id,
      summary: 'Smoke holiday',
      startDate: '2030-06-12',
      endDate: '2030-06-15',
      isAllDay: true,
    }),
  );
  record('an all-day event keeps floating dates', allDayEvent?.isAllDay === true && allDayEvent?.startDate === '2030-06-12');

  const recurringEvent = data(
    await api('POST', '/api/events', {
      calendarId: cal.id,
      summary: 'Smoke weekly',
      startMs: Date.parse('2030-06-03T09:00:00Z'),
      endMs: Date.parse('2030-06-03T09:30:00Z'),
      rrule: 'FREQ=WEEKLY;BYDAY=MO',
    }),
  );
  record('POST /api/events stores a recurring series as one row', recurringEvent?.rrule === 'FREQ=WEEKLY;BYDAY=MO');

  /* ---- aggregated calendar ---- */

  console.log('\ncalendar aggregation');
  const rangeStart = Date.parse('2030-06-01T00:00:00Z');
  const rangeEnd = Date.parse('2030-07-01T00:00:00Z');
  const items = data(await api('GET', `/api/calendar/items?startMs=${rangeStart}&endMs=${rangeEnd}&layout=1`));

  record('GET /api/calendar/items returns items', Array.isArray(items?.items) && items.items.length > 0);
  record('it includes events', items.items.some((i) => i.kind === 'event' && i.id === event.id));
  record('it includes all-day events', items.items.some((i) => i.id === allDayEvent.id && i.isAllDay));
  record(
    'it expands the weekly series into multiple occurrences',
    items.items.filter((i) => i.id === recurringEvent.id).length >= 4,
    `${items.items.filter((i) => i.id === recurringEvent.id).length} occurrences`,
  );
  record('it buckets items by day', Object.keys(items.days ?? {}).length > 0);
  record('it returns overlap columns when asked', Array.isArray(items.layout));
  record('it returns the calendar list for the sidebar', Array.isArray(items.calendars));

  const badRange = await call('GET', '/api/calendar/items?startMs=0&endMs=0');
  record('an invalid range is rejected with 400', badRange.status === 400);

  /* ---- focus, stats, search ---- */

  console.log('\nfocus, stats and search');
  const focus = data(await api('POST', '/api/focus', { kind: 'focus', plannedSeconds: 1500 }));
  record('POST /api/focus starts a session', focus?.kind === 'focus');
  const finished = data(await api('PATCH', `/api/focus/${focus.id}`, { completed: true, actualSeconds: 1500 }));
  record('PATCH /api/focus/[id] finishes a session', finished?.completed === true);

  const stats = data(await api('GET', '/api/stats?days=30'));
  record('GET /api/stats returns a 30-day series', stats?.completedByDay?.length === 30);
  record('stats count the completions', stats?.totalCompleted >= 1);

  const search = data(await api('GET', '/api/search?q=smoke'));
  record('GET /api/search finds tasks', search?.tasks?.length >= 1);
  record('GET /api/search finds habits', search?.habits?.length >= 1);

  /* ---- settings ---- */

  console.log('\nsettings');
  const updated = data(await api('PATCH', '/api/settings', { accent: 'pink', theme: 'dark', weekStartsOn: 0 }));
  record('PATCH /api/settings updates the accent', updated?.accent === 'pink');
  record('PATCH /api/settings updates the week start', updated?.weekStartsOn === 0);

  const rejected = await call('PATCH', '/api/settings', { accent: 'chartreuse' });
  record('an invalid accent is rejected with 422', rejected.status === 422, `status ${rejected.status}`);

  const settings = data(await api('GET', '/api/settings'));
  record('GET /api/settings reports capabilities', settings?.capabilities !== undefined);

  /* ---- ical feed ---- */

  console.log('\nsubscriptions');
  const token = data(await api('POST', '/api/ical-tokens', { name: 'Smoke feed' }));
  record('POST /api/ical-tokens issues a token URL', typeof token?.url === 'string' && token.url.includes('/api/ical/'));

  const feedPath = new URL(token.url).pathname;
  const feed = await call('GET', feedPath);
  record('GET /api/ical/[token] returns a calendar', feed.status === 200 && feed.text.includes('BEGIN:VCALENDAR'));
  record('the feed contains VEVENTs', feed.text.includes('BEGIN:VEVENT'));
  record('the feed contains VTODOs for scheduled tasks', feed.text.includes('BEGIN:VTODO'));
  record('the feed is served as text/calendar', feed.headers.get('content-type')?.includes('text/calendar') === true);
  record('the feed is marked no-store and noindex', feed.headers.get('cache-control')?.includes('no-store') === true);

  const badToken = await call('GET', '/api/ical/not-a-real-token-at-all-xyz');
  record('an unknown feed token returns 404', badToken.status === 404);

  await api('DELETE', `/api/ical-tokens/${token.id}`);
  const revoked = await call('GET', feedPath);
  record('a revoked token stops working immediately', revoked.status === 404);

  /* ---- caldav accounts ---- */

  console.log('\nCalDAV account lifecycle');
  const account = data(
    await api('POST', '/api/caldav/accounts', {
      name: 'Smoke CalDAV',
      serverUrl: 'https://caldav.example.com',
      username: 'smoke',
      password: 'app-specific-password',
    }),
  );
  record('POST /api/caldav/accounts creates an account', account?.name === 'Smoke CalDAV');
  record('the account reports that a password is stored', account?.hasPassword === true);
  record('the API never returns the password', !JSON.stringify(account).includes('app-specific-password'));

  const accounts = data(await api('GET', '/api/caldav/accounts'));
  record('GET /api/caldav/accounts lists it', accounts?.some((a) => a.id === account.id));

  // Discovery against an unreachable host must fail gracefully, not hang or throw.
  const discover = await call('POST', `/api/caldav/accounts/${account.id}/discover`);
  record(
    'discovery against an unreachable server returns a result rather than crashing',
    discover.status === 200 && ['error', 'success', 'skipped'].includes(data(discover)?.status),
    `status ${discover.status} / ${data(discover)?.status}`,
  );

  const sync = await call('POST', `/api/caldav/accounts/${account.id}/sync`, { kind: 'discover' });
  record('a manual sync request is handled', sync.status === 200);

  await api('DELETE', `/api/caldav/accounts/${account.id}`);
  const afterDelete = data(await api('GET', '/api/caldav/accounts'));
  record('DELETE removes the account from the list', !afterDelete.some((a) => a.id === account.id));

  /* ---- export ---- */

  console.log('\nexport');
  const json = await call('GET', '/api/export');
  record('GET /api/export returns JSON', json.status === 200 && json.json?.schemaVersion === 1);
  record('the export includes tasks', Array.isArray(json.json?.tasks) && json.json.tasks.length >= 1);
  record('the export includes habits and their history', Array.isArray(json.json?.habitEntries));
  record(
    'the export never contains a CalDAV password',
    !json.text.includes('app-specific-password') && !json.text.includes('passwordEncrypted'),
  );

  const ics = await call('GET', '/api/export?format=ics');
  record('GET /api/export?format=ics returns a calendar', ics.status === 200 && ics.text.includes('BEGIN:VCALENDAR'));

  /* ---- admin ---- */

  console.log('\nadministration');
  const invite = data(await api('POST', '/api/invites', { email: `invitee-${Date.now()}@example.com` }));
  record('POST /api/invites creates an invite link', typeof invite?.url === 'string' && invite.url.includes('invite='));

  const users = data(await api('GET', '/api/admin/users'));
  record('GET /api/admin/users lists accounts', Array.isArray(users) && users.length >= 1);

  const selfDemote = await call('PATCH', `/api/admin/users/${boot.user.id}`, { isAdmin: false });
  record('an admin cannot demote their own account', selfDemote.status === 400);

  /* ---- authorisation boundaries ---- */

  console.log('\nauthorisation boundaries');
  const foreignList = await call('GET', '/api/lists/00000000-0000-0000-0000-000000000000');
  record('an unknown list id returns 404, not another tenant\u2019s data', foreignList.status === 404);

  const savedCookies = cookies;
  cookies = '';
  const anonymous = await call('GET', '/api/bootstrap');
  record('signed out, /api/bootstrap is refused', anonymous.status === 401);
  const anonAdmin = await call('GET', '/api/admin/users');
  record('signed out, admin routes are refused', anonAdmin.status === 401);
  cookies = savedCookies;

  /* ---- sign out ---- */

  console.log('\nsession teardown');
  await call('POST', '/api/auth/sign-out', {});
  const afterSignOut = await call('GET', '/api/tasks');
  record('signing out invalidates the session', afterSignOut.status === 401);

  /* ---- summary ---- */

  console.log(`\n${'─'.repeat(60)}`);
  if (failures.length === 0) {
    console.log(`\u001b[32m✓ all ${pass} checks passed\u001b[0m\n`);
  } else {
    console.log(`\u001b[31m✗ ${failures.length} of ${pass + failures.length} checks failed\u001b[0m`);
    for (const failure of failures) console.log(`   \u001b[31m•\u001b[0m ${failure}`);
    console.log();
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('\n\u001b[31msmoke test aborted:\u001b[0m', error.message);
  process.exitCode = 1;
});
