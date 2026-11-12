const target = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.text, d: r.result.exceptionDetails.exception?.description?.slice(0,300) } : r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks?task=KztmWi3KcDsGlWd3L6Sb3g' });
await sleep(12000);
console.log(JSON.stringify({
  drawer: await evaluate(`(() => { const d = document.querySelector('[data-slot="drawer"]'); return d ? d.innerText.replace(/\\n+/g, ' | ').slice(0, 400) : null; })()`),
  anchors: await evaluate(`[...document.querySelectorAll('a')].map(a => a.textContent.trim().slice(0,40) + ' :: ' + a.className.slice(0,50))`),
  frames: await evaluate(`[...document.querySelectorAll('iframe')].length`),
  errors: await evaluate(`window.__err ?? null`),
}, null, 1));
ws.close(); process.exit(0);
