/* Probe: does clicking "Attach file" open a picker, and does a chosen file upload? */
const PORT = 9333;
const url = process.argv[2] ?? 'http://127.0.0.1:4100/tasks?task=KztmWi3KcDsGlWd3L6Sb3g';
const filePath = process.argv[3] ?? '/tmp/probe-file.txt';

async function createTarget() {
  const res = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
  return res.json();
}

const target = await createTarget();
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
  } else if (msg.method) {
    events.push(msg);
  }
});

function send(method, params = {}) {
  const messageId = ++id;
  ws.send(JSON.stringify({ id: messageId, method, params }));
  return new Promise((resolve, reject) => pending.set(messageId, { resolve, reject }));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function evaluate(expression) {
  const { result } = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  return result.value;
}

await send('Page.enable');
await send('Runtime.enable');
await send('Network.enable');
await send('Log.enable');
await send('DOM.enable');
await send('Page.setInterceptFileChooserDialog', { enabled: true });
await send('Network.setBypassServiceWorker', { bypass: true });
await send('Page.navigate', { url });

// Wait for the sheet + section.
for (let i = 0; i < 40; i += 1) {
  await sleep(500);
  const ready = await evaluate(
    `Boolean(document.querySelector('section[aria-label=Attachments] input[type=file]'))`,
  );
  if (ready) break;
}

const state = await evaluate(`(() => {
  const section = document.querySelector('section[aria-label=Attachments]');
  const input = section?.querySelector('input[type=file]');
  const buttons = [...(section?.querySelectorAll('button') ?? [])];
  const attach = buttons.find((b) => (b.textContent ?? '').includes('Attach file')) ?? buttons[0];
  const rect = attach?.getBoundingClientRect();
  const style = attach ? getComputedStyle(attach) : null;
  return {
    online: navigator.onLine,
    hasInput: Boolean(input),
    inputDisabled: input?.disabled ?? null,
    inputDisplay: input ? getComputedStyle(input).display : null,
    attachText: attach?.textContent ?? null,
    attachDisabled: attach?.disabled ?? null,
    attachAriaDisabled: attach?.getAttribute('aria-disabled') ?? null,
    attachOpacity: style?.opacity ?? null,
    attachPointerEvents: style?.pointerEvents ?? null,
    rock: rect ? { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) } : null,
  };
})()`);
console.log('STATE', JSON.stringify(state));

// A genuine mouse click at the button's centre.
if (state.rock) {
  const x = state.rock.x + state.rock.w / 2;
  const y = state.rock.y + state.rock.h / 2;
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

await sleep(1500);
const chooser = events.filter((e) => e.method === 'Page.fileChooserOpened');
console.log('FILECHOOSER', JSON.stringify(chooser.map((e) => e.params)));

if (chooser.length) {
  const { backendNodeId } = chooser[0].params;
  try {
    await send('DOM.setFileInputFiles', { files: [filePath], backendNodeId });
    console.log('setFileInputFiles ok');
  } catch (error) {
    console.log('setFileInputFiles failed', error.message);
  }
  await sleep(2500);
  const after = await evaluate(`(() => {
    const section = document.querySelector('section[aria-label=Attachments]');
    const input = section?.querySelector('input[type=file]');
    return {
      files: input?.files?.length ?? null,
      text: section?.innerText ?? null,
    };
  })()`);
  console.log('AFTER', JSON.stringify(after));
}

const requests = events
  .filter((e) => e.method === 'Network.requestWillBeSent')
  .map((e) => `${e.params.request.method} ${e.params.request.url}`)
  .filter((line) => line.includes('/api/attachments'));
console.log('ATTACHMENT REQUESTS', JSON.stringify(requests));

const logs = events
  .filter((e) => e.method === 'Log.entryAdded' && ['error', 'warning'].includes(e.params.entry.level))
  .map((e) => `${e.params.entry.level}: ${e.params.entry.text}`);
console.log('LOGS', JSON.stringify(logs.slice(0, 12)));

ws.close();
process.exit(0);
