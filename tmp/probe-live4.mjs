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

await evaluate(`(() => {
  window.__log = [];
  const of = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const res = await of(input, init);
    if (url.includes('/api/sync/version')) {
      const body = await res.clone().text();
      window.__log.push({ t: Date.now(), body: body.slice(0, 200), age: res.headers.get('age'), fromSW: res.type });
    }
    return res;
  };
  return true;
})()`);

await new Promise((r) => setTimeout(r, 6000));
const before = await evaluate(`window.__log.slice()`);
console.log('polls before patch', JSON.stringify(before, null, 2));

const patched = await evaluate(`(async () => {
  const j = await (await fetch('/api/tasks', { headers: { 'X-TaskTick-Fresh': '1' } })).json();
  const t = j.data.find((x) => x.title === 'Book the dentist');
  await fetch('/api/tasks/' + t.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: t.title }) });
  return t.id;
})()`);
await new Promise((r) => setTimeout(r, 12000));
const after = await evaluate(`window.__log.slice(-4)`);
console.log('polls after patch', JSON.stringify(after, null, 2));
ws.close();
process.exit(0);
