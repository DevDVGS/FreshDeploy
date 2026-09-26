import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import http from 'node:http';
import { once } from 'node:events';
import { reportFingerprint, createLiveServer } from '../packages/cli/src/sse.js';
import { stamp } from '../packages/core/src/index.js';
import { translateCheck } from '../packages/widget/src/i18n.js';
const bin=path.resolve('packages/cli/bin/freshdeploy.js');
const temp=()=>fs.mkdtemp(path.join(os.tmpdir(),'fd-v040-'));
const call=(cwd,...args)=>spawnSync(process.execPath,[bin,...args],{cwd,encoding:'utf8'});

async function project(dir,framework='react'){
  await fs.mkdir(path.join(dir,'src'),{recursive:true});
  await fs.writeFile(path.join(dir,'src/main.jsx'),"import React from 'react';\n");
  await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({version:'4.2.1',scripts:{build:'vite build',prebuild:'echo original'},dependencies:{[framework]:'19'}}));
}

test('one-command setup is repeatable, installs automatic build hooks and preserves originals',async()=>{
  const dir=await temp();
  try {
    await project(dir);
    let result=call(dir,'setup','--url','http://localhost:8081/','--profile','local','--language','es');
    assert.equal(result.status,0,result.stderr);
    const first=await fs.readFile(path.join(dir,'src/main.jsx'),'utf8');
    const pkg=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8'));
    assert.match(pkg.scripts.prebuild,/echo original && node scripts\/freshdeploy-build-meta.mjs/);
    assert.match(pkg.scripts.postbuild,/node scripts\/freshdeploy-after-build.mjs/);
    const original=await fs.readFile(path.join(dir,'src/main.jsx.freshdeploy.bak'),'utf8');
    assert.equal(original,"import React from 'react';\n");
    assert.equal((first.match(/freshdeploy\/mount\.js/g)||[]).length,1);
    const config=JSON.parse(await fs.readFile(path.join(dir,'freshdeploy.config.json'),'utf8'));
    assert.equal(config.monitoring.widgetIntervalSeconds,1);
    assert.equal(config.language,'es');
    result=call(dir,'setup','--url','http://localhost:8081/');assert.equal(result.status,0,result.stderr);
    assert.equal(await fs.readFile(path.join(dir,'src/main.jsx'),'utf8'),first);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8')).scripts,pkg.scripts);
    // Changes in a user-owned widget are never overwritten on subsequent runs.
    const widget=path.join(dir,'src/freshdeploy/index.js');
    await fs.appendFile(widget,'\n// user change\n');
    result=call(dir,'setup');assert.equal(result.status,0,result.stderr);
    assert.match(result.stdout,/Kept user-edited files: index.js/);
    assert.match(await fs.readFile(widget,'utf8'),/user change/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('offline build hook stamps exactly the built version and public files, not private files',async()=>{
  const dir=await temp();
  try{
    await project(dir);
    assert.equal(call(dir,'setup','--url','http://localhost:8081/').status,0);
    await fs.mkdir(path.join(dir,'dist','assets'),{recursive:true});
    await fs.writeFile(path.join(dir,'dist/index.html'),'<html><title>Test</title></html>');
    await fs.writeFile(path.join(dir,'dist/assets/app.js'),'console.log("test")');
    await fs.writeFile(path.join(dir,'dist/.env'),'DO_NOT_PUBLISH=true');
    const env={...process.env,FD_VERSION:'4.2.2',FD_COMMIT:'build-id-42'};
    const pre=spawnSync(process.execPath,['scripts/freshdeploy-build-meta.mjs'],{cwd:dir,encoding:'utf8',env});
    assert.equal(pre.status,0,pre.stderr);
    const post=spawnSync(process.execPath,['scripts/freshdeploy-after-build.mjs'],{cwd:dir,encoding:'utf8',env});
    assert.equal(post.status,0,post.stderr);
    const manifest=JSON.parse(await fs.readFile(path.join(dir,'dist/.freshdeploy.json'),'utf8'));
    assert.equal(manifest.version,'4.2.2');assert.equal(manifest.commit,'build-id-42');
    assert.deepEqual(manifest.assets.map(x=>x.path),['assets/app.js','index.html']);
    const comparison=await stamp({directory:path.join(dir,'dist'),version:'4.2.2',commit:'build-id-42'});
    assert.deepEqual(manifest.assets,comparison.assets);
    assert.match(await fs.readFile(path.join(dir,'src/freshdeploy/build-meta.js'),'utf8'),/buildVersion = "4\.2\.2"/);
    assert.match(await fs.readFile(path.join(dir,'.gitignore'),'utf8'),/scripts\/\.freshdeploy-build-meta.json/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('SSE sends meaningful changes, stores fresh timestamp and replays newest report on reconnect',async()=>{
  const live=await createLiveServer({port:0,origin:'http://localhost:8081'});
  try{
    const base={schemaVersion:1,kind:'freshdeploy.public-report',status:'warn',generatedAt:'2026-09-25T00:00:00Z',
      version:{version:'1.0.0',commit:'v1'},checks:[{id:'cache',state:'warn',summary:'Cache warning'}],
      assets:{checked:1,passed:1,failed:0,skipped:0,total:1},comparison:null};
    assert.equal(live.publish(base),true);
    assert.equal(live.publish({...base,generatedAt:'2026-09-25T00:00:02Z'}),false);
    assert.equal(reportFingerprint(base),reportFingerprint({...base,generatedAt:'tomorrow'}));
    const modified={...base,status:'fail',generatedAt:'2026-09-25T00:00:04Z',
      checks:[{id:'assets',state:'fail',summary:'Asset mismatch'}]};
    assert.equal(live.publish(modified),true);
    const controller=new AbortController();
    const response=await fetch(live.url,{headers:{Origin:'http://localhost:8081'},signal:controller.signal});
    assert.equal(response.status,200);
    const reader=response.body.getReader();const message=new TextDecoder().decode((await reader.read()).value);
    assert.match(message,/event: report/);assert.match(message,/2026-09-25T00:00:04Z/);
    controller.abort();
  }finally{await live.close();}
});

test('Spanish uses localized texts for every published built-in check, and technical statuses remain unchanged',()=>{
  for(const id of ['http','redirect','cache','manifest','html-integrity','version','assets','content','monitor']){
    const text=translateCheck({id,state:'pass',summary:'Served HTML matches build output.'},'es');
    assert.doesNotMatch(text,/Served HTML|Production returned|Manifest found/);
  }
  assert.equal(translateCheck({id:'assets',state:'fail',summary:'broken'},'en'),'broken');
});

test('official v0.3 trial mount upgrades in place without replacing App.jsx or duplicating imports',async()=>{
  const dir=await temp();
  try{
    await project(dir);
    await fs.writeFile(path.join(dir,'src/App.jsx'),"export default function App(){return 'My app'}\n");
    assert.equal(call(dir,'setup','--url','http://localhost:8081/').status,0);
    const mount=path.join(dir,'src/freshdeploy/mount.js');
    await fs.copyFile(path.resolve('tests/fixtures/v030-trial-mount.js.txt'),mount);
    const previous=await fs.readFile(mount,'utf8');
    assert.doesNotMatch(previous,/serverIntervalSeconds/);
    const result=call(dir,'setup');assert.equal(result.status,0,result.stderr);
    const updated=await fs.readFile(mount,'utf8');
    assert.match(updated,/serverIntervalSeconds/);
    assert.equal(await fs.readFile(path.join(dir,'src/App.jsx'),'utf8'),"export default function App(){return 'My app'}\n");
    const entry=await fs.readFile(path.join(dir,'src/main.jsx'),'utf8');
    assert.equal((entry.match(/freshdeploy\/mount\.js/g)||[]).length,1);
    const script=await fs.readFile(path.join(dir,'scripts/freshdeploy-build-meta.mjs'),'utf8');
    assert.match(script,/scripts\/\.freshdeploy-build-meta.json/);
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});


test('watch --live finds the expected version and report path from config, without long flags', {timeout:12000}, async()=>{
  const dir=await temp();
  const dist=path.join(dir,'dist');await fs.mkdir(dist);
  await fs.writeFile(path.join(dist,'index.html'),'<!doctype html><title>Fast setup</title>');
  await stamp({directory:dist,version:'2.0.0',commit:'local-setup-v2'});
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const target=path.join(dist,new URL(req.url,'http://localhost').pathname==='/'?'index.html':new URL(req.url,'http://localhost').pathname.slice(1));
    try{res.end(await fs.readFile(target));}catch{res.writeHead(404).end('missing');}
  });
  let child;
  try{
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const url=`http://127.0.0.1:${server.address().port}/`;
    await fs.writeFile(path.join(dir,'freshdeploy.config.json'),JSON.stringify({schemaVersion:1,url,buildDir:'dist',monitoring:{serverIntervalSeconds:2}}));
    child=spawn(process.execPath,[bin,'watch','--live','--sse-port','0'],{cwd:dir,stdio:'ignore'});
    const reportFile=path.join(dist,'.freshdeploy-report.json');
    let report;
    for(let i=0;i<45;i++){
      try{report=JSON.parse(await fs.readFile(reportFile,'utf8'));break;}catch{}
      await new Promise(resolve=>setTimeout(resolve,120));
    }
    assert.ok(report,'watch should publish a report without explicit URL/commit/report flags');
    assert.equal(report.status,'pass');assert.equal(report.version.commit,'local-setup-v2');
    assert.equal((await fs.readFile(path.join(dir,'freshdeploy-monitor-private.json'),'utf8')).includes('"checks"'),true);
  }finally{
    child?.kill('SIGTERM');
    if(child)await Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(resolve,1000))]);
    await new Promise(resolve=>server.close(resolve));await fs.rm(dir,{recursive:true,force:true});
  }
});
