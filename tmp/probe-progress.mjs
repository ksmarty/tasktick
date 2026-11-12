/* Probe: does an upload show progress while it runs, and an error row when it fails? */
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

const snapshot = `(() => {
  const section = document.querySelector('section[aria-label=Attachments]');
  const bars = [...section.querySelectorAll('[role=progressbar]')];
  return {
    text: section.innerText,
    bars: bars.map((b) => ({
      value: b.getAttribute('aria-valuenow'),
      label: b.getAttribute('aria-label'),
      transform: b.firstElementChild ? getComputedStyle(b.firstElementChild).transform : null,
      width: Math.round(b.getBoundingClientRect().width),
    })),
    alerts: [...section.querySelectorAll('[role=alert]')].map((n) => n.textContent),
    buttons: [...section.querySelectorAll('button')].map((b) => b.getAttribute('aria-label') ?? b.textContent.trim().slice(0, 40)),
  };
})()`;

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Page.navigate', { url });
for (let i = 0; i < 40; i += 1) {
  await sleep(500);
  if (await evaluate(`Boolean(document.querySelector('section[aria-label=Attachments] input[type=file]'))`)) break;
}

// A slow uplink, so the bar has time to be observed.
await send('Network.emulateNetworkConditions', {
  offline: false,
  latency: 20,
  downloadThroughput: 5_000_000,
  uploadThroughput: 120_000,
});

// 2 MB, chosen the way the picker would deliver it.
const started = await evaluate(`(async () => {
  const el = document.querySelector('section[aria-label=Attachments] input[type=file]');
  const bytes = new Uint8Array(2 * 1024 * 1024).fill(97);
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], 'progress probe.txt', { type: 'text/plain' }));
  el.files = dt.files;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return el.files.length;
})()`);
console.log('PICKED', started);
await sleep(400);
console.log('EARLY', JSON.stringify(await evaluate(snapshot)));
await sleep(2500);
console.log('MID', JSON.stringify(await evaluate(snapshot)));
await sleep(9000);
console.log('LATE', JSON.stringify(await evaluate(snapshot)));

// A refused file: the client's own limit, no request at all.
const refused = await evaluate(`(() => {
  const el = document.querySelector('section[aria-label=Attachments] input[type=file]');
  const bytes = new Uint8Array(26 * 1024 * 1024);
  const dt = new DataTransfer();
  dt.items.add(new File([bytes], 'too-big.bin', { type: 'application/octet-stream' }));
  el.files = dt.files;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
})()`);
await sleep(800);
console.log('REFUSED', JSON.stringify(await evaluate(snapshot)));

const attachmentPosts = events
  .filter((e) => e.method === 'Network.requestWillBeSent')
  .map((e) => `${e.params.request.method} ${e.params.request.url}`)
  .filter((line) => line.includes('/api/attachments') && line.startsWith('POST'));
console.log('POSTS', JSON.stringify(attachmentPosts));

ws.close();
process.exit(0);
