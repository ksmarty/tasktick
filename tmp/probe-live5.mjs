const target = await (
  await fetch('http://127.0.0.1:9333/json/new?' + encodeURIComponent('about:blank'), { method: 'PUT' })
).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const events = [];
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.exceptionThrown') events.push({ kind: 'exception', text: m.params.exceptionDetails?.exception?.description ?? m.params.exceptionDetails?.text });
  if (m.method === 'Log.entryAdded') events.push({ kind: 'log', text: m.params.entry.text });
  if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) events.push({ kind: m.params.type, text: m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200) });
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((res) => { const my = ++id; pending.set(my, res); ws.send(JSON.stringify({ id: my, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value ?? r.result?.result ?? null;
};
await send('Runtime.enable');
await send('Page.enable');
await send('Log.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks' });
await new Promise((r) => setTimeout(r, 6000));

await evaluate(`(() => { window.__reqs = []; const of = window.fetch; window.fetch = (input, init) => { const url = typeof input === 'string' ? input : input.url; window.__reqs.push(url); return of(input, init); }; return true; })()`);

const mark = 'Live probe ' + Date.now();
const info = await evaluate(`(async () => {
  const j = await (await fetch('/api/tasks', { headers: { 'X-TaskTick-Fresh': '1' } })).json();
  const t = j.data.find((x) => !x.completedAtMs);
  const r = await fetch('/api/tasks/' + t.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: ${JSON.stringify(mark)} }) });
  return { id: t.id, old: t.title, status: r.status };
})()`);
console.log('patched', JSON.stringify(info));
await new Promise((r) => setTimeout(r, 12000));
const report = await evaluate(`({ reqs: window.__reqs.filter((u) => u.includes('/api/')), seen: document.body.innerText.includes(${JSON.stringify(mark)}), sw: Boolean(navigator.serviceWorker.controller) })`);
console.log('report', JSON.stringify(report, null, 2));
console.log('events', JSON.stringify(events.slice(0, 6), null, 2));
await evaluate(`(async () => { await fetch('/api/tasks/' + ${JSON.stringify(info.id)}, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: ${JSON.stringify(info.old)} }) }); return true; })()`);
ws.close();
process.exit(0);
