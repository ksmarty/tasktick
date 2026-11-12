/**
 * Drives headless Chromium over raw CDP (Node 22's global WebSocket) to answer
 * one question: on a cold, offline launch does the calendar screen paint from
 * the persisted read cache, and if not, which key is missing?
 *
 * Usage: node tmp/offline-probe.mjs [online|offline|both]
 */
const CDP_HTTP = 'http://127.0.0.1:9222';
const APP = process.env.PROBE_APP ?? 'http://127.0.0.1:3000';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    this.ws.addEventListener('message', (e) => {
      const msg = JSON.parse(e.data);
      if (msg.id !== undefined) {
        const p = this.pending.get(msg.id);
        if (!p) return;
        this.pending.delete(msg.id);
        if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
        else p.resolve(msg.result);
      } else {
        this.events.push(msg);
      }
    });
  }
  ready() {
    return new Promise((res, rej) => {
      this.ws.addEventListener('open', () => res(this));
      this.ws.addEventListener('error', (e) => rej(new Error('ws error ' + e.message)));
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
    const r = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      allowUnsafeEvalBlockedByCSP: false,
    });
    if (r.exceptionDetails) throw new Error('page threw: ' + JSON.stringify(r.exceptionDetails).slice(0, 800));
    return r.result?.value;
  }
}

const READ_IDB = `
(async () => {
  const db = await new Promise((res, rej) => {
    const r = indexedDB.open('tasktick-offline');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  const stores = [...db.objectStoreNames];
  const out = {};
  for (const store of stores) {
    if (!db.objectStoreNames.contains(store)) continue;
    const recs = await new Promise((res, rej) => {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAll();
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    out[store] = recs.map((r) => ({
      key: r.key ?? r.id,
      scope: r.scope ?? null,
      bytes: typeof r.json === 'string' ? r.json.length : null,
      savedAt: r.savedAt ?? null,
    }));
  }
  return out;
})()
`;

const STATE = `
(async () => {
  const regs = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistrations() : [];
  const names = 'caches' in self ? await caches.keys() : [];
  const apiKeys = {};
  for (const name of names) {
    if (!name.startsWith('tasktick-api')) continue;
    const cache = await caches.open(name);
    apiKeys[name] = (await cache.keys()).map((r) => r.url.replace(location.origin, ''));
  }
  return {
    url: location.href,
    controller: Boolean(navigator.serviceWorker?.controller),
    regs: regs.map((r) => r.scope),
    cacheNames: names.filter((n) => n.startsWith('tasktick')),
    apiKeys,
    text: document.body.innerText.slice(0, 1200),
  };
})()
`;

async function main() {
  const mode = process.argv[2] ?? 'both';
  const version = await (await fetch(CDP_HTTP + '/json/version')).json();
  const target = await (await fetch(CDP_HTTP + '/json/new?url=about:blank', { method: 'PUT' })).json();
  const cdp = await new Cdp(target.webSocketDebuggerUrl).ready();
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Network.enable');
  await cdp.send('Log.enable');

  const log = [];
  const origPush = cdp.events.push.bind(cdp.events);
  cdp.events.push = (ev) => {
    if (ev.method === 'Log.entryAdded') log.push(`[log] ${ev.params.entry.text}`);
    if (ev.method === 'Network.responseReceived' && ev.params.response.url.includes('/api/')) {
      log.push(`[net] ${ev.params.response.status} ${ev.params.response.url.replace(APP, '')}`);
    }
    if (ev.method === 'Network.loadingFailed') {
      const id = ev.params.requestId;
      log.push(`[net-fail] ${id} ${ev.params.errorText}`);
    }
    if (ev.method === 'Runtime.consoleAPICalled') {
      log.push(`[console.${ev.params.type}] ` + ev.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
    }
    return origPush(ev);
  };

  console.error('browser:', version.Browser);

  // Preview sign-in (loopback only): mints a real session, then redirects.
  if (mode !== 'cold') {
    console.error('step: sign-in');
    await cdp.send('Page.navigate', { url: APP + '/api/auth/preview-session?next=/calendar' });
    await sleep(6000);
    console.error('after sign-in:', await cdp.evaluate('location.pathname'));
  }

  if (mode === 'cold') {
    console.error('step: cold /calendar (server down)');
    await cdp.send('Page.navigate', { url: APP + '/calendar' });
    await sleep(9000);
    console.log('== COLD /calendar ==');
    console.log(JSON.stringify(await cdp.evaluate(STATE), null, 1).slice(0, 4000));
    console.error('step: cold /tasks (server down)');
    await cdp.send('Page.navigate', { url: APP + '/tasks' });
    await sleep(9000);
    console.log('== COLD /tasks ==');
    console.log(JSON.stringify(await cdp.evaluate(STATE), null, 1).slice(0, 4000));
    console.log('== console ==');
    console.log(log.slice(-40).join('\n'));
    return;
  }

  if (mode === 'online' || mode === 'both') {
    console.error('step: online /calendar');
    await cdp.send('Page.navigate', { url: APP + '/calendar' });
    await sleep(12000);
    await cdp.send('Page.reload', {});
    await sleep(8000);
    console.error('step: online state');
    console.log('== ONLINE /calendar ==');
    console.log(JSON.stringify(await cdp.evaluate(STATE), null, 1).slice(0, 4000));
    console.log('== IDB after online ==');
    console.log(JSON.stringify(await cdp.evaluate(READ_IDB), null, 1).slice(0, 6000));
  }

  if (mode === 'offline' || mode === 'both') {
    console.error('step: go offline');
    await cdp.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
      connectionType: 'none',
    });
    await cdp.send('Page.navigate', { url: 'about:blank' });
    await sleep(1000);
    await cdp.send('Page.navigate', { url: APP + '/calendar' });
    await sleep(12000);
    console.error('step: offline state');
    console.log('== OFFLINE cold /calendar ==');
    const state = await cdp.evaluate(STATE);
    console.log(JSON.stringify(state, null, 1).slice(0, 5000));
    console.log('== IDB offline ==');
    console.log(JSON.stringify(await cdp.evaluate(READ_IDB), null, 1).slice(0, 6000));
    console.error('step: offline /tasks');
    await cdp.send('Page.navigate', { url: APP + '/tasks' });
    await sleep(10000);
    console.log('== OFFLINE cold /tasks ==');
    console.log(JSON.stringify(await cdp.evaluate(STATE), null, 1).slice(0, 4000));
  }

  console.log('== console ==');
  console.log(log.slice(-60).join('\n'));
}

main().catch((e) => {
  console.error('FAILED', e);
  process.exit(1);
});
