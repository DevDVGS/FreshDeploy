import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { stamp, inspect, toPublicReport } from '../packages/core/src/index.js';
import { isPublicReport, summarizeDeployment } from '../packages/widget/src/state.js';

const manifest = { schemaVersion:1, version:'1.0.1', commit:'local-v2' };
const checks = ['http','cache','manifest','version','assets'].map(id => ({ id, state:'pass', summary:`${id} passed.` }));
const report = {
  schemaVersion:1, kind:'freshdeploy.public-report', status:'pass', generatedAt:'2026-09-25T00:00:00Z',
  version:{version:manifest.version,commit:manifest.commit},checks,
  assets:{checked:2,passed:2,failed:0,skipped:0,total:2},comparison:{added:1,changed:1,removed:1}
};

test('widget only verifies matching build with complete matching post-deploy report', () => {
  assert.equal(isPublicReport(report),true);
  assert.equal(summarizeDeployment({manifest,report,expectedCommit:'local-v2'}).state,'pass');
  assert.equal(summarizeDeployment({manifest,report,expectedVersion:'1.0.1'}).state,'pass');
  assert.equal(summarizeDeployment({manifest,report,expectedVersion:'1.0.1',maxReportAgeMs:30_000,now:Date.parse(report.generatedAt)+60_000}).label,'monitor stale');
  const unavailable={...report, status:'warn', version:null, checks:[{id:'monitor',state:'warn',summary:'Monitor could not complete the latest check.'}]};
  assert.equal(summarizeDeployment({manifest,report:unavailable,expectedVersion:'1.0.1'}).label,'monitor unavailable');
  assert.equal(summarizeDeployment({manifest,report}).state,'warn');
  assert.equal(summarizeDeployment({manifest,expectedCommit:'local-v2'}).state,'warn');
  assert.equal(summarizeDeployment({manifest,report,expectedCommit:'old-build'}).state,'fail');
  assert.equal(summarizeDeployment({manifest,report:{...report,version:{version:'1.0.0',commit:'local-v1'}},expectedVersion:'1.0.1'}).state,'warn');
  assert.equal(summarizeDeployment({manifest,report:{...report,assets:{...report.assets,skipped:1}},expectedVersion:'1.0.1'}).state,'warn');
  assert.equal(summarizeDeployment({manifest,report:{...report,checks:checks.filter(x=>x.id!=='assets')},expectedVersion:'1.0.1'}).state,'warn');
});

test('sanitized browser report contains no private errors or asset URLs', () => {
  const privateReport = {
    status:'warn',generatedAt:'2026-09-25T00:00:00Z',url:'https://private.example/path',
    version:{version:'1.0.1',commit:'local-v2'},checks:[...checks,{id:'cache',state:'warn',summary:'Review cache.',detail:'Authorization: SECRET'}],
    assets:{checked:2,passed:2,failed:0,skipped:0,total:2,errors:[{url:'https://secret.example/private',reason:'secret'}]},
    comparison:{added:['new.js'],changed:['app.js'],removed:['old.js']}
  };
  const publicReport = toPublicReport(privateReport);
  const serialized = JSON.stringify(publicReport);
  assert.equal(isPublicReport(publicReport),true);
  assert.deepEqual(publicReport.comparison,{added:1,changed:1,removed:1});
  for (const secret of ['SECRET','private.example','secret.example','new.js','app.js','old.js']) assert.equal(serialized.includes(secret),false,secret);
});

test('a failed real asset check produces a failed public report, not a false success', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'freshdeploy-public-test-'));
  const html = '<!doctype html><script src="app.js"></script>';
  await fs.writeFile(path.join(dir,'index.html'),html);
  await fs.writeFile(path.join(dir,'app.js'),'console.log("original")');
  const stamped = await stamp({directory:dir,version:'1.0.1',commit:'local-v2'});
  let asset = 'console.log("original")';
  const server = http.createServer((request,response) => {
    const name = new URL(request.url,'http://localhost').pathname;
    response.setHeader('Cache-Control','no-cache');
    if (name === '/') response.end(html);
    else if (name === '/.freshdeploy.json') response.end(JSON.stringify(stamped));
    else if (name === '/index.html') response.end(html);
    else if (name === '/app.js') response.end(asset);
    else response.writeHead(404).end('Missing');
  });
  try {
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    const url = `http://127.0.0.1:${server.address().port}/`;
    const good = toPublicReport(await inspect({url,expected:'local-v2'}));
    assert.equal(good.status,'pass');
    assert.equal(summarizeDeployment({manifest:stamped,report:good,expectedCommit:'local-v2'}).state,'pass');
    asset = 'console.log("corrupted in production")';
    const broken = toPublicReport(await inspect({url,expected:'local-v2'}));
    assert.equal(broken.status,'fail');
    assert.equal(broken.checks.find(c=>c.id==='assets').state,'fail');
    assert.equal(summarizeDeployment({manifest:stamped,report:broken,expectedCommit:'local-v2'}).state,'fail');
  } finally { await new Promise(resolve=>server.close(resolve)); await fs.rm(dir,{recursive:true,force:true}); }
});

test('CLI writes both detailed private and sanitized public reports even on warning', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(),'freshdeploy-cli-report-'));
  const html = '<!doctype html><title>Check</title>';
  await fs.writeFile(path.join(dir,'index.html'),html);
  const stamped = await stamp({directory:dir,version:'1.0.1',commit:'local-v2'});
  const server = http.createServer((request,response) => {
    const name = new URL(request.url,'http://localhost').pathname;
    if (name === '/') response.end(html); // No cache policy deliberately: warn.
    else if (name === '/index.html') response.end(html);
    else if (name === '/.freshdeploy.json') response.end(JSON.stringify(stamped));
    else response.writeHead(404).end('Missing');
  });
  try {
    server.listen(0,'127.0.0.1');
    await once(server,'listening');
    const url = `http://127.0.0.1:${server.address().port}/`;
    const bin = path.resolve('packages/cli/bin/freshdeploy.js');
    const code = await new Promise((resolve,reject) => {
      const child = spawn(process.execPath,[bin,'check','--url',url,'--expected','local-v2','--report','private.json','--public-report','public.json'],{cwd:dir,stdio:'ignore'});
      child.on('error',reject);
      child.on('exit',resolve);
    });
    assert.equal(code,1,'Cache warning must be a nonzero CI exit code');
    const privateReport = JSON.parse(await fs.readFile(path.join(dir,'private.json'),'utf8'));
    const publicReport = JSON.parse(await fs.readFile(path.join(dir,'public.json'),'utf8'));
    assert.equal(privateReport.status,'warn');
    assert.equal(publicReport.status,'warn');
    assert.equal(isPublicReport(publicReport),true);
    assert.equal(publicReport.checks.find(c=>c.id==='cache').state,'warn');
    assert.equal('url' in publicReport,false);
    assert.equal('errors' in publicReport.assets,false);
  } finally { await new Promise(resolve=>server.close(resolve)); await fs.rm(dir,{recursive:true,force:true}); }
});

test('mounted widget refreshes automatically without page reload and preserves the panel', async () => {
  const { mountFreshDeploy } = await import('../packages/widget/src/index.js');
  const old = { document:globalThis.document, location:globalThis.location, fetch:globalThis.fetch,
    setTimeout:globalThis.setTimeout, clearTimeout:globalThis.clearTimeout };
  const makeElement = () => ({className:'',textContent:'',innerHTML:'',hidden:true,attrs:{},setAttribute(name,value){this.attrs[name]=value;},addEventListener(){}});
  const elements = new Map(['.pill','.panel','.dot','.text','.body','.close','.retry'].map(key=>[key,makeElement()]));
  let publishedReport = structuredClone(report), poll, pollDelay;
  let bodyWrites = 0, bodyHtml = '';
  Object.defineProperty(elements.get('.body'), 'innerHTML', {
    get() { return bodyHtml; },
    set(value) { bodyWrites++; bodyHtml = value; },
  });
  let requests = [];
  const host = {setAttribute(){},attachShadow(){return {innerHTML:'',querySelector(selector){return elements.get(selector);}};},remove(){}};
  const target = {append(){}};
  globalThis.document = { hidden:false, body:target, createElement(){return host;}, querySelector(){return null;},addEventListener(){},removeEventListener(){} };
  globalThis.location = new URL('https://site.example/');
  globalThis.setTimeout = (fn, ms) => { poll = fn; pollDelay = ms; return 101; };
  globalThis.clearTimeout = () => { poll = null; };
  globalThis.fetch = async (url,opts) => {
    requests.push({url:String(url),cache:opts.cache});
    return {ok:true,json:async()=>new URL(String(url)).pathname.endsWith('report.json') ? publishedReport : manifest};
  };
  try {
    const widget = mountFreshDeploy({target,expectedCommit:'local-v2',manifestUrl:'/.freshdeploy.json',reportUrl:'/.freshdeploy-report.json',pollIntervalMs:5000});
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(elements.get('.text').textContent,'deployment verified');
    assert.match(elements.get('.body').innerHTML,/\+1 ~1 -1/);
    assert.equal(pollDelay,5000);
    assert.equal(requests.every(item=>item.cache==='no-store' && new URL(item.url).searchParams.has('_fd')),true);
    // Updating only the monitor timestamp must not repaint the body or close the panel.
    elements.get('.panel').hidden = false;
    const firstPaints = bodyWrites;
    publishedReport = {...report, generatedAt:'2026-09-25T00:00:05Z'};
    poll();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(bodyWrites,firstPaints,'unchanged checks must not rebuild the open panel');
    assert.equal(elements.get('.panel').hidden,false,'the panel stays open after a timestamp-only update');
    // A real failure must still update the open panel and indicator.
    publishedReport = {...publishedReport,status:'fail',checks:checks.map(x=>x.id==='assets'?{...x,state:'fail',summary:'Resource hash mismatch.'}:x),assets:{...report.assets,checked:2,passed:1,failed:1}};
    poll();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(elements.get('.text').textContent,'deployment failed');
    assert.match(elements.get('.body').innerHTML,/Resource hash mismatch/);
    assert.equal(bodyWrites,firstPaints+1,'a meaningful status change updates the panel once');
    assert.equal(elements.get('.panel').hidden,false,'the open panel stays open');
    widget.destroy();
    assert.equal(poll,null,'timer is disposed');
  } finally {
    for (const [key,value] of Object.entries(old)) {
      if (value === undefined) delete globalThis[key]; else globalThis[key]=value;
    }
  }
});
