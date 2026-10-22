import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { gzipSync } from 'node:zlib';

const source = await fs.readFile(new URL('../../src/gallery/analysis/image-data.js', import.meta.url), 'utf8');
const script = new vm.Script(source, { filename: 'image-data.js' });
const pack = bytes => gzipSync(Buffer.from(bytes)).toString('base64');
const grayBytes = [0, 64, 128, 255];
const depthBytes = [255, 128, 64, 0];
const rgbBytes = [255, 0, 0, 0, 255, 0, 0, 0, 255, 40, 80, 120];
const dimensions = { w: 2, h: 2, dw: 2, dh: 2, rw: 2, rh: 2 };
const mapFixture = () => ({
  id: 'test-work', ...dimensions,
  gray: pack(grayBytes), depth: pack(depthBytes), rgb: pack(rgbBytes)
});
const lazyMeta = () => ({ id: 'test-work', ...dimensions, dataPath: './assets/artworks/maps/test-work.json' });
const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

function harness(meta, fetchImpl = () => { throw new Error('Unexpected fetch'); }) {
  const artwork = { meta, gray: null };
  const calls = [];
  const context = vm.createContext({
    ART: [artwork], Blob, Response, DecompressionStream, atob,
    fetch(...args) { calls.push(args); return fetchImpl(...args); }
  });
  script.runInContext(context);
  return { context, artwork, calls, ensure: () => context.ensureGray(0) };
}
function assertDecoded(gray) {
  assert.equal(gray.w, 2); assert.equal(gray.h, 2);
  assert.deepEqual(Array.from(gray.lum), grayBytes.map(n => Math.fround(n / 255)));
  assert.deepEqual(Array.from(gray.depth), depthBytes.map(n => Math.fround(n / 255)));
  assert.equal(gray.rgb.w, 2); assert.equal(gray.rgb.h, 2);
  assert.deepEqual(Array.from(gray.rgb.data), rgbBytes);
}
function assertUncached(h) {
  assert.equal(h.artwork.gray, null);
  assert.equal(h.artwork.grayTask, null, 'Rejected in-flight work must be cleared for retry');
  assert.equal(h.artwork.seg, undefined);
}

test('legacy embedded maps decode without fetch and retain their segmentation', async () => {
  const meta = { ...mapFixture(), seg: { w: 2, h: 2, ids: pack([1, 1, 0, 2]), segs: [{ id: 1, ko: '인물' }], context: '기존 해설' } };
  const h = harness(meta);
  const gray = await h.ensure();
  assertDecoded(gray);
  assert.equal(h.calls.length, 0);
  assert.deepEqual(Array.from(gray.segIds), [1, 1, 0, 2]);
  assert.equal(h.artwork.seg.context, '기존 해설');
  assert.equal(h.artwork.seg.segs, meta.seg.segs);
  assert.equal(h.artwork.gray, gray);
  assert.equal(h.artwork.grayTask, null);
});

test('new-style lazy maps fetch the local JSON and decode without mutating metadata', async () => {
  const meta = lazyMeta(), before = JSON.stringify(meta);
  const h = harness(meta, path => {
    assert.equal(path, meta.dataPath);
    return jsonResponse(mapFixture());
  });
  const gray = await h.ensure();
  assertDecoded(gray);
  assert.equal(h.calls.length, 1);
  assert.equal(JSON.stringify(meta), before);
  assert.equal(h.artwork.seg, undefined, 'Depth data does not imply SAM segmentation');
  assert.equal(h.artwork.gray, gray);
});

test('concurrent selection shares one fetch and subsequent selections reuse the decoded cache', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const h = harness(lazyMeta(), async () => { await gate; return jsonResponse(mapFixture()); });
  const first = h.ensure(), second = h.ensure(), third = h.ensure();
  assert.equal(h.calls.length, 1);
  assert(h.artwork.grayTask);
  assert.equal(h.artwork.gray, null);
  release();
  const results = await Promise.all([first, second, third]);
  assertDecoded(results[0]);
  assert(results.every(value => value === results[0]));
  assert.equal(await h.ensure(), results[0]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.artwork.grayTask, null);
});

test('HTTP 404 does not cache failure and a later selection retries successfully', async () => {
  let attempts = 0;
  const h = harness(lazyMeta(), () => jsonResponse(mapFixture(), ++attempts === 1 ? 404 : 200));
  await assert.rejects(h.ensure(), /HTTP 404/);
  assertUncached(h);
  assertDecoded(await h.ensure());
  assert.equal(h.calls.length, 2);
});

test('foreign and malformed data paths are rejected before any fetch', async () => {
  const invalidPaths = [
    'https://evil.example/maps/test-work.json',
    'https://commons.wikimedia.org/test-work.json',
    '//evil.example/test-work.json', '/assets/artworks/maps/test-work.json',
    './assets/artworks/maps/../test-work.json', './assets/artworks/maps/%2e%2e.json',
    './assets/artworks/maps/test-work.json?x=1', './assets/artworks/maps/test-work.json#x',
    './assets/artworks/maps/test_work.json', './assets/artworks/maps/Test-work.json',
    './assets/artworks/maps/nested/test-work.json', 'javascript:alert(1)',
    './assets/artworks/maps/test-work.json\n'
  ];
  for (const dataPath of invalidPaths) {
    const h = harness({ ...lazyMeta(), dataPath });
    await assert.rejects(h.ensure(), /올바르지 않은 작품 데이터 경로/, dataPath);
    assert.equal(h.calls.length, 0, dataPath);
    assertUncached(h);
  }
});

test('wrong map identity or any mismatched dimension is rejected without caching', async () => {
  for (const key of ['id', 'w', 'h', 'dw', 'dh', 'rw', 'rh']) {
    const map = mapFixture(); map[key] = key === 'id' ? 'other-work' : 3;
    const h = harness(lazyMeta(), () => jsonResponse(map));
    await assert.rejects(h.ensure(), new RegExp('작품 이미지 지도 정보 불일치: ' + key));
    assertUncached(h);
    assert.equal(h.calls.length, 1);
  }
});

test('missing, empty and non-string lazy payload fields are rejected without caching', async () => {
  for (const key of ['gray', 'depth', 'rgb']) {
    for (const invalid of [undefined, '', 42]) {
      const map = { ...mapFixture(), [key]: invalid };
      const h = harness(lazyMeta(), () => jsonResponse(map));
      await assert.rejects(h.ensure(), new RegExp('작품 이미지 지도 누락: ' + key));
      assertUncached(h);
    }
  }
});

test('valid gzip with truncated pixel bytes never reaches the decoded cache', async () => {
  for (const [key, bytes] of [['gray', grayBytes], ['depth', depthBytes], ['rgb', rgbBytes]]) {
    const map = { ...mapFixture(), [key]: pack(bytes.slice(0, -1)) };
    const h = harness(lazyMeta(), () => jsonResponse(map));
    await assert.rejects(h.ensure(), /작품 이미지 지도 크기가 맞지 않아요/);
    assertUncached(h);
  }
});

test('corrupt gzip rejects each channel without caching and can be retried', async () => {
  for (const key of ['gray', 'depth', 'rgb']) {
    let attempts = 0;
    const broken = { ...mapFixture(), [key]: Buffer.from('not a gzip stream').toString('base64') };
    const h = harness(lazyMeta(), () => jsonResponse(++attempts === 1 ? broken : mapFixture()));
    await assert.rejects(h.ensure());
    assertUncached(h);
    assertDecoded(await h.ensure());
    assert.equal(h.calls.length, 2);
  }
});

test('truncated legacy segmentation bytes do not publish partial gray or segmentation caches', async () => {
  const h = harness({ ...mapFixture(), seg: { w: 2, h: 2, ids: pack([1, 2, 3]), segs: [] } });
  await assert.rejects(h.ensure(), /구성요소 지도 크기가 맞지 않아요/);
  assertUncached(h);
  assert.equal(h.calls.length, 0);
});

test('embedded maps support missing RGB and resize low-resolution depth and segment IDs', async () => {
  const meta = { ...mapFixture(), dw: 1, dh: 1, depth: pack([128]), seg: { w: 1, h: 1, ids: pack([2]), segs: [{ id: 2 }] } };
  delete meta.rgb; delete meta.rw; delete meta.rh;
  const h = harness(meta);
  const gray = await h.ensure();
  assert.deepEqual(Array.from(gray.depth), Array(4).fill(Math.fround(128 / 255)));
  assert.deepEqual(Array.from(gray.segIds), [2, 2, 2, 2]);
  assert.equal(gray.rgb, undefined);
  assert.equal(h.artwork.seg.context, '');
  assert.equal(h.calls.length, 0);
});
