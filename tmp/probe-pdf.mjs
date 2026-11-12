const target = await (await fetch('http://127.0.0.1:9333/json/new?about:blank', { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (m, p = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const evaluate = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? { error: r.result.exceptionDetails.text, d: r.result.exceptionDetails.exception?.description?.slice(0,200) } : r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send('Page.enable'); await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks' });
await sleep(9000);
// Upload a tiny but real PDF.
const uploaded = await evaluate(`(async () => {
  const body = '%PDF-1.4\\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\\ntrailer<</Root 1 0 R>>\\n%%EOF';
  const form = new FormData();
  form.set('taskId', 'KztmWi3KcDsGlWd3L6Sb3g');
  form.set('file', new File([body], 'receipt.pdf', { type: 'application/pdf' }));
  const response = await fetch('/api/attachments', { method: 'POST', body: form });
  const json = await response.json();
  return { status: response.status, id: json?.data?.id ?? null, kind: json?.data?.mimeType ?? null };
})()`);
const id_ = uploaded.id;
const headers = id_ ? await evaluate(`fetch('/api/attachments/${id_}?inline=1').then(r => ({ status: r.status, disposition: r.headers.get('content-disposition'), frame: r.headers.get('x-frame-options'), type: r.headers.get('content-type') }))`) : null;
await sleep(2000);
// Open the sheet and the file preview.
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks?task=KztmWi3KcDsGlWd3L6Sb3g' });
await sleep(9000);
const openSheet = await evaluate(`Boolean(document.querySelector('[data-slot="drawer"]'))`);
const button = await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((el) => el.textContent.includes('receipt.pdf')); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
if (button) { for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: button.x, y: button.y, button: 'left', clickCount: 1 }); }
await sleep(4000);
const dialog = await evaluate(`(() => {
  const d = document.querySelector('[data-slot="dialog-content"]');
  if (!d) return { found: false };
  const r = d.getBoundingClientRect();
  const frame = d.querySelector('iframe');
  const footer = d.querySelector('[data-slot="dialog-footer"]') ?? [...d.querySelectorAll('div')].pop();
  const fr = frame?.getBoundingClientRect();
  return { found: true, dialog: [r.x, r.y, r.width, r.height].map(Math.round), viewport: [innerWidth, innerHeight], withinX: r.x >= 4 && r.right <= innerWidth - 4, withinY: r.y >= 0 && r.bottom <= innerHeight, frame: fr ? [fr.x, fr.y, fr.width, fr.height].map(Math.round) : null, frameSrc: frame?.src ?? null };
})()`);
console.log(JSON.stringify({ uploaded, headers, openSheet, buttonFound: Boolean(button), dialog }, null, 1));
ws.close(); process.exit(0);
