/**
 * SPA-navigation probe: opens one target at /tasks, then client-side navigates to
 * /calendar by clicking the link, logging network responses and the rendered text
 * at each step. Used with the server stopped to test a true offline session.
 *
 * Usage: PROBE_APP=http://127.0.0.1:3100 node tmp/spa-nav-probe.mjs [/tasks /calendar]
 */
const CDP_HTTP = 'http://127.0.0.1:9222';
const APP = process.env.PROBE_APP ?? 'http://127.0.0.1:3100';
const from = process.argv[2] ?? '/tasks';
const to = process.argv[3] ?? '/calendar';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function openTarget(url) {
  const res = await fetch(CDP_HTTP + '/json/new?url=about:blank', { method: 'PUT' });
  const target = await res.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  const log = [];
  ws.addEventListener('message', (e) => {
    const msg = JSON.parse(e.data);
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); p(msg); }
      return;
    }
    if (msg.method === 'Network.responseReceived') {
      const r = msg.params.response;
      if (/\/api\/|_rsc/.test(r.url)) log.push(`[net] ${r.status} ${r.url.replace(APP, '')}`);
    }
    if (msg.method === 'Network.loadingFailed') {
      log.push(`[net-fail] ${msg.params.errorText} ${msg.params.requestId}`);
    }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params = {}) => {
    const myId = ++id;
    return new Promise((resolve) => { pending.set(myId, resolve); ws.send(JSON.stringify({ id: myId, method, params })); });
  };
  await send('Page.enable');
  await send('Runtime.enable');
  await send('Network.enable');
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    return r.result?.result?.value ?? r.result?.exceptionDetails ?? null;
  };
  return { send, evaluate, log, navigate: (u) => send('Page.navigate', { url: APP + u }) };
}

const STATE = `(() => ({
  url: location.href,
  controller: Boolean(navigator.serviceWorker.controller),
  text: document.body.innerText.replace(/\\n{2,}/g, '\\n').slice(0, 900),
}))()`;

const page = await openTarget();
console.error(`step: load ${from} (server down)`);
await page.navigate(from);
await sleep(9000);
console.log(`== ${from} ==`);
console.log(JSON.stringify(await page.evaluate(STATE), null, 1));

console.error(`step: click through to ${to}`);
const clicked = await page.evaluate(`(() => {
  const links = [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href'));
  const el = [...document.querySelectorAll('a[href]')].find((a) => a.getAttribute('href') === ${JSON.stringify(to)} || a.getAttribute('href')?.startsWith(${JSON.stringify(to)}));
  if (!el) return { clicked: false, links: links.slice(0, 40) };
  el.click();
  return { clicked: true, href: el.getAttribute('href') };
})()`);
console.log('click:', JSON.stringify(clicked));
await sleep(9000);
console.log(`== ${to} ==`);
console.log(JSON.stringify(await page.evaluate(STATE), null, 1));
console.log('== net ==');
console.log(page.log.join('\n'));
process.exit(0);
