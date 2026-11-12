// Minimal CDP driver: navigate, wait, evaluate, screenshot.
const [, , url, outPng, waitMs = '6000', script = ''] = process.argv;

const targets = await (await fetch('http://127.0.0.1:9333/json/new?' + encodeURIComponent(url), { method: 'PUT' })).json();
const ws = new WebSocket(targets.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const events = [];
ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method) events.push(msg);
});
await new Promise((resolve) => ws.addEventListener('open', resolve));

const send = (method, params = {}) =>
  new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url });
await new Promise((r) => setTimeout(r, Number(waitMs)));

if (script) {
  const result = await send('Runtime.evaluate', { expression: script, awaitPromise: true, returnByValue: true });
  console.log(JSON.stringify(result.result?.value ?? result.result ?? result, null, 2));
}

if (outPng && outPng !== '-') {
  const shot = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  if (shot.result?.data) {
    const { writeFileSync } = await import('node:fs');
    writeFileSync(outPng, Buffer.from(shot.result.data, 'base64'));
    console.log('screenshot ->', outPng);
  } else {
    console.log('screenshot failed', JSON.stringify(shot).slice(0, 300));
  }
}

const problems = events
  .filter((e) => e.method === 'Log.entryAdded' && ['error', 'warning'].includes(e.params.entry.level))
  .map((e) => `${e.params.entry.level}: ${e.params.entry.text}`);
if (problems.length) console.log('console problems:\n' + problems.join('\n'));
ws.close();
process.exit(0);
