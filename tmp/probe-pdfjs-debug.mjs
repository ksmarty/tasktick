// Why is the sheet still on the spinner?
import { setTimeout as sleep } from 'node:timers/promises';

const ORIGIN = 'http://localhost:4100';
const TASK = 'KztmWi3KcDsGlWd3L6Sb3g';
const PAGE = `${ORIGIN}/tasks?task=${TASK}`;

const target = await (await fetch(`http://127.0.0.1:9333/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
const requests = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
  if (m.method === 'Runtime.consoleAPICalled') logs.push(`${m.params.type}: ${m.params.args.map((a) => a.value ?? a.description).join(' ')}`);
  if (m.method === 'Runtime.exceptionThrown') logs.push(`exception: ${m.params.exceptionDetails.exception?.description?.slice(0, 400)}`);
  if (m.method === 'Network.requestWillBeSent') requests.push(m.params.request.url);
  if (m.method === 'Network.loadingFailed') requests.push(`FAILED ${m.params.errorText} ${m.params.type}`);
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  const out = r.result?.result;
  if (out?.subtype === 'error') logs.push(`eval: ${out.description?.slice(0, 300)}`);
  return out?.value ?? out ?? r.result ?? r;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: PAGE });
await sleep(8000);

console.log('row', await evaluate(`(() => {
  const row = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('two-pages.pdf'));
  if (!row) return 'no row';
  row.click();
  return 'clicked';
})()`));
await sleep(5000);

console.log('text', JSON.stringify(await evaluate(`document.querySelector('[data-slot="dialog-content"]')?.innerText?.slice(0, 400)`)));
console.log('html tail', JSON.stringify(await evaluate(`document.querySelector('[data-slot="dialog-content"]')?.innerHTML?.slice(-700)`)));
console.log('--- logs'); for (const l of logs.slice(0, 25)) console.log(l);
console.log('--- requests'); for (const r of requests.filter((u) => /pdf|attachment/.test(u)).slice(0, 15)) console.log(r);
ws.close();
