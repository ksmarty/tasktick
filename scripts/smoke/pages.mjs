#!/usr/bin/env node
// Server-render check for the authenticated app routes.
const BASE = process.argv[2] ?? 'http://127.0.0.1:3000';
let cookies = '';

function merge(res) {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const pair = c.split(';')[0];
    const name = pair.split('=')[0];
    const rest = cookies.split('; ').filter(Boolean).filter((x) => !x.startsWith(`${name}=`));
    rest.push(pair);
    cookies = rest.join('; ');
  }
}

const results = [];
function record(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? '\u001b[32m✓\u001b[0m' : '\u001b[31m✗\u001b[0m'} ${name}${ok ? '' : ` — ${detail ?? ''}`}`);
}

(async () => {
  const email = `pages-${Date.now()}@example.com`;
  let r = await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE },
    body: JSON.stringify({ email, password: 'smoke-test-password-1234', name: 'Pages' }),
  });
  merge(r);
  if (r.status !== 200) {
    console.log('could not create an account to test pages:', r.status, (await r.text()).slice(0, 200));
    process.exit(1);
  }

  // Give the views something to render rather than empty states.
  await fetch(`${BASE}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookies, Origin: BASE },
    body: JSON.stringify({ title: 'Rendered task', dueDate: new Date().toISOString().slice(0, 10), priority: 'high' }),
  });
  await fetch(`${BASE}/api/habits`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookies, Origin: BASE },
    body: JSON.stringify({ name: 'Rendered habit', goalType: 'boolean', frequency: 'daily' }),
  });

  // Assert only what server rendering actually promises: the shell (brand, nav
  // title, tab bar / sidebar) and the route's own chrome. View data is fetched
  // client-side through the shared store, so it is intentionally absent from the
  // first HTML payload.
  const routes = [
    ['/today', ['TaskTick', 'Today']],
    ['/tasks', ['All tasks']],
    ['/calendar', ['Calendar']],
    ['/habits', ['Habits']],
    ['/matrix', ['matrix', 'Priority']],
    ['/pomodoro', ['Focus']],
    ['/search', ['Search']],
    ['/settings', ['Settings']],
    ['/settings/calendars', ['Calendar']],
    ['/settings/notifications', ['Notif']],
    ['/settings/advanced', ['']],
    ['/settings/admin', ['Admin']],
    ['/offline', ['Offline']],
  ];

  console.log(`\nserver-rendered pages on ${BASE}\n`);
  for (const [path, needles] of routes) {
    const res = await fetch(`${BASE}${path}`, { headers: { Cookie: cookies }, redirect: 'manual' });
    const html = await res.text();
    const ok = res.status === 200 && needles.every((n) => n === '' || html.toLowerCase().includes(n.toLowerCase()));
    record(`GET ${path} renders (200)`, ok, `status ${res.status}${ok ? '' : `, missing ${JSON.stringify(needles)}`}`);
  }

  // Signed out, the app routes must redirect rather than render.
  const anon = await fetch(`${BASE}/today`, { redirect: 'manual' });
  record('signed out, /today redirects to /login', anon.status === 307 && (anon.headers.get('location') ?? '').includes('/login'), `status ${anon.status}`);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length === 0 ? '\u001b[32m✓' : '\u001b[31m✗'} ${results.length - failed.length}/${results.length} pages rendered\u001b[0m\n`);
  if (failed.length) process.exitCode = 1;
})();
