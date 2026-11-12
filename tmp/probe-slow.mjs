// Slow-network check: does the preview show a spinner instead of the worker's
// machine-readable offline document?
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const ORIGIN = 'http://localhost:4100';
const TASK = 'KztmWi3KcDsGlWd3L6Sb3g';
const PAGE = `${ORIGIN}/tasks?task=${TASK}`;

const target = await (await fetch(`http://127.0.0.1:9333/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value ?? r.result?.result ?? r.result ?? r;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Page.navigate', { url: PAGE });
await sleep(7000);

const cookies = (await send('Network.getAllCookies')).result?.cookies ?? [];
const cookie = cookies.filter((c) => c.domain.includes('localhost')).map((c) => `${c.name}=${c.value}`).join('; ');
const pdf = readFileSync('tmp/big.pdf');
const form = new FormData();
form.set('taskId', TASK);
form.set('file', new Blob([pdf], { type: 'application/pdf' }), 'slow-big.pdf');
const upload = await fetch(`${ORIGIN}/api/attachments`, { method: 'POST', headers: { cookie }, body: form });
console.log('upload', upload.status, (await upload.json())?.data?.id);

await send('Page.navigate', { url: PAGE });
await sleep(9000);

// Throttle only now: the page is loaded, so this costs the file and nothing else.
await send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 300,
  downloadThroughput: 20_000,
  uploadThroughput: 20_000,
});

const opened = await evaluate(`(() => {
  const row = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('slow-big.pdf'));
  if (!row) return 'no row';
  row.click();
  return 'clicked';
})()`);
console.log('row', opened);

for (const wait of [2000, 20000, 20000]) {
  await sleep(wait);
  const state = await evaluate(`(() => {
    const dialogs = [...document.querySelectorAll('[data-slot="dialog-content"]')];
    const d = dialogs[dialogs.length - 1];
    if (!d) return { noDialog: true };
    return {
      spinner: Boolean(d.querySelector('[role="status"]')),
      spinnerLabel: d.querySelector('[role="status"]')?.getAttribute('aria-label') ?? null,
      alert: d.querySelector('[role="alert"]')?.textContent ?? null,
      frame: Boolean(d.querySelector('iframe')),
      frameSrc: d.querySelector('iframe')?.getAttribute('src')?.slice(0, 40) ?? null,
      text: d.innerText.replace(/\\s+/g, ' ').slice(0, 160),
    };
  })()`);
  console.log(`+${wait}`, JSON.stringify(state));
}
ws.close();
process.exit(0);
