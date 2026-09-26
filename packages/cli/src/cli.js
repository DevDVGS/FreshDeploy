import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { createLiveServer, reportFingerprint } from './sse.js';
// In the repository, use the sibling source. The public npm tarball includes
// those same modules in vendor/ so the CLI needs no separately published deps.
async function loadWorkspacePackage(packageName, bundledPath, sourcePath) {
  const sourceFile = fileURLToPath(new URL(sourcePath, import.meta.url));
  if (fsSync.existsSync(sourceFile)) return import(sourcePath);
  const bundledFile = fileURLToPath(new URL(bundledPath, import.meta.url));
  if (fsSync.existsSync(bundledFile)) return import(bundledPath);
  throw new Error(`${packageName} is missing from the FreshDeploy installation; reinstall the package.`);
}

const { inspect, stamp, MANIFEST, toPublicReport } = await loadWorkspacePackage(
  '@devdags/freshdeploy-core', '../vendor/core/index.js', '../../core/src/index.js'
);
const { detectProject } = await loadWorkspacePackage(
  '@devdags/freshdeploy-adapters', '../vendor/adapters/index.js', '../../adapters/src/index.js'
);
const { translate: translateText, translateCheck: translateCheckText } = await loadWorkspacePackage(
  '@devdags/freshdeploy-widget/i18n', '../vendor/widget/i18n.js', '../../widget/src/i18n.js'
);

const PACKAGE_VERSION = JSON.parse(await fs.readFile(new URL('../package.json', import.meta.url), 'utf8')).version;
const CONFIG = 'freshdeploy.config.json';
const HELP = `freshdeploy ${PACKAGE_VERSION} — deployment verification

  freshdeploy setup [--url https://example.com] [--profile local|production] [--language en|es]
  freshdeploy init [--url https://example.com]
  freshdeploy stamp [--out dist] [--version 1.0.0] [--commit SHA]
  freshdeploy check [--url URL] [--expected VERSION_OR_SHA]
                    [--expected-content TEXT] [--previous FILE]
                    [--max-assets 25] [--json] [--report FILE]
                    [--public-report FILE]
  freshdeploy watch [--live] [--interval 30] [--sse-port 4318] [--sse-origin URL]
  freshdeploy settings [--profile local|production|custom] [--interval N]
                       [--widget-interval N] [--language en|es] [--mode auto|polling|sse] [--sse-url URL]
  freshdeploy detect

Setup can be rerun safely; npm run build stamps supported Vite projects automatically.
Exit: 0 verified, 1 warning/failure, 2 usage/runtime error.
The manifest must be generated BEFORE deployment; check runs AFTER deployment.`;

function options(args) {
  const result = { _: [] };
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith('--')) { result._.push(args[i]); continue; }
    const key = args[i].slice(2);
    if (!['url', 'out', 'version', 'commit', 'expected', 'expected-content', 'previous', 'max-assets', 'report', 'public-report', 'interval', 'widget-interval', 'profile', 'language', 'mode', 'sse-url', 'sse-port', 'sse-origin', 'json', 'force', 'live', 'no-widget', 'help'].includes(key)) throw new Error(`Unknown option: --${key}`);
    result[key] = ['json', 'force', 'live', 'no-widget', 'help'].includes(key) ? true : args[++i];
    if (result[key] === undefined) throw new Error(`Missing value for --${key}`);
  }
  return result;
}
function gitCommit() {
  try { return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return 'unknown'; }
}
async function readConfig() {
  try { return JSON.parse(await fs.readFile(CONFIG, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return {}; throw new Error(`Invalid ${CONFIG}: ${e.message}`); }
}
function checkUrl(raw) {
  if (!raw) return null;
  const parsed = new URL(raw);
  if (!['https:', 'http:'].includes(parsed.protocol)) throw new Error('Production URL must use HTTP or HTTPS.');
  return parsed.href;
}
function workflow() {
  // Example only: deliberately outside .github/workflows until the user connects their deployment.
  return [
    '# Runs only if the hosting provider publishes a GitHub deployment_status event.',
    '# Otherwise connect the check step to your actual deploy workflow (docs/integration.md).',
    'name: FreshDeploy post-deploy',
    'on:',
    '  deployment_status:',
    'permissions:',
    '  contents: read',
    'jobs:',
    '  verify:',
    "    if: github.event.deployment_status.state == 'success'",
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: actions/setup-node@v4',
    '        with:',
    "          node-version: '22'",
    '      - name: Verify deployed version',
    '        env:',
    '          FD_URL: ${{ github.event.deployment_status.environment_url }}',
    '          FD_EXPECTED: ${{ github.event.deployment.sha }}',
    '        run: |',
    `          npm exec --yes --package=@devdags/freshdeploy@${PACKAGE_VERSION} -- freshdeploy check --expected "$FD_EXPECTED" --report freshdeploy-report.json`,
    '      - uses: actions/upload-artifact@v4',
    '        if: always()',
    '        with:',
    '          name: freshdeploy-report',
    '          path: freshdeploy-report.json',
    '          if-no-files-found: ignore',
    ''
  ].join('\n');
}
async function init(args, { quiet = false } = {}) {
  const cwd = process.cwd();
  const found = detectProject(cwd);
  let url = args.url || process.env.FD_URL || null;
  if (!url && stdin.isTTY && stdout.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    try { url = (await rl.question('Production URL (press Enter to configure later): ')).trim() || null; }
    finally { rl.close(); }
  }
  url = checkUrl(url);
  if(args.language && !['en','es'].includes(args.language))throw new Error('Language must be en or es.');
  const config = { schemaVersion: 1, framework: found.framework, url, buildDir: found.buildDir, maxAssets: 25,
    language: args.language || 'en', monitoring: { mode: 'auto', profile: 'production', serverIntervalSeconds: 30, widgetIntervalSeconds: 10, sseUrl: null },
    widget: { enabled: false } };
  const configPath = path.resolve(CONFIG);
  if (fsSync.existsSync(configPath) && !args.force) throw new Error(`${CONFIG} already exists. Use --force to replace it.`);
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { flag: args.force ? 'w' : 'wx' });
  const workflowFile = path.resolve('docs/freshdeploy-workflow.example.yml');
  await fs.mkdir(path.dirname(workflowFile), { recursive: true });
  if (!fsSync.existsSync(workflowFile)) await fs.writeFile(workflowFile, workflow());
  if (!quiet) console.log(`FreshDeploy initialized — ${found.framework}\n  Config: ${CONFIG}\n  Workflow example: docs/freshdeploy-workflow.example.yml\n  Build directory: ${found.buildDir || 'configure explicitly'}\nNext: build, deploy, then run freshdeploy check. See freshdeploy --help.`);
}
function widgetSourceDir() {
  const source = fileURLToPath(new URL('../../widget/src/index.js', import.meta.url));
  if (fsSync.existsSync(source)) return path.dirname(source);
  const bundled = fileURLToPath(new URL('../vendor/widget/index.js', import.meta.url));
  if (fsSync.existsSync(bundled)) return path.dirname(bundled);
  throw new Error('Bundled widget is missing. Reinstall FreshDeploy.');
}
const shaFile = async filename => createHash('sha256').update(await fs.readFile(filename)).digest('hex');
const MANAGED_FILE = 'src/freshdeploy/.managed.json';
const LEGACY_WIDGET_HASHES = {
  // Known official 0.3.0 files, used to migrate the earlier zip installation
  // without overwriting an edited file. Other files are left untouched.
  'index.js': '3206938a511e70c4e0fa80002f437c2af258b7830171f3b743e406de960259f4',
  'state.js': '404357a8ab243eb19f879c3dd449f7bda02d5db638447e1cd6029ee63afd9f7a',
  'i18n.js': '8d369c01cc522b09f21dad977e05bf4cd0ca49f79e2abd1e83f1cd9748f0f0a8'
};
async function installManagedWidget(sourceDir) {
  const source=widgetSourceDir();
  const registry=await fs.readFile(MANAGED_FILE,'utf8').then(JSON.parse).catch(()=>({}));
  let installed=0,protectedFiles=[];
  for(const name of ['index.js','state.js','i18n.js']) {
    const upstream=path.join(source,name),dest=path.join(sourceDir,name);
    const upstreamHash=await shaFile(upstream);
    if (!fsSync.existsSync(dest)) {
      await fs.copyFile(upstream,dest);installed++;registry[name]=upstreamHash;continue;
    }
    const currentHash=await shaFile(dest);
    if(currentHash===upstreamHash){registry[name]=upstreamHash;continue;}
    if(currentHash===registry[name] || currentHash===LEGACY_WIDGET_HASHES[name]){
      await fs.copyFile(upstream,dest);installed++;registry[name]=upstreamHash;continue;
    }
    protectedFiles.push(name);
  }
  await fs.writeFile(MANAGED_FILE,JSON.stringify(registry,null,2)+'\n');
  return {installed,protectedFiles};
}
async function setup(args) {
  // Repeatable by design: setup never clears a previous configuration, entry,
  // custom postbuild hook or user-edited widget source files.
  if (!fsSync.existsSync(CONFIG)) await init(args, { quiet: true });
  const config=await readConfig();
  if (!config.schemaVersion) throw new Error(`${CONFIG} needs schemaVersion; check it before setup.`);
  if(args.url!==undefined)config.url=checkUrl(args.url);
  if(args.language!==undefined){if(!['en','es'].includes(args.language))throw new Error('Language must be en or es.');config.language=args.language;}
  if(args.profile!==undefined){
    if(!['local','production','custom'].includes(args.profile))throw new Error('Setup profile must be local, production or custom.');
    const selected=args.profile==='local'?{serverIntervalSeconds:2,widgetIntervalSeconds:1}:args.profile==='production'?{serverIntervalSeconds:30,widgetIntervalSeconds:10}:{};
    config.monitoring={...config.monitoring,...selected,profile:args.profile};
  }
  config.monitoring??={};
  if(args.interval!==undefined)config.monitoring.serverIntervalSeconds=intSeconds(args.interval,'Server interval');
  if(args['widget-interval']!==undefined)config.monitoring.widgetIntervalSeconds=intSeconds(args['widget-interval'],'Widget interval');
  if((args.interval!==undefined||args['widget-interval']!==undefined)&&args.profile===undefined)config.monitoring.profile='custom';
  if(args.mode!==undefined){if(!['auto','polling','sse'].includes(args.mode))throw new Error('Mode must be auto, polling or sse.');config.monitoring.mode=args.mode;}
  if(args['sse-url']!==undefined){const url=new URL(args['sse-url']);if(!['http:','https:'].includes(url.protocol))throw new Error('SSE URL must use HTTP or HTTPS.');config.monitoring.sseUrl=url.href;}
  const supported=new Set(['react-vite','vue-vite']);
  if (!supported.has(config.framework) || args['no-widget']) {
    await fs.writeFile(CONFIG,JSON.stringify(config,null,2)+'\n');
    console.log(`FreshDeploy configured (${config.framework}). The generic CLI is ready; see docs/integration.md for that framework.`);
    return;
  }
  const entries=['src/main.jsx','src/main.tsx','src/main.js','src/main.ts'];
  const entry=entries.find(x=>fsSync.existsSync(x));
  if(!entry){console.log('CLI ready. Widget not injected: no standard src/main entry found.');return;}
  const entryText=await fs.readFile(entry,'utf8');
  const sourceDir=path.resolve('src/freshdeploy');
  const marker="import './freshdeploy/mount.js';";
  await fs.mkdir(sourceDir,{recursive:true});
  const {installed,protectedFiles}=await installManagedWidget(sourceDir);
  const mount=`/** Optional production widget; verification runs in CI / the trusted monitor. */
import { mountFreshDeploy } from './index.js';
import { buildVersion, buildCommit, buildSettings } from './build-meta.js';
if (import.meta.env.PROD) mountFreshDeploy({
  expectedVersion: buildVersion,
  expectedCommit: buildCommit,
  manifestUrl: \`\${import.meta.env.BASE_URL}.freshdeploy.json\`,
  reportUrl: \`\${import.meta.env.BASE_URL}.freshdeploy-report.json\`,
  pollIntervalMs: buildSettings.widgetIntervalSeconds * 1000,
  maxReportAgeMs: buildSettings.maxReportAgeMs,
  serverIntervalSeconds: buildSettings.serverIntervalSeconds,
  language: buildSettings.language,
  sseUrl: import.meta.env.VITE_FD_SSE_URL || buildSettings.sseUrl || null,
  mode: buildSettings.mode,
});
`;
  const mountFile=path.join(sourceDir,'mount.js');
  if(!fsSync.existsSync(mountFile))await fs.writeFile(mountFile,mount);
  else if(new Set([
    // Official v0.3.0 generated mount and the official React trial mount.
    '0616f92b579c8ada2e22a20e09525a1223cc9d17ed112fb4ca4c4a159ce4b8a5',
    '14d15370349335efd4d4d3b4688ec559fb1247dcba9e18260f24e12907618a5f',
  ]).has(createHash('sha256').update((await fs.readFile(mountFile,'utf8')).replace(/\r\n/g,'\n')).digest('hex'))){
    // Match official legacy mounts regardless of Git's Windows CRLF conversion.
    const backup=`${mountFile}.freshdeploy.bak`;
    if(!fsSync.existsSync(backup))await fs.copyFile(mountFile,backup);
    await fs.writeFile(mountFile,mount);
  }

  const pkg=JSON.parse(await fs.readFile('package.json','utf8'));
  const metaFile=path.join(sourceDir,'build-meta.js');
  if(!fsSync.existsSync(metaFile))await fs.writeFile(metaFile,
    `export const buildVersion = ${JSON.stringify(pkg.version||'0.0.0')};\nexport const buildCommit = ${JSON.stringify(gitCommit())};\nexport const buildSettings = ${JSON.stringify({language:config.language,...config.monitoring,maxReportAgeMs:120000})};\n`);
  const scriptFile=path.resolve('scripts/freshdeploy-build-meta.mjs');
  await fs.mkdir(path.dirname(scriptFile),{recursive:true});
  // Generated build metadata and manifest share the same pinned version/commit.
  const metadataScript=`import fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
let commit = process.env.FD_COMMIT || process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA;
if (!commit) try { commit = execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(); } catch { commit='unknown'; }
const pkg=JSON.parse(await fs.readFile('package.json','utf8'));
const version=process.env.FD_VERSION || process.env.VITE_FD_VERSION || pkg.version || '0.0.0';
const config=JSON.parse(await fs.readFile('freshdeploy.config.json','utf8'));
const settings={language:config.language||'en',...config.monitoring,maxReportAgeMs:120000};
await fs.writeFile('src/freshdeploy/build-meta.js',\`export const buildVersion = \${JSON.stringify(version)};\\nexport const buildCommit = \${JSON.stringify(commit)};\\nexport const buildSettings = \${JSON.stringify(settings)};\\n\`);
await fs.writeFile('scripts/.freshdeploy-build-meta.json',JSON.stringify({version,commit})+'\\n');
`;
  // The 0.3.0 generated script is a managed version; customized scripts are not replaced.
  if(!fsSync.existsSync(scriptFile)) await fs.writeFile(scriptFile,metadataScript);
  else {
    const prior=await fs.readFile(scriptFile,'utf8');
    if(!prior.includes("scripts/.freshdeploy-build-meta.json") && prior.includes("src/freshdeploy/build-meta.js") && prior.includes("execFileSync('git'")){
      if(!fsSync.existsSync(`${scriptFile}.freshdeploy.bak`))await fs.copyFile(scriptFile,`${scriptFile}.freshdeploy.bak`);
      await fs.writeFile(scriptFile,metadataScript);
    }
  }
  if(!(await fs.readFile(scriptFile,'utf8')).includes('scripts/.freshdeploy-build-meta.json')) throw new Error('Your customized build metadata script needs updating. Back it up and rerun setup; see docs/integration.md.');
  // Self-contained postbuild hook: keeps the build/install workflow offline and
  // works even when setup was invoked via temporary npx.
  const afterBuild=path.resolve('scripts/freshdeploy-after-build.mjs');
  if(!fsSync.existsSync(afterBuild))await fs.copyFile(new URL('./templates/after-build.mjs',import.meta.url),afterBuild);
  if(!entryText.includes('freshdeploy/mount.js')){
    await fs.writeFile(`${entry}.freshdeploy.bak`,entryText,{flag:'wx'});
    await fs.writeFile(entry,`${marker}\n${entryText}`);
  }
  const preCommand='node scripts/freshdeploy-build-meta.mjs';
  const postCommand='node scripts/freshdeploy-after-build.mjs';
  pkg.scripts??={};let updatedPkg=false;
  for(const [hook,command] of [['prebuild',preCommand],['postbuild',postCommand]]){
    if(!pkg.scripts[hook]?.includes(command)){
      pkg.scripts[hook]=pkg.scripts[hook]?`${pkg.scripts[hook]} && ${command}`:command;
      updatedPkg=true;
    }
  }
  if(updatedPkg){
    if(!fsSync.existsSync('package.json.freshdeploy.bak'))await fs.writeFile('package.json.freshdeploy.bak',await fs.readFile('package.json','utf8'),{flag:'wx'});
    await fs.writeFile('package.json',JSON.stringify(pkg,null,2)+'\n');
  }
  config.widget??={};config.widget.enabled=true;
  await fs.writeFile(CONFIG,JSON.stringify(config,null,2)+'\n');
  const ignore='.gitignore';let ignored=await fs.readFile(ignore,'utf8').catch(()=>''),additions=[];
  for(const item of ['scripts/.freshdeploy-build-meta.json','*.freshdeploy.bak','freshdeploy-private*.json'])if(!ignored.split(/\r?\n/).includes(item))additions.push(item);
  if(additions.length)await fs.appendFile(ignore,`${ignored.endsWith('\n')?'':'\n'}# FreshDeploy local-only files\n${additions.join('\n')}\n`);
  console.log(`FreshDeploy ready — ${config.framework}. npm run build now generates the public manifest automatically.`);
  console.log(`  Entry: ${entry} · ${installed} managed widget file(s) updated.`);
  if(protectedFiles.length)console.log(`  Kept user-edited files: ${protectedFiles.join(', ')}. Review them before upgrading manually.`);
  console.log('  Next: npm run build → deploy → freshdeploy check. For local monitoring: freshdeploy watch --live.');
  console.log('  Workflow example is inactive; private reports are never published automatically.');
}
function intSeconds(value,name,min=1,max=86400){const n=Number(value);if(!Number.isInteger(n)||n<min||n>max)throw new Error(`${name} must be an integer from ${min} to ${max} seconds.`);return n;}
async function settingsCommand(args){
  const config=await readConfig();
  if (!config.schemaVersion) throw new Error('Run freshdeploy setup or init first.');
  const current=config.monitoring||{};
  const profile=args.profile || current.profile || 'production';
  if (!['local','production','custom'].includes(profile))throw new Error('Profile must be local, production or custom.');
  const defaults=profile==='local'?{serverIntervalSeconds:2,widgetIntervalSeconds:1}:profile==='production'?{serverIntervalSeconds:30,widgetIntervalSeconds:10}:current;
  const next={...current,...(args.profile?defaults:{}),profile};
  if(args.interval!==undefined)next.serverIntervalSeconds=intSeconds(args.interval,'Server interval');
  if(args['widget-interval']!==undefined)next.widgetIntervalSeconds=intSeconds(args['widget-interval'],'Widget interval');
  if(args.language!==undefined&&!['en','es'].includes(args.language))throw new Error('Language must be en or es.');
  if(args.mode!==undefined&&!['auto','polling','sse'].includes(args.mode))throw new Error('Mode must be auto, polling or sse.');
  if(args['sse-url']!==undefined){const url=new URL(args['sse-url']);if(!['http:','https:'].includes(url.protocol))throw new Error('SSE URL must use HTTP or HTTPS.');next.sseUrl=url.href;}
  if(args.mode!==undefined)next.mode=args.mode;
  config.language=args.language || config.language || 'en';
  next.serverIntervalSeconds=intSeconds(next.serverIntervalSeconds||30,'Server interval');
  next.widgetIntervalSeconds=intSeconds(next.widgetIntervalSeconds||10,'Widget interval');
  config.monitoring=next;
  // Changes never silently overwrite a customized widget mount: it reads settings
  // from its own config at build time and/or VITE_FD_SSE_URL.
  if(Object.keys(args).some(k=>k!=='_'))await fs.writeFile(CONFIG,JSON.stringify(config,null,2)+'\n');
  console.log(JSON.stringify({language:config.language,monitoring:next},null,2));
  console.log('After changing production widget defaults, rebuild your app. In-widget preferences are per browser.');
}
async function stampCommand(args) {
  const config = await readConfig();
  const out = args.out || config.buildDir;
  if (!out) throw new Error('No public build directory configured. Pass --out <public-web-root>.');
  const pkg = await fs.readFile('package.json', 'utf8').then(JSON.parse).catch(() => ({}));
  const version = args.version || process.env.FD_VERSION || pkg.version || '0.0.0';
  const commit = args.commit || process.env.FD_COMMIT || process.env.GITHUB_SHA || process.env.VERCEL_GIT_COMMIT_SHA || gitCommit();
  const result = await stamp({ directory: out, version, commit });
  console.log(`Manifest written: ${path.join(out, MANIFEST)} (${result.assets.length} public assets; ${result.version}; ${result.commit.slice(0, 12)})`);
}
function showReport(report, language='en') {
  const label = translateText(report.status,language);
  const symbols = { pass: '✓', warn: '!', fail: '×' };
  console.log(`\nfreshdeploy  /  ${label}\n${report.url}\n`);
  for (const x of report.checks) console.log(` ${symbols[x.state]}  ${translateCheckText(x,language)}${x.state !== 'pass' && x.detail ? `\n    ${x.detail}` : ''}`);
  if (report.comparison) console.log(`\nVersion diff: ${report.comparison.added.length} added, ${report.comparison.changed.length} changed, ${report.comparison.removed.length} removed`);
  console.log(`\nChecked ${report.assets.checked}/${report.assets.total} resources.\n`);
}
async function writeJson(filename, value) {
  const dest = path.resolve(filename);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.tmp-${process.pid}-${Date.now()}`;
  try {
    await fs.writeFile(tmp, JSON.stringify(value, null, 2) + '\n');
    await fs.rename(tmp, dest);
  } finally { await fs.rm(tmp, { force: true }).catch(() => {}); }
}

async function checkCommand(args, { monitoring = false } = {}) {
  const config = await readConfig();
  const url = args.url || process.env.FD_URL || config.url;
  let expected = args.expected || process.env.FD_EXPECTED;
  if(!expected && config.buildDir){
    try{const local=JSON.parse(await fs.readFile(path.join(config.buildDir,MANIFEST),'utf8'));
      expected=local.commit && local.commit!=='unknown'?local.commit:local.version;
    }catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const previous = args.previous ? JSON.parse(await fs.readFile(args.previous, 'utf8')) : null;
  let ticker;
  let progress = '';
  if (!monitoring && !args.json && stdout.isTTY && !process.env.CI) {
    const frames = ['|', '/', '-', '\\']; let i = 0;
    ticker = setInterval(() => stdout.write(`\r${frames[i++ % frames.length]} ${progress.padEnd(58)}`), 90);
  }
  let report;
  try {
    report = await inspect({ url, expected, expectedContent: args['expected-content'], previous, maxAssets: args['max-assets'] ?? config.maxAssets ?? 25, onProgress: x => { progress = x; } });
  } finally { if (ticker) { clearInterval(ticker); stdout.write('\r' + ' '.repeat(70) + '\r'); } }
  if (args.report) {
    await writeJson(args.report, report);
  }
  if (args['public-report']) {
    const publicReport = toPublicReport(report);
    await writeJson(args['public-report'], publicReport);
  }
  if (!monitoring) {
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else showReport(report,args.language || config.language || 'en');
  }
  if (report.status !== 'pass' && !monitoring) process.exitCode = 1;
  return report;
}

/** Human-friendly summary of a changed result, rather than a report on every scan. */
function monitorSummary(report, previous, language = 'en') {
  const now = new Date().toLocaleTimeString(language === 'es' ? 'es-ES' : 'en-GB', { hour12: false });
  const status = String(report.status || 'warn').toUpperCase();
  const version = report.version?.version || 'unknown';
  const passed = report.assets?.passed ?? 0;
  const total = report.assets?.total ?? 0;
  const failed = report.assets?.failed ?? 0;
  const warningCount = (report.checks || []).filter(x => x.state === 'warn').length;
  const wasFail = previous?.status === 'fail' && report.status !== 'fail';
  const restored = wasFail ? (language === 'es' ? ' · integridad recuperada' : ' · integrity restored') : '';
  const issues = failed ? (language === 'es' ? ` · ${failed} archivo(s) con error` : ` · ${failed} failed asset(s)`) :
    warningCount ? (language === 'es' ? ` · ${warningCount} aviso(s)` : ` · ${warningCount} warning(s)`) : '';
  return `${now}  ${status.padEnd(4)} · ${version} · ${passed}/${total} assets${issues}${restored}`;
}

/** Long-running local/dedicated monitor. CI should run `check` after deployment instead. */
async function watchCommand(args) {
  const config = await readConfig();
  if(!args['public-report']){if(!config.buildDir)throw new Error('Set buildDir or pass --public-report FILE.');args['public-report']=path.join(config.buildDir,'.freshdeploy-report.json');}
  if(!args.report)args.report='freshdeploy-monitor-private.json';
  if(!args.expected){
    const manifestFile=config.buildDir&&path.join(config.buildDir,MANIFEST);
    if(!manifestFile||!fsSync.existsSync(manifestFile))throw new Error('Build and stamp your project first, or pass --expected.');
    const manifest=JSON.parse(await fs.readFile(manifestFile,'utf8'));
    args.expected=manifest.commit!=='unknown'?manifest.commit:manifest.version;
  }
  const interval = intSeconds(args.interval || config.monitoring?.serverIntervalSeconds || 30,'--interval');
  checkUrl(args.url || process.env.FD_URL || config.url || (() => { throw new Error('Production URL is required.'); })());
  const port=args['sse-port']===undefined?(args.live?4318:null):Number(args['sse-port']);
  if(port!==null && !args['sse-origin']) args['sse-origin']=config.url || args.url;
  if(port!==null && !args['sse-origin']) throw new Error('Live updates need a browser origin: set --url once during setup or pass --sse-origin.');
  const live=port===null?null:await createLiveServer({port,origin:args['sse-origin']});
  if(live)console.log(`SSE: ${live.url} · origin ${new URL(args['sse-origin']).origin}`);
  let stopped=false,wake=null,lastFingerprint=null,lastReport=null;
  const stop=()=>{stopped=true;wake?.();};
  process.once('SIGINT',stop);
  process.once('SIGTERM',stop);
  console.log(`freshdeploy / monitoring every ${interval}s · only changes are shown · Ctrl+C to stop`);
  try {
    while(!stopped){
      try {
        const report=await checkCommand(args,{monitoring:true});
        const publicReport=toPublicReport(report);
        const fingerprint=reportFingerprint(publicReport);
        if(fingerprint!==lastFingerprint){
          console.log(monitorSummary(report,lastReport,config.language));
          lastFingerprint=fingerprint;
          lastReport=report;
        }
        live?.publish(publicReport);
      }catch(error){
        // Fail closed: a stopped/broken monitor never leaves an old PASS visible.
        const unavailable={schemaVersion:1,kind:'freshdeploy.public-report',status:'warn',
          generatedAt:new Date().toISOString(),version:null,
          checks:[{id:'monitor',state:'warn',summary:'Monitor could not complete the latest check.'}],
          assets:{checked:0,passed:0,failed:0,skipped:0,total:0},comparison:null};
        await writeJson(args['public-report'],unavailable);
        const fingerprint=reportFingerprint(unavailable);
        if(fingerprint!==lastFingerprint){
          const now=new Date().toLocaleTimeString(config.language==='es'?'es-ES':'en-GB',{hour12:false});
          console.error(`${now}  WARN · ${config.language==='es'?'monitor no disponible':'monitor unavailable'} · ${error.message}`);
          lastFingerprint=fingerprint;
          lastReport=null;
        }
        live?.publish(unavailable);
      }
      if(stopped)break;
      await new Promise(resolve=>{
        const timeout=setTimeout(()=>{wake=null;resolve();},interval*1000);
        wake=()=>{clearTimeout(timeout);wake=null;resolve();};
      });
    }
  }finally{
    process.removeListener('SIGINT',stop);
    process.removeListener('SIGTERM',stop);
    if(live)await live.close();
    console.log('FreshDeploy monitor stopped.');
  }
}

export async function run(argv) {
  const args = options(argv);
  if (args.help || !args._[0] || args._[0] === 'help') { console.log(HELP); return; }
  switch (args._[0]) {
    case 'init': return init(args);
    case 'setup': return setup(args);
    case 'settings': return settingsCommand(args);
    case 'detect': return console.log(JSON.stringify(detectProject(), null, 2));
    case 'stamp': return stampCommand(args);
    case 'check': return checkCommand(args);
    case 'watch': return watchCommand(args);
    default: throw new Error(`Unknown command: ${args._[0]}. Run freshdeploy --help.`);
  }
}
