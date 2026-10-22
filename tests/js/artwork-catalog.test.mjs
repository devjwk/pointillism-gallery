import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { gunzipSync } from 'node:zlib';

const root = new URL('../../', import.meta.url);
const read = name => fs.readFile(new URL(name, root), 'utf8');
const catalogContext = vm.createContext({});
new vm.Script(await read('assets/artworks/catalog.js')).runInContext(catalogContext);
const artworks = new vm.Script('ARTWORKS').runInContext(catalogContext);
const added = {
  geumgangjeondo: '금강전도', seodang: '서당', mudong: '무동',
  'dano-pungjeong': '단오풍정', 'wolha-jeongin': '월하정인', sehando: '세한도'
};
const positiveInteger = value => Number.isInteger(value) && value > 0;
const httpsURL = value => {
  assert.equal(typeof value, 'string');
  const url = new URL(value);
  assert.equal(url.protocol, 'https:');
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  return url;
};

test('six new Joseon works have their expected unique IDs and distinct titles', () => {
  const works = artworks.filter(a => Object.hasOwn(added, a.id));
  assert.equal(works.length, 6);
  assert.equal(new Set(works.map(a => a.id)).size, 6);
  assert.equal(new Set(works.map(a => a.title)).size, 6);
  for (const [id, title] of Object.entries(added)) {
    assert.equal(works.find(a => a.id === id)?.title, title, id);
  }
});

for (const id of Object.keys(added)) {
  test(id + ': lazy gzip pixels, unscaled dimensions, honest depth and public-domain provenance', async () => {
    const a = artworks.find(a => a.id === id);
    assert(a, 'Missing new artwork ' + id);
    assert.equal(Object.hasOwn(a, 'seg'), false, 'SAM masks must not be claimed before segmentation');
    for (const key of ['w','h','dw','dh','rw','rh']) assert(positiveInteger(a[key]), id + '.' + key);
    assert(Math.max(a.w, a.h) <= 900, 'Grayscale maximum edge is 900 pixels');
    assert.equal(a.dataPath, './assets/artworks/maps/' + id + '.json');
    const map = JSON.parse(await fs.readFile(new URL(a.dataPath, root), 'utf8'));
    assert.equal(map.id, id);
    assert.equal(Object.hasOwn(map, 'seg'), false, 'Lazy payload must not claim SAM masks');
    for (const key of ['w','h','dw','dh','rw','rh']) {
      assert.equal(map[key], a[key], id + ': map/metadata dimension mismatch: ' + key);
    }
    const pixels = {};
    for (const [field, expected] of [['gray', a.w*a.h], ['depth', a.dw*a.dh], ['rgb', a.rw*a.rh*3]]) {
      assert.equal(Object.hasOwn(a, field), false, field + ' must be lazy-loaded, not embedded in the catalog');
      assert.equal(typeof map[field], 'string', field + ' must be gzip/base64');
      pixels[field] = gunzipSync(Buffer.from(map[field], 'base64'));
      assert.equal(pixels[field].length, expected, id + '.' + field + ' byte count');
    }
    let min = 255, max = 0, finite8bitCount = 0;
    const depthValues = new Set();
    for (const value of pixels.depth) {
      if (Number.isFinite(value) && Number.isInteger(value) && value >= 0 && value <= 255) finite8bitCount++;
      min = Math.min(min, value); max = Math.max(max, value); depthValues.add(value);
    }
    assert.equal(finite8bitCount, a.dw*a.dh, 'Every depth sample is a finite 8-bit value');
    assert(min < max && depthValues.size > 1, 'Depth must be nonconstant: min=' + min + ', max=' + max + ', unique=' + depthValues.size);
    assert.equal(typeof a.context, 'string');
    assert(a.context.trim().length > 0, 'A curated artwork explanation is required');
    const source = a.source;
    assert(source && typeof source === 'object');
    assert.equal(httpsURL(source.pageUrl).hostname, 'commons.wikimedia.org');
    httpsURL(source.downloadUrl);
    assert.equal(source.license, 'Public domain');
    assert.equal(source.copyrighted, 'False');
    assert.equal(source.restrictions, '');
    assert.match(source.originalSha256, /^[a-f\d]{64}$/i);
    const originalWidth = source.originalWidth ?? source.width;
    const originalHeight = source.originalHeight ?? source.height;
    assert(positiveInteger(originalWidth) && positiveInteger(originalHeight), 'Original source dimensions are required to verify no upscaling');
    assert(a.w <= originalWidth && a.h <= originalHeight, 'Grayscale must not upscale the source');
    assert(a.dw <= originalWidth && a.dh <= originalHeight, 'Depth must not upscale the source');
    assert(a.rw <= originalWidth && a.rh <= originalHeight, 'RGB must not upscale the source');
    const provenance = a.depthProvenance;
    assert.equal(provenance?.model, 'onnx-community/depth-anything-v2-small');
    assert.equal(provenance.dtype, 'q8');
    assert.equal(provenance.execution, 'browser-local');
  });
}

const panelScript = new vm.Script(await read('src/gallery/ui/segments.js'));
function panelHarness(artwork) {
  function node(tagName = 'div') {
    const classes = new Set();
    return {
      tagName, children: [], dataset: {}, style: {}, handlers: {}, _html: '',
      classList: {
        add: c => classes.add(c), remove: c => classes.delete(c),
        contains: c => classes.has(c), toggle: (c, on) => on ? classes.add(c) : classes.delete(c)
      },
      set innerHTML(value) { this._html = value; this.children = []; },
      get innerHTML() { return this._html; },
      append(...children) { this.children.push(...children); },
      appendChild(child) { this.children.push(child); return child; },
      addEventListener(event, handler) { this.handlers[event] = handler; }
    };
  }
  const elements = Object.fromEntries(['segpanel','chips','ctx','hots'].map(id => [id, node()]));
  const S = { cur: 0, lockId: 7, sel: 7 };
  const context = vm.createContext({
    URL, ART: [artwork], S,
    document: { getElementById: id => elements[id], createElement: node }
  });
  panelScript.runInContext(context);
  context.renderSegPanel();
  return { ...elements, S };
}
const anchors = element => element.children.flatMap(child => child.tagName === 'a' ? [child] : anchors(child));

test('curated explanation is escaped without inventing segmentation, and uses a safe source DOM node', () => {
  const context = '<img src=x onerror="alert(1)"> & \'quoted\'';
  const { ctx, chips, segpanel, S } = panelHarness({ meta: {
    context, source: { pageUrl: 'https://commons.wikimedia.org/wiki/File:Example.jpg' }
  } });
  assert(ctx.innerHTML.includes('<b>작품 해설</b>'));
  assert(ctx.innerHTML.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; &#39;quoted&#39;'));
  assert(!ctx.innerHTML.includes('<img'));
  assert(ctx.innerHTML.includes('아직 구성요소를 분석하지 않았어요'));
  assert(!ctx.innerHTML.includes('개의 구성요소를 구분했어요'));
  assert.equal(chips.children.length, 0);
  assert(segpanel.classList.contains('on'));
  assert.equal(S.lockId, -1); assert.equal(S.sel, -1);
  const [link] = anchors(ctx);
  assert.equal(anchors(ctx).length, 1);
  assert.equal(link.href, 'https://commons.wikimedia.org/wiki/File:Example.jpg');
  assert.equal(link.textContent, '이미지 출처 · Wikimedia Commons');
  assert.equal(link.target, '_blank');
  assert.equal(link.rel, 'noopener noreferrer');
  assert(!ctx.innerHTML.includes('<a'), 'Links must be created as DOM nodes, not interpolated HTML');
});

test('source links reject non-HTTPS, lookalike hosts, credentials, ports and malformed URLs', () => {
  for (const pageUrl of [
    'javascript:alert(1)', 'data:text/html,<script>alert(1)</script>',
    'http://commons.wikimedia.org/wiki/File:Example.jpg',
    'https://commons.wikimedia.org.evil.example/wiki/File:Example.jpg',
    'https://commons.wikimedia.org@evil.example/wiki/File:Example.jpg',
    'https://evil.example/?next=https://commons.wikimedia.org/',
    'https://user@commons.wikimedia.org/wiki/File:Example.jpg',
    'https://commons.wikimedia.org:444/wiki/File:Example.jpg',
    '//commons.wikimedia.org/wiki/File:Example.jpg', '<a href="https://commons.wikimedia.org/">'
  ]) {
    const { ctx } = panelHarness({ meta: { context: '설명', source: { pageUrl } } });
    assert.equal(anchors(ctx).length, 0, pageUrl);
  }
});

test('existing segmentation keeps its context, auto summary and hotspots, with curated fallback', () => {
  const artwork = {
    seg: { context: '기존 설명', segs: [{ id: 1, ko: '인물' }] },
    cache: { map: { segStat: { 1: { area: 1, med: 0.8, frac: 0.5 } } }, hot: [{ seg: '인물' }] }
  };
  const original = panelHarness(artwork);
  assert(original.ctx.innerHTML.startsWith('<b>맥락</b> 기존 설명'));
  assert(original.ctx.innerHTML.includes('<b>1개</b>의 구성요소를 구분했어요'));
  assert.equal(original.chips.children.length, 1);
  assert.equal(original.hots.children.length, 1);
  assert.equal(anchors(original.ctx).length, 0);
  const fallback = panelHarness({ ...artwork, seg: { ...artwork.seg, context: '' }, meta: { context: '<새 해설>' } });
  assert(fallback.ctx.innerHTML.startsWith('<b>작품 해설</b> &lt;새 해설&gt;'));
  assert(fallback.ctx.innerHTML.includes('<b>1개</b>의 구성요소를 구분했어요'));
  const preferred = panelHarness({ ...artwork, meta: { context: '무시할 해설' } });
  assert(!preferred.ctx.innerHTML.includes('무시할 해설'));
});
