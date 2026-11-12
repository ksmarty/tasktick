/**
 * Runs one expression in the page at APP over CDP, dumping the value as JSON.
 * Usage: node tmp/cdp-eval.mjs "<js expression>" [waitMsAfterNavigate]
 */
const CDP_HTTP = 'http://127.0.0.1:9222';
const APP = process.env.PROBE_APP ?? 'http://127.0.0.1:3100';
const expression = process.argv[2] ?? 'location.href';
const waitMs = Number(process.argv[3] ?? 4000);
const navigate = process.env.NAVIGATE;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const target = await (await fetch(CDP_HTTP + '/json/new?url=about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.id !== undefined) { const p = pending.get(msg.id); if (p) { pending.delete(msg.id); p(msg); } }
});
await new Promise((res) => ws.addEventListener('open', res));
function send(method, params = {}) {
  const myId = ++id;
  return new Promise((resolve) => { pending.set(myId, resolve); ws.send(JSON.stringify({ id: myId, method, params })); });
}
await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: APP + (navigate ?? '/') });
await sleep(waitMs);
const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r.result?.result?.value ?? r.result, null, 1));
process.exit(0);
