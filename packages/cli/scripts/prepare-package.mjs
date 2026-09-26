/** Prepack: ship one self-contained CLI package, no separately published workspace packages. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const cliRoot = fileURLToPath(new URL('..', import.meta.url));
const projectRoot = path.resolve(cliRoot, '../..');
const vendor = path.join(cliRoot, 'vendor');
for (const name of ['core', 'adapters', 'widget']) {
  const source = path.join(projectRoot, 'packages', name, 'src');
  const destination = path.join(vendor, name);
  await fs.rm(destination, { recursive: true, force: true });
  await fs.mkdir(destination, { recursive: true });
  await fs.cp(source, destination, { recursive: true, force: true });
}
await fs.copyFile(path.join(projectRoot, 'LICENSE'), path.join(cliRoot, 'LICENSE'));
await fs.cp(path.join(projectRoot, 'docs'), path.join(cliRoot, 'docs'), { recursive: true, force: true });
