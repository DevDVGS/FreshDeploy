import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { stamp, inspect, compareManifests, parseHtmlResources, assessHtmlCache, validateManifest } from '../packages/core/src/index.js';
import { detectProject } from '../packages/adapters/src/index.js';
const temp = async () => fs.mkdtemp(path.join(os.tmpdir(), 'freshdeploy-'));

async function server(routes) {
  const srv = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = routes[url.pathname];
    if (!route) { res.writeHead(404).end('Not found'); return; }
    const { body, status = 200, headers = {} } = route;
    res.writeHead(status, headers).end(body);
  });
  srv.listen(0, '127.0.0.1');
  await once(srv, 'listening');
  return { url: `http://127.0.0.1:${srv.address().port}/`, close: () => new Promise(resolve => srv.close(resolve)) };
}

test('stamping writes a valid deterministic public-only manifest', async () => {
  const folder = await temp();
  await fs.writeFile(path.join(folder, 'index.html'), '<h1>Hello</h1>');
  await fs.writeFile(path.join(folder, 'app.js'), 'console.log(1)');
  await fs.writeFile(path.join(folder, 'secrets.php'), 'private');
  await fs.writeFile(path.join(folder, '.env'), 'SECRET=yes');
  // Windows may deny symlink creation without Developer Mode or elevation.
  // Continue testing exclusion of sensitive files, and also check the link
  // when the operating system allows creating it.
  try {
    await fs.symlink(path.join(folder, '.env'), path.join(folder, 'link.js'));
  } catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(error.code)) {
      throw error;
    }
  }
  const result = await stamp({ directory: folder, version: '1.2.0', commit: 'abcd1234', now: new Date('2026-09-25T00:00:00Z') });
  assert.equal(result.createdAt, '2026-09-25T00:00:00.000Z');
  assert.deepEqual(result.assets.map(a => a.path), ['app.js', 'index.html']);
  assert.equal(validateManifest(result), true);
  const written = JSON.parse(await fs.readFile(path.join(folder, '.freshdeploy.json'), 'utf8'));
  assert.deepEqual(written, result);
  await fs.rm(folder, { recursive: true, force: true });
});

test('five adapters detect framework and sensible stamp target', async () => {
  for (const [deps, file, expected] of [
    [{ react: '^19', vite: '^7' }, null, 'react-vite'],
    [{ next: '^15', react: '^19' }, null, 'nextjs'],
    [{ vue: '^3' }, null, 'vue-vite'],
    [{ '@angular/core': '^20' }, null, 'angular'],
    [{}, 'index.php', 'html-php']
  ]) {
    const folder = await temp();
    await fs.writeFile(path.join(folder, 'package.json'), JSON.stringify({ dependencies: deps }));
    if (file) await fs.writeFile(path.join(folder, file), '<?php');
    assert.equal(detectProject(folder).framework, expected);
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('manifest comparison classifies added, modified and deleted files', () => {
  const before = { assets: [{path:'a.js',sha256:'1'}, {path:'gone.css',sha256:'2'}] };
  const after = { assets: [{path:'a.js',sha256:'3'}, {path:'new.css',sha256:'4'}] };
  assert.deepEqual(compareManifests(before, after), {added:['new.css'],changed:['a.js'],removed:['gone.css']});
});

test('same-origin HTML resources are recognized; external URLs are excluded', () => {
  const items = parseHtmlResources('<script src="/app.js"></script><link href="style.css"><img src="https://cdn.example.com/x.png"><img srcset="x.webp 1x, y.webp 2x">', new URL('https://site.test/app/'));
  assert.deepEqual(items, ['https://site.test/app.js', 'https://site.test/app/style.css', 'https://site.test/app/x.webp', 'https://site.test/app/y.webp']);
});

test('HTML cache evaluation flags long-lived and absent policies', () => {
  assert.equal(assessHtmlCache(new Headers({'cache-control':'public, max-age=3600'})).state, 'warn');
  assert.equal(assessHtmlCache(new Headers({'cache-control':'no-cache'})).state, 'pass');
  assert.equal(assessHtmlCache(new Headers({'cache-control':'max-age=0, s-maxage=3600'})).state, 'warn');
  assert.equal(assessHtmlCache(new Headers()).state, 'warn');
});

test('post-deploy inspection verifies version and SHA-256 asset integrity', async () => {
  const folder = await temp();
  const html = '<!doctype html><script src="app.js"></script><p>$50</p>';
  await fs.writeFile(path.join(folder, 'index.html'), html);
  await fs.writeFile(path.join(folder, 'app.js'), 'console.log("ok")');
  const manifest = await stamp({directory:folder, version:'1.1.0', commit:'a'.repeat(40)});
  const routes = {
    '/': {body:html,headers:{'cache-control':'no-cache'}},
    '/index.html': {body:html},
    '/app.js': {body:'console.log("ok")'},
    '/.freshdeploy.json': {body:JSON.stringify(manifest)}
  };
  const host = await server(routes);
  try {
    const result = await inspect({url:host.url,expected:'a'.repeat(40),expectedContent:'$50',maxAssets:25,previous:manifest});
    assert.equal(result.status, 'pass', JSON.stringify(result.checks));
    assert.equal(result.assets.checked, 2);
    assert.deepEqual(result.comparison, {added:[],changed:[],removed:[]});
    routes['/'] = {body:'<h1>stale cached HTML</h1>',headers:{'cache-control':'no-cache'}};
    const stale = await inspect({url:host.url,expected:'a'.repeat(40)});
    assert.equal(stale.checks.find(x=>x.id==='html-integrity').state,'fail');
    routes['/'] = {body:html,headers:{'cache-control':'no-cache'}};
    routes['/app.js'] = {body:'console.log("changed")'};
    const broken = await inspect({url:host.url,expected:'b'.repeat(40)});
    assert.equal(broken.status,'fail');
    assert.equal(broken.checks.find(x=>x.id==='version').state,'fail');
    assert.equal(broken.checks.find(x=>x.id==='assets').state,'fail');
    routes['/app.js'] = {body:'console.log("ok")'};
    const partial = await inspect({url:host.url,expected:'a'.repeat(40),maxAssets:1});
    assert.equal(partial.status,'warn');
    assert.equal(partial.assets.skipped,1);
  } finally { await host.close(); await fs.rm(folder,{recursive:true,force:true}); }
});

test('missing manifest cannot be reported as verified', async () => {
  const host = await server({'/': {body:'<h1>working</h1>',headers:{'cache-control':'no-cache'}}});
  try {
    const report = await inspect({url:host.url,expected:'a'.repeat(40)});
    assert.equal(report.status,'warn');
    assert.equal(report.checks.find(c=>c.id==='version').state,'warn');
  } finally { await host.close(); }
});

test('init creates a valid config and inactive workflow example, and refuses silent overwrite', async () => {
  const cwd = await temp();
  const bin = path.resolve('packages/cli/bin/freshdeploy.js');
  await fs.writeFile(path.join(cwd,'package.json'),JSON.stringify({dependencies:{react:'19'}}));
  const created = spawnSync(process.execPath,[bin,'init','--url','https://example.com/'],{cwd,encoding:'utf8'});
  assert.equal(created.status,0,created.stderr);
  const config = JSON.parse(await fs.readFile(path.join(cwd,'freshdeploy.config.json'),'utf8'));
  assert.equal(config.framework,'react-vite');
  const yaml = await fs.readFile(path.join(cwd,'docs/freshdeploy-workflow.example.yml'),'utf8');
  assert.match(yaml,/deployment_status:/);
  assert.match(yaml,/FD_EXPECTED: \$\{\{ github\.event\.deployment\.sha \}\}/);
  const again = spawnSync(process.execPath,[bin,'init'],{cwd,encoding:'utf8'});
  assert.equal(again.status,2);
  await fs.rm(cwd,{recursive:true,force:true});
});
