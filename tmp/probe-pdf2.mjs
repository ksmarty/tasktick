// Upload a two-page PDF to a task, open it, and measure the preview.
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const ORIGIN = 'http://localhost:4100';
const TASK = 'KztmWi3KcDsGlWd3L6Sb3g';
const PAGE = `${ORIGIN}/tasks?task=${TASK}`;
const mobile = process.argv[2] === 'mobile';

const target = await (
  await fetch(`http://127.0.0.1:9333/json/new?${encodeURIComponent(PAGE)}`, { method: 'PUT' })
).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) =>
  new Promise((resolve) => {
    const myId = ++id;
    pending.set(myId, resolve);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value ?? r.result?.result ?? r.result ?? r;
};

await send('Runtime.enable');
await send('Page.enable');
await send('Network.enable');
await send('Page.navigate', { url: PAGE });
await sleep(7000);

if (mobile) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await send('Page.navigate', { url: PAGE });
  await sleep(7000);
}

// Upload with the browser's own cookies.
const cookies = (await send('Network.getAllCookies')).result?.cookies ?? [];
console.log('cookies', cookies.map((c) => `${c.domain}${c.path} ${c.name}`).join(' | '));
const cookie = cookies
  .filter((c) => c.domain.includes('localhost'))
  .map((c) => `${c.name}=${c.value}`)
  .join('; ');
const pdf = readFileSync('tmp/two-pages.pdf');
const form = new FormData();
form.set('taskId', TASK);
form.set('file', new Blob([pdf], { type: 'application/pdf' }), 'two-pages.pdf');
const upload = await fetch(`${ORIGIN}/api/attachments`, {
  method: 'POST',
  headers: { cookie },
  body: form,
});
console.log('upload', upload.status, (await upload.text()).slice(0, 160));

await send('Page.navigate', { url: PAGE });
await sleep(8000);

const clicked = await evaluate(`(() => {
  const row = [...document.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('two-pages.pdf'));
  if (!row) return 'no row';
  row.click();
  return 'clicked';
})()`);
console.log('row', clicked);
await sleep(4000);

const report = await evaluate(`(() => {
  const dialogs = [...document.querySelectorAll('[data-slot="dialog-content"]')];
  const d = dialogs[dialogs.length - 1];
  if (!d) return { noDialog: true };
  const r = d.getBoundingClientRect();
  const frame = d.querySelector('iframe');
  const fr = frame?.getBoundingClientRect();
  const alert = d.querySelector('[role="alert"]');
  return {
    coarse: matchMedia('(pointer: coarse)').matches,
    hover: matchMedia('(hover: hover)').matches,
    dialog: [r.x, r.y, r.width, r.height].map(Math.round),
    frame: frame ? { src: frame.getAttribute('src'), rect: fr && [fr.x, fr.y, fr.width, fr.height].map(Math.round) } : null,
    alert: alert ? alert.textContent : null,
    card: [...d.querySelectorAll('p, a')].map((n) => { const q = n.getBoundingClientRect(); return { t: n.tagName, text: n.textContent.trim().slice(0, 40), rect: [q.x, q.y, q.width, q.height].map(Math.round) }; }),
    links: [...d.querySelectorAll('a')].map((a) => ({ text: a.textContent.trim(), target: a.target, href: (a.getAttribute('href') || '').slice(0, 60) })),
    text: d.innerText.replace(/\\s+/g, ' ').slice(0, 240),
  };
})()`);
console.log(JSON.stringify(report, null, 2));

const tree = await send('Page.getFrameTree');
const flat = [];
const walk = (node) => { flat.push(node.frame.url.slice(0, 90)); (node.childFrames ?? []).forEach(walk); };
walk(tree.result.frameTree);
console.log('frames', JSON.stringify(flat, null, 1));

const shot = await send('Page.captureScreenshot', { format: 'png' });
const { writeFileSync } = await import('node:fs');
writeFileSync(mobile ? 'tmp/pdf-mobile.png' : 'tmp/pdf-desktop.png', Buffer.from(shot.result.data, 'base64'));
ws.close();
process.exit(0);
