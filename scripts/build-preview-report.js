/** Produces a real local verification report for the self-contained visual preview. */
import fs from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { stamp, inspect, toPublicReport } from '../packages/core/src/index.js';

const dir = path.resolve('preview');
await stamp({ directory: dir, version: '0.5.0-beta.1', commit: 'preview-build' });
const server = http.createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const filename = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!['index.html', '.freshdeploy.json'].includes(filename)) { response.writeHead(404).end('Not found'); return; }
  const bytes = await fs.readFile(path.join(dir, filename));
  response.writeHead(200, { 'content-type': filename.endsWith('.json') ? 'application/json' : 'text/html' }).end(bytes);
});
try {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${server.address().port}/`;
  const result = await inspect({ url, expected: 'preview-build' });
  await fs.writeFile(path.join(dir, '.freshdeploy-report.json'), JSON.stringify(toPublicReport(result), null, 2) + '\n');
  console.log(`Preview report generated from an actual local check: ${result.status} (${result.assets.passed}/${result.assets.total} assets)`);
} finally { await new Promise(resolve => server.close(resolve)); }
