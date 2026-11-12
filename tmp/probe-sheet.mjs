/* Probe: what does the open sheet actually contain? */
const PORT = 9333;
const url = process.argv[2] ?? 'http://127.0.0.1:4100/tasks?task=KztmWi3KcDsGlWd3L6Sb3g';

const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
function send(method, params = {}) {
  const messageId = ++id;
  ws.send(JSON.stringify({ id: messageId, method, params }));
  return new Promise((resolve, reject) => pending.set(messageId, { resolve, reject }));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evaluate(expression) {
  const { result } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return result.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url });
await sleep(6000);

const info = await evaluate(`(() => {
  const dialog = document.querySelector('[role=dialog]');
  const section = document.querySelector('section[aria-label=Attachments]');
  const inputs = [...document.querySelectorAll('input[type=file]')];
  return {
    dialogClass: dialog?.className ?? null,
    dialogText: dialog?.innerText?.slice(0, 600) ?? null,
    sectionText: section?.innerText ?? null,
    sectionHtml: section?.outerHTML?.slice(0, 900) ?? null,
    fileInputs: inputs.length,
    buttons: [...(dialog?.querySelectorAll('button') ?? [])].map((b) => b.getAttribute('aria-label') ?? b.textContent?.trim()).slice(0, 20),
  };
})()`);
console.log(JSON.stringify(info, null, 2));
ws.close();
process.exit(0);
