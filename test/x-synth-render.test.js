import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import { renderXSynth, sweepXDirections, occlusionFactors, cameraFromFov, makeRng, X_SYNTH_TRUTH_SCHEMA } from '../tools/x-synth-render.mjs';
import { encodeX, decodeX } from '../src/x-codec.js';
import { xCameraLookAt, xProjectSites } from '../src/x-project.js';
import { xSiteId } from '../src/x-layout.js';

const SMALL = { profile: 'X0', text: 'synth', width: 160, height: 120, fov: 40, az: 35, el: 25, seed: 3 };

test('renderXSynth — 결정적(같은 입력 → 같은 PNG/luma sha), 크기·범위', () => {
  const a = renderXSynth(SMALL), b = renderXSynth(SMALL);
  assert.equal(a.truth.imageSha256, b.truth.imageSha256);
  assert.equal(createHash('sha256').update(Buffer.from(a.luma.buffer)).digest('hex'), createHash('sha256').update(Buffer.from(b.luma.buffer)).digest('hex'));
  assert.equal(a.width * a.height, a.luma.length);
  assert.ok([...a.luma].every(v => v >= 0 && v <= 1));
  assert.equal(Buffer.from(a.png.subarray(1, 4)).toString('latin1'), 'PNG');
  const c = renderXSynth({ ...SMALL, seed: 4 });
  assert.notEqual(a.truth.imageSha256, c.truth.imageSha256, '잡음 seed 가 다르면 이미지가 달라요');
});

test('renderXSynth — truth 는 encodeX 레벨·복호 가능·사이트 수 보존, blind 에는 정답 키가 없어요', () => {
  const r = renderXSynth(SMALL);
  const enc = encodeX('synth', 'X0');
  assert.deepEqual(r.truth.levels, Array.from(enc.levels));
  assert.deepEqual(r.truth.digits, Array.from(enc.digits));
  assert.ok(decodeX({ levels: r.truth.levels }, 'X0').ok);
  assert.equal(r.truth.schemaVersion, X_SYNTH_TRUTH_SCHEMA);
  assert.equal(r.truth.audience, 'evaluator-only');
  assert.equal(r.truth.points.length, 512);
  assert.ok(r.truth.points.every((p, i) => p.siteId === i), 'points 는 siteId 오름차순·고유');
  assert.equal(Object.values(r.truth.visibilityCounts).reduce((x, y) => x + y, 0), 512);
  assert.equal(r.truth.visibilityCounts.off, 512 - Array.from(enc.levels).filter(Boolean).length);
  assert.deepEqual(r.truth.profile, { profileId: 'X0', layoutId: 'lee-fo-v1', N: 8, c: 0, tones: 2, ecc: 'M' });
  for (const key of ['pose', 'levels', 'digits', 'points', 'text', 'overlap', 'visibility', 'dropout', 'profile']) assert.ok(!(key in r.blind), `blind 에 ${key} 금지`);
  assert.deepEqual(Object.keys(r.blind).sort(), ['camera', 'height', 'imageSha256', 'lumaFormat', 'schemaVersion', 'width']);
  assert.equal(r.blind.imageSha256, r.truth.imageSha256);
});

test('renderXSynth — 점등 사이트 자리는 배경보다 밝고, 소등 자리(겹침 없음)는 배경 근처예요', () => {
  const r = renderXSynth({ ...SMALL, noise: 0, width: 320, height: 240 });
  const { width } = r;
  const at = p => r.luma[Math.floor(p.v) * width + Math.floor(p.u)];
  const litVisible = r.truth.points.filter(p => r.truth.visibility[p.siteId] === 'visible');
  assert.ok(litVisible.length > 100);
  // 디스크 r1.6 · gain .8 · σ1 → 중심 피크 ≈ .8·(1−e^{−r²/2σ²}) ≈ .58, 먼 모서리 falloff(21/27)² ≈ .6 → ≥ .3 대. 배경 .04 대비 충분히 밝은 .2 로 잠가요.
  assert.ok(litVisible.every(p => at(p) > 0.2), `가시 점등 사이트 중심은 밝아요 (min ${Math.min(...litVisible.map(at)).toFixed(3)})`);
  // «이웃 없는» 은 가시 점등만이 아니라 프레임 안 점등 전부(겹침·포화 포함)에서 6 px 이상 떨어진 자리
  const litAll = r.truth.points.filter(p => r.truth.levels[p.siteId] > 0 && p.inFrame);
  const offFar = r.truth.points.filter(p => r.truth.visibility[p.siteId] === 'off' && p.inFrame
    && litAll.every(q => Math.hypot(q.u - p.u, q.v - p.v) > 6));
  assert.ok(offFar.length > 20);
  assert.ok(offFar.every(p => at(p) < 0.1), '이웃 없는 소등 자리는 배경 근처');
});

test('renderXSynth — emitterFailure 는 truth 메타에만 기록되고 레벨을 끄며, 정면은 overlap 이 비스듬보다 많아요', () => {
  const killed = renderXSynth({ ...SMALL, kill: 0.1, seed: 11 });
  assert.ok(killed.truth.dropout.emitterFailure.length > 5);
  const enc = encodeX('synth', 'X0');
  for (const s of killed.truth.dropout.emitterFailure) { assert.equal(enc.levels[s], 1); assert.equal(killed.truth.levels[s], 0); }
  const frontal = renderXSynth({ ...SMALL, az: 0, el: 0 });
  const oblique = renderXSynth({ ...SMALL, az: 35, el: 25 });
  assert.ok((frontal.truth.visibilityCounts.overlap || 0) > (oblique.truth.visibilityCounts.overlap || 0));
});

test('occlusionFactors — 앞의 점등이 감쇠하고, none 은 항등', () => {
  const N = 8;
  const pose = xCameraLookAt({ N, azimuth: 0, elevation: 0 });
  const { points } = xProjectSites({ N, pose, camera: cameraFromFov({ width: 320, height: 240, fov: 40 }) });
  const lit = new Uint8Array(N ** 3).fill(1);
  const none = occlusionFactors(points, lit, { occlusion: 'none', alphaLit: 0.35, alphaBody: 0.08, occRadius: 3 });
  assert.ok([...none.factor].every(f => f === 1));
  const front = occlusionFactors(points, lit, { occlusion: 'front', alphaLit: 0.35, alphaBody: 0.08, occRadius: 3 });
  // 정면: 중심 열 (3,3,z)·(4,4,z) 등은 앞의 z 가 클수록 가림 수가 늘어요 — 가장 뒤(z=0) 가 가장 어둡고 맨 앞(z=7) 은 항등
  // (siteId 는 계약 X.1 `(x·N+y)·N+z` — 손 공식 대신 xSiteId. 손 공식을 뒤집어 쓰면 «열» 이 x 를 훑어 Z 가 상수가 돼요.)
  const id = (x, y, z) => xSiteId(N, [x, y, z]);
  assert.equal(front.factor[id(3, 3, 7)], 1);
  assert.ok(front.factor[id(3, 3, 0)] < front.factor[id(3, 3, 4)]);
  assert.ok(front.litFront[id(3, 3, 0)] >= 4);
  // 점등 앞 하나(z=1) + 소등 몸체 여럿(z=2…7 중 occRadius 안) — 계수는 정확히 (1−αL)^lit·(1−αB)^body
  const two = Uint8Array.from(lit, (_, s) => (s === id(3, 3, 0) || s === id(3, 3, 1) ? 1 : 0));
  const body = occlusionFactors(points, two, { occlusion: 'front', alphaLit: 0.35, alphaBody: 0.08, occRadius: 3 });
  assert.equal(body.litFront[id(3, 3, 0)], 1);
  assert.ok(body.bodyFront[id(3, 3, 0)] >= 1);
  assert.ok(Math.abs(body.factor[id(3, 3, 0)] - 0.65 * 0.92 ** body.bodyFront[id(3, 3, 0)]) < 1e-12);
  assert.ok(Math.abs(body.factor[id(3, 3, 1)] - 0.92 ** body.bodyFront[id(3, 3, 1)]) < 1e-12);
});

test('sweepXDirections — 격자 행 수·필드·정면 방향의 minPair 0', () => {
  const sweep = sweepXDirections({ profile: 'X0', azStep: 45, elStep: 45, width: 320, height: 240, fov: 40 });
  assert.equal(sweep.rows.length, 8 * 3); // az 0..315 × el −45,0,45
  const frontal = sweep.rows.find(r => r.azDeg === 0 && r.elDeg === 0);
  assert.equal(frontal.minPairPx, 0);
  assert.ok(sweep.rows.every(r => r.overlapFraction >= 0 && r.overlapFraction <= 1 && r.pitchPx > 0));
  // 축 정렬 4 방향(az 0/90/180/270, el 0)은 열이 정확히 겹쳐 minPair 0, 비스듬한 방향은 0 보다 크고 겹침 비율도 낮아요
  const axial = sweep.rows.filter(r => r.elDeg === 0 && r.azDeg % 90 === 0);
  assert.equal(axial.length, 4);
  assert.ok(axial.every(r => r.minPairPx === 0));
  const oblique = sweep.rows.filter(r => r.elDeg !== 0 && r.azDeg % 90 === 45);
  assert.ok(oblique.length >= 4 && oblique.every(r => r.minPairPx > 0));
  const mean = rows => rows.reduce((a, r) => a + r.overlapFraction, 0) / rows.length;
  assert.ok(mean(oblique) < mean(axial), `비스듬 ${mean(oblique)} < 축정렬 ${mean(axial)}`);
  assert.deepEqual(sweep.profile, { profileId: 'X0', layoutId: 'lee-fo-v1', N: 8, c: 0, tones: 2 });
});

test('makeRng — seed 재현, uint32 밖·비정수 seed 는 거절(alias 금지)', () => {
  const a = makeRng(9), b = makeRng(9);
  for (let i = 0; i < 5; i += 1) assert.equal(a(), b());
  assert.throws(() => makeRng(4294967297), RangeError); // 1 과 같은 열을 내던 alias
  assert.throws(() => makeRng(1.5), RangeError);
  assert.throws(() => makeRng(-1), RangeError);
  assert.throws(() => renderXSynth({ ...SMALL, seed: 4294967297 }), RangeError);
  assert.equal(renderXSynth(SMALL).truth.render.effectiveSeed, SMALL.seed);
});

test('renderXSynth/sweep — 자원·범위 경계는 배열 생성 전에 거절(codex REPORT_004)', () => {
  assert.throws(() => renderXSynth({ ...SMALL, width: 16, height: 16, sat: 0 }), /sat/);
  assert.throws(() => renderXSynth({ ...SMALL, sat: Infinity }), /sat/);
  assert.throws(() => renderXSynth({ ...SMALL, width: 2001, height: 2000 }), /px/);
  assert.throws(() => renderXSynth({ ...SMALL, width: 100.5 }), /width/);
  assert.throws(() => renderXSynth({ ...SMALL, radius: 1000 }), /radius/);
  assert.throws(() => renderXSynth({ ...SMALL, psf: NaN }), /psf/);
  assert.throws(() => renderXSynth({ ...SMALL, occlusion: 'magic' }), /occlusion/);
  assert.throws(() => renderXSynth({ ...SMALL, kill: 1.5 }), /kill/);
  assert.throws(() => renderXSynth({ ...SMALL, fov: 180 }), /fov/);
  assert.throws(() => sweepXDirections({ profile: 'X0', azStep: 0 }), /azStep/);
  assert.throws(() => sweepXDirections({ profile: 'X0', azStep: -15 }), /azStep/);
  assert.throws(() => sweepXDirections({ profile: 'X0', elStep: -15 }), /elStep/);
  assert.throws(() => sweepXDirections({ profile: 'X0', azStep: 0.001, elStep: 0.001 }), /방향 수/);
  // 16×16 sat 정상값은 유한 luma
  const tiny = renderXSynth({ ...SMALL, width: 16, height: 16 });
  assert.ok([...tiny.luma].every(Number.isFinite));
});

test('renderXSynth — emission 과 visibility 를 구별하고, physicalOcclusion 은 라벨과 무관하게 factor 로 뽑아요', () => {
  const r = renderXSynth({ ...SMALL, az: 0, el: 0, occlusion: 'front', alphaLit: 0.6, occRadius: 8, width: 320, height: 240 });
  assert.equal(r.truth.emission.length, 512);
  assert.ok(r.truth.emission.every(e => ['on', 'off', 'failed'].includes(e)));
  assert.equal(r.truth.emission.filter(e => e === 'on').length, r.truth.levels.filter(Boolean).length);
  assert.equal(r.truth.render.occludedThreshold, 0.5);
  const thr = r.truth.render.occludedThreshold;
  const byFactor = r.truth.points.filter(p => r.truth.levels[p.siteId] > 0 && r.truth.perSite[p.siteId]?.occlusionFactor < thr).map(p => p.siteId);
  assert.deepEqual(r.truth.dropout.physicalOcclusion, byFactor);
  // 정면 + 큰 occRadius: 겹침 라벨을 받은 자리 중에도 감쇠가 큰 사이트가 있고, 그것도 physicalOcclusion 에 들어가요
  const overlapButOccluded = byFactor.filter(s => r.truth.visibility[s] === 'overlap');
  assert.ok(overlapButOccluded.length > 0, '겹침 라벨 아래 숨은 감쇠 사건이 dropout 에 남아요');
  assert.ok(r.truth.conventions.emission.includes('승격 금지'));
});

test('x-synth-render — argv[1] 없는 node -e import 에서도 throw 하지 않아요(라이브러리 import 회귀)', () => {
  const { spawnSync } = require('node:child_process');
  const out = spawnSync(process.execPath, ['-e', "import('./tools/x-synth-render.mjs').then(m => console.log(typeof m.renderXSynth))"], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  assert.equal(out.stdout.trim(), 'function');
});
