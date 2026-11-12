const CDP = process.env.CDP ?? 'http://127.0.0.1:9223';
const APP = process.env.PROBE_APP ?? 'http://127.0.0.1:3101';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class Cdp {
  constructor(url) {
    this.ws = new WebSocket(url); this.id = 0; this.pending = new Map();
    this.ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.id === undefined) return;
      const p = this.pending.get(m.id); if (!p) return;
      this.pending.delete(m.id);
      if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
    });
  }
  ready() { return new Promise((res, rej) => { this.ws.addEventListener('open', () => res(this)); this.ws.addEventListener('error', () => rej(new Error('ws'))); }); }
  send(method, params = {}) { const id = ++this.id; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async ev(expression) { const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails).slice(0, 400)); return r.result?.value; }
}
const t = await fetch(`${CDP}/json/new?about:blank`, { method: 'PUT' }).then((r) => r.json());
const cdp = new Cdp(t.webSocketDebuggerUrl); await cdp.ready();
await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
await cdp.send('Page.navigate', { url: `${APP}/tasks` });
await sleep(8000);
console.log('tasks:', JSON.stringify(await cdp.ev(`({url: location.href, text: document.body.innerText.slice(0, 120)})`)));
console.log('anchors:', JSON.stringify(await cdp.ev(`[...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => h.includes('calendar')).slice(0, 10)`)));
console.log('click:', await cdp.ev(`(() => { const a = [...document.querySelectorAll('a[href]')].find(x => new URL(x.href).pathname === '/calendar'); if (!a) return 'no calendar link'; a.click(); return 'clicked ' + a.getAttribute('href'); })()`));
await sleep(9000);
console.log('after:', JSON.stringify(await cdp.ev(`({url: location.href, controller: Boolean(navigator.serviceWorker.controller), text: document.body.innerText.slice(0, 700)})`), null, 1));
await cdp.send('Page.close').catch(() => {});
