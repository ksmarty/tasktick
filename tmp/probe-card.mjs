const target = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.text, d: r.result.exceptionDetails.exception?.description?.slice(0, 300) } : r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks' });
await sleep(8000);
const up = await evaluate(`(async () => {
  const pdf = '%PDF-1.4\\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]>>endobj\\ntrailer<</Root 1 0 R>>\\n%%EOF';
  const form = new FormData();
  form.set('taskId', 'KztmWi3KcDsGlWd3L6Sb3g');
  form.set('file', new File([pdf], 'page.pdf', { type: 'application/pdf' }));
  const r = await fetch('/api/attachments', { method: 'POST', body: form });
  return r.status;
})()`);
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks?task=KztmWi3KcDsGlWd3L6Sb3g' });
await sleep(10000);
let clicked = false;
for (let i = 0; i < 12 && !clicked; i++) {
  clicked = await evaluate(`(() => { const b = [...document.querySelectorAll('[data-slot="drawer"] button')].find((el) => el.textContent.trim().startsWith('page.pdf')); if (!b) return false; b.click(); return true; })()`);
  if (!clicked) {
    await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('Ship the sync engine refactor')); if (b) b.click(); return Boolean(b); })()`);
    await sleep(2500);
  }
}
await sleep(4500);
const report = await evaluate(`(() => {
  const d = document.querySelector('[data-slot="dialog-content"]');
  if (!d) return { noDialog: true };
  const r = d.getBoundingClientRect();
  const frame = d.querySelector('iframe');
  const footer = d.querySelector('[data-slot="dialog-footer"]');
  const buttons = footer ? [...footer.querySelectorAll('button')].map((b) => { const q = b.getBoundingClientRect(); return { label: b.textContent.trim(), y: Math.round(q.y), x: Math.round(q.x), w: Math.round(q.width) }; }) : [];
  const fr = frame?.getBoundingClientRect();
  const status = d.querySelector('[role="status"]');
  return {
    dialog: [r.x, r.y, r.width, r.height].map(Math.round),
    viewport: [innerWidth, innerHeight],
    frame: fr ? [fr.x, fr.y, fr.width, fr.height].map(Math.round) : null,
    frameSrc: frame?.src ?? null,
    footerRow: buttons.map((b) => b.y),
    buttons,
    sameRow: new Set(buttons.map((b) => b.y)).size === 1,
    spinnerPresent: Boolean(status),
  };
})()`);
console.log(JSON.stringify({ up, clicked, report }, null, 1));
ws.close(); process.exit(0);
