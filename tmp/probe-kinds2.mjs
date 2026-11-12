const target = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.text, d: r.result.exceptionDetails.exception?.description?.slice(0, 200) } : r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks' });
await sleep(9000);
const up = await evaluate(`(async () => {
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII='), (c) => c.charCodeAt(0));
  const out = [];
  for (const [name, body, type] of [['shot.png', png, 'image/png'], ['note.txt', new TextEncoder().encode('preview text line\\n'), 'text/plain']]) {
    const form = new FormData();
    form.set('taskId', 'KztmWi3KcDsGlWd3L6Sb3g');
    form.set('file', new File([body], name, { type }));
    out.push([name, (await fetch('/api/attachments', { method: 'POST', body: form })).status]);
  }
  return out;
})()`);
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks?task=KztmWi3KcDsGlWd3L6Sb3g' });
await sleep(10000);
const report = {};
for (const name of ['shot.png', 'note.txt']) {
  let opened = false;
  for (let i = 0; i < 10 && !opened; i++) {
    opened = await evaluate(`(() => { const b = [...document.querySelectorAll('[data-slot="drawer"] button')].find((el) => el.textContent.trim().startsWith(${JSON.stringify(name)})); if (!b) return false; b.click(); return true; })()`);
    if (!opened) { await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('Ship the sync engine refactor')); if (b) b.click(); return Boolean(b); })()`); await sleep(2500); }
  }
  await sleep(4000);
  report[name] = await evaluate(`(() => {
    const d = document.querySelector('[data-slot="dialog-content"]');
    if (!d) return { noDialog: true };
    const r = d.getBoundingClientRect();
    const box = d.querySelector('.relative.flex');
    const img = d.querySelector('img'); const pre = d.querySelector('pre');
    const el = img ?? pre;
    const er = el?.getBoundingClientRect();
    const b = box?.getBoundingClientRect();
    const footer = d.querySelector('[data-slot="dialog-footer"]');
    const ys = footer ? [...footer.querySelectorAll('button')].map((x) => Math.round(x.getBoundingClientRect().y)) : [];
    return { dialog: [r.x, r.y, r.width, r.height].map(Math.round), box: b ? [b.width, b.height].map(Math.round) : null, media: er ? [er.x, er.y, er.width, er.height].map(Math.round) : null, sameRow: new Set(ys).size === 1, footerY: ys, spinner: Boolean(d.querySelector('[role="status"]')), text: pre ? pre.textContent?.slice(0, 24) : null };
  })()`);
  await evaluate(`(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return true; })()`);
  await sleep(1500);
}
console.log(JSON.stringify({ up, report }, null, 1));
ws.close(); process.exit(0);
