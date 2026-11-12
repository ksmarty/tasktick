// Cold vs warm open of the detail sheet for a short maps link.
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
const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return result.result?.value;
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

await send('Runtime.enable');
await send('Page.enable');
await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks' });
await wait(6000);

const PAT = 'https://maps.app.goo.gl/GfEZMWPsWs9gcjPf9?g_st=ic';
console.log(
  'patch',
  await evaluate(`fetch('/api/tasks/KztmWi3KcDsGlWd3L6Sb3g', {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({url:${JSON.stringify(
    PAT,
  )}})}).then(r => r.status)`),
);

const probe = `(async () => {
  const started = performance.now();
  const first = await new Promise((resolve) => {
    const tick = () => {
      const frame = document.querySelector('iframe[title]');
      if (frame) return resolve({ at: Math.round(performance.now() - started) });
      if (performance.now() - started > 20000) return resolve({ at: null });
      requestAnimationFrame(tick);
    };
    tick();
  });
  await new Promise((r) => setTimeout(r, 1500));
  const frame = document.querySelector('iframe[title]');
  const rows = [...document.querySelectorAll('[data-slot="drawer"] div')].map((el) => el.textContent.trim()).filter((t) => t && t.length < 90);
  const text = document.querySelector('[data-slot="drawer"]')?.innerText ?? '';
  return {
    frameAt: first.at,
    frameSrc: frame?.getAttribute('src') ?? null,
    frameRect: frame ? (({width, height, x, y}) => ({width, height, x, y}))(frame.getBoundingClientRect()) : null,
    resolveCalls: performance.getEntriesByType('resource').filter((e) => e.name.includes('/api/links/resolve')).length,
    showsRawUrl: text.includes('maps.app.goo.gl'),
    locationRow: rows.find((t) => t.startsWith('Location')) ?? null,
    cache: Object.keys(JSON.parse(localStorage.getItem('tasktick.places.v1') ?? '{}')).length,
  };
})()`;

const URL_SHEET = 'http://127.0.0.1:4100/tasks?task=KztmWi3KcDsGlWd3L6Sb3g';

console.log('clear', await evaluate(`localStorage.removeItem('tasktick.places.v1'), 'ok'`));
await send('Page.navigate', { url: URL_SHEET });
await wait(5000);
console.log('cold', JSON.stringify(await evaluate(probe), null, 2));

await send('Page.navigate', { url: 'http://127.0.0.1:4100/tasks' });
await wait(1500);
await send('Page.navigate', { url: URL_SHEET });
await wait(5000);
console.log('warm', JSON.stringify(await evaluate(probe), null, 2));

ws.close();
process.exit(0);
