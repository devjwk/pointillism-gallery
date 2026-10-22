import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createHash } from 'node:crypto';

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

test('gallery catalog has ten distinct artworks and preserves the four original records', async () => {
  const source = await read('assets/artworks/catalog.js');
  const context = vm.createContext({});
  new vm.Script(source).runInContext(context);
  const artworks = new vm.Script('ARTWORKS').runInContext(context);
  assert.equal(artworks.length, 10);
  assert.equal(new Set(artworks.map(a => a.title)).size, 10);
  assert.equal(new Set(artworks.map(a => a.id)).size, 10);
  const legacyHashes = {
    inwang: '2aa1e660fcfa9761b9e0e4f730575362f72dbde902bf819b238b9459e9cb9901',
    miindo: 'accf77417538c27787a5f54cc9db45d51310ac6b5a7c9835801b729df908f261',
    ssireum: 'f75b279b02f32330c6d15e6550f66c63cb24b9256a1c0557af82f676936c2585',
    porsche: '843a663d8076aa28697c12b160f3b4534288556c86e6feadc06011f13c11cc7f'
  };
  // Hash original fields only, allowing new provenance without changing legacy data.
  const legacyFields = ['id','title','artist','year','medium','w','h','gray','depth','tune','seg','dw','dh','rgb','rw','rh'];
  for (const [id, expected] of Object.entries(legacyHashes)) {
    const artwork = artworks.find(a => a.id === id);
    assert(artwork, 'Missing original artwork ' + id);
    const data = Object.fromEntries(legacyFields.map(key => [key, artwork[key]]));
    assert.equal(createHash('sha256').update(JSON.stringify(data)).digest('hex'), expected, 'Original artwork data changed: ' + id);
  }
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
