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

const idAndTitle = await evaluate(`(async () => {
  const j = await (await fetch('/api/tasks', { headers: { 'X-TaskTick-Fresh': '1' } })).json();
  const t = j.data.find((x) => x.title === 'Reply to the design review thread') ?? j.data[0];
  return { id: t.id, title: t.title };
})()`);
console.log('target', JSON.stringify(idAndTitle));

const marker = 'Reply to the design review thread (live)';
const patched = await evaluate(`(async () => {
  const r = await fetch('/api/tasks/' + ${JSON.stringify(idAndTitle.id)}, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: ${JSON.stringify(marker)} }) });
  return { status: r.status, text: (await r.text()).slice(0, 160) };
})()`);
console.log('patched', JSON.stringify(patched));

for (let i = 0; i < 6; i += 1) {
  await new Promise((r) => setTimeout(r, 2000));
  const seen = await evaluate(`(() => document.body.innerText.includes(${JSON.stringify(marker)}))()`);
  console.log(i, 'live title visible:', seen);
  if (seen) break;
}

// restore
const restored = await evaluate(`(async () => {
  const r = await fetch('/api/tasks/' + ${JSON.stringify(idAndTitle.id)}, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: ${JSON.stringify(idAndTitle.title)} }) });
  return r.status;
})()`);
console.log('restored', restored);
ws.close();
process.exit(0);
