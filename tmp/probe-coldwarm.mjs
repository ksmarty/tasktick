const SHEET = 'http://127.0.0.1:4100/tasks?task=KztmWi3KcDsGlWd3L6Sb3g';
const target = await (await fetch('http://127.0.0.1:9333/json/new?' + encodeURIComponent('http://127.0.0.1:4100/tasks'), { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((resolve) => { const myId = ++id; pending.set(myId, resolve); ws.send(JSON.stringify({ id: myId, method, params })); });
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value; };
await send('Runtime.enable'); await send('Page.enable');
await send('Page.addScriptToEvaluateOnNewDocument', { source: `
  window.__probe = { drawerAt: null, frameAt: null };
  const obs = new MutationObserver(() => {
    if (window.__probe.drawerAt === null && document.querySelector('[data-slot="drawer"]')) window.__probe.drawerAt = Math.round(performance.now());
    if (window.__probe.frameAt === null && document.querySelector('iframe[title]')) window.__probe.frameAt = Math.round(performance.now());
    if (window.__probe.drawerAt !== null && window.__probe.frameAt !== null) obs.disconnect();
  });
  obs.observe(document.documentElement, { childList: true, subtree: true });
` });

const measure = async (label) => {
  await send('Page.navigate', { url: SHEET });
  await new Promise((r) => setTimeout(r, 8000));
  const out = await ev(`JSON.stringify({
    ...window.__probe,
    frameWait: window.__probe.frameAt !== null && window.__probe.drawerAt !== null ? window.__probe.frameAt - window.__probe.drawerAt : null,
    resolveCalls: performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/links/resolve')).length,
    frameSrc: document.querySelector('iframe[title]')?.getAttribute('src') ?? null,
    row: (document.querySelector('[data-slot="drawer"]')?.innerText ?? '').split('\\n').slice(5, 8).join(' | '),
  })`);
  console.log(label, out);
};

await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks' });
await new Promise((r) => setTimeout(r, 4000));
console.log('cleared', await ev("localStorage.removeItem('tasktick.places.v1'), 'yes'"));
await measure('COLD');
await measure('WARM');
console.log('cached', await ev("localStorage.getItem('tasktick.places.v1')"));
ws.close(); process.exit(0);
