const target = await (await fetch('http://127.0.0.1:9333/json/new?' + encodeURIComponent('http://127.0.0.1:4100/tasks'), { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((resolve) => { const myId = ++id; pending.set(myId, resolve); ws.send(JSON.stringify({ id: myId, method, params })); });
await send('Runtime.enable'); await send('Page.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks?task=KztmWi3KcDsGlWd3L6Sb3g' });
await new Promise((r) => setTimeout(r, 7000));
const expr = `(async () => {
  const frame = document.querySelector('iframe[title]');
  const text = document.querySelector('[data-slot="drawer"]')?.innerText ?? '';
  return {
    frameSrc: frame?.getAttribute('src') ?? null,
    frameTitle: frame?.getAttribute('title') ?? null,
    rect: frame ? [Math.round(frame.getBoundingClientRect().width), Math.round(frame.getBoundingClientRect().height)] : null,
    resolveCalls: performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/links/resolve')).length,
    showsRawUrl: text.includes('maps.app.goo.gl'),
    text: text.slice(0, 300),
    cacheKeys: Object.keys(JSON.parse(localStorage.getItem('tasktick.places.v1') ?? '{}')).length,
  };
})()`;
const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
console.log(JSON.stringify(r, null, 1).slice(0, 1600));
ws.close(); process.exit(0);
