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

// Instrument: record every /api request the page makes from now on.
await evaluate(`(() => {
  window.__reqs = [];
  const of = window.fetch;
  window.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    const h = new Headers((init && init.headers) || (typeof input === 'object' ? input.headers : undefined));
    window.__reqs.push({ url, fresh: h.get('X-TaskTick-Fresh'), t: Date.now() });
    return of(input, init);
  };
  return true;
})()`);

const mark = 'Stand-up (live ' + Date.now() + ')';
const target2 = await evaluate(`(async () => {
  const j = await (await fetch('/api/tasks', { headers: { 'X-TaskTick-Fresh': '1' } })).json();
  const t = j.data.find((x) => x.title === 'Stand-up');
  const r = await fetch('/api/tasks/' + t.id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: ${JSON.stringify(mark)} }) });
  return { id: t.id, old: t.title, status: r.status };
})()`);
console.log('patched', JSON.stringify(target2));

await new Promise((r) => setTimeout(r, 14000));
const report = await evaluate(`(async () => {
  const reqs = window.__reqs.filter((r) => r.url.includes('/api/'));
  const versions = reqs.filter((r) => r.url.includes('/api/sync/version'));
  const tasks = reqs.filter((r) => /\\/api\\/tasks(\\?|$)/.test(r.url));
  const seen = document.body.innerText.includes(${JSON.stringify(mark)});
  return { total: reqs.length, versions: versions.length, versionFresh: versions.filter((v) => v.fresh === '1').length, tasks: tasks.length, seen };
})()`);
console.log('report', JSON.stringify(report, null, 2));

await evaluate(`(async () => { await fetch('/api/tasks/' + ${JSON.stringify(target2.id)}, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: ${JSON.stringify(target2.old)} }) }); return true; })()`);
ws.close();
process.exit(0);
