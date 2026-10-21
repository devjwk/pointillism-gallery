import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const skip = new Set(['.git', 'node_modules', '__pycache__', '.venv', '.cache']);
async function walk(dir) {
  const result = [];
  for (const item of await fs.readdir(dir, {withFileTypes:true})) {
    if (skip.has(item.name)) continue;
    const full = path.join(dir, item.name);
    if (item.isSymbolicLink()) throw new Error(`Unexpected symlink: ${full}`);
    if (item.isDirectory()) result.push(...await walk(full));
    else result.push(full);
  }
  return result;
}
const files = await walk(root);
const relative = file => path.relative(root, file).split(path.sep).join('/');
async function localTarget(from, url) {
  if (!url || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(url)) return;
  const clean = decodeURIComponent(url.split(/[?#]/)[0]);
  const destination = path.resolve(path.dirname(from), clean);
  assert(destination.startsWith(root + path.sep) || destination === root, `Outside-root link: ${relative(from)} -> ${url}`);
  const stat = await fs.stat(destination).catch(() => null);
  assert(stat, `Missing link: ${relative(from)} -> ${url}`);
  if (stat.isDirectory() && !url.endsWith('.git')) {
    // README links to source directories are allowed; HTML page routes need index.html.
    if (from.endsWith('.html')) await fs.access(path.join(destination, 'index.html'));
  }
}
let links = 0;
for (const file of files) {
  const name = relative(file);
  assert(!/(?:^|\/)(?:inputs?|outputs|runs|private|private-jobs|models|weights|checkpoints)(?:\/|$)/.test(name), `Private/generated path included: ${name}`);
  assert(!/\.(?:scene\.json|glb|gltf|ply|onnx|safetensors|pt|pth|ckpt|npy|npz|zip)$/.test(name), `Generated/model file included: ${name}`);
  if (!/\.(?:html|js|mjs|css|json|md|py|txt)$/.test(file)) continue;
  const text = await fs.readFile(file, 'utf8');
  assert(!/[/]Users[/][A-Za-z0-9._-]+[/]|[.]aside[/]u[/][0-9]+[/]/.test(text), `Private absolute path included: ${name}`);
  assert(!/(?:github_pat_|gh[pousr]_|hf_)[A-Za-z0-9]{20,}/.test(text), `Possible credential included: ${name}`);
  if (/\.(?:html|md)$/.test(file)) {
    const urls = [...text.matchAll(/\b(?:src|href)=["']([^"']+)["']/g)].map(m=>m[1]);
    if (file.endsWith('.md')) urls.push(...[...text.matchAll(/\]\(([^)\s]+)(?:\s+[^)]*)?\)/g)].map(m=>m[1]));
    for (const url of urls) { await localTarget(file,url); links++; }
  }
  if (name.startsWith('tools/scene-validation/src/') && file.endsWith('.js')) {
    for (const m of text.matchAll(/\b(?:import|export)\s+(?:[^;]+?\s+from\s*)?["'](\.[^"']+)["']/g)) await localTarget(file,m[1]);
  }
}
const html = await fs.readFile(path.join(root,'index.html'),'utf8');
assert(html.includes('./assets/artworks/catalog.js') && html.includes('./dist/gallery.js'));
assert(html.includes('./tools/scene-validation/'));
const tool = await fs.readFile(path.join(root,'tools/scene-validation/index.html'),'utf8');
assert(tool.includes('src="./src/app.js"') || tool.includes('src="src/app.js"'));
assert(tool.includes('styles.css'));
console.log(`Site structure passed: ${files.length} files, ${links} document references; private/model output guards passed.`);
