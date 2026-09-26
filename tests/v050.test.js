import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { stamp } from '../packages/core/src/index.js';

const temp = () => fs.mkdtemp(path.join(os.tmpdir(), 'freshdeploy-release-'));
const waitFor = async (fn, timeoutMs = 8000) => {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await fn()) return;
    await new Promise(resolve => setTimeout(resolve, 70));
  }
  throw new Error('Timed out waiting for monitor output.');
};

test('packed npm CLI installs offline as a single package and detects all five project types', { timeout: 45000 }, async () => {
  const dir = await temp();
  const source = path.resolve('packages');
  const npmCandidates = [process.env.npm_execpath,
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    path.resolve(path.dirname(process.execPath), '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')].filter(Boolean);
  const npmCli = await (async () => {for (const candidate of npmCandidates) {try {await fs.access(candidate);return candidate;} catch {}} throw new Error('npm-cli.js not found; run tests with npm test or provide npm_execpath.');})();
  const npmRun = (args, cwd) => spawnSync(process.execPath, [npmCli, ...args], {cwd, encoding: 'utf8'});
  const tempRoot = path.join(dir, 'source');
  let result;
  try {
    for (const name of ['cli', 'core', 'adapters', 'widget']) {
      const sourcePath = path.join(source, name);
      const destination = path.join(tempRoot, 'packages', name);
      if (name === 'cli') await fs.cp(sourcePath, destination, { recursive: true, filter: f => !f.includes(`${path.sep}vendor${path.sep}`) && !f.endsWith(`${path.sep}vendor`) });
      else await fs.cp(sourcePath, destination, { recursive: true });
    }
    await fs.copyFile('LICENSE', path.join(tempRoot, 'LICENSE'));
    await fs.cp('docs', path.join(tempRoot, 'docs'), { recursive: true });
    result = npmRun(['pack', '--json', '--pack-destination', dir], path.join(tempRoot,'packages/cli'));
    assert.equal(result.status, 0, result.stderr + result.stdout);
    const packed = JSON.parse(result.stdout)[0];
    assert.equal(packed.name,'@devdags/freshdeploy');
    assert.equal(packed.version,'0.5.0-beta.1');
    for (const required of ['vendor/core/index.js','vendor/adapters/index.js','vendor/widget/index.js','LICENSE','docs/integration.md']) {
      assert.ok(packed.files.some(x=>x.path===required), `${required} must ship in the npm tarball`);
    }
    const tarball=path.join(dir,packed.filename);
    const consumer=path.join(dir,'consumer');await fs.mkdir(consumer);
    await fs.writeFile(path.join(consumer,'package.json'),JSON.stringify({name:'fd-consumer',version:'1.0.0',private:true,type:'module'}));
    result=npmRun(['install','--offline','--ignore-scripts','--no-audit','--no-fund',tarball],consumer);
    assert.equal(result.status,0,result.stderr);
    const installed=JSON.parse(await fs.readFile(path.join(consumer,'node_modules/@devdags/freshdeploy/package.json'),'utf8'));
    assert.deepEqual(installed.dependencies??{},{});
    const cli=path.join(consumer,'node_modules/@devdags/freshdeploy/bin/freshdeploy.js');
    for(const [dependencies,marker,expected] of [
      [{react:'19',vite:'8'},null,'react-vite'],
      [{vue:'3',vite:'8'},null,'vue-vite'],
      [{next:'15',react:'19'},null,'nextjs'],
      [{'@angular/core':'20'},'angular.json','angular'],
      [{},'index.php','html-php']
    ]){
      const project=path.join(dir,`project-${expected}`);await fs.mkdir(project);
      await fs.writeFile(path.join(project,'package.json'),JSON.stringify({name:`project-${expected}`,version:'1.0.0',type:'module',dependencies,scripts:{build:'echo user-build'}}));
      if(marker)await fs.writeFile(path.join(project,marker),marker.endsWith('.json')?'{}':'<?php');
      if(['react-vite','vue-vite'].includes(expected)){
        await fs.mkdir(path.join(project,'src'));
        await fs.writeFile(path.join(project,'src/main.jsx'),'// Existing application entry\n');
      }
      result=spawnSync(process.execPath,[cli,'detect'],{cwd:project,encoding:'utf8'});
      assert.equal(result.status,0,result.stderr);
      assert.equal(JSON.parse(result.stdout).framework,expected);
      result=spawnSync(process.execPath,[cli,'setup','--url','http://localhost:8081/'],{cwd:project,encoding:'utf8'});
      assert.equal(result.status,0,result.stderr);
      const after=await fs.readFile(path.join(project,'package.json'),'utf8');
      const config=JSON.parse(await fs.readFile(path.join(project,'freshdeploy.config.json'),'utf8'));
      assert.equal(config.framework,expected);
      if(['react-vite','vue-vite'].includes(expected)){
        assert.match(after,/freshdeploy-after-build/);
        assert.match(await fs.readFile(path.join(project,'src/main.jsx'),'utf8'),/freshdeploy\/mount\.js/);
        assert.ok((await fs.stat(path.join(project,'src/freshdeploy/index.js'))).size>100);
      }else{
        assert.doesNotMatch(after,/freshdeploy-after-build/);
      }
    }
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('live monitor prints only status changes while its public report stays fresh', {timeout:14000}, async () => {
  const dir=await temp();
  const dist=path.join(dir,'dist');await fs.mkdir(dist);
  const original='console.log("original")';
  await fs.writeFile(path.join(dist,'index.html'),'<!doctype html><script src="app.js"></script>');
  await fs.writeFile(path.join(dist,'app.js'),original);
  await stamp({directory:dist,version:'1.0.0',commit:'smoke-commit'});
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');
    const target=new URL(req.url,'http://localhost').pathname;
    const file=path.join(dist,target==='/'?'index.html':target.slice(1));
    try{res.end(await fs.readFile(file));}catch{res.writeHead(404).end('missing');}
  });
  let child;
  try{
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const url=`http://127.0.0.1:${server.address().port}/`;
    await fs.writeFile(path.join(dir,'freshdeploy.config.json'),JSON.stringify({schemaVersion:1,url,buildDir:'dist',monitoring:{serverIntervalSeconds:1}}));
    child=spawn(process.execPath,[path.resolve('packages/cli/bin/freshdeploy.js'),'watch','--sse-port','0'],{cwd:dir,stdio:['ignore','pipe','pipe']});
    let output='',errors='';
    child.stdout.on('data',v=>output+=v.toString());
    child.stderr.on('data',v=>errors+=v.toString());
    await waitFor(()=>/PASS · 1\.0\.0 · 2\/2 assets/.test(output));
    await new Promise(resolve=>setTimeout(resolve,1150));
    assert.equal((output.match(/PASS · 1\.0\.0/g)||[]).length,1,`repeated unchanged result: ${output}`);
    await fs.writeFile(path.join(dist,'app.js'),'console.log("tampered")');
    await waitFor(()=>/FAIL · 1\.0\.0 · 1\/2 assets/.test(output));
    await fs.writeFile(path.join(dist,'app.js'),original);
    await waitFor(()=>/integrity restored/.test(output));
    assert.equal((output.match(/PASS · 1\.0\.0/g)||[]).length,2,output);
    assert.doesNotMatch(output,/Checked 2\/2 resources|Production returned HTTP 200/);
    assert.equal(errors,'');
    const report=JSON.parse(await fs.readFile(path.join(dist,'.freshdeploy-report.json'),'utf8'));
    assert.equal(report.status,'pass');
  }finally{
    child?.kill('SIGTERM');
    if(child)await Promise.race([once(child,'exit'),new Promise(resolve=>setTimeout(resolve,1000))]);
    await new Promise(resolve=>server.close(resolve));
    await fs.rm(dir,{recursive:true,force:true});
  }
});
