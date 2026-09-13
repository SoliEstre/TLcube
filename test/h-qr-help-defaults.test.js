/** QR 중심·전개도 도움말·Y 기본값 회귀. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createGeneratorState } from '../src/generator-state.js';
import { encodeH } from '../src/h-codec.js';
import { buildHScene } from '../src/h-render.js';
import { sceneToSvg } from '../src/svg.js';
import { qrMatrix, TL_READER_URL } from '../src/qr.js';
import { hCornerQrMetrics, hQrPosition, withHCornerQr } from '../src/generator-h-qr.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const INDEX = readFileSync(ROOT + 'index.html', 'utf8');
const QR_TEXT = TL_READER_URL;
const CORNERS = ['TL', 'TR', 'BL', 'BR'];
const PERSPECTIVES = [0, 0.18, 1];
const ROTATIONS = [[0, 0, 0], [0.31, 0.71, 0.19], [1.2, -0.47, 2.1]];

const close = (a, b, epsilon = 1e-9) => Math.abs(a - b) <= epsilon;
const orientation = (a, b, c) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
function onSegment(a, b, p) {
  return close(orientation(a, b, p), 0) && p.x >= Math.min(a.x, b.x) - 1e-9 && p.x <= Math.max(a.x, b.x) + 1e-9
    && p.y >= Math.min(a.y, b.y) - 1e-9 && p.y <= Math.max(a.y, b.y) + 1e-9;
}
function segmentsMeet(a, b, c, d) {
  const ab = orientation(a, b, c), ac = orientation(a, b, d), cd = orientation(c, d, a), ca = orientation(c, d, b);
  if (((ab > 0 && ac < 0) || (ab < 0 && ac > 0)) && ((cd > 0 && ca < 0) || (cd < 0 && ca > 0))) return true;
  return onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}
function inOrOn(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (onSegment(a, b, point)) return true;
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
function polygonsMeet(a, b) {
  for (let i = 0; i < a.length; i += 1) for (let j = 0; j < b.length; j += 1) {
    if (segmentsMeet(a[i], a[(i + 1) % a.length], b[j], b[(j + 1) % b.length])) return true;
  }
  return inOrOn(a[0], b) || inOrOn(b[0], a);
}
function qrBox(qr) {
  return [{ x: qr.x, y: qr.y }, { x: qr.x + qr.size, y: qr.y }, { x: qr.x + qr.size, y: qr.y + qr.size }, { x: qr.x, y: qr.y + qr.size }];
}

test('H 외곽 QR은 H0/H5/H7·4코너·원근/자세 전체에서 중심·bounds를 보존하고 본문과 닿지 않는다', () => {
  for (const version of [0, 5, 7]) for (const perspective of PERSPECTIVES) for (const [rotateX, rotateY, rotateZ] of ROTATIONS) {
    const encoded = encodeH('A', { version, mode: 6, finder: 'auto' });
    const base = buildHScene(encoded, { perspective, rotateX, rotateY, rotateZ, outline: true });
    const before = JSON.stringify(base);
    const centre = { x: base.width / 2, y: base.height / 2 };
    const metrics = hCornerQrMetrics(base, qrMatrix(QR_TEXT).size);
    assert.equal(metrics.quiet, 4, 'quiet zone must remain four modules');
    for (const corner of CORNERS) {
      const combined = withHCornerQr(base, { text: QR_TEXT, corner });
      assert.equal(JSON.stringify(base), before, 'base scene must remain identity-preserved');
      assert.deepEqual({ width: combined.width, height: combined.height, hModel: combined.hModel }, { width: base.width, height: base.height, hModel: base.hModel });
      assert.deepEqual(centre, { x: combined.width / 2, y: combined.height / 2 }, 'QR must not shift root centre');
      assert.equal(combined.hCornerQr.quiet, 4);
      const box = qrBox(combined.hCornerQr);
      for (const shape of base.shapes.filter((shape) => shape.kind === 'polygon')) {
        assert.equal(polygonsMeet(box, shape.points), false, `intersection ${version}/${perspective}/${corner}`);
      }
      const svg = sceneToSvg(combined);
      assert.ok(svg.includes('<polygon '), 'QR scene must serialize to SVG');
      assert.equal(sceneToSvg(combined), svg, 'SVG must remain deterministic');
    }
  }
});

test('H QR off path is reference identity and cache keys only on text while corners remain distinct', () => {
  const base = buildHScene(encodeH('h-cache', { version: 5, mode: 6, finder: 'auto' }), { perspective: 0.18 });
  assert.equal(withHCornerQr(base), base);
  assert.equal(withHCornerQr(base, { text: QR_TEXT, corner: 'none' }), base);
  assert.equal(hQrPosition('TL'), 'TL'); assert.equal(hQrPosition('inner'), 'none');
  const outputs = CORNERS.map((corner) => withHCornerQr(base, { text: QR_TEXT, corner }));
  assert.equal(new Set(outputs.map((scene) => `${scene.hCornerQr.x},${scene.hCornerQr.y}`)).size, 4);
  for (const scene of outputs) assert.equal(scene.shapes.filter((shape) => shape.qr).length, 1 + qrMatrix(QR_TEXT).modules.reduce((sum, bit) => sum + bit, 0));
  const source = readFileSync(ROOT + 'src/generator-h-qr.js', 'utf8');
  assert.match(source, /let lastQrText,lastQr;/);
  assert.match(source, /text!==lastQrText/);
});

test('H hQr state is wired through render, preview, and video paths', () => {
  for (const needle of ['const hQr=cfg.fallback.mode===\'corner\'', 'hQr: result.hQr', 'withHCornerQr(buildHScene(current.encoded,hSceneOptions()),current.hQr)', 'withHCornerQr(buildHScene(encoded,{...hPreviewOptions', 'qr={...current.hQr}']) assert.ok(INDEX.includes(needle), needle);
});

test('g1040/g1041 are unique complete eight-language help text; static notes are gone and dynamic video state stays outside help', () => {
  for (const lang of ['ko', 'en', 'ja', 'fr', 'it', 'de', 'es', 'pt']) {
    const at = INDEX.indexOf(`${lang}: {`); assert.ok(at >= 0, `${lang} dictionary`);
    const open = INDEX.indexOf('{', at); let depth = 0; let end = -1;
    for (let i = open; i < INDEX.length; i += 1) { if (INDEX[i] === '{') depth += 1; else if (INDEX[i] === '}' && --depth === 0) { end = i; break; } }
    const body = INDEX.slice(open, end);
    for (const key of ['g1040', 'g1041']) {
    const values = [...body.matchAll(new RegExp(`"${key}":\\s*("(?:\\\\.|[^"\\\\])*")`, 'g'))].map((match) => JSON.parse(match[1]));
    assert.equal(values.length, 1, `${lang}/${key} must be unique`);
    assert.ok(values[0].length > 80, `${lang}/${key} must be complete help text`);
    if (lang !== 'ko') assert.doesNotMatch(values[0], /[가-힣]/, `${lang}/${key} Korean fallback`);
    }
  }
  assert.doesNotMatch(INDEX, /data-cube-label="(?:note|snapshot)"/);
  const video = INDEX.slice(INDEX.indexOf('id="cubeVideoSection"'), INDEX.indexOf('id="backdropSection"'));
  assert.match(video, /data-help="g1041"/);
  for (const id of ['cubeVideoDuration', 'cubeVideoStatus', 'cancelCubeVideo']) assert.match(video, new RegExp(`id="${id}"`));
  assert.match(video, /role="status" aria-live="polite"/);
});

test('fresh first paint is Y/2.5D and explicit O/H are never coerced', () => {
  const fresh = createGeneratorState();
  assert.deepEqual({ type: fresh.type, representation: fresh.yRepresentation, faces: fresh.hFaces }, { type: 'Y', representation: '2.5d', faces: 3 });
  assert.equal(createGeneratorState({ type: 'O' }).type, 'O');
  const h = createGeneratorState({ type: 'Y', yRepresentation: '3d', hFaces: 6, orbitPersp: 0 });
  assert.deepEqual({ representation: h.yRepresentation, faces: h.hFaces, perspective: h.orbitPersp }, { representation: '3d', faces: 6, perspective: 0 });
  assert.match(INDEX, /toggle-card active" data-type="Y"/);
  assert.match(INDEX, /const generatorState = createGeneratorState\(\);/);
});
