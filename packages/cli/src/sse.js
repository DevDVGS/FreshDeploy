/** Optional public-summary-only SSE broadcaster for a trusted local/dedicated monitor. */
import http from 'node:http';

// Timestamp changes keep the *stored* report fresh, but do not justify a full
// notification if the version, checks and results are unchanged.
export function reportFingerprint(report) {
  if (!report || typeof report !== 'object') throw new Error('A public report is required.');
  const { generatedAt: _generatedAt, ...meaningful } = report;
  return JSON.stringify(meaningful);
}

export async function createLiveServer({ port, host='127.0.0.1', origin=null } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('SSE port must be between 0 and 65535.');
  const allowedOrigin = origin ? new URL(origin).origin : null;
  const clients = new Set();
  let lastReport = null, lastFingerprint = null;
  const server = http.createServer((req,res) => {
    const requestUrl = new URL(req.url || '/', 'http://localhost');
    if (requestUrl.pathname !== '/events' || req.method !== 'GET') { res.writeHead(404).end(); return; }
    const requester = req.headers.origin;
    // Browsers must explicitly match the configured origin. Never allow wildcard CORS.
    if (requester && (!allowedOrigin || requester !== allowedOrigin)) { res.writeHead(403).end(); return; }
    const headers = {
      'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control':'no-store, no-transform',
      'Connection':'keep-alive', 'X-Accel-Buffering':'no',
    };
    if (allowedOrigin && requester === allowedOrigin) headers['Access-Control-Allow-Origin']=allowedOrigin;
    res.writeHead(200,headers);
    res.write(': connected\n\n');
    // Reconnected tabs always get the latest report, including its new timestamp.
    if (lastReport) res.write(`event: report\ndata: ${JSON.stringify(lastReport)}\n\n`);
    clients.add(res);
    req.on('close',()=>clients.delete(res));
  });
  await new Promise((resolve,reject)=>{ server.once('error',reject); server.listen(port,host,()=>{ server.off('error',reject); resolve(); }); });
  const heartbeat = setInterval(()=>{ for (const c of clients) { try { c.write(': heartbeat\n\n'); } catch { clients.delete(c); } } },15_000);
  heartbeat.unref?.();
  return {
    get url(){ const address=server.address(); return `http://${host}:${address.port}/events`; },
    publish(report){
      const fingerprint = reportFingerprint(report);
      const changed = fingerprint !== lastFingerprint;
      lastReport = report;
      lastFingerprint = fingerprint;
      if (!changed) return false;
      const msg=`event: report\ndata: ${JSON.stringify(report)}\n\n`;
      for (const c of clients) { try{c.write(msg);}catch{clients.delete(c);} }
      return true;
    },
    async close(){clearInterval(heartbeat); for(const c of clients)c.end(); clients.clear(); await new Promise(resolve=>server.close(resolve));}
  };
}
