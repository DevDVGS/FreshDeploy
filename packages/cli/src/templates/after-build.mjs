/** FreshDeploy-managed postbuild hook. Runs with Node.js; no network or npm subprocess. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const config = JSON.parse(await fs.readFile(path.join(root, 'freshdeploy.config.json'), 'utf8'));
if (!config.buildDir) throw new Error('FreshDeploy: choose a public build directory in freshdeploy.config.json.');
const publicRoot = path.resolve(root, config.buildDir);
const relative = path.relative(root, publicRoot);
if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
  throw new Error('FreshDeploy: refusing to stamp a directory outside the project or the entire project root.');
}
if (!(await fs.stat(publicRoot)).isDirectory()) throw new Error('FreshDeploy: the public build directory does not exist.');
const meta = JSON.parse(await fs.readFile(path.join(root, 'scripts/.freshdeploy-build-meta.json'), 'utf8'));
const accepted = /\.(?:html?|css|m?js|cjs|json|svg|png|jpe?g|webp|gif|avif|ico|woff2?|ttf|eot|wasm|txt|webmanifest)$/i;
const skip = new Set(['.freshdeploy.json', '.env', '.git', 'node_modules', '.next', '.output', '.DS_Store']);
const assets = [];
async function walk(folder) {
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    if (skip.has(entry.name) || entry.name.startsWith('.')) continue;
    const file = path.join(folder, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) { await walk(file); continue; }
    if (!entry.isFile() || !accepted.test(entry.name) || entry.name.endsWith('.map')) continue;
    const data = await fs.readFile(file);
    assets.push({ path: path.relative(publicRoot, file).split(path.sep).join('/'),
      sha256: createHash('sha256').update(data).digest('hex'), size: data.length });
  }
}
await walk(publicRoot);
assets.sort((a,b)=>a.path.localeCompare(b.path));
const manifest = { schemaVersion: 1, version: String(meta.version), commit: String(meta.commit),
  createdAt: new Date().toISOString(), assets };
await fs.writeFile(path.join(publicRoot,'.freshdeploy.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(`FreshDeploy: ${config.buildDir}/.freshdeploy.json ready (${assets.length} public assets, ${manifest.version}).`);
