import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { stamp } from '../packages/core/src/index.js';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitForReport(file, expected, timeout = 12000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    try { const report = JSON.parse(await fs.readFile(file, 'utf8')); if (report.status === expected) return report; }
    catch (error) { if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error; }
    await sleep(120);
  }
  throw new Error(`Public report did not change to ${expected} within ${timeout} ms`);
}

test('watch reruns server-side checks and publishes a changed FAIL without refresh', {timeout:20000}, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'freshdeploy-watch-'));
  const dist = path.join(dir, 'dist');
  await fs.mkdir(dist);
  await fs.writeFile(path.join(dist,'index.html'), '<!doctype html><script src="app.js"></script>');
  await fs.writeFile(path.join(dist,'app.js'), 'console.log("original")');
  await stamp({directory:dist,version:'1.0.2',commit:'local-v3'});
  const server = http.createServer(async (req,res) => {
    const name = new URL(req.url, 'http://localhost').pathname;
    const file = path.join(dist,name === '/' ? 'index.html' : name.slice(1));
    res.setHeader('Cache-Control', 'no-store');
    try { res.end(await fs.readFile(file)); }
    catch { res.writeHead(404).end('Missing'); }
  });
  let child, exited;
  try {
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    const url = `http://127.0.0.1:${server.address().port}/`;
    const bin = path.resolve('packages/cli/bin/freshdeploy.js');
    child = spawn(process.execPath,[bin,'watch','--url',url,'--expected','local-v3','--interval','5','--public-report','dist/.freshdeploy-report.json','--report','private.json'],{cwd:dir,stdio:'ignore'});
    exited = new Promise(resolve => child.once('exit',resolve));
    const filename = path.join(dist,'.freshdeploy-report.json');
    assert.equal((await waitForReport(filename,'pass')).assets.passed,2);
    await fs.writeFile(path.join(dist,'app.js'),'console.log("changed after deployment")');
    const broken = await waitForReport(filename,'fail');
    assert.equal(broken.assets.failed,1);
    assert.equal(broken.checks.find(item=>item.id==='assets').state,'fail');
  } finally {
    child?.kill('SIGTERM');
    if (child) await Promise.race([exited,sleep(1000)]);
    await new Promise(resolve=>server.close(resolve));
    await fs.rm(dir,{recursive:true,force:true});
  }
});
