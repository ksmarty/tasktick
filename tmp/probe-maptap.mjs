const target = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const targets = new Set();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Target.targetCreated') targets.add(m.params.targetInfo.url.slice(0, 80));
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.text } : r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Page.enable'); await send('Runtime.enable'); await send('Target.setDiscoverTargets', { discover: true });
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks?task=KztmWi3KcDsGlWd3L6Sb3g' });
let open = false;
for (let i = 0; i < 20 && !open; i++) { await sleep(1500); open = await evaluate(`Boolean(document.querySelector('[data-slot="drawer"]'))`); }
if (!open) {
  const row = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('Ship the sync engine refactor')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  if (row) { await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: row.x, y: row.y, button: 'left', clickCount: 1 }); await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: row.x, y: row.y, button: 'left', clickCount: 1 }); }
  for (let i = 0; i < 14 && !open; i++) { await sleep(1500); open = await evaluate(`Boolean(document.querySelector('[data-slot="drawer"]'))`); }
}
await sleep(4000);
const geometry = await evaluate(`(() => {
  const link = [...document.querySelectorAll('a')].find((a) => a.className.includes('break-words'));
  if (!link) return { found: false };
  const r = link.getBoundingClientRect(); const cs = getComputedStyle(link);
  return { found: true, text: link.textContent.trim().slice(0, 70), lines: Math.round(r.height / parseFloat(cs.lineHeight)), height: Math.round(r.height), width: Math.round(r.width), textOverflow: cs.textOverflow, whiteSpace: cs.whiteSpace, href: link.href.slice(0, 45), target: link.target };
})()`);
const hit = await evaluate(`(() => {
  const frame = document.querySelector('iframe[src*="google.com/maps"]');
  if (!frame) return { found: false };
  const box = frame.getBoundingClientRect();
  const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
  return { found: true, hitTag: top?.tagName, hitHref: top?.getAttribute?.('href')?.slice(0, 45), hitTarget: top?.getAttribute?.('target'), framePointerEvents: getComputedStyle(frame).pointerEvents, box: [box.x, box.y, box.width, box.height].map(Math.round) };
})()`);
if (!hit.found) { console.log(JSON.stringify({ open, geometry, hit }, null, 1)); ws.close(); process.exit(0); }
const before = await evaluate('location.pathname + location.search');
const [x, y] = [hit.box[0] + hit.box[2] / 2, hit.box[1] + hit.box[3] / 2];
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
await sleep(3000);
const after = await evaluate('location.pathname + location.search');
console.log(JSON.stringify({ drawerOpen: open, geometry, hit, before, after, stayedOnPage: before === after, googleTargets: [...targets].filter((u) => /google\.com\/maps/.test(u)).slice(0, 4) }, null, 1));
ws.close(); process.exit(0);
