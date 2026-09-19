#!/usr/bin/env node
/**
 * x-synth-render — Type X 합성 렌더(rd-8) · truth JSON · 방향 정규화 표.
 *
 * 무엇을 만드나:
 *   render 모드: profile + 본문 → encodeX 레벨 → 알려진 pose 로 pinhole 순투영 → 점광원 splat(디스크 ⊗ 가우시안 PSF)
 *               → 가림 감쇠 → 배경·잡음·포화 → 8-bit PNG(회색) + `.truth.json`(평가기 전용) + `.luma`(blind 입력용 Float32 0…1).
 *   sweep 모드:  이미지 없이 방위·고도 격자에서 «겹침 비율 · 최소 화면 간격/pitchPx» 를 재서 `sweep.json` 에 표로 — «나쁜 방향» 목록.
 *
 * 경계(계약 X 불변 1): truth JSON 은 평가기만 읽어요. blind 경로(codex x-observer)에는 `.luma`/PNG + camera 만 건너가고,
 * pose·siteId·levels·seed 는 DTO allowlist 밖이에요. 이 도구는 그 분리를 «파일을 갈라서» 지켜요.
 *
 * 사용:
 *   node tools/x-synth-render.mjs --profile X0 --text "https://tl.estre.so/x" --out test/output/x-synth \
 *        [--az 35 --el 25 --roll 0 --dl 3] [--width 640 --height 480 --fov 40] \
 *        [--radius 1.6 --psf 1.0 --gain 0.8 --bg 0.04 --noise 0.01 --sat 1.0 --falloff 1] \
 *        [--occlusion none|front --alphaLit 0.35 --alphaBody 0.08 --occRadius 1.0] [--kill 0.0] [--seed 1] [--name NAME]
 *   node tools/x-synth-render.mjs --profile X0 --sweep --out test/output/x-synth [--azStep 15 --elStep 15 --dl 3 --minSep 2.5]
 *
 * 단위: 각도는 도(°), 길이는 px, radius/psf/occRadius/minSep 는 «pitchPx 배수» 가 아니라 px — truth 에 pitchPx 를 같이 적어 정규화해요.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { encodeX, xCapacity } from '../src/x-codec.js';
import { xProfile, xProfileDto } from '../src/x-profile.js';
import { X_CAMERA_MODEL, xCameraLookAt, xProjectSites, xOverlapMask } from '../src/x-project.js';
import { xSiteCoord } from '../src/x-layout.js';
import { rasterToPng } from '../src/png.js';

export const X_SYNTH_TRUTH_SCHEMA = 'TLcube:X:synth-truth:v0';
export const X_SYNTH_SWEEP_SCHEMA = 'TLcube:X:synth-sweep:v0';

const DEG = Math.PI / 180;

export const RENDER_DEFAULTS = Object.freeze({
  az: 35, el: 25, roll: 0, dl: 3,
  width: 640, height: 480, fov: 40,
  radius: 1.6, psf: 1.0, gain: 0.8, bg: 0.04, noise: 0.01, sat: 1.0, falloff: 1,
  occlusion: 'none', alphaLit: 0.35, alphaBody: 0.08, occRadius: 3.2, // occRadius 기본 = 2·radius(디스크가 실제로 겹치는 거리)
  kill: 0, seed: 1,
});

/** mulberry32 — 결정적 PRNG(seed 로 재현) */
export function makeRng(seed) {
  let a = seed >>> 0;
  return () => { a += 0x6D2B79F5; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function gaussian(rng) { const u = 1 - rng(), v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

export function cameraFromFov({ width, height, fov }) {
  const fx = (width / 2) / Math.tan((fov * DEG) / 2);
  return { model: X_CAMERA_MODEL, width, height, fx, fy: fx, cx: width / 2, cy: height / 2 };
}

/**
 * 가림 계수 — 각 점등 사이트 앞(더 작은 z)에 화면 거리 < occRadius 인 사이트가 몇 개 있는지 세고,
 * 점등이면 (1−alphaLit), 소등 몸체면 (1−alphaBody) 를 곱해요. X-A 는 투명 구조를 가정하지만 LED 몸체는 조금 가려요(가설 X.7).
 */
export function occlusionFactors(points, lit, { occlusion, alphaLit, alphaBody, occRadius }) {
  const n = points.length;
  const factor = new Float64Array(n).fill(1);
  const litFront = new Uint16Array(n), bodyFront = new Uint16Array(n);
  if (occlusion === 'none' || !(occRadius > 0)) return { factor, litFront, bodyFront };
  const inFrame = points.filter(p => p.inFrame);
  const cell = occRadius;
  const grid = new Map();
  const key = (u, v) => `${Math.floor(u / cell)},${Math.floor(v / cell)}`;
  for (const p of inFrame) { const k = key(p.u, p.v); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(p); }
  for (const p of inFrame) {
    if (!lit[p.siteId]) continue;
    const gu = Math.floor(p.u / cell), gv = Math.floor(p.v / cell);
    for (let du = -1; du <= 1; du += 1) for (let dv = -1; dv <= 1; dv += 1) {
      const bucket = grid.get(`${gu + du},${gv + dv}`);
      if (!bucket) continue;
      for (const q of bucket) {
        if (q.siteId === p.siteId || q.z >= p.z) continue;
        if (Math.hypot(q.u - p.u, q.v - p.v) >= occRadius) continue;
        if (lit[q.siteId]) litFront[p.siteId] += 1; else bodyFront[p.siteId] += 1;
      }
    }
    factor[p.siteId] = (1 - alphaLit) ** litFront[p.siteId] * (1 - alphaBody) ** bodyFront[p.siteId];
  }
  return { factor, litFront, bodyFront };
}

/** 디스크 splat(가장자리 1px 선형 램프) → 부동소수 누적 이미지 */
function splatDisk(img, width, height, u, v, radius, amp) {
  const r = Math.max(radius, 0.5);
  const x0 = Math.max(0, Math.floor(u - r - 1)), x1 = Math.min(width - 1, Math.ceil(u + r + 1));
  const y0 = Math.max(0, Math.floor(v - r - 1)), y1 = Math.min(height - 1, Math.ceil(v + r + 1));
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      const d = Math.hypot(x + 0.5 - u, y + 0.5 - v);
      const cover = d <= r - 0.5 ? 1 : d >= r + 0.5 ? 0 : (r + 0.5 - d);
      if (cover > 0) img[y * width + x] += amp * cover;
    }
  }
}

/** 분리 가우시안 블러(σ px, 반경 3σ) — PSF */
function blurGaussian(img, width, height, sigma) {
  if (!(sigma > 0)) return img;
  const rad = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float64Array(rad * 2 + 1);
  let s = 0;
  for (let i = -rad; i <= rad; i += 1) { k[i + rad] = Math.exp(-(i * i) / (2 * sigma * sigma)); s += k[i + rad]; }
  for (let i = 0; i < k.length; i += 1) k[i] /= s;
  const tmp = new Float64Array(img.length);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let acc = 0;
    for (let i = -rad; i <= rad; i += 1) { const xx = Math.min(width - 1, Math.max(0, x + i)); acc += img[y * width + xx] * k[i + rad]; }
    tmp[y * width + x] = acc;
  }
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    let acc = 0;
    for (let i = -rad; i <= rad; i += 1) { const yy = Math.min(height - 1, Math.max(0, y + i)); acc += tmp[yy * width + x] * k[i + rad]; }
    img[y * width + x] = acc;
  }
  return img;
}

/**
 * 한 장 렌더. 반환 { luma: Float32Array(0…1, 포화 clip 뒤), png: Uint8Array, truth, blind }.
 * truth 는 평가기 전용, blind 는 관측기에 건너가는 것만 담아요(camera + 이미지 메타).
 */
export function renderXSynth(opts) {
  const o = { ...RENDER_DEFAULTS, ...opts };
  const profile = xProfile(o.profile);
  if (o.ecc) profile.ecc = o.ecc;
  const cap = xCapacity(profile);
  const text = o.text ?? 'https://tl.estre.so/x'.slice(0, cap.payloadBytes);
  const enc = encodeX(text, profile);
  const N = cap.layout.raw.N;
  const levels = Uint8Array.from(enc.levels);
  const rng = makeRng(o.seed);
  // dropout: emitterFailure — 점등 사이트 중 kill 비율을 끄고 truth 메타로만 기록(검출기 입력 아님)
  const emitterFailure = [];
  if (o.kill > 0) for (let s = 0; s < levels.length; s += 1) if (levels[s] > 0 && rng() < o.kill) { levels[s] = 0; emitterFailure.push(s); }
  const lit = Uint8Array.from(levels, v => (v > 0 ? 1 : 0));

  const camera = cameraFromFov(o);
  const pose = xCameraLookAt({ N, pitch: 1, distanceOverWidth: o.dl, azimuth: o.az * DEG, elevation: o.el * DEG, roll: o.roll * DEG });
  const { points, pitchPx } = xProjectSites({ N, pitch: 1, pose, camera });
  const minSep = 2 * o.radius + 2 * o.psf;
  const overlap = xOverlapMask(points, lit, minSep);
  const occ = occlusionFactors(points, lit, o);

  const { width, height } = camera;
  const img = new Float64Array(width * height);
  const centreDepth = pose.t[2];
  const maxLevel = profile.tones - 1;
  const perSite = new Array(points.length);
  for (const p of points) {
    const s = p.siteId;
    if (!lit[s] || !p.inFrame) { perSite[s] = null; continue; }
    const falloff = o.falloff ? (centreDepth / p.z) ** 2 : 1;
    const amp = o.gain * (levels[s] / maxLevel) * falloff * occ.factor[s];
    // 화면 반지름은 깊이에 따라 원근 스케일(중심 깊이에서 radius)
    const rPx = o.radius * (centreDepth / p.z);
    splatDisk(img, width, height, p.u, p.v, rPx, amp);
    perSite[s] = { amp, rPx, litFront: occ.litFront[s], bodyFront: occ.bodyFront[s] };
  }
  blurGaussian(img, width, height, o.psf);

  const luma = new Float32Array(width * height);
  let saturatedPx = 0;
  for (let i = 0; i < img.length; i += 1) {
    let v = img[i] + o.bg + (o.noise > 0 ? gaussian(rng) * o.noise : 0);
    if (v >= o.sat) { v = o.sat; saturatedPx += 1; }
    luma[i] = v < 0 ? 0 : v / o.sat;
  }
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < luma.length; i += 1) { const g = Math.round(luma[i] * 255); pixels[i * 4] = g; pixels[i * 4 + 1] = g; pixels[i * 4 + 2] = g; pixels[i * 4 + 3] = 255; }
  const png = rasterToPng({ width, height, pixels });
  const imageSha256 = createHash('sha256').update(png).digest('hex');

  // 사이트별 가시성 사유(truth 어휘 = X.6): 소등 off · 프레임 밖 outOfView · 겹침 overlap · 가림(감쇠 큰) occluded · 포화 saturated · 그 외 visible
  const visibility = new Array(points.length);
  for (const p of points) {
    const s = p.siteId;
    if (!lit[s]) visibility[s] = 'off';
    else if (!p.inFrame) visibility[s] = 'outOfView';
    else if (overlap[s]) visibility[s] = 'overlap';
    else if (occ.factor[s] < 0.5) visibility[s] = 'occluded';
    else if (luma[Math.floor(p.v) * width + Math.floor(p.u)] >= 0.999) visibility[s] = 'saturated'; // 픽셀 (i,j) 는 [i,i+1) — floor
    else visibility[s] = 'visible';
  }
  const counts = {};
  for (const v of visibility) counts[v] = (counts[v] || 0) + 1;

  const truth = {
    schemaVersion: X_SYNTH_TRUTH_SCHEMA,
    audience: 'evaluator-only', // blind DTO 에 절대 넣지 않아요(계약 X 불변 1) — 관측기는 .blind.json + 이미지만 받아요
    conventions: {
      transform: 'Xc = R·Xw + t (world→camera, R 3×3 row-major)',
      worldUnits: 'pitch (사이트 간격 = 1, 원점 = 큐브 중심)', cameraUnits: 'px (fx,fy,cx,cy) · z = 카메라 깊이(pitch 단위, z>0 이 카메라 앞)',
      image: 'u 오른쪽 · v 아래 · 원점 좌상단 픽셀 모서리, 픽셀 중심 = (i+0.5, j+0.5)',
      inFrame: '기하 판정(프레임 안·카메라 앞)일 뿐 광학 가시성이 아니에요 — 광학은 visibility',
      overlap: 'lit 쌍 화면 거리 < minSepPx = 2·radiusPx + 2·psfSigmaPx (양쪽 표시)',
      pitchPx: '큐브 중심 깊이에서 1 pitch 의 화면 길이 — radius/psf/occRadius/minSep 정규화 기준',
      siteId: '(x·N + y)·N + z (계약 X.1, z 가 가장 빠른 축), points 는 siteId 오름차순·고유, xyz 필드에 좌표 동봉',
    },
    profile: { ...xProfileDto(profile), ecc: profile.ecc },
    text, digits: Array.from(enc.digits), levels: Array.from(levels),
    pose: { R: pose.R, t: pose.t, azimuthDeg: o.az, elevationDeg: o.el, rollDeg: o.roll, distanceOverWidth: o.dl, distance: pose.distance, direction: pose.direction, pitch: 1 },
    camera, pitchPx, minSepPx: minSep,
    points: points.map(p => ({ siteId: p.siteId, xyz: xSiteCoord(N, p.siteId), u: p.inFront ? +p.u.toFixed(4) : null, v: p.inFront ? +p.v.toFixed(4) : null, z: +p.z.toFixed(6), inFrame: p.inFrame })),
    overlap: Array.from(overlap), visibility, visibilityCounts: counts,
    perSite,
    dropout: { emitterFailure, physicalOcclusion: visibility.map((v, s) => (v === 'occluded' ? s : -1)).filter(s => s >= 0), detectorMiss: [] },
    render: {
      radiusPx: o.radius, psfSigmaPx: o.psf, gain: o.gain, background: o.bg, noiseSigma: o.noise, saturation: o.sat, falloff: !!o.falloff,
      occlusion: o.occlusion, alphaLit: o.alphaLit, alphaBody: o.alphaBody, occRadiusPx: o.occRadius, kill: o.kill, seed: o.seed,
      saturatedPixels: saturatedPx,
    },
    imageSha256,
  };
  const blind = { schemaVersion: 'TLcube:X:synth-blind:v0', camera, width, height, imageSha256, lumaFormat: 'float32le-row-major-0to1' };
  return { luma, png, truth, blind, width, height };
}

/** 방향 격자 정규화 표 — 이미지 없이 겹침 비율·최소 간격만 재요(«나쁜 방향» 표) */
export function sweepXDirections(opts) {
  const o = { ...RENDER_DEFAULTS, azStep: 15, elStep: 15, minSep: 2.5, ...opts };
  const profile = xProfile(o.profile);
  const cap = xCapacity(profile);
  const N = cap.layout.raw.N;
  const enc = encodeX(o.text ?? 'sweep'.padEnd(Math.min(cap.payloadBytes, 5), 'x'), profile);
  const lit = Uint8Array.from(enc.levels, v => (v > 0 ? 1 : 0));
  const litCount = lit.reduce((a, b) => a + b, 0);
  const camera = cameraFromFov(o);
  const rows = [];
  // 고도 격자는 0 을 반드시 포함(정면 행이 기준점) — |el| ≤ 75 의 elStep 배수
  const elStart = -Math.floor(75 / o.elStep) * o.elStep;
  for (let el = elStart; el <= 75; el += o.elStep) {
    for (let az = 0; az < 360; az += o.azStep) {
      const pose = xCameraLookAt({ N, pitch: 1, distanceOverWidth: o.dl, azimuth: az * DEG, elevation: el * DEG });
      const { points, pitchPx } = xProjectSites({ N, pitch: 1, pose, camera });
      const overlap = xOverlapMask(points, lit, o.minSep);
      const overlapCount = overlap.reduce((a, b) => a + b, 0);
      // 최소 간격(점등 쌍) — 겹침 마스크와 같은 격자로 근사하지 않고 정확히 재요(N³ 작음)
      let minPair = Infinity;
      const litPts = points.filter(p => lit[p.siteId] && p.inFrame);
      for (let i = 0; i < litPts.length; i += 1) for (let j = i + 1; j < litPts.length; j += 1) {
        const d = Math.hypot(litPts[i].u - litPts[j].u, litPts[i].v - litPts[j].v);
        if (d < minPair) minPair = d;
      }
      rows.push({ azDeg: az, elDeg: el, pitchPx: +pitchPx.toFixed(3), overlapFraction: +(overlapCount / litCount).toFixed(4), minPairPx: +minPair.toFixed(3), minPairOverPitch: +(minPair / pitchPx).toFixed(4), inFrame: points.filter(p => p.inFrame).length });
    }
  }
  const bad = rows.filter(r => r.overlapFraction > 0.1).map(r => [r.azDeg, r.elDeg, r.overlapFraction]);
  return { schemaVersion: X_SYNTH_SWEEP_SCHEMA, profile: xProfileDto(profile), litCount, camera, distanceOverWidth: o.dl, minSepPx: o.minSep, azStep: o.azStep, elStep: o.elStep, rows, badDirections: bad };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out[key] = true; continue; }
    out[key] = Number.isFinite(Number(next)) && next.trim() !== '' ? Number(next) : next;
    i += 1;
  }
  return out;
}

function writeLuma(path, luma) {
  writeFileSync(path, Buffer.from(luma.buffer, luma.byteOffset, luma.byteLength));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.profile) { console.error('usage: --profile X0 [--text ...] --out DIR [--sweep] [render options]'); process.exit(2); }
  const outDir = resolve(args.out ?? 'test/output/x-synth');
  mkdirSync(outDir, { recursive: true });
  if (args.sweep) {
    const sweep = sweepXDirections(args);
    const path = join(outDir, `${args.profile}_sweep_dl${sweep.distanceOverWidth}.json`);
    writeFileSync(path, JSON.stringify(sweep, null, 1));
    const worst = [...sweep.rows].sort((a, b) => b.overlapFraction - a.overlapFraction).slice(0, 8);
    console.log(`sweep ${sweep.rows.length} directions · lit ${sweep.litCount} · bad(>10%) ${sweep.badDirections.length} → ${path}`);
    for (const r of worst) console.log(`  az ${String(r.azDeg).padStart(3)} el ${String(r.elDeg).padStart(4)}  overlap ${(r.overlapFraction * 100).toFixed(1)}%  minPair ${r.minPairOverPitch} pitch`);
    return;
  }
  const r = renderXSynth(args);
  const name = args.name ?? `${args.profile}_az${r.truth.pose.azimuthDeg}_el${r.truth.pose.elevationDeg}_r${r.truth.pose.rollDeg}_dl${r.truth.pose.distanceOverWidth}_s${r.truth.render.seed}`;
  writeFileSync(join(outDir, `${name}.png`), r.png);
  writeFileSync(join(outDir, `${name}.truth.json`), JSON.stringify(r.truth));
  writeFileSync(join(outDir, `${name}.blind.json`), JSON.stringify(r.blind, null, 1));
  writeLuma(join(outDir, `${name}.${r.width}x${r.height}.f32.luma`), r.luma);
  const c = r.truth.visibilityCounts;
  console.log(`${name}: ${r.width}×${r.height} pitchPx ${r.truth.pitchPx.toFixed(2)} · visible ${c.visible || 0} overlap ${c.overlap || 0} occluded ${c.occluded || 0} saturated ${c.saturated || 0} off ${c.off || 0} outOfView ${c.outOfView || 0} · sha ${r.truth.imageSha256.slice(0, 12)}`);
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/')}` || process.argv[1]?.endsWith('x-synth-render.mjs')) {
  main().catch(err => { console.error(err); process.exit(1); });
}
