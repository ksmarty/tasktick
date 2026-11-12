const target = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const targets = new Set();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Target.targetCreated') targets.add(m.params.targetInfo.url.slice(0, 60));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.text } : r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Page.enable'); await send('Runtime.enable'); await send('Target.setDiscoverTargets', { discover: true });
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks?task=KztmWi3KcDsGlWd3L6Sb3g' });
let open = false;
for (let i = 0; i < 25 && !open; i++) { await sleep(1500); open = await evaluate(`Boolean(document.querySelector('[data-slot="drawer"]'))`); }
await sleep(8000);
const address = await evaluate(`(() => {
  const link = [...document.querySelectorAll('a')].find((a) => a.className.includes('break-words'));
  if (!link) return { found: false };
  const r = link.getBoundingClientRect(); const cs = getComputedStyle(link);
  return { found: true, text: link.textContent.trim(), height: Math.round(r.height), lineHeight: cs.lineHeight, lines: Math.round(r.height / parseFloat(cs.lineHeight)), width: Math.round(r.width), overflow: cs.textOverflow, scrollWidth: link.scrollWidth, clientWidth: link.clientWidth };
})()`);
const frameBox = await evaluate(`(() => { const f = document.querySelector('iframe[src*="google.com/maps"]'); if (!f) return null; const r = f.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })()`);
const before = await evaluate('location.pathname + location.search');
if (frameBox) { const [x, y, w, h] = frameBox; await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x + w / 2, y: y + h / 2, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x + w / 2, y: y + h / 2, button: 'left', clickCount: 1 }); }
await sleep(3000);
const after = await evaluate('location.pathname + location.search');
console.log(JSON.stringify({ drawerOpen: open, address, frameBox, before, after, stayedOnPage: before === after, newTargets: [...targets].filter((u) => /maps\.app\.goo\.gl|google\.com\/maps/.test(u)).slice(0, 4) }, null, 1));
ws.close(); process.exit(0);
