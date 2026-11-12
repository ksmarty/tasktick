const target = await (await fetch('http://127.0.0.1:9333/json/new?' + encodeURIComponent('http://127.0.0.1:4100/tasks'), { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((resolve) => { const myId = ++id; pending.set(myId, resolve); ws.send(JSON.stringify({ id: myId, method, params })); });
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks' });
await new Promise((r) => setTimeout(r, 5000));
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value ?? JSON.stringify(r.result?.exceptionDetails ?? r.result).slice(0,300); };
console.log('task', await ev("fetch('/api/tasks/KztmWi3KcDsGlWd3L6Sb3g').then(r=>r.json()).then(d=>({ok:d.ok, id:d.data?.id, title:d.data?.title, url:d.data?.url}))").then(v=>JSON.stringify(v)));
console.log('cache', await ev("localStorage.getItem('tasktick.places.v1')"));
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks?task=KztmWi3KcDsGlWd3L6Sb3g' });
for (const ms of [2500, 3000, 4000]) {
  await new Promise((r) => setTimeout(r, ms));
  console.log(ms, await ev("JSON.stringify({drawer: !!document.querySelector('[data-slot=\"drawer\"]'), frame: document.querySelector('iframe[title]')?.getAttribute('src') ?? null, text: (document.querySelector('[data-slot=\"drawer\"]')?.innerText ?? '').slice(0,120)})"));
}
ws.close(); process.exit(0);
