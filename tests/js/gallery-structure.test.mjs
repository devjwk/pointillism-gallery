import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const read = name => fs.readFile(new URL(name, root), 'utf8');

test('gallery feature sources reproduce the published bundle in the declared order', async () => {
  const order = JSON.parse(await read('src/gallery/order.json'));
  assert.equal(order.length, 22);
  assert.equal(new Set(order).size, order.length);
  const joined = (await Promise.all(order.map(read))).join('');
  assert.equal(joined, await read('dist/gallery.js'));
  assert.doesNotThrow(() => new vm.Script(joined));
});

test('gallery catalog remains a separate script with four distinct existing artworks', async () => {
  const source = await read('assets/artworks/catalog.js');
  const context = vm.createContext({});
  new vm.Script(source).runInContext(context);
  const titles = new vm.Script('ARTWORKS.map(a => a.title)').runInContext(context);
  assert.equal(titles.length, 4);
  assert.equal(new Set(titles).size, 4);
  assert(titles.includes('인왕제색도'));
  assert(titles.includes('미인도'));
  assert(titles.includes('씨름'));
});

test('gallery preserves every statically referenced DOM id after extraction', async () => {
  const html = await read('index.html');
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(ids.length, new Set(ids).size);
  const source = await read('dist/gallery.js');
  for (const match of source.matchAll(/getElementById\(['"]([^'"]+)['"]\)/g)) {
    assert(ids.includes(match[1]), `Missing gallery control ${match[1]}`);
  }
});

test('gallery loads classic data before its runtime and links the nested validation page', async () => {
  const html = await read('index.html');
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map(m => m[1]);
  assert.equal(scripts.length, 2);
  assert(scripts.every(s => s.includes('defer') && !s.includes('type="module"')));
  assert(scripts[0].includes('assets/artworks/catalog.js'));
  assert(scripts[1].includes('dist/gallery.js'));
  const match = html.match(/href="(\.\/tools\/scene-validation\/)"/);
  assert(match);
  assert.equal(new URL(match[1], 'https://devjwk.github.io/pointillism-gallery/?view=mobile').pathname, '/pointillism-gallery/tools/scene-validation/');
});
