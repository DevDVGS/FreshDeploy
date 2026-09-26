import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createLiveServer } from '../packages/cli/src/sse.js';
import { normalizeLanguage, translate, translateMessage, translateCheck } from '../packages/widget/src/i18n.js';
const bin=path.resolve('packages/cli/bin/freshdeploy.js');
const tmp=()=>fs.mkdtemp(path.join(os.tmpdir(),'freshdeploy-setup-'));
const call=(cwd,...args)=>spawnSync(process.execPath,[bin,...args],{cwd,encoding:'utf8'});

test('setup integrates a React/Vite entry with backup, prebuild metadata, language and no overwrite',async()=>{
 const dir=await tmp();
 try {
  await fs.mkdir(path.join(dir,'src'));await fs.writeFile(path.join(dir,'src/main.jsx'),"import React from 'react';\n");
  await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({version:'1.2.3',scripts:{build:'vite build',prebuild:'echo existing'},dependencies:{react:'19'}}));
  const result=call(dir,'setup','--url','https://example.com/','--language','es');
  assert.equal(result.status,0,result.stderr);
  const cfg=JSON.parse(await fs.readFile(path.join(dir,'freshdeploy.config.json'),'utf8'));
  assert.equal(cfg.framework,'react-vite');assert.equal(cfg.widget.enabled,true);assert.equal(cfg.language,'es');
  assert.equal(cfg.monitoring.serverIntervalSeconds,30);
  assert.match(await fs.readFile(path.join(dir,'src/main.jsx'),'utf8'),/freshdeploy\/mount\.js/);
  assert.equal(await fs.readFile(path.join(dir,'src/main.jsx.freshdeploy.bak'),'utf8'),"import React from 'react';\n");
  const pkg=JSON.parse(await fs.readFile(path.join(dir,'package.json'),'utf8'));
  assert.match(pkg.scripts.prebuild,/echo existing && node scripts\/freshdeploy-build-meta.mjs/);
  assert.match(await fs.readFile(path.join(dir,'src/freshdeploy/mount.js'),'utf8'),/buildSettings/);
  const b=call(dir,'settings','--profile','local','--language','en','--mode','polling');
  assert.equal(b.status,0,b.stderr);
  const meta=spawnSync(process.execPath,['scripts/freshdeploy-build-meta.mjs'],{cwd:dir,encoding:'utf8',env:{...process.env,FD_VERSION:'2.0.0',FD_COMMIT:'testing'}});
  assert.equal(meta.status,0,meta.stderr);
  const file=await fs.readFile(path.join(dir,'src/freshdeploy/build-meta.js'),'utf8');
  assert.match(file,/buildVersion = "2\.0\.0"/);assert.match(file,/buildCommit = "testing"/);
  assert.match(file,/"language":"en"/);assert.match(file,/"widgetIntervalSeconds":1/);
  const again=call(dir,'setup','--url','https://example.com/');assert.equal(again.status,0,again.stderr);
  assert.equal((await fs.readFile(path.join(dir,'src/main.jsx'),'utf8')).match(/freshdeploy\/mount\.js/g).length,1);
 } finally {await fs.rm(dir,{recursive:true,force:true});}
});

test('setup supports Vue/Vite without changing the application logic',async()=>{
 const dir=await tmp();try{
  await fs.mkdir(path.join(dir,'src'));
  await fs.writeFile(path.join(dir,'src/main.ts'),"import { createApp } from 'vue';\n");
  await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({version:'1.0.0',scripts:{build:'vite build'},dependencies:{vue:'3'}}));
  const res=call(dir,'setup','--url','https://example.com');assert.equal(res.status,0,res.stderr);
  assert.match(await fs.readFile(path.join(dir,'src/main.ts'),'utf8'),/freshdeploy\/mount\.js/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('settings validate intervals and never overwrite custom entry point',async()=>{
 const dir=await tmp();try{
  await fs.writeFile(path.join(dir,'package.json'),JSON.stringify({scripts:{},version:'1.0.0'}));
  assert.equal(call(dir,'init','--url','https://example.com').status,0);
  const fail=call(dir,'settings','--interval','0');assert.equal(fail.status,2);
  assert.equal(call(dir,'settings','--profile','local','--interval','2','--widget-interval','1','--language','es').status,0);
  const config=JSON.parse(await fs.readFile(path.join(dir,'freshdeploy.config.json'),'utf8'));
  assert.equal(config.monitoring.serverIntervalSeconds,2);assert.equal(config.monitoring.widgetIntervalSeconds,1);assert.equal(config.language,'es');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('English and Spanish dictionaries do not modify technical result states',()=>{
 assert.equal(normalizeLanguage('fr'),'en');assert.equal(translate('published','es'),'Versión publicada');
 assert.equal(translate('deployment failed','es'),'fallo en despliegue');
 assert.match(translateCheck({id:'assets',state:'fail',summary:'broken resource'},'es'),/Integridad de archivos/);
 assert.match(translateMessage('The post-deployment check found a failure. Review the checks below.','es'),/error/);
});

test('SSE requires exact browser origin, exposes only supplied public data and replays latest report',async()=>{
 const live=await createLiveServer({port:0,origin:'http://localhost:8081'});
 try {
  const denied=await fetch(live.url,{headers:{Origin:'http://other.example'}});assert.equal(denied.status,403);
  const wrong=await fetch(live.url.replace('/events','/private'),{headers:{Origin:'http://localhost:8081'}});assert.equal(wrong.status,404);
  const sample={kind:'freshdeploy.public-report',status:'warn',version:{version:'1.0.0',commit:'a'},checks:[],assets:{total:0,checked:0,passed:0,failed:0,skipped:0},generatedAt:'2026-09-25T00:00:00Z'};
  live.publish(sample);
  const controller=new AbortController();
  const ok=await fetch(live.url,{headers:{Origin:'http://localhost:8081'},signal:controller.signal});
  assert.equal(ok.status,200);assert.equal(ok.headers.get('access-control-allow-origin'),'http://localhost:8081');
  const reader=ok.body.getReader();const data=new TextDecoder().decode((await reader.read()).value);
  assert.match(data,/event: report/);assert.match(data,/"status":"warn"/);controller.abort();
 }finally{await live.close();}
});

test('SSE push updates open widget; a disconnect resumes polling; EN/ES settings persist',async()=>{
 const {mountFreshDeploy}=await import('../packages/widget/src/index.js');
 const old=Object.fromEntries(['document','location','fetch','EventSource','localStorage','window','setTimeout','clearTimeout'].map(key=>[key,globalThis[key]]));
 const el=()=>({textContent:'',innerHTML:'',value:'',hidden:true,className:'',events:{},attrs:{},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,f){this.events[k]=f;}});
 const keys=['.pill','.panel','.dot','.text','.body','.close','.retry','.title','.footer','.language-label','.interval-label','.server-label','.apply','.back','.settings-button','.settings-pane','.lang-select','.interval-input','.profile-select','.profile-label','.profile-note'];
 const elements=new Map(keys.map(k=>[k,el()]));const host={setAttribute(){},attachShadow(){return {innerHTML:'',querySelector(sel){return elements.get(sel);}};},remove(){}};
 const page=new URL('http://localhost:8081/');let delay=0, timer=null,source=null,readReport={
  schemaVersion:1,kind:'freshdeploy.public-report',status:'warn',generatedAt:new Date().toISOString(),
  version:{version:'1.0.3',commit:'local-v4'},checks:[
   {id:'http',state:'pass',summary:'Production returned HTTP 200.'},
   {id:'cache',state:'warn',summary:'HTML caching policy needs review.'},
   {id:'manifest',state:'pass',summary:'Manifest found.'},
   {id:'version',state:'pass',summary:'Published version matches expected identifier.'},
   {id:'assets',state:'pass',summary:'2/2 assets verified.'}],
  assets:{total:2,checked:2,passed:2,failed:0,skipped:0},comparison:null};
 class FakeEventSource{
  constructor(url){this.url=url;this.events={};source=this;}
  addEventListener(name,cb){this.events[name]=cb;}
  close(){this.closed=true;}
  emit(name,data){this.events[name]?.(data===undefined?{}:{data:JSON.stringify(data)});}
 }
 let stored=null;
 try{
  globalThis.EventSource=FakeEventSource;globalThis.location=page;
  globalThis.window={addEventListener(){},removeEventListener(){}};
  globalThis.document={hidden:false,body:{append(){}},createElement(){return host;},querySelector(){return null;},addEventListener(){},removeEventListener(){}};
  globalThis.localStorage={getItem(){return stored;},setItem(k,v){stored=v;}};
  globalThis.setTimeout=(cb,ms)=>{timer=cb;delay=ms;return 7;};globalThis.clearTimeout=()=>{timer=null;};
  globalThis.fetch=async url=>({ok:true,json:async()=>new URL(String(url)).pathname.includes('report.json')?readReport:{schemaVersion:1,version:'1.0.3',commit:'local-v4'}});
  const widget=mountFreshDeploy({target:globalThis.document.body,expectedCommit:'local-v4',sseUrl:'http://127.0.0.1:4318/events',pollIntervalMs:2000});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(elements.get('.text').textContent,'deployment warning');
  elements.get('.panel').hidden=false;
  source.emit('open');assert.equal(delay,60000);
  readReport={...readReport,status:'fail',checks:readReport.checks.map(x=>x.id==='assets'?{...x,state:'fail',summary:'1 asset failed.'}:x),assets:{...readReport.assets,passed:1,failed:1}};
  source.emit('report',readReport);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(elements.get('.text').textContent,'deployment failed');assert.equal(elements.get('.panel').hidden,false);
  source.emit('error');assert.equal(delay,2000);
  elements.get('.settings-button').events.click();
  elements.get('.profile-select').value='production';elements.get('.profile-select').events.change();
  assert.equal(elements.get('.interval-input').value,'10');
  elements.get('.profile-select').value='local';elements.get('.profile-select').events.change();
  assert.equal(elements.get('.interval-input').value,'1');elements.get('.lang-select').value='es';elements.get('.interval-input').value='1';
  elements.get('.apply').events.click();assert.equal(elements.get('.text').textContent,'fallo en despliegue');
  assert.equal(JSON.parse(stored).pollIntervalMs,1000);assert.equal(elements.get('.panel').hidden,false);
  assert.equal(delay,1000);widget.destroy();assert.equal(source.closed,true);
 }finally{for(const [k,v] of Object.entries(old)){if(v===undefined)delete globalThis[k];else globalThis[k]=v;}}
});
