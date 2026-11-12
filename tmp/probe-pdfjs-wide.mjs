// Does the sheet really draw a page, and can a phone move through it?
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const ORIGIN = 'http://localhost:4100';
const TASK = 'KztmWi3KcDsGlWd3L6Sb3g';
const PAGE = `${ORIGIN}/tasks?task=${TASK}`;
const FILE = 'tmp/two-pages.pdf';

const target = await (await fetch(`http://127.0.0.1:9333/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const seen = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
  if (m.method === 'Network.responseReceived') seen.push(m.params.response.url);
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  const out = r.result?.result;
  if (out?.subtype === 'error') console.log('eval error', out.description?.slice(0, 200));
  return out?.value ?? out ?? r.result ?? r;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await send('Page.navigate', { url: PAGE });
await sleep(8000);

const cookies = (await send('Network.getAllCookies')).result?.cookies ?? [];
const cookie = cookies.filter((c) => c.domain.includes('localhost')).map((c) => `${c.name}=${c.value}`).join('; ');
const pdf = readFileSync(FILE);
const form = new FormData();
form.set('taskId', TASK);
form.set('file', new Blob([pdf], { type: 'application/pdf' }), 'two-pages.pdf');
const upload = await fetch(`${ORIGIN}/api/attachments`, { method: 'POST', headers: { cookie }, body: form });
console.log('upload', upload.status);

await send('Page.navigate', { url: PAGE });
await sleep(9000);

const opened = await evaluate(`(() => {
  const row = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('two-pages.pdf'));
  if (!row) return 'no row';
  row.click();
  return 'clicked';
})()`);
console.log('row', opened);
await sleep(6000);

const state = await evaluate(`(async () => {
  const dialog = document.querySelector('[data-slot="dialog-content"]');
  const canvas = dialog?.querySelector('canvas');
  const status = dialog?.querySelector('[role="status"]');
  const alert = dialog?.querySelector('[role="alert"]');
  return {
    dialog: dialog ? (() => { const r = dialog.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; })() : null,
    canvas: canvas ? { w: canvas.clientWidth, h: canvas.clientHeight, pixels: [canvas.width, canvas.height] } : null,
    drawing: canvas ? (() => { const c = canvas.getContext('2d'); const d = c.getImageData(0, 0, canvas.width, canvas.height).data; let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark += 1; return dark; })() : null,
    label: dialog?.querySelector('[aria-live="polite"]')?.textContent ?? null,
    zoom: [...(dialog?.querySelectorAll('span') ?? [])].map((s) => s.textContent).find((t) => /%$/.test(t ?? '')) ?? null,
    status: status?.getAttribute('aria-label') ?? null,
    alert: alert?.textContent ?? null,
    iframes: dialog?.querySelectorAll('iframe').length ?? 0,
    buttons: [...(dialog?.querySelectorAll('button[aria-label]') ?? [])].map((b) => b.getAttribute('aria-label')),
  };
})()`);
console.log('page 1', JSON.stringify(state));

// Turn to the second page, then zoom in once.
await evaluate(`document.querySelector('[data-slot="dialog-content"] button[aria-label="Next page"]').click()`);
await sleep(2500);
const second = await evaluate(`(async () => {
  const dialog = document.querySelector('[data-slot="dialog-content"]');
  const canvas = dialog?.querySelector('canvas');
  return {
    label: dialog?.querySelector('[aria-live="polite"]')?.textContent ?? null,
    dark: canvas ? (() => { const c = canvas.getContext('2d'); const d = c.getImageData(0, 0, canvas.width, canvas.height).data; let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 128) dark += 1; return dark; })() : null,
  };
})()`);
console.log('page 2', JSON.stringify(second));

await evaluate(`document.querySelector('[data-slot="dialog-content"] button[aria-label="Zoom in"]').click()`);
await sleep(2000);
const zoomed = await evaluate(`(() => {
  const dialog = document.querySelector('[data-slot="dialog-content"]');
  const canvas = dialog?.querySelector('canvas');
  return { width: canvas?.clientWidth ?? null, zoom: [...dialog.querySelectorAll('span')].map((s) => s.textContent).find((t) => /%$/.test(t ?? '')) ?? null };
})()`);
console.log('zoomed', JSON.stringify(zoomed));
console.log('worker fetched', seen.filter((u) => u.includes('pdf.worker')).length);
console.log('pdfjs chunk', seen.filter((u) => /pdf/.test(u) && !u.includes('pdf.worker')).slice(0, 4));

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) writeFileSync('tmp/pdfjs-mobile.png', Buffer.from(shot.result.data, 'base64'));
ws.close();
