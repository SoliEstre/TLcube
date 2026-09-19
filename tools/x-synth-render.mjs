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
import { pathToFileURL } from 'node:url';
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

/** 렌더 자원 상한 — D-2 blind DTO 의 4 Mpx 와 맞추고, 커널/작업량이 무제한이 되지 않게 해요(codex REPORT_004) */
export const RENDER_LIMITS = Object.freeze({ MAX_PIXELS: 4_000_000, MAX_RADIUS_PX: 64, MAX_PSF_SIGMA_PX: 32, MAX_OCC_RADIUS_PX: 64, MAX_SEED: 0xFFFFFFFF, MAX_SWEEP_DIRECTIONS: 100_000 });

function finitePos(v, name, { min = Number.MIN_VALUE, max = Number.MAX_VALUE, integer = false } = {}) {
  if (!Number.isFinite(v) || v < min || v > max || (integer && !Number.isInteger(v))) throw new RangeError(`${name} 범위 밖: ${v}`);
  return v;
}

/** 옵션 검증 — 배열을 만들기 «전에» 거절해요(sat 0 → NaN luma, 과대 크기 → 성공한 척 하는 D-2 거절 입력 방지) */
export function assertRenderOptions(o) {
  finitePos(o.width, 'width', { min: 1, integer: true }); finitePos(o.height, 'height', { min: 1, integer: true });
  if (o.width * o.height > RENDER_LIMITS.MAX_PIXELS) throw new RangeError(`width×height 가 ${RENDER_LIMITS.MAX_PIXELS} px 를 넘어요`);
  finitePos(o.fov, 'fov', { max: 179.9 }); finitePos(o.dl, 'dl');
  for (const k of ['az', 'el', 'roll']) if (!Number.isFinite(o[k])) throw new RangeError(`${k} 가 유한수가 아니에요`);
  finitePos(o.radius, 'radius', { max: RENDER_LIMITS.MAX_RADIUS_PX }); finitePos(o.psf, 'psf', { min: 0, max: RENDER_LIMITS.MAX_PSF_SIGMA_PX });
  finitePos(o.gain, 'gain', { min: 0 }); finitePos(o.bg, 'bg', { min: 0 }); finitePos(o.noise, 'noise', { min: 0 }); finitePos(o.sat, 'sat');
  finitePos(o.alphaLit, 'alphaLit', { min: 0, max: 1 }); finitePos(o.alphaBody, 'alphaBody', { min: 0, max: 1 }); finitePos(o.occRadius, 'occRadius', { min: 0, max: RENDER_LIMITS.MAX_OCC_RADIUS_PX });
  finitePos(o.kill, 'kill', { min: 0, max: 1 });
  if (!['none', 'front'].includes(o.occlusion)) throw new RangeError(`occlusion: ${o.occlusion}`);
  finitePos(o.seed, 'seed', { min: 0, max: RENDER_LIMITS.MAX_SEED, integer: true });
  // codec: 코덱 연구 옵션 pass-through(codex 0308 — 안 넘기면 후보 평가가 기본 null 패턴을 렌더해요). 허용 키만, 값 검증은 코덱이(xCapacity 가 거절)
  if (o.codec !== undefined) {
    if (o.codec === null || typeof o.codec !== 'object' || Array.isArray(o.codec)) throw new RangeError('codec 은 객체({ecc, finderId, scanOrderId, crc})여야 해요');
    for (const k of Object.keys(o.codec)) if (!CODEC_OPTION_KEYS.includes(k)) throw new RangeError(`codec 에 알 수 없는 키: ${k} (허용 ${CODEC_OPTION_KEYS.join('/')})`);
  }
  return o;
}

/** 렌더 옵션 → 코덱 옵션(xCapacity/encodeX 에 그대로). o.ecc(구 인터페이스) 는 codec.ecc 로 합쳐요 */
export const CODEC_OPTION_KEYS = Object.freeze(['ecc', 'finderId', 'scanOrderId', 'crc']);
export function codecOptions(o) {
  return { ...(o.codec ?? {}), ...(o.ecc !== undefined && (o.codec === undefined || o.codec.ecc === undefined) ? { ecc: o.ecc } : {}) };
}

/** mulberry32 — 결정적 PRNG. seed 는 uint32 정수만(1 과 4294967297 이 같은 열을 내는 alias 를 계약으로 막아요 — effectiveSeed = seed) */
export function makeRng(seed) {
  if (!Number.isInteger(seed) || seed < 0 || seed > RENDER_LIMITS.MAX_SEED) throw new RangeError(`seed 는 0…2³²−1 정수여야 해요: ${seed}`);
  let a = seed >>> 0;
  // 상태를 매 draw uint32 로 wrap — 무제한 double 누적은 draw 4,917,759 근처(2⁵³)에서 seed 1/2 상태가 같은 double 로 합쳐졌어요(codex REPORT_006)
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
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
/** σ < PSF_NOOP_SIGMA 는 no-op(픽셀 격자보다 훨씬 좁은 PSF 는 항등) — 1e-200 같은 값은 2σ² 가 0 으로 underflow 해 0/0 커널을 냈어요(codex REPORT_006) */
export const PSF_NOOP_SIGMA = 1e-3;
function blurGaussian(img, width, height, sigma) {
  if (!(sigma >= PSF_NOOP_SIGMA)) return img;
  const rad = Math.max(1, Math.ceil(sigma * 3));
  const k = new Float64Array(rad * 2 + 1);
  let s = 0;
  for (let i = -rad; i <= rad; i += 1) { const u = i / sigma; k[i + rad] = Math.exp(-0.5 * u * u); s += k[i + rad]; }
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
  const o = assertRenderOptions({ ...RENDER_DEFAULTS, ...opts });
  const profile = xProfile(o.profile);
  const codec = codecOptions(o);
  if (codec.ecc) profile.ecc = codec.ecc;
  const cap = xCapacity(profile, codec);
  const text = o.text ?? 'https://tl.estre.so/x'.slice(0, cap.payloadBytes);
  const enc = encodeX(text, profile, codec);
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
    perSite[s] = { amp, rPx, occlusionFactor: occ.factor[s], litFront: occ.litFront[s], bodyFront: occ.bodyFront[s] };
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

  // 사이트별 «발광 상태»(emission: on/off/failed — 소등은 관측 증거가 아니라 렌더 사실) 와 «가시성 라벨»(visibility, X.6 어휘, 우선순위
  // outOfView > overlap > occluded > saturated > visible). 라벨은 하나뿐이라 겹침 자리의 감쇠 사건은 라벨에서 가려지므로,
  // 감쇠 사실은 perSite.occlusionFactor 에 따로 있고 dropout.physicalOcclusion 은 «라벨과 무관하게» factor < occludedThreshold 로 뽑아요.
  const OCCLUDED_THRESHOLD = 0.5;
  const emission = new Array(points.length);
  const visibility = new Array(points.length);
  const failedSet = new Set(emitterFailure);
  for (const p of points) {
    const s = p.siteId;
    emission[s] = failedSet.has(s) ? 'failed' : lit[s] ? 'on' : 'off';
    if (!lit[s]) visibility[s] = 'off';
    else if (!p.inFrame) visibility[s] = 'outOfView';
    else if (overlap[s]) visibility[s] = 'overlap';
    else if (occ.factor[s] < OCCLUDED_THRESHOLD) visibility[s] = 'occluded';
    else if (luma[Math.floor(p.v) * width + Math.floor(p.u)] >= 0.999) visibility[s] = 'saturated'; // 픽셀 (i,j) 는 [i,i+1) — floor
    else visibility[s] = 'visible';
  }
  const physicalOcclusion = points.filter(p => lit[p.siteId] && occ.factor[p.siteId] < OCCLUDED_THRESHOLD).map(p => p.siteId);
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
      emission: 'on|off|failed 는 렌더의 발광 사실 — 관측 DTO 의 «검증된 off 음의 근거» 로 승격 금지(어댑터는 emission 과 관측 가능성을 구별)',
      visibility: 'X.6 어휘의 단일 라벨(우선순위 outOfView > overlap > occluded > saturated > visible); 소등 사이트는 off. 감쇠 사실은 perSite.occlusionFactor',
      physicalOcclusion: 'lit ∧ occlusionFactor < render.occludedThreshold — visibility 라벨과 무관하게 뽑음',
      roll: '+π/2 픽셀 변환 (du,dv)↦(−dv,du) 는 fx=fy 한정; 일반식 (−fx/fy·dv, fy/fx·du) — 정규화 카메라 평면에서는 항상 (−y,x)',
      seed: 'uint32 정수(effectiveSeed = seed, alias 없음) — split 간 동일 seed 는 동일 잡음',
    },
    profile: { ...xProfileDto(profile), ecc: profile.ecc },
    // 실제로 인코드에 쓰인 코덱 옵션(연구 옵션 포함) — 후보 평가가 «무엇을 렌더했는가» 를 진리로 남겨요(codex 0308)
    codec: { ecc: cap.ecc, finderId: cap.layout.finderId ?? null, scanOrderId: cap.scanOrderId, crc: cap.crc ?? null, reservedSites: cap.layout.reservedSites ?? [], digits: cap.digits },
    text, digits: Array.from(enc.digits), levels: Array.from(levels),
    pose: { R: pose.R, t: pose.t, azimuthDeg: o.az, elevationDeg: o.el, rollDeg: o.roll, distanceOverWidth: o.dl, distance: pose.distance, direction: pose.direction, pitch: 1 },
    camera, pitchPx, minSepPx: minSep,
    points: points.map(p => ({ siteId: p.siteId, xyz: xSiteCoord(N, p.siteId), u: p.inFront ? +p.u.toFixed(4) : null, v: p.inFront ? +p.v.toFixed(4) : null, z: +p.z.toFixed(6), inFrame: p.inFrame })),
    overlap: Array.from(overlap), emission, visibility, visibilityCounts: counts,
    perSite,
    dropout: { emitterFailure, physicalOcclusion, detectorMiss: [] },
    render: {
      radiusPx: o.radius, psfSigmaPx: o.psf, gain: o.gain, background: o.bg, noiseSigma: o.noise, saturation: o.sat, falloff: !!o.falloff,
      occlusion: o.occlusion, alphaLit: o.alphaLit, alphaBody: o.alphaBody, occRadiusPx: o.occRadius, occludedThreshold: OCCLUDED_THRESHOLD,
      kill: o.kill, seed: o.seed, effectiveSeed: o.seed, saturatedPixels: saturatedPx,
    },
    imageSha256,
  };
  const blind = { schemaVersion: 'TLcube:X:synth-blind:v0', camera, width, height, imageSha256, lumaFormat: 'float32le-row-major-0to1' };
  return { luma, png, truth, blind, width, height };
}

/** 방향 격자 정규화 표 — 이미지 없이 겹침 비율·최소 간격만 재요(«나쁜 방향» 표) */
export function sweepXDirections(opts) {
  const o = assertRenderOptions({ ...RENDER_DEFAULTS, azStep: 15, elStep: 15, minSep: 2.5, ...opts });
  // step 은 유한 양수, 방향 수 상한(azStep 0/음수·elStep 음수는 무한 루프 — codex REPORT_004)
  finitePos(o.azStep, 'azStep'); finitePos(o.elStep, 'elStep'); finitePos(o.minSep, 'minSep', { min: 0 });
  const nAz = Math.ceil(360 / o.azStep), nEl = 2 * Math.floor(75 / o.elStep) + 1;
  if (nAz * nEl > RENDER_LIMITS.MAX_SWEEP_DIRECTIONS) throw new RangeError(`방향 수 ${nAz * nEl} 가 상한 ${RENDER_LIMITS.MAX_SWEEP_DIRECTIONS} 을 넘어요`);
  const profile = xProfile(o.profile);
  const codec = codecOptions(o);
  if (codec.ecc) profile.ecc = codec.ecc;
  const cap = xCapacity(profile, codec);
  const N = cap.layout.raw.N;
  const enc = encodeX(o.text ?? 'sweep'.padEnd(Math.min(cap.payloadBytes, 5), 'x'), profile, codec);
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
  return { schemaVersion: X_SYNTH_SWEEP_SCHEMA, profile: xProfileDto(profile), codec: { ecc: cap.ecc, finderId: cap.layout.finderId ?? null, scanOrderId: cap.scanOrderId, crc: cap.crc ?? null, digits: cap.digits }, litCount, camera, distanceOverWidth: o.dl, minSepPx: o.minSep, azStep: o.azStep, elStep: o.elStep, rows, badDirections: bad };
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

// 직접 실행 가드 — argv[1] 이 없는 `node -e "import(...)"` 에서도 throw 하지 않아요(라이브러리 import 회귀)
const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invoked === import.meta.url) {
  main().catch(err => { console.error(err); process.exit(1); });
}
