import fs from 'node:fs';
import path from 'node:path';

function exists(root, filename) {
  return fs.existsSync(path.join(root, filename));
}

function readJson(root, filename) {
  try { return JSON.parse(fs.readFileSync(path.join(root, filename), 'utf8')); }
  catch { return {}; }
}

/** Detection is advisory: users can always set buildDir explicitly. */
export function detectProject(root = process.cwd()) {
  const pkg = readJson(root, 'package.json');
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  if (deps.next || exists(root, 'next.config.js') || exists(root, 'next.config.mjs') || exists(root, 'next.config.ts')) {
    return { framework: 'nextjs', buildDir: 'public', stampWhen: 'before-build', note: 'Stamp public/ before next build. Next-managed assets are checked from served HTML; they are not hashed into this manifest.' };
  }
  if (deps['@angular/core'] || exists(root, 'angular.json')) {
    const config = readJson(root, 'angular.json');
    const first = Object.values(config.projects || {})[0];
    const options = first?.architect?.build?.options || first?.targets?.build?.options || {};
    const output = options.outputPath;
    const target = typeof output === 'string' ? output : output?.base;
    return { framework: 'angular', buildDir: target || 'dist', stampWhen: 'after-build', note: 'For recent Angular builds, select dist/<app>/browser if necessary.' };
  }
  if (deps.vue) return { framework: 'vue-vite', buildDir: 'dist', stampWhen: 'after-build', note: '' };
  if (deps.react || deps['@vitejs/plugin-react']) return { framework: 'react-vite', buildDir: 'dist', stampWhen: 'after-build', note: '' };
  if (exists(root, 'composer.json') || fs.readdirSync(root).some(name => name.endsWith('.php'))) {
    return { framework: 'html-php', buildDir: null, stampWhen: 'before-upload', note: 'Select the public web root explicitly. Never stamp a private project directory.' };
  }
  return { framework: 'html-php', buildDir: null, stampWhen: 'before-upload', note: 'Choose your published web directory explicitly.' };
}
