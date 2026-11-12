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
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /show map/i.test(x.textContent||'')); b?.click(); return Boolean(b); })()`);
await new Promise((r) => setTimeout(r, 4000));
const info = await evaluate(`(() => {
  const frame = document.querySelector('[data-slot="drawer"] iframe');
  const r = frame?.getBoundingClientRect();
  return { rect: r ? { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) } : null };
})()`);
console.log(JSON.stringify(info));
const shot = await send('Page.captureScreenshot', { format: 'png' });
const fs = await import('node:fs/promises');
await fs.writeFile('/tmp/map-frame.png', Buffer.from(shot.result.data, 'base64'));
console.log('/tmp/map-frame.png');
ws.close();
process.exit(0);
