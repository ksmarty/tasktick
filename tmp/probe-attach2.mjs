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
await new Promise((r) => setTimeout(r, 9000));
await evaluate(`(() => { const b = [...document.querySelectorAll('[data-slot="drawer"] button')].find((x) => /edit/i.test((x.getAttribute('aria-label') || '') + (x.title || ''))); b?.click(); return Boolean(b); })()`);
await new Promise((r) => setTimeout(r, 2500));
const cleaned = await evaluate(`(async () => {
  const dialog = document.querySelector('[data-slot="dialog-content"]');
  const toastBefore = [...document.querySelectorAll('[data-sonner-toast], [role="status"]')].map((n) => n.innerText).filter(Boolean);
  const trash = [...dialog.querySelectorAll('button')].find((b) => /remove/i.test(b.getAttribute('aria-label') || ''));
  if (!trash) return { error: 'no trash', toastBefore };
  trash.click();
  await new Promise((r) => setTimeout(r, 800));
  const confirm = [...document.querySelectorAll('[role="dialog"] button')].find((b) => /remove|delete/i.test(b.textContent || ''));
  confirm?.click();
  await new Promise((r) => setTimeout(r, 2500));
  const left = [...document.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') || '').filter((l) => l.includes('notes'));
  const toastAfter = [...document.querySelectorAll('[data-sonner-toast], [role="status"]')].map((n) => n.innerText).filter(Boolean);
  return { toastBefore, toastAfter, remaining: left };
})()`);
console.log('cleanup', JSON.stringify(cleaned, null, 2));
await evaluate(`(async () => { const list = await (await fetch('/api/attachments?taskId=KztmWi3KcDsGlWd3L6Sb3g', { headers: { 'X-TaskTick-Fresh': '1' } })).json(); return true; })()`);
ws.close();
process.exit(0);
