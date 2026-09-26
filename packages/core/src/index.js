import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const MANIFEST = '.freshdeploy.json';
const PUBLIC_ASSET = /\.(?:html?|css|m?js|cjs|json|svg|png|jpe?g|webp|gif|avif|ico|woff2?|ttf|eot|wasm|txt|webmanifest)$/i;
const SKIP = new Set([MANIFEST, '.env', '.git', 'node_modules', '.next', '.output', '.DS_Store']);
const MAX_MANIFEST_BYTES = 2_000_000;
const MAX_HTML_BYTES = 2_000_000;

export function sha256(data) { return createHash('sha256').update(data).digest('hex'); }

export async function stamp({ directory, version = '0.0.0', commit = 'unknown', now = new Date() }) {
  const root = path.resolve(directory);
  const stat = await fs.stat(root);
  if (!stat.isDirectory()) throw new Error('Build output must be a directory.');
  const assets = [];
  async function walk(folder) {
    for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
      if (SKIP.has(entry.name) || entry.name.startsWith('.')) continue;
      const filename = path.join(folder, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) { await walk(filename); continue; }
      if (!entry.isFile() || !PUBLIC_ASSET.test(entry.name) || entry.name.endsWith('.map')) continue;
      // No source/server files (PHP, env, config), even if output was misconfigured.
      const bytes = await fs.readFile(filename);
      assets.push({ path: path.relative(root, filename).split(path.sep).join('/'), sha256: sha256(bytes), size: bytes.length });
    }
  }
  await walk(root);
  assets.sort((a, b) => a.path.localeCompare(b.path));
  const manifest = { schemaVersion: 1, version: String(version), commit: String(commit), createdAt: now.toISOString(), assets };
  await fs.writeFile(path.join(root, MANIFEST), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}

function checkEntry(id, state, summary, detail = '') { return { id, state, summary, detail }; }
function parseCacheControl(value = '') {
  const lower = value.toLowerCase();
  const ages = [...lower.matchAll(/(?:^|,)\s*(?:s-maxage|max-age)\s*=\s*(\d+)/g)].map(x => Number(x[1]));
  return { noStore: /(?:^|,)\s*no-store\b/.test(lower), noCache: /(?:^|,)\s*no-cache\b/.test(lower), maxAge: ages.length ? Math.max(...ages) : null };
}
export function assessHtmlCache(headers) {
  const raw = headers.get('cache-control') || '';
  const cache = parseCacheControl(raw);
  if (cache.noStore || cache.noCache || (cache.maxAge !== null && cache.maxAge <= 60)) {
    return checkEntry('cache', 'pass', 'HTML caching policy is suitable for frequent releases.', `Cache-Control: ${raw}`);
  }
  return checkEntry('cache', 'warn', 'HTML caching policy needs review.', raw ? `Cache-Control: ${raw}. This indicates possible staleness, not proof that a visitor has stale content.` : 'Cache-Control is absent; inspect your CDN/server caching policy.');
}

export function parseHtmlResources(html, pageUrl) {
  const found = new Set();
  const tags = html.match(/<(?:script|link|img|source)\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const attrs = {};
    for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4];
    const candidates = [attrs.src, attrs.href];
    if (attrs.srcset) candidates.push(...attrs.srcset.split(',').map(x => x.trim().split(/\s+/)[0]));
    for (const item of candidates) {
      if (!item || /^(?:data:|blob:|javascript:|#)/i.test(item)) continue;
      try {
        const url = new URL(item, pageUrl);
        if (url.origin === pageUrl.origin && /^https?:$/.test(url.protocol)) {
          url.hash = ''; url.search = '';
          found.add(url.href);
        }
      } catch { /* invalid HTML references are not followed */ }
    }
  }
  return [...found];
}

async function getLimited(url, { maxBytes = MAX_HTML_BYTES, timeoutMs = 10_000, fresh = false } = {}) {
  const response = await fetch(url, {
    redirect: 'follow', signal: AbortSignal.timeout(timeoutMs),
    headers: fresh ? { 'Cache-Control': 'no-cache' } : {}, cache: fresh ? 'no-store' : 'default'
  });
  if (Number(response.headers.get('content-length')) > maxBytes) {
    await response.body?.cancel();
    throw new Error(`Resource exceeds ${maxBytes} bytes`);
  }
  const chunks = [];
  let total = 0;
  if (response.body) {
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > maxBytes) { await response.body.cancel().catch(() => {}); throw new Error(`Resource exceeds ${maxBytes} bytes`); }
      chunks.push(chunk);
    }
  }
  return { response, bytes: Buffer.concat(chunks) };
}

export function compareManifests(previous, current) {
  const before = new Map((previous?.assets || []).map(x => [x.path, x.sha256]));
  const after = new Map((current?.assets || []).map(x => [x.path, x.sha256]));
  return {
    added: [...after.keys()].filter(k => !before.has(k)),
    changed: [...after.keys()].filter(k => before.has(k) && before.get(k) !== after.get(k)),
    removed: [...before.keys()].filter(k => !after.has(k))
  };
}

export function validateManifest(value) {
  return value && value.schemaVersion === 1 && typeof value.version === 'string' && typeof value.commit === 'string' && Array.isArray(value.assets) &&
    value.assets.every(x => x && typeof x.path === 'string' && !x.path.startsWith('/') && !x.path.split('/').includes('..') && /^[a-f0-9]{64}$/.test(x.sha256) && Number.isSafeInteger(x.size) && x.size >= 0);
}

function expectedMatches(expected, manifest) {
  if (!expected) return true;
  const exp = String(expected).trim();
  if (exp === manifest.version || exp === manifest.commit) return true;
  return /^[a-f\d]{7,40}$/i.test(exp) && /^[a-f\d]{7,40}$/i.test(manifest.commit) && (manifest.commit.startsWith(exp) || exp.startsWith(manifest.commit));
}

function reportStatus(checks) {
  if (checks.some(x => x.state === 'fail')) return 'fail';
  if (checks.some(x => x.state === 'warn')) return 'warn';
  return 'pass';
}

export async function inspect({ url, expected, expectedContent, previous, maxAssets = 25, timeoutMs = 10_000, maxAssetBytes = 6_000_000, onProgress = () => {} } = {}) {
  if (!url) throw new Error('Production URL required. Set it once in freshdeploy.config.json or pass --url.');
  const pageUrl = new URL(url);
  if (!['http:', 'https:'].includes(pageUrl.protocol)) throw new Error('Only HTTP(S) URLs are supported.');
  const base = new URL(pageUrl.href.endsWith('/') ? pageUrl.href : pageUrl.href.replace(/[^/]*$/, ''));
  const checks = [];
  let manifest = null;
  let html = '';
  let htmlBytes = null;
  let remoteResponse = null;
  onProgress('Fetching production HTML');
  try {
    const { response, bytes } = await getLimited(pageUrl, { maxBytes: MAX_HTML_BYTES, timeoutMs, fresh: true });
    remoteResponse = response;
    htmlBytes = bytes;
    html = bytes.toString('utf8');
    checks.push(checkEntry('http', response.ok ? 'pass' : 'fail', `Production returned HTTP ${response.status}.`, response.url));
    if (response.url && new URL(response.url).origin !== pageUrl.origin) checks.push(checkEntry('redirect', 'warn', 'Production redirects to another origin.', 'Only assets on the configured origin are checked.'));
    checks.push(assessHtmlCache(response.headers));
  } catch (error) {
    checks.push(checkEntry('http', 'fail', 'Could not fetch production HTML.', error.message));
  }
  if (remoteResponse?.ok && expectedContent) {
    checks.push(checkEntry('content', html.includes(expectedContent) ? 'pass' : 'fail', html.includes(expectedContent) ? 'Expected content is present.' : 'Expected content is missing.', 'Case-sensitive match against served HTML. Client-rendered text is not covered.'));
  }
  onProgress('Reading published manifest');
  try {
    const manifestUrl = new URL(MANIFEST, base);
    const { response, bytes } = await getLimited(manifestUrl, { maxBytes: MAX_MANIFEST_BYTES, timeoutMs, fresh: true });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const parsed = JSON.parse(bytes.toString('utf8'));
    if (!validateManifest(parsed)) throw new Error('Invalid or unsupported manifest format.');
    manifest = parsed;
    checks.push(checkEntry('manifest', 'pass', `Manifest found: ${manifest.version}.`, `Commit: ${manifest.commit}`));
    const expectedHtml = manifest.assets.find(x => x.path === 'index.html');
    if (expectedHtml && htmlBytes && (pageUrl.pathname.endsWith('/') || pageUrl.pathname.endsWith('/index.html'))) {
      const matches = sha256(htmlBytes) === expectedHtml.sha256;
      checks.push(checkEntry('html-integrity', matches ? 'pass' : 'fail', matches ? 'Served HTML matches build output.' : 'Served HTML differs from the build manifest.', 'A cached, modified or substituted index page may be in use.'));
    }
    if (expected) {
      checks.push(checkEntry('version', expectedMatches(expected, manifest) ? 'pass' : 'fail', expectedMatches(expected, manifest) ? 'Published version matches expected identifier.' : 'Published version does not match the expected identifier.', `Expected: ${expected}; actual: ${manifest.version} (${manifest.commit})`));
    } else {
      checks.push(checkEntry('version', 'warn', 'No expected version provided; publication freshness is not verified.', 'Pass --expected <version-or-commit> from the deployment pipeline.'));
    }
  } catch (error) {
    checks.push(checkEntry('manifest', 'warn', 'Published manifest was not available.', `${error.message}. Run freshdeploy stamp before uploading the build.`));
    if (expected) checks.push(checkEntry('version', 'warn', 'Expected version could not be verified without a manifest.'));
  }
  const links = remoteResponse?.ok ? parseHtmlResources(html, pageUrl) : [];
  const targets = new Map();
  for (const link of links) targets.set(link, null);
  for (const asset of manifest?.assets || []) {
    const assetUrl = new URL(asset.path, base);
    if (assetUrl.origin === pageUrl.origin) targets.set(assetUrl.href, asset);
  }
  let success = 0, failure = 0, skipped = 0;
  const assetErrors = [];
  const total = targets.size;
  const limit = Math.max(0, Math.min(500, Number(maxAssets) || 0));
  const selected = [...targets.entries()].slice(0, limit);
  onProgress(`Checking ${selected.length}/${total} assets`);
  // Limited parallelism to avoid flooding production sites.
  let cursor = 0;
  async function worker() {
    while (cursor < selected.length) {
      const current = selected[cursor++];
      const [assetUrl, meta] = current;
      try {
        const result = await getLimited(assetUrl, { maxBytes: maxAssetBytes, timeoutMs, fresh: true });
        if (!result.response.ok) throw new Error(`HTTP ${result.response.status}`);
        if (new URL(result.response.url).origin !== pageUrl.origin) throw new Error('Redirected to another origin');
        if (meta && sha256(result.bytes) !== meta.sha256) throw new Error('SHA-256 does not match the build manifest');
        success++;
      } catch (error) { failure++; assetErrors.push({ url: assetUrl, reason: error.message }); }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, selected.length) }, worker));
  skipped = total - selected.length;
  const assetDetail = assetErrors.slice(0, 10).map(x => `${x.url}: ${x.reason}`).join(' | ');
  checks.push(checkEntry('assets', failure ? 'fail' : skipped ? 'warn' : total ? 'pass' : 'warn', `${success}/${total} assets verified${failure ? `; ${failure} failed` : ''}${skipped ? `; ${skipped} not checked` : ''}.`, assetDetail || (skipped ? 'Raise maxAssets to increase coverage. Large files above the size limit also fail verification.' : 'Same-origin resources and manifest hashes checked. External CDN resources are excluded.')));
  const comparison = previous && manifest && validateManifest(previous) ? compareManifests(previous, manifest) : null;
  const report = { schemaVersion: 1, generatedAt: new Date().toISOString(), url: pageUrl.href, status: reportStatus(checks), version: manifest ? { version: manifest.version, commit: manifest.commit } : null, checks, assets: { checked: success + failure, passed: success, failed: failure, skipped, total, errors: assetErrors }, comparison };
  return report;
}

/** Explicit opt-in, sanitized, browser-readable subset. The full CI report stays private. */
export function toPublicReport(report) {
  if (!report || !['pass', 'warn', 'fail'].includes(report.status) || !Array.isArray(report.checks) || !report.assets) {
    throw new Error('Cannot publish an incomplete deployment report.');
  }
  const comparison = report.comparison ? {
    added: report.comparison.added.length,
    changed: report.comparison.changed.length,
    removed: report.comparison.removed.length
  } : null;
  return {
    schemaVersion: 1,
    kind: 'freshdeploy.public-report',
    generatedAt: report.generatedAt,
    status: report.status,
    version: report.version ? { version: report.version.version, commit: report.version.commit } : null,
    checks: report.checks.map(({ id, state, summary }) => ({ id, state, summary })),
    assets: {
      checked: report.assets.checked, passed: report.assets.passed,
      failed: report.assets.failed, skipped: report.assets.skipped, total: report.assets.total
    },
    comparison
  };
}
