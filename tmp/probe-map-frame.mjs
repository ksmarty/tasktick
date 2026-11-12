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
await new Promise((r) => setTimeout(r, 6000));

const before = await evaluate(`(() => {
  const sheet = document.querySelector('[data-slot="drawer"]');
  return { sheet: Boolean(sheet), text: sheet?.innerText.slice(-220) ?? null };
})()`);
console.log('before', JSON.stringify(before, null, 2));

await evaluate(`(() => {
  const btn = [...document.querySelectorAll('button')].find((b) => /show map/i.test(b.textContent || ''));
  btn?.click();
  return Boolean(btn);
})()`);
await new Promise((r) => setTimeout(r, 5000));

const after = await evaluate(`(() => {
  const frame = document.querySelector('[data-slot="drawer"] iframe');
  const r = frame?.getBoundingClientRect();
  return {
    frame: Boolean(frame),
    src: frame?.getAttribute('src') ?? null,
    rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null,
    text: document.querySelector('[data-slot="drawer"]')?.innerText.slice(-260) ?? null,
    active: document.activeElement?.tagName + ':' + (document.activeElement?.getAttribute('data-slot') || ''),
    activeOutline: getComputedStyle(document.activeElement).outlineStyle,
  };
})()`);
console.log('after', JSON.stringify(after, null, 2));
ws.close();
process.exit(0);
