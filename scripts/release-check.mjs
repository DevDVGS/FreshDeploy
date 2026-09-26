/** Local pre-publish hygiene check. This is a guardrail, not a secret scanner. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('..', import.meta.url));
const required = ['LICENSE','README.md','CHANGELOG.md','CONTRIBUTING.md','.gitignore', '.github/workflows/ci.yml', 'docs/security.md', 'packages/cli/package.json'];
for (const file of required) {
  const item = path.join(root,file);
  if (!(await fs.stat(item).catch(()=>null))?.isFile()) throw new Error(`Missing release file: ${file}`);
}
const pkg = JSON.parse(await fs.readFile(path.join(root,'packages/cli/package.json'),'utf8'));
if (pkg.private || pkg.license !== 'MIT' || pkg.publishConfig?.access !== 'public') throw new Error('Package metadata needs review.');
if (pkg.dependencies && Object.keys(pkg.dependencies).length) throw new Error('CLI no longer self-contained.');
let tracked=[];
try {
  execFileSync('git',['rev-parse','--show-toplevel'],{cwd:root,stdio:'pipe'});
  tracked=execFileSync('git',['ls-files','-z'],{cwd:root}).toString().split('\0').filter(Boolean);
} catch { /* Source ZIP without a .git directory: checks above still apply. */ }
const excluded = /(^|\/)(node_modules|dist|build|coverage|vendor)(\/|$)|(^|\/)\.env(?:\.|$)|(^|\/)\.npmrc$|(^|\/)\.freshdeploy(?:-report)?\.json$|(^|\/)freshdeploy(?:-monitor-private|-private[^/]*)?-(?:report|private)[^/]*\.json$|(^|\/)freshdeploy\.config\.json$|\.freshdeploy\.bak$|\.(?:zip|tgz)$/i;
const intentionalPreview = new Set(['preview/.freshdeploy.json','preview/.freshdeploy-report.json']);
const prohibited = tracked.filter(x => !intentionalPreview.has(x) && excluded.test(x));
if (prohibited.length) throw new Error(`Review tracked private/generated files: ${prohibited.join(', ')}`);
console.log(`Release preflight OK · ${pkg.name}@${pkg.version} · ${tracked.length?`${tracked.length} tracked files checked`:'source archive (no Git index)'}`);
console.log('Scope ownership and actual publishing must be confirmed separately.');
