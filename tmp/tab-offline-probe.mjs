/**
 * Proves the tab fix end to end: a phone that has only ever opened `/tasks`
 * online must still boot `/calendar` from disk when the server is gone.
 *
 * Phase 1 (`warm`, server up): sign in, sit on /tasks, never touch /calendar,
 * and dump which documents the session cache holds.
 * Phase 2 (`cold`, server down): launch /tasks, then tap the calendar tab and
 * dump what the screen actually shows.
 *
 * Usage: PROBE_APP=http://127.0.0.1:3101 node tmp/tab-offline-probe.mjs warm|cold
 */
const CDP_HTTP = process.env.CDP ?? 'http://127.0.0.1:9222';
const APP = process.env.PROBE_APP ?? 'http://127.0.0.1:3101';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.logs = [];
    this.ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      } else if (msg.method === 'Network.responseReceived') {
        const url = msg.params.response.url;
        if (url.includes('/api/')) this.logs.push(`[net] ${msg.params.response.status} ${url}`);
      } else if (msg.method === 'Network.loadingFailed') {
        this.logs.push(`[net-fail] ${msg.params.requestId} ${msg.params.errorText}`);
      }
    });
  }
  ready() {
    return new Promise((res, rej) => {
      this.ws.addEventListener('open', () => res(this));
      this.ws.addEventListener('error', () => rej(new Error('ws error')));
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
    return r.result?.value;
  }
}

const STATE = `(() => ({
  url: location.href,
  controller: Boolean(navigator.serviceWorker.controller),
  text: document.body.innerText.slice(0, 900),
}))()`;

const CACHES = `(async () => {
  const names = await caches.keys();
  const out = {};
  for (const name of names) {
    if (!name.startsWith('api-')) continue;
    const cache = await caches.open(name);
    const keys = await cache.keys();
    out[name] = keys.map((k) => new URL(k.url).pathname + new URL(k.url).search);
  }
  return out;
})()`;

const main = async () => {
  const mode = process.argv[2] ?? 'warm';
  const version = await fetch(`${CDP_HTTP}/json/version`).then((r) => r.json());
  const target = await fetch(`${CDP_HTTP}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
  const cdp = new Cdp(target.webSocketDebuggerUrl);
  await cdp.ready();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  console.log('browser:', version.Browser);

  if (mode === 'warm') {
    console.log('step: sign-in');
    await cdp.send('Page.navigate', { url: `${APP}/api/auth/preview-session?next=/tasks` });
    await sleep(9000);
    console.log('step: settled on', await cdp.evaluate('location.pathname'));
    // One reload so the installed worker controls the page, then leave it be.
    await cdp.send('Page.navigate', { url: `${APP}/tasks` });
    await sleep(9000);
    console.log('state:', JSON.stringify(await cdp.evaluate(STATE), null, 1));
    console.log('api caches:', JSON.stringify(await cdp.evaluate(CACHES), null, 1));
  } else {
    console.log('step: cold launch at /tasks, server down');
    await cdp.send('Page.navigate', { url: `${APP}/tasks` });
    await sleep(8000);
    console.log('tasks:', JSON.stringify(await cdp.evaluate(STATE), null, 1));

    console.log('step: tap the calendar tab');
    const clicked = await cdp.evaluate(`(() => {
      const link = [...document.querySelectorAll('a[href]')].find((a) => new URL(a.href).pathname === '/calendar');
      if (!link) return 'no calendar link';
      link.click();
      return 'clicked ' + link.getAttribute('href');
    })()`);
    console.log('click:', clicked);
    await sleep(10000);
    console.log('calendar:', JSON.stringify(await cdp.evaluate(STATE), null, 1));
  }

  console.log('--- network log (last 25) ---');
  for (const line of cdp.logs.slice(-25)) console.log(line);
  await cdp.send('Page.close').catch(() => {});
};

main().catch((error) => {
  console.error('probe failed:', error.message);
  process.exitCode = 1;
});
