const target = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); let frames = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.method === 'Page.frameAttached' || m.method === 'Page.frameNavigated') frames.push(m.params.frame?.url ?? '(plugin)');
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.text } : r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks' });
await sleep(8000);
const up = await evaluate(`(async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC';
  const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
  const out = [];
  for (const [name, file] of [
    ['pixel.png', new File([bytes], 'pixel.png', { type: 'image/png' })],
    ['note.txt', new File(['preview text line\\n'], 'note.txt', { type: 'text/plain' })],
  ]) {
    const form = new FormData();
    form.set('taskId', 'KztmWi3KcDsGlWd3L6Sb3g');
    form.set('file', file);
    const r = await fetch('/api/attachments', { method: 'POST', body: form });
    out.push([name, r.status]);
  }
  return out;
})()`);
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks?task=KztmWi3KcDsGlWd3L6Sb3g' });
let sheet = false;
for (let i = 0; i < 20 && !sheet; i++) { await sleep(1500); sheet = await evaluate(`Boolean(document.querySelector('[data-slot="drawer"]'))`); }
if (!sheet) {
  const row = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('Ship the sync engine refactor')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
  if (row) { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: row.x, y: row.y, button: 'left', clickCount: 1 }); }
  for (let i = 0; i < 12 && !sheet; i++) { await sleep(1500); sheet = await evaluate(`Boolean(document.querySelector('[data-slot="drawer"]'))`); }
}
await sleep(3000);
const rows = await evaluate(`[...document.querySelectorAll('[data-slot="drawer"] button')].map((b) => b.textContent.trim()).filter(Boolean).slice(0, 12)`);
const results = { _rows: rows, _sheet: sheet };
for (const name of ['pixel.png', 'note.txt', 'receipt.pdf']) {
  const clicked = await evaluate(`(() => { const b = [...document.querySelectorAll('[data-slot="drawer"] button')].find((el) => el.textContent.trim().startsWith(${JSON.stringify(name)})); if (!b) return false; b.click(); return true; })()`);
  if (!clicked) { results[name] = { missing: true }; continue; }
  await sleep(3500);
  results[name] = await evaluate(`(() => {
    const d = document.querySelector('[data-slot="dialog-content"]');
    if (!d) return { noDialog: true };
    const img = d.querySelector('img');
    const frame = d.querySelector('iframe');
    const pre = d.querySelector('pre');
    const r = d.getBoundingClientRect();
    return { dialog: [r.x, r.y, r.width, r.height].map(Math.round), inside: r.y >= 0 && r.bottom <= innerHeight, img: img ? { natural: [img.naturalWidth, img.naturalHeight], box: [Math.round(img.getBoundingClientRect().width), Math.round(img.getBoundingClientRect().height)] } : null, frame: frame ? [Math.round(frame.getBoundingClientRect().width), Math.round(frame.getBoundingClientRect().height)] : null, pre: pre ? pre.textContent.trim().slice(0, 40) : null };
  })()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', windowsVirtualKeyCode: 27 });
  await sleep(1500);
}
console.log(JSON.stringify({ up, results, framesSeen: frames.slice(0, 6) }, null, 1));
ws.close(); process.exit(0);
