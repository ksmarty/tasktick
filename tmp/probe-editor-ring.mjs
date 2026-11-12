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
const style = `(el) => { if (!el) return null; const s = getComputedStyle(el); return { tag: el.tagName, slot: el.getAttribute('data-slot'), label: el.getAttribute('aria-label'), outline: s.outlineStyle + ' ' + s.outlineWidth, shadow: s.boxShadow.slice(0, 40), focusVisible: el.matches(':focus-visible') }; }`;
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks?task=KztmWi3KcDsGlWd3L6Sb3g' });
await new Promise((r) => setTimeout(r, 6000));
await evaluate(`(() => { const b = [...document.querySelectorAll('[data-slot="drawer"] button')].find((x) => /edit/i.test((x.getAttribute('aria-label')||'') + (x.title||''))); b?.click(); return Boolean(b); })()`);
await new Promise((r) => setTimeout(r, 4000));
console.log('href', await evaluate(`location.href`));
const report = await evaluate(`(() => {
  const style = ${style};
  const dialog = document.querySelector('[data-slot="dialog-content"]');
  const r = dialog?.getBoundingClientRect();
  return {
    dialog: Boolean(dialog),
    rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
    active: style(document.activeElement),
    activeInDialog: dialog ? dialog.contains(document.activeElement) : false,
    rowRinged: [...document.querySelectorAll('*')].filter((el) => el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none').length,
    dialogs: document.querySelectorAll('[data-slot="dialog-content"]').length,
    anyDialog: [...document.querySelectorAll('[role="dialog"]')].map((d) => (d.getAttribute('data-slot')||'') + ':' + (d.getAttribute('aria-labelledby')||'')).slice(0,4),
    attachBtn: [...document.querySelectorAll('[data-slot="dialog-content"] button')].map((b) => b.getAttribute('aria-label')).filter(Boolean).slice(0, 12),
  };
})()`);
console.log(JSON.stringify(report, null, 2));
ws.close();
process.exit(0);
