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

const plan = await evaluate(`(async () => {
  const list = await (await fetch('/api/tasks', { headers: { 'X-TaskTick-Fresh': '1' } })).json();
  const open = (list.data ?? list.data?.tasks ?? []).find ? (list.data.tasks || []).find((t) => !t.completedAt) : null;
  const rows = [...document.querySelectorAll('button[class*="row-content"]')].map((b) => b.innerText.split('\\n')[0]);
  return { taskId: open?.id ?? null, title: open?.title ?? null, rows: rows.slice(0, 6) };
})()`);
console.log('plan', JSON.stringify(plan));

const patched = await evaluate(`(async () => {
  const id = ${JSON.stringify(plan.taskId)};
  if (!id) return { error: 'no task' };
  const r = await fetch('/api/tasks/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ completed: true }) });
  return { status: r.status, body: (await r.text()).slice(0, 120) };
})()`);
console.log('patched', JSON.stringify(patched));

for (let i = 0; i < 6; i += 1) {
  await new Promise((r) => setTimeout(r, 2000));
  const snap = await evaluate(`(() => {
    const done = [...document.querySelectorAll('button[aria-label^="Complete"]')].length;
    const rows = [...document.querySelectorAll('button[class*="row-content"]')].map((b) => b.innerText.split('\\n')[0]);
    return { completeButtons: done, hasTitle: rows.includes(${JSON.stringify(plan.title)}) };
  })()`);
  console.log(i, JSON.stringify(snap));
}
ws.close();
process.exit(0);
