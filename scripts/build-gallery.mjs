import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const root = fileURLToPath(new URL('../', import.meta.url));
const order = JSON.parse(await fs.readFile(path.join(root, 'src/gallery/order.json'), 'utf8'));
if (!Array.isArray(order) || !order.length || new Set(order).size !== order.length) {
  throw new Error('Gallery source order must be a nonempty, unique list.');
}
for (const file of order) {
  if (!/^src\/gallery\/[a-z0-9/-]+\.js$/.test(file) || file.includes('..')) {
    throw new Error(`Invalid gallery source path: ${file}`);
  }
}
const bundle = (await Promise.all(order.map(file => fs.readFile(path.join(root, file), 'utf8')))).join('');
new vm.Script(bundle, { filename: 'dist/gallery.js' });
const destination = path.join(root, 'dist/gallery.js');
if (process.argv.includes('--check')) {
  const current = await fs.readFile(destination, 'utf8');
  if (current !== bundle) throw new Error('dist/gallery.js is stale. Run npm run build.');
  console.log(`Gallery build is current (${order.length} feature files).`);
} else {
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bundle);
  console.log(`Built dist/gallery.js from ${order.length} feature files (${Buffer.byteLength(bundle)} bytes).`);
}
