const target = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.text } : r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks?task=KztmWi3KcDsGlWd3L6Sb3g' });
await sleep(10000);
// Throttle so the PDF takes a moment to arrive.
await send('Network.emulateNetworkConditions', { offline: false, latency: 200, downloadThroughput: 60_000, uploadThroughput: 60_000 });
let clicked = false;
for (let i = 0; i < 10 && !clicked; i++) {
  clicked = await evaluate(`(() => { const b = [...document.querySelectorAll('[data-slot="drawer"] button')].find((el) => el.textContent.trim().startsWith('page.pdf')); if (!b) return false; b.click(); return true; })()`);
  if (!clicked) { await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('Ship the sync engine refactor')); if (b) b.click(); return Boolean(b); })()`); await sleep(2500); }
}
const samples = [];
for (let i = 0; i < 14; i++) {
  samples.push(await evaluate(`(() => { const d = document.querySelector('[data-slot="dialog-content"]'); const s = d?.querySelector('[role="status"]'); return s ? s.getAttribute('aria-label') : null; })()`));
  await sleep(500);
}
await send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
console.log(JSON.stringify({ clicked, samples: [...new Set(samples)] }, null, 1));
ws.close(); process.exit(0);
