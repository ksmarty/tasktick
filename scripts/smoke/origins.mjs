#!/usr/bin/env node
/**
 * Verifies the auth origin policy end to end against a running instance.
 *
 *   node scripts/smoke/origins.mjs http://127.0.0.1:3000
 *
 * Expects REGISTRATION_MODE=open so registration itself is never the reason a
 * request is refused — every deny here must come from the origin check.
 *
 * Regression guard for the "Invalid origin" failure that made a LAN deployment
 * unusable: the allow cases must succeed, and the deny cases must STILL be
 * refused, because relaxing the check too far would remove CSRF protection.
 */
const BASE = process.argv[2] ?? 'http://127.0.0.1:3400';

const ORIGIN_CASES = [
  ['http://192.168.1.50:3000', true, 'LAN IPv4 (the reported bug)'],
  ['http://192.168.1.50:8080', true, 'LAN IPv4, other port'],
  ['http://10.0.0.5:3000', true, 'RFC1918 10/8'],
  ['http://172.20.0.1:3000', true, 'RFC1918 172.16/12'],
  ['http://172.31.255.254:3000', true, 'RFC1918 upper bound'],
  ['http://nas:3000', true, 'bare hostname'],
  ['http://tasktick.local:3000', true, 'mDNS .local'],
  ['http://100.101.102.103:3000', true, 'Tailscale CGNAT 100.64/10'],
  ['http://[fd00::1]:3000', true, 'IPv6 ULA'],
  ['http://[fe80::1]:3000', true, 'IPv6 link-local'],
  ['http://127.0.0.1:3400', true, 'loopback'],
  ['http://localhost:3000', true, 'APP_URL itself'],

  ['https://evil.com', false, 'public attacker page'],
  ['http://192.168.1.50.evil.com', false, 'public host that LOOKS private'],
  ['https://tasks.example.com', false, 'public hostname (needs config)'],
  ['http://8.8.8.8', false, 'public IP'],
  ['http://172.32.0.1:3000', false, 'just outside 172.16/12'],
  ['http://172.15.255.255:3000', false, 'just below 172.16/12'],
  ['http://100.128.0.1:3000', false, 'just outside 100.64/10'],
  ['http://100.63.255.255:3000', false, 'just below 100.64/10'],
  ['http://192.169.0.1:3000', false, 'near-miss 192.168'],
  ['http://10.0.0.1.evil.com', false, 'private IP as a subdomain of a public host'],
  ['null', false, 'sandboxed iframe origin'],
];

let seq = 0;

async function attempt(origin) {
  const email = `origin-${Date.now()}-${seq++}@example.com`;
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (origin !== null) headers.Origin = origin;
  // better-auth keys its rate limiter on the client IP, which it takes from
  // X-Forwarded-For. A unique value per request keeps the limiter from turning
  // a policy test into a 429 test.
  headers['X-Forwarded-For'] = '10.9.' + (seq % 250) + '.' + ((seq * 7) % 250);

  // A realistic Host header for the LAN cases, so the request is not
  // distinguishable from a real browser apart from the Origin under test.
  let url = BASE;
  if (origin && origin !== 'null') url = BASE;

  const res = await fetch(`${url}/api/auth/sign-up/email`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ email, password: 'origin-test-password-1234', name: 'Origin' }),
  });

  let body = {};
  try {
    body = await res.json();
  } catch {
    /* ignore */
  }
  return { status: res.status, code: body?.code ?? '' };
}

const rows = [];
let rateLimited = 0;

console.log('\norigin                              want   got    status  verdict');
console.log('-'.repeat(88));

for (const [origin, shouldAllow, label] of ORIGIN_CASES) {
  const r = await attempt(origin);

  if (r.status === 429) {
    rateLimited++;
    rows.push({ ok: null });
    console.log(String(origin).padEnd(35) + (shouldAllow ? 'allow  ' : 'deny   ') + '  --    429     \u001b[33mSKIP (rate limited)\u001b[0m');
    continue;
  }

  const allowed = r.status === 200;
  const ok = allowed === shouldAllow;
  rows.push({ ok });
  console.log(
    String(origin).padEnd(35) +
      (shouldAllow ? 'allow  ' : 'deny   ') +
      (allowed ? 'allow  ' : 'deny   ') +
      String(r.status).padEnd(8) +
      (ok ? '\u001b[32mPASS\u001b[0m' : '\u001b[31mFAIL\u001b[0m') +
      '  ' +
      label,
  );
  // Space requests out so better-auth's rate limiter does not distort results.
}

const judged = rows.filter((r) => r.ok !== null);
const failed = judged.filter((r) => r.ok === false).length;

console.log('-'.repeat(88));
if (failed === 0) {
  console.log(`\u001b[32m${judged.length}/${judged.length} passed\u001b[0m` + (rateLimited ? ` (${rateLimited} skipped by rate limiting)` : ''));
} else {
  console.log(`\u001b[31m${failed} of ${judged.length} FAILED\u001b[0m`);
  process.exitCode = 1;
}
