/* Probe: is React's onChange attached to the file input, and does a change event upload? */
const PORT = 9333;
const url = process.argv[2] ?? 'http://127.0.0.1:4100/tasks?task=KztmWi3KcDsGlWd3L6Sb3g';

const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));

let id = 0;
const pending = new Map();
const events = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  } else if (msg.method) events.push(msg);
});
function send(method, params = {}) {
  const messageId = ++id;
  ws.send(JSON.stringify({ id: messageId, method, params }));
  return new Promise((resolve, reject) => pending.set(messageId, { resolve, reject }));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function evaluate(expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) return { error: exceptionDetails.text };
  return result.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Log.enable');
await send('Page.navigate', { url });

for (let i = 0; i < 40; i += 1) {
  await sleep(500);
  const ready = await evaluate(`Boolean(document.querySelector('section[aria-label=Attachments] input[type=file]'))`);
  if (ready) break;
}

const props = await evaluate(`(() => {
  const el = document.querySelector('input[type=file]');
  const keys = Object.keys(el);
  const propsKey = keys.find((k) => k.startsWith('__reactProps'));
  const fiberKey = keys.find((k) => k.startsWith('__reactFiber'));
  const props = propsKey ? el[propsKey] : null;
  const handlers = [];
  if (props) {
    for (const [name, value] of Object.entries(props)) {
      if (typeof value === 'function') handlers.push(name);
    }
  }
  return {
    keys,
    propsKey: propsKey ?? null,
    fiberKey: fiberKey ?? null,
    handlers,
    onChangeSource: props?.onChange ? String(props.onChange).slice(0, 200) : null,
    type: props?.type ?? null,
    multiple: props?.multiple ?? null,
  };
})()`);
console.log('REACT', JSON.stringify(props, null, 2));

const dispatched = await evaluate(`(async () => {
  const el = document.querySelector('input[type=file]');
  const dt = new DataTransfer();
  dt.items.add(new File(['picker probe via change\\n'], 'change probe.txt', { type: 'text/plain' }));
  el.files = dt.files;
  const before = el.files.length;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 2500));
  const section = document.querySelector('section[aria-label=Attachments]');
  return { assigned: before, after: el.files.length, text: section.innerText };
})()`);
console.log('DISPATCH', JSON.stringify(dispatched));

const requests = events
  .filter((e) => e.method === 'Network.requestWillBeSent')
  .map((e) => `${e.params.request.method} ${e.params.request.url}`)
  .filter((line) => line.includes('/api/attachments'));
console.log('REQUESTS', JSON.stringify(requests));

const logs = events
  .filter((e) => ['Log.entryAdded', 'Runtime.exceptionThrown'].includes(e.method))
  .map((e) => JSON.stringify(e.params).slice(0, 300));
console.log('LOGS', JSON.stringify(logs.slice(0, 10)));

ws.close();
process.exit(0);
