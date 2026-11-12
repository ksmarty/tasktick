// Does Chrome put a plugin frame around an http PDF, a blob PDF, or neither?
const ORIGIN = 'http://localhost:4100';
const ID = process.argv[2];

const open = async (url) => {
  const t = await (await fetch(`http://127.0.0.1:9333/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json();
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  });
  await new Promise((r) => ws.addEventListener('open', r));
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send('Page.enable');
  await new Promise((r) => setTimeout(r, 4000));
  const tree = await send('Page.getFrameTree');
  const flat = [];
  const walk = (n) => { flat.push(n.frame.url.slice(0, 70)); (n.childFrames ?? []).forEach(walk); };
  walk(tree.result.frameTree);
  ws.close();
  return flat;
};

console.log('http  ->', JSON.stringify(await open(`${ORIGIN}/api/attachments/${ID}?inline=1#zoom=page-width&toolbar=1`)));

const html = `${ORIGIN}/api/attachments/${ID}?inline=1`;
const page = `data:text/html,<body style="margin:0"><iframe id=f style="width:600px;height:500px"></iframe><script>fetch('${html}',{credentials:'include'}).then(r=>r.blob()).then(b=>{const u=URL.createObjectURL(b);document.getElementById('f').src=u+'%23zoom=page-width';document.title='blob:'+u.slice(0,20)})</script></body>`;
console.log('blob  ->', JSON.stringify(await open(page)));
process.exit(0);
