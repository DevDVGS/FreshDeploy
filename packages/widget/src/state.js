/** Pure browser/report reconciliation. A CI result is never inferred from a manifest alone. */
const validState = state => ['pass', 'warn', 'fail'].includes(state);
const validCount = n => Number.isSafeInteger(n) && n >= 0;

export function isPublicReport(value) {
  if (!value || value.schemaVersion !== 1 || value.kind !== 'freshdeploy.public-report' || !validState(value.status)) return false;
  if (value.version === null) { if (value.status === 'pass') return false; }
  else if (!value.version || typeof value.version.version !== 'string' || typeof value.version.commit !== 'string') return false;
  if (!Array.isArray(value.checks) || value.checks.length > 50 || !value.checks.every(x => x && typeof x.id === 'string' && typeof x.summary === 'string' && validState(x.state))) return false;
  if (!value.assets || !['checked', 'passed', 'failed', 'skipped', 'total'].every(k => validCount(value.assets[k]))) return false;
  if (value.assets.checked !== value.assets.passed + value.assets.failed || value.assets.checked + value.assets.skipped !== value.assets.total) return false;
  if (value.status === 'pass' && (value.checks.some(x => x.state !== 'pass') || value.assets.failed || value.assets.skipped || !value.assets.checked)) return false;
  if (value.status === 'warn' && value.checks.some(x => x.state === 'fail')) return false;
  if (value.status === 'fail' && !value.checks.some(x => x.state === 'fail')) return false;
  if (value.comparison !== null && value.comparison !== undefined && (!value.comparison || !['added', 'changed', 'removed'].every(k => validCount(value.comparison[k])))) return false;
  return true;
}

export function summarizeDeployment({ manifest, report = null, expectedVersion, expectedCommit, maxReportAgeMs = 0, now = Date.now() } = {}) {
  if (!manifest || manifest.schemaVersion !== 1 || typeof manifest.version !== 'string' || typeof manifest.commit !== 'string') {
    return { state: 'warn', label: 'manifest unavailable', message: 'The published manifest is missing or invalid.' };
  }
  const expected = expectedCommit || expectedVersion || '';
  const current = expectedCommit ? manifest.commit : manifest.version;
  const commitPrefix = Boolean(expectedCommit && /^[a-f\d]{7,40}$/i.test(expected) && /^[a-f\d]{7,40}$/i.test(current) && (current.startsWith(expected) || expected.startsWith(current)));
  if (!expected) return { state: 'warn', label: 'version not pinned', message: 'Embed the expected build version or commit to verify freshness.' };
  if (expected !== current && !commitPrefix) return { state: 'fail', label: 'version mismatch', message: 'This page does not match the published manifest. It may be cached or outdated.' };
  if (!report) return { state: 'warn', label: 'report unavailable', message: 'Build version matches, but the post-deployment CI report is not published.' };
  if (!isPublicReport(report)) return { state: 'warn', label: 'report invalid', message: 'The published verification report has an invalid format.' };
  if (report.version === null && report.checks.some(x => x.id === 'monitor' && x.state === 'warn')) {
    return { state: 'warn', label: 'monitor unavailable', message: 'The background monitor could not complete its latest verification.' };
  }
  if (maxReportAgeMs > 0 && (!Number.isFinite(Date.parse(report.generatedAt)) || now - Date.parse(report.generatedAt) > maxReportAgeMs)) {
    return { state: 'warn', label: 'monitor stale', message: 'No recent verification report has been published. Check whether the monitor is running.' };
  }
  if (!report.version || report.version.version !== manifest.version || report.version.commit !== manifest.commit) {
    return { state: 'warn', label: 'report pending', message: 'The published report is for a different deployment. Wait for the latest post-deploy check.' };
  }
  const required = ['http', 'manifest', 'version', 'assets'];
  if (required.some(id => !report.checks.some(check => check.id === id && check.state === 'pass')) && report.status === 'pass') {
    return { state: 'warn', label: 'report incomplete', message: 'Mandatory deployment checks are not confirmed.' };
  }
  if (report.status === 'pass') return { state: 'pass', label: 'deployment verified', message: 'The build and the published CI report match.' };
  if (report.status === 'fail') return { state: 'fail', label: 'deployment failed', message: 'The post-deployment check found a failure. Review the checks below.' };
  return { state: 'warn', label: 'deployment warning', message: 'The post-deployment check reported a warning. Review the checks below.' };
}
