const target = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.text, detail: r.result.exceptionDetails.exception?.description?.slice(0, 200) } : r.result?.result?.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks?task=KztmWi3KcDsGlWd3L6Sb3g' });
await new Promise((r) => setTimeout(r, 9000));
console.log(JSON.stringify({
  url: await evaluate(`fetch('/api/tasks/KztmWi3KcDsGlWd3L6Sb3g').then(r => r.json()).then(d => ({ url: d?.data?.url ?? null, title: d?.data?.title ?? null }))`),
  drawer: await evaluate(`Boolean(document.querySelector('[data-slot="drawer"]'))`),
  anchors: await evaluate(`[...document.querySelectorAll('[data-slot="drawer"] a')].map(a => ({ text: a.textContent.slice(0,30), cls: a.className.slice(0,60) }))`),
  frames: await evaluate(`[...document.querySelectorAll('iframe')].map(f => f.src.slice(0,50))`),
}, null, 1));
ws.close(); process.exit(0);
