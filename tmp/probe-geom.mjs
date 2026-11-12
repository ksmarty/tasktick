const target = await (await fetch('http://127.0.0.1:9333/json/new?' + encodeURIComponent('http://127.0.0.1:4100/tasks?task=KztmWi3KcDsGlWd3L6Sb3g'), { method: 'PUT' })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0; const pending = new Map();
ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((resolve) => { const myId = ++id; pending.set(myId, resolve); ws.send(JSON.stringify({ id: myId, method, params })); });
await send('Runtime.enable'); await send('Page.enable');
await new Promise((r) => setTimeout(r, 9000));
const ev = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); return r.result?.result?.value; };
console.log(await ev(`(() => {
  const frame = document.querySelector('iframe[title]');
  const drawer = document.querySelector('[data-slot="drawer"]');
  const r = frame?.getBoundingClientRect();
  const dr = drawer?.getBoundingClientRect();
  return JSON.stringify({
    drawer: dr && [Math.round(dr.x), Math.round(dr.y), Math.round(dr.width), Math.round(dr.height)],
    frame: r && [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
    withinDrawer: r && dr ? r.bottom <= dr.bottom + 1 : null,
    scrollable: drawer ? drawer.scrollHeight > drawer.clientHeight : null,
    label: [...drawer.querySelectorAll('span')].map(s => s.textContent.trim()).filter(t => t === 'Location').length,
    anchorText: drawer.querySelector('a[href^="https://maps.app"]')?.textContent?.trim() ?? null,
  });
})()`));
await send('Page.captureScreenshot', { format: 'png' }).then(async (shot) => { const fs = await import('node:fs/promises'); await fs.writeFile('tmp/place-sheet.png', Buffer.from(shot.result.data, 'base64')); });
ws.close(); process.exit(0);
