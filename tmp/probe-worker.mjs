// Does pdf.js get its own worker, or a fake one on the main thread?
import { setTimeout as sleep } from 'node:timers/promises';

const ORIGIN = 'http://localhost:4100';
const PAGE = `${ORIGIN}/tasks?task=KztmWi3KcDsGlWd3L6Sb3g`;

const target = await (await fetch(`http://127.0.0.1:9333/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300)}`);
  if (m.method === 'Log.entryAdded') logs.push(`log ${m.params.entry.level}: ${m.params.entry.text.slice(0, 300)}`);
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value ?? null;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Log.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: PAGE });
await sleep(8000);
console.log('worker file', JSON.stringify(await evaluate(`fetch('/pdf.worker.min.mjs', { method: 'HEAD' }).then((r) => ({ status: r.status, type: r.headers.get('content-type') }))`)));
await evaluate(`[...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('two-pages.pdf'))?.click() ?? null`);
await sleep(6000);
console.log('canvas', JSON.stringify(await evaluate(`(() => { const c = document.querySelector('[data-slot="dialog-content"] canvas'); return c ? { w: c.width, h: c.height } : null; })()`)));
console.log('--- console');
for (const l of logs.filter((x) => /pdf|worker|Warn|warn|error/i.test(x)).slice(0, 12)) console.log(l);
ws.close();
