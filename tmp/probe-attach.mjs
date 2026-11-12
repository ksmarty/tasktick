const target = await (
  await fetch('http://127.0.0.1:9333/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })
).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((res) => { const my = ++id; pending.set(my, res); ws.send(JSON.stringify({ id: my, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value ?? r.result?.result ?? null;
};
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks?task=KztmWi3KcDsGlWd3L6Sb3g' });
await new Promise((r) => setTimeout(r, 10000));
console.log('href', await evaluate('location.href'));
console.log('bodyHead', JSON.stringify((await evaluate('document.body.innerText')).slice(0, 200)));

// DETAIL SHEET: compact plus header, no trash.
const sheet = await evaluate(`(() => {
  const s = document.querySelector('[data-slot="drawer"]');
  const attach = [...(s?.querySelectorAll('button') ?? [])].filter((b) => /attach/i.test((b.getAttribute('aria-label') || '') + (b.title || '')));
  const trashes = [...(s?.querySelectorAll('button') ?? [])].filter((b) => /remove|delete/i.test((b.getAttribute('aria-label') || '')));
  return { sheet: Boolean(s), attachButtons: attach.map((b) => ({ label: b.getAttribute('aria-label'), w: Math.round(b.getBoundingClientRect().width), h: Math.round(b.getBoundingClientRect().height) })), removeButtons: trashes.map((b) => b.getAttribute('aria-label')) };
})()`);
console.log('detail sheet', JSON.stringify(sheet, null, 2));

// Editor: open it, upload a text file, preview it.
await evaluate(`(() => { const b = [...document.querySelectorAll('[data-slot="drawer"] button')].find((x) => /edit/i.test((x.getAttribute('aria-label') || '') + (x.title || ''))); b?.click(); return Boolean(b); })()`);
await new Promise((r) => setTimeout(r, 2500));

const upload = await evaluate(`(async () => {
  const dialog = document.querySelector('[data-slot="dialog-content"]');
  if (!dialog) return { error: 'no dialog' };
  const input = dialog.querySelector('input[type="file"]');
  if (!input) return { error: 'no input' };
  const dt = new DataTransfer();
  dt.items.add(new File(['Live update notes\\nsecond line\\n'], 'notes.txt', { type: 'text/plain' }));
  input.files = dt.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 2500));
  const rows = [...dialog.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')).filter(Boolean);
  return { names: [...dialog.querySelectorAll('button')].map((b) => (b.textContent || '').trim()).filter((t) => t.includes('notes')), labels: rows.filter((l) => /remove|attach|upload/i.test(l)) };
})()`);
console.log('upload', JSON.stringify(upload, null, 2));

const preview = await evaluate(`(async () => {
  const dialog = document.querySelector('[data-slot="dialog-content"]');
  const nameBtn = [...dialog.querySelectorAll('button')].find((b) => (b.textContent || '').includes('notes.txt'));
  if (!nameBtn) return { error: 'no filename button' };
  nameBtn.click();
  await new Promise((r) => setTimeout(r, 2500));
  const dialogs = [...document.querySelectorAll('[data-slot="dialog-content"]')];
  const viewer = dialogs.find((d) => d.querySelector('pre'));
  return { dialogs: dialogs.length, pre: viewer?.querySelector('pre')?.textContent ?? null, title: viewer?.querySelector('[data-slot="dialog-title"]')?.textContent ?? null };
})()`);
console.log('preview', JSON.stringify(preview, null, 2));
ws.close();
process.exit(0);
