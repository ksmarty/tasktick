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
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks' });
await new Promise((r) => setTimeout(r, 6000));

const box = await evaluate(`(() => {
  const row = [...document.querySelectorAll('button')].find((b) => String(b.className).includes('row-content'));
  if (!row) return null;
  const r = row.getBoundingClientRect();
  return { x: Math.round(r.x + 40), y: Math.round(r.y + r.height / 2) };
})()`);
console.log('row', JSON.stringify(box));
if (box) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button: 'left', clickCount: 1 });
}
await new Promise((r) => setTimeout(r, 2500));
const report = await evaluate(`(() => {
  const style = (el) => { const s = getComputedStyle(el); return { tag: el.tagName, slot: el.getAttribute('data-slot'), cls: (el.className||'').slice(0,60), outline: s.outlineStyle + ' ' + s.outlineWidth + ' ' + s.outlineColor, boxShadow: s.boxShadow, focusVisible: el.matches(':focus-visible') }; };
  const active = document.activeElement;
  const sheet = document.querySelector('[data-slot="drawer"]');
  return { sheet: Boolean(sheet), active: style(active), inside: Boolean(sheet && sheet.contains(active)), ringed: [...document.querySelectorAll('*')].filter((el) => el.matches(':focus-visible') && getComputedStyle(el).outlineStyle !== 'none').map(style).slice(0, 4) };
})()`);
console.log(JSON.stringify(report, null, 2));
ws.close();
process.exit(0);
