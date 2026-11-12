// Same-origin (app origin) blob test: does an iframe pointed at a blob: URL of a
// PDF show up as a frame with a plugin, and does the document survive?
const ORIGIN = 'http://localhost:4100';
const ID = process.argv[2];

const t = await (await fetch(`http://127.0.0.1:9333/json/new?${encodeURIComponent(`${ORIGIN}/tasks`)}`, { method: 'PUT' })).json();
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
await new Promise((r) => ws.addEventListener('open', r));
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result?.result?.value ?? r.result?.result ?? r.result ?? r;
};

await send('Page.enable');
await send('Runtime.enable');
await new Promise((r) => setTimeout(r, 6000));

const out = await evaluate(`(async () => {
  const response = await fetch('/api/attachments/${ID}?inline=1', { credentials: 'same-origin' });
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const frame = document.createElement('iframe');
  frame.id = 'probe';
  frame.src = url + '#zoom=page-width&toolbar=1';
  frame.style.cssText = 'position:fixed;left:0;top:0;width:600px;height:500px;z-index:9999;border:2px solid red';
  document.body.appendChild(frame);
  return { status: response.status, type: blob.type, size: blob.size, url: url.slice(0, 40) };
})()`);
console.log('blob', JSON.stringify(out));
await new Promise((r) => setTimeout(r, 4000));

const tree = await send('Page.getFrameTree');
const flat = [];
const walk = (n) => { flat.push(n.frame.url.slice(0, 60)); (n.childFrames ?? []).forEach(walk); };
walk(tree.result.frameTree);
console.log('frames', JSON.stringify(flat));

const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 610, height: 510, scale: 1 } });
const { writeFileSync } = await import('node:fs');
writeFileSync('tmp/blob-frame.png', Buffer.from(shot.result.data, 'base64'));
ws.close();
process.exit(0);
