/**
 * A "low internet" stand-in: forwards everything to the real app, but holds
 * every `/api/` response for API_DELAY_MS. Used to answer one question — does
 * the calendar screen still paint from disk when the network answers *late*
 * rather than not at all?
 *
 * Usage: PROXY_PORT=3200 ORIGIN=http://127.0.0.1:3100 node tmp/slow-proxy.mjs
 */
import http from 'node:http';

const PORT = Number(process.env.PROXY_PORT ?? 3200);
const ORIGIN = process.env.ORIGIN ?? 'http://127.0.0.1:3100';
const API_DELAY_MS = Number(process.env.API_DELAY_MS ?? 2500);

const server = http.createServer(async (req, res) => {
  const target = new URL(req.url, ORIGIN);
  const isApi = target.pathname.startsWith('/api/');
  const headers = { ...req.headers, host: new URL(ORIGIN).host };
  delete headers['accept-encoding'];

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);

  const failFirst = isApi && process.env.DROP_API === '1' && !req.headers.cookie?.includes('keep');
  if (failFirst) {
    // Answer like a server that cannot be reached at all.
    req.socket.destroy();
    return;
  }

  try {
    const upstream = await fetch(target, {
      method: req.method,
      headers,
      body: chunks.length && req.method !== 'GET' && req.method !== 'HEAD' ? Buffer.concat(chunks) : undefined,
      redirect: 'manual',
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    const outHeaders = {};
    upstream.headers.forEach((value, key) => {
      if (key === 'content-encoding' || key === 'transfer-encoding' || key === 'content-length') return;
      outHeaders[key] = value;
    });
    if (isApi && API_DELAY_MS > 0) await new Promise((r) => setTimeout(r, API_DELAY_MS));
    res.writeHead(upstream.status, outHeaders);
    res.end(body);
  } catch (error) {
    res.writeHead(502, { 'content-type': 'text/plain' });
    res.end('proxy error: ' + error.message);
  }
});

server.listen(PORT, '0.0.0.0', () => console.log('slow proxy on', PORT, '->', ORIGIN, 'api delay', API_DELAY_MS));
