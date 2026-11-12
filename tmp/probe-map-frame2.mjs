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
await evaluate(`window.__errs = []; window.addEventListener('unhandledrejection', (e) => window.__errs.push(String(e.reason))); true`);
await evaluate(`(() => { const b = [...document.querySelectorAll('button')].find((x) => /show map/i.test(x.textContent||'')); b?.click(); return Boolean(b); })()`);
for (let i = 0; i < 8; i += 1) {
  await new Promise((r) => setTimeout(r, 800));
  const snap = await evaluate(`(() => {
    const sheet = document.querySelector('[data-slot="drawer"]');
    const frame = sheet?.querySelector('iframe');
    const btn = [...document.querySelectorAll('button')].find((x) => /map/i.test(x.textContent||''));
    return { t: ${i}, label: btn?.textContent ?? null, frame: Boolean(frame), src: frame?.getAttribute('src') ?? null,
      tail: sheet?.innerText.slice(-150) ?? null, errs: (window.__errs||[]).slice(-2) };
  })()`);
  console.log(JSON.stringify(snap));
}
ws.close();
process.exit(0);
