// Sets the maps link on one task so the detail sheet has something to render.
const [, , , , , script] = process.argv;
const target = await (
  await fetch('http://127.0.0.1:9333/json/new?' + encodeURIComponent('http://127.0.0.1:4100/tasks'), {
    method: 'PUT',
  })
).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  }
});
await new Promise((resolve) => ws.addEventListener('open', resolve));
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks' });
await new Promise((r) => setTimeout(r, 5000));
const result = await send('Runtime.evaluate', {
  expression: script,
  awaitPromise: true,
  returnByValue: true,
});
console.log(JSON.stringify(result.result?.value ?? result.result ?? result, null, 2));
ws.close();
process.exit(0);
