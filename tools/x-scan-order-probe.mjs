#!/usr/bin/env node
/**
 * x-scan-order-probe — rd-4 «scan order × 블록 배정» 측정 하네스(합성 가림 3모델, 블록별 e/s).
 *
 * 질문: 사이트 관측 실패가 공간적으로 뭉칠 때(가림·시야 겹침·손가락) RS 블록 하나에 소거가 몰려 «한 블록 실패 = 프레임 실패» 가
 * 되는가, 그리고 scan order(digit → 심볼 → 블록 순서)와 블록 배정(연속 vs 인터리브)이 그 확률을 얼마나 바꾸는가.
 * v0 는 단일 RS 블록(≤210 심볼)이라 순서가 정정 능력에 영향을 주지 않아요 — 그래서 이 하네스는 ① v0 의 e/s 분포(nsym 표 근거)와
 * ② 가상의 B 블록 분할(N12+ 또는 강제 --blocks) 에서 순서·배정 효과를 함께 재요. 결론을 «scanOrderHash 잠금» 에 쓰려면 rd-4 ledger 로.
 *
 * 가림 3모델(사이트 단위 미관측 집합 U):
 *   dropout   — 독립 Bernoulli(p): 발광체 고장/검출 누락(공간 무상관)
 *   blob      — 세계 좌표 구(반지름 r·pitch, 중심 무작위) 안 사이트 전부 미관측: 손가락·스티커·근접 가림(공간 뭉침)
 *   view      — 무작위 시선(방위·고도 균일, D/L, 640×480 fov 40) 순투영의 overlap ∪ outOfView 사이트(기하 자기 가림)
 * 톤 오류: 관측된 사이트가 확률 q 로 반전 → 트리플 패턴이 불법(000/111)이면 소거, 합법이지만 다른 digit 이면 오류.
 * 심볼(3 digit) = 소거(한 digit 이라도 소거) / 오류(소거 없고 한 digit 이라도 틀림) / 정상. 블록 b 실패 ⇔ 2·s_b + e_b > nsym_b.
 *
 * scan order 후보:
 *   cell-order-v0 — 중심 siteId 오름차순 셀 순(현행 잠정)
 *   morton-v0     — 트리플 중심(centroid) 의 Morton(Z-order) 키 순: 공간 국소 순
 *   stride-v0     — cell-order 를 B 로 stride 인터리브한 순(«순서 자체» 를 흩뿌린 대조군)
 * 블록 배정: contiguous(연속 구간) · interleaved(i mod B).
 *
 * 사용: node tools/x-scan-order-probe.mjs --profile X0 --trials 400 --blocks 1,2,3 --ecc M --seed 1 --out DIR
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { xProfileLayout, xProfile } from '../src/x-profile.js';
import { xNsymFor, xDigitFromLevels, X_ERASED, xCapacity, encodeX, decodeX } from '../src/x-codec.js';
import { packCellDigitsToSymbols } from '../src/base211.js';
import { X_CRC_ID } from '../src/x-crc.js';
import { xSiteCoord } from '../src/x-layout.js';
import { H_BINARY } from '../src/h-profile.js';
import { xCameraLookAt, xProjectSites, xOverlapMask } from '../src/x-project.js';
import { makeRng, cameraFromFov } from './x-synth-render.mjs';

export const X_SCAN_ORDER_PROBE_SCHEMA = 'TLcube:X:scan-order-probe:v0';

const DEFAULTS = Object.freeze({
  profile: 'X0', trials: 400, blocks: '1,2,3', ecc: 'M', seed: 1, q: 0.01,
  dropoutP: '0.02,0.05,0.10', blobR: '1.5,2.5,3.5', dl: 3, width: 640, height: 480, fov: 40, minSep: 5.2,
});

function morton3(x, y, z) {
  let key = 0n;
  for (let i = 0; i < 8; i += 1) {
    key |= (BigInt((x >> i) & 1) << BigInt(3 * i)) | (BigInt((y >> i) & 1) << BigInt(3 * i + 1)) | (BigInt((z >> i) & 1) << BigInt(3 * i + 2));
  }
  return key;
}

/** 후보 scan order 별 «트리플 순서» — 입력은 profileLayout.triples(cell-order) */
export function scanOrders(profileLayout, blocks) {
  const { triples, raw } = profileLayout;
  const N = raw.N;
  const centroidKey = t => {
    const c = t.map(s => xSiteCoord(N, s));
    // centroid×2 는 정수 — Morton 은 정수 입력
    const cx = c[0][0] + c[1][0] + c[2][0], cy = c[0][1] + c[1][1] + c[2][1], cz = c[0][2] + c[1][2] + c[2][2];
    return morton3(Math.round(cx * 2 / 3), Math.round(cy * 2 / 3), Math.round(cz * 2 / 3));
  };
  const morton = triples.map((t, i) => ({ t, i, k: centroidKey(t) })).sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : a.i - b.i)).map(o => o.t);
  const stride = [];
  const B = Math.max(1, blocks);
  for (let r = 0; r < B; r += 1) for (let i = r; i < triples.length; i += B) stride.push(triples[i]);
  // 주의: 이 대리지표 경로의 Morton 은 round(2·centroid) 양자화(초기 구현) — 코덱의 `morton-v0`(좌표 합, 반올림 없음)와 «다른 알고리즘» 이라
  // 이름을 갈라요. 09-19 s1~s4 원자료의 'morton-v0' 라벨은 이 legacy 정의예요(REPORT_003 §3 정정).
  return { 'cell-order-v0': triples, 'morton-round2-legacy': morton, 'stride-v0': stride };
}

/** 블록 배정: 심볼 인덱스 → 블록 */
export function blockOf(symbolIndex, symbols, blocks, assignment) {
  if (blocks <= 1) return 0;
  return assignment === 'interleaved' ? symbolIndex % blocks : Math.floor(symbolIndex * blocks / symbols);
}

/** 가림 모델 — 미관측 사이트 마스크 */
export function occlusionMask(model, param, ctx, rng) {
  const { N, sites, camera } = ctx;
  const U = new Uint8Array(sites);
  if (model === 'dropout') {
    for (let s = 0; s < sites; s += 1) if (rng() < param) U[s] = 1;
  } else if (model === 'blob') {
    const c = [rng() * (N - 1), rng() * (N - 1), rng() * (N - 1)];
    for (let s = 0; s < sites; s += 1) {
      const p = xSiteCoord(N, s);
      if (Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) <= param) U[s] = 1;
    }
  } else if (model === 'view') {
    const azimuth = rng() * 2 * Math.PI;
    const elevation = Math.asin(2 * rng() - 1);
    const pose = xCameraLookAt({ N, distanceOverWidth: ctx.dl, azimuth, elevation });
    const { points } = xProjectSites({ N, pose, camera });
    const lit = ctx.lit;
    const overlap = xOverlapMask(points, lit, param);
    for (let s = 0; s < sites; s += 1) if (!points[s].inFrame || overlap[s]) U[s] = 1;
  } else throw new RangeError(`모델: ${model}`);
  return U;
}

/** trial 의 «본문»: 트리플별 무작위 합법 digit 과 그로부터 켜지는 사이트(중심 + 패턴의 1) — 겹침 모델이 실제 점등 마스크를 쓰게 해요 */
export function drawDigits(profileLayout, rng) {
  const { triples, raw } = profileLayout;
  const lit = new Uint8Array(raw.N ** 3);
  for (const cell of raw.cells) lit[cell.centre] = 1;
  const digits = new Map();
  for (const t of triples) {
    const d = Math.floor(rng() * 6);
    digits.set(t.join(','), d);
    H_BINARY[d].forEach((v, i) => { if (v) lit[t[i]] = 1; });
  }
  return { digits, lit };
}

/** 한 trial: 순서/배정별 블록 e/s → 실패 여부. digits 는 drawDigits 의 Map(트리플 identity → digit) */
export function trial({ orders, symbols, blocks, assignments, nsymFor, U, q, rng, sites, digits }) {
  // 관측 사이트 반전 마스크(모든 순서가 같은 잡음을 공유 — 대응 표본)
  const flip = new Uint8Array(sites);
  if (q > 0) for (let s = 0; s < sites; s += 1) if (!U[s] && rng() < q) flip[s] = 1;
  const results = {};
  const classifyTriple = t => {
    const key = t.join(',');
    const d = digits ? digits.get(key) : 0;
    if (t.some(s => U[s])) return 'e';
    const pat = H_BINARY[d].map((v, i) => (flip[t[i]] ? 1 - v : v));
    const got = xDigitFromLevels(pat);
    if (got === X_ERASED) return 'e';
    return got === d ? 'ok' : 's';
  };
  // 트리플 분류는 순서와 무관 → 한 번만
  const cls = new Map();
  for (const t of orders['cell-order-v0']) cls.set(t.join(','), classifyTriple(t));
  for (const [orderId, seq] of Object.entries(orders)) {
    for (const assignment of assignments) {
      for (const B of blocks) {
        const e = new Array(B).fill(0), s = new Array(B).fill(0), count = new Array(B).fill(0);
        for (let i = 0; i < symbols; i += 1) {
          const b = blockOf(i, symbols, B, assignment);
          count[b] += 1;
          let symE = false, symS = false;
          for (let k = 0; k < 3; k += 1) {
            const c = cls.get(seq[i * 3 + k].join(','));
            if (c === 'e') symE = true; else if (c === 's') symS = true;
          }
          if (symE) e[b] += 1; else if (symS) s[b] += 1;
        }
        let fail = false;
        for (let b = 0; b < B; b += 1) if (2 * s[b] + e[b] > nsymFor(count[b])) { fail = true; break; }
        results[`${orderId}|${assignment}|B${B}`] = { fail, e, s, count };
      }
    }
  }
  return results;
}

export function runProbe(opts) {
  const o = { ...DEFAULTS, ...opts };
  // 기본(대리지표) 경로도 실행 «전» 검사 — legacy q 는 유한 scalar 하나(목록이면 거절: 이 경로는 q 를 순회하지 않아요)
  const checked = assertProbeOptions({ ...o, q: String(o.q) });
  if (checked.qs.length !== 1) throw new RangeError('runProbe 의 q 는 scalar 하나예요(목록은 --real 경로)');
  const blocksList = checked.blocks;
  const pl = xProfileLayout(o.profile);
  const N = pl.raw.N, sites = N ** 3;
  const symbols = Math.floor(pl.digits / 3);
  const camera = cameraFromFov({ width: o.width, height: o.height, fov: o.fov });
  const ctx = { N, sites, camera, dl: o.dl, lit: null }; // lit 은 trial 마다 실제 본문(drawDigits)에서 — 겹침은 «켜진» 사이트끼리만
  const nsymCache = new Map();
  const nsymFor = S => { if (!nsymCache.has(S)) nsymCache.set(S, xNsymFor(S, o.ecc)); return nsymCache.get(S); };
  const assignments = ['contiguous', 'interleaved'];
  const models = [
    ...String(o.dropoutP).split(',').map(Number).map(p => ({ model: 'dropout', param: p })),
    ...String(o.blobR).split(',').map(Number).map(r => ({ model: 'blob', param: r })),
    { model: 'view', param: o.minSep },
  ];
  const rows = [];
  for (const { model, param } of models) {
    const rng = makeRng(o.seed * 1000003 + rows.length);
    const orders = scanOrders(pl, Math.max(...blocksList));
    const agg = {};
    let unobservedSum = 0;
    for (let t = 0; t < o.trials; t += 1) {
      const { digits, lit } = drawDigits(pl, rng);
      const U = occlusionMask(model, param, { ...ctx, lit }, rng);
      // 소등 사이트의 «미관측» 은 digit 판독에 영향이 없어요(그 자리는 어차피 0) — 점등 사이트만 소거 원인으로 세요
      for (let s = 0; s < sites; s += 1) if (!lit[s]) U[s] = 0;
      unobservedSum += U.reduce((a, b) => a + b, 0);
      const r = trial({ orders, symbols, blocks: blocksList, assignments, nsymFor, U, q: o.q, rng, sites, digits });
      for (const [key, v] of Object.entries(r)) {
        if (!agg[key]) agg[key] = { fails: 0, e: [], s: [], maxE: [] };
        const a = agg[key];
        if (v.fail) a.fails += 1;
        a.e.push(v.e.reduce((x, y) => x + y, 0));
        a.s.push(v.s.reduce((x, y) => x + y, 0));
        a.maxE.push(Math.max(...v.e));
      }
    }
    const q95 = arr => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(0.95 * s.length) - 1)]; };
    const mean = arr => arr.reduce((a, b) => a + b, 0) / arr.length;
    for (const [key, a] of Object.entries(agg)) {
      const [orderId, assignment, B] = key.split('|');
      rows.push({
        profile: o.profile, N, symbols, ecc: o.ecc, model, param, orderId, assignment, blocks: Number(B.slice(1)),
        trials: o.trials, pFail: +(a.fails / o.trials).toFixed(4), meanE: +mean(a.e).toFixed(2), p95E: q95(a.e), meanS: +mean(a.s).toFixed(2),
        meanMaxBlockE: +mean(a.maxE).toFixed(2), meanUnobserved: +(unobservedSum / o.trials).toFixed(1),
        nsymPerBlock: blocksList.includes(Number(B.slice(1))) ? nsymFor(Math.ceil(symbols / Number(B.slice(1)))) : null,
      });
    }
  }
  return { schemaVersion: X_SCAN_ORDER_PROBE_SCHEMA, options: o, symbols, digits: pl.digits, rows };
}

// ─────────────────────────────────────────────────────────────────────────────
// --real 모드(codex REPORT_007 뒤): 유효 본문 encodeX → 공유 물리 사건(dropout 난수·blob 중심·시선) → 실제 decodeX.
// 순서 후보는 코덱이 지원하는 scanOrderId 만(cell-order-v0 · morton-v0), 단일 블록(v0), q 는 0 과 >0 을 갈라 실행.
// unknownMode: oracle = 소등 사이트의 미관측은 «0 으로 앎»(낙관) · conservative = 미관측이면 소등 여부와 무관하게 null(소거).
// 결과는 per-trial outcome 을 보존해 paired discordant count(순서 A 실패∧B 성공 / A 성공∧B 실패)를 복원할 수 있어요.
// ─────────────────────────────────────────────────────────────────────────────
export const REAL_ORDERS = Object.freeze(['cell-order-v0', 'morton-v0']);
export const PROBE_LIMITS = Object.freeze({ MAX_TRIALS: 20_000, MAX_WORK: 400_000, MAX_LIST: 16 });

function numList(v, name, { min = 0, max = Number.MAX_VALUE } = {}) {
  const list = (Array.isArray(v) ? v : String(v).split(',')).map(Number);
  if (list.length < 1 || list.length > PROBE_LIMITS.MAX_LIST) throw new RangeError(`${name} 목록 길이 1…${PROBE_LIMITS.MAX_LIST}`);
  for (const x of list) if (!Number.isFinite(x) || x < min || x > max) throw new RangeError(`${name} 값 범위 밖: ${Number.isFinite(x) ? x : '<non-finite>'}`);
  return list;
}

/** 실행 «전» 입력 검사 — trials/blocks/q/CSV 유한·정수·총 작업량 cap(무한 루프·과대 할당 금지) */
export function assertProbeOptions(o) {
  if (typeof o.profile !== 'string') throw new RangeError('profile 은 문자열이어야 해요');
  if (!Number.isInteger(o.trials) || o.trials < 1 || o.trials > PROBE_LIMITS.MAX_TRIALS) throw new RangeError(`trials 는 1…${PROBE_LIMITS.MAX_TRIALS} 정수`);
  if (!Number.isInteger(o.seed) || o.seed < 0 || o.seed > 4294) throw new RangeError('seed 는 0…4294 정수(모델별 파생 seed 가 uint32 안에 들게)');
  const blocks = numList(o.blocks, 'blocks', { min: 1, max: 8 });
  if (!blocks.every(Number.isInteger)) throw new RangeError('blocks 는 정수');
  const qs = numList(o.q, 'q', { min: 0, max: 1 });
  const dropout = numList(o.dropoutP, 'dropoutP', { min: 0, max: 1 });
  const blob = numList(o.blobR, 'blobR', { min: 0, max: 64 });
  for (const [k, v] of Object.entries({ width: o.width, height: o.height })) if (!Number.isInteger(v) || v < 1 || v > 4096) throw new RangeError(`${k} 는 1…4096 정수`);
  for (const [k, v] of Object.entries({ fov: o.fov, dl: o.dl, minSep: o.minSep })) if (!Number.isFinite(v) || v <= 0) throw new RangeError(`${k} 는 유한 양수`);
  if (o.unknownMode !== undefined && !['oracle', 'conservative'].includes(o.unknownMode)) throw new RangeError('unknownMode 는 oracle|conservative');
  const models = dropout.length + blob.length + 1;
  const work = o.trials * models * qs.length * Math.max(blocks.length, 1) * 3;
  if (work > PROBE_LIMITS.MAX_WORK) throw new RangeError(`총 작업량 ${work} 이 상한 ${PROBE_LIMITS.MAX_WORK} 을 넘어요`);
  return { blocks, qs, dropout, blob };
}

/** 공유 물리 사건(순서 후보끼리 대응 표본): 사이트별 dropout 난수 · blob 중심 · 시선 · 사이트별 반전 난수 */
export function drawEvent(ctx, rng) {
  const { sites } = ctx;
  const u = new Float32Array(sites), v = new Float32Array(sites);
  for (let s = 0; s < sites; s += 1) u[s] = rng();
  for (let s = 0; s < sites; s += 1) v[s] = rng();
  const centre = [rng() * (ctx.N - 1), rng() * (ctx.N - 1), rng() * (ctx.N - 1)];
  const azimuth = rng() * 2 * Math.PI, elevation = Math.asin(2 * rng() - 1);
  return { u, v, centre, azimuth, elevation };
}

/** 사건을 «이 순서의 점등 마스크» 에 적용 → 미관측 U(점등/소등 모두 포함 — unknownMode 는 뒤에서) */
export function applyEvent(model, param, event, ctx, lit) {
  const { N, sites } = ctx;
  const U = new Uint8Array(sites);
  if (model === 'dropout') { for (let s = 0; s < sites; s += 1) if (event.u[s] < param) U[s] = 1; }
  else if (model === 'blob') {
    for (let s = 0; s < sites; s += 1) { const p = xSiteCoord(N, s); if (Math.hypot(p[0] - event.centre[0], p[1] - event.centre[1], p[2] - event.centre[2]) <= param) U[s] = 1; }
  } else if (model === 'view') {
    const pose = xCameraLookAt({ N, distanceOverWidth: ctx.dl, azimuth: event.azimuth, elevation: event.elevation });
    const { points } = xProjectSites({ N, pose, camera: ctx.camera });
    const overlap = xOverlapMask(points, lit, param);
    for (let s = 0; s < sites; s += 1) if (!points[s].inFrame || overlap[s]) U[s] = 1;
  } else throw new RangeError(`모델: ${model}`);
  return U;
}

function randomText(rng, bytes) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~:/?#[]@!$&()*+,;=%';
  let s = '';
  for (let i = 0; i < bytes; i += 1) s += alphabet[Math.floor(rng() * alphabet.length)];
  return s;
}

export function runRealProbe(opts) {
  const o = { ...DEFAULTS, q: '0,0.01', unknownMode: 'oracle', ...opts };
  const { qs, dropout, blob } = assertProbeOptions(o);
  // erasureReserve 는 이 경로에서 decodeX 로 전달하지 않아요 — 메타에만 남으면 거짓 표기가 되니(codex 0056) 0/미지정 외엔 거절
  if (o.erasureReserve !== undefined && o.erasureReserve !== 0) throw new RangeError('erasureReserve 는 --real 경로 미지원(decodeX 에 전달하지 않음) — 0 또는 미지정만');
  // --crc: 프레임 CRC 옵션(rd-5 연구) 을 encode/decode 양쪽에 «명시 전달» — 성공 판정은 ok ∧ text === GT ∧ verified. CLI 는 'true'/'false' 문자열로 와요.
  const crcRaw = o.crc === 'true' ? true : o.crc === 'false' ? false : o.crc;
  if (crcRaw !== undefined && crcRaw !== false && crcRaw !== true && crcRaw !== X_CRC_ID) throw new RangeError(`crc 는 true/false/'${X_CRC_ID}' 만`);
  const crcOpt = (crcRaw === true || crcRaw === X_CRC_ID) ? { crc: X_CRC_ID } : {};
  // --rngSplit: payload 본문과 물리 사건(dropout 난수·blob 중심·시선·반전 난수)을 «다른 RNG 스트림» 에서 뽑아요 — payload 길이(예: CRC 로 30→26 B)가 바뀌어도
  // 같은 seed/trial 이 같은 물리 사건이 되게(codex 0118 on/off 대응 표본 설계). 기본 false = 기존 단일 스트림(D-3/D-3b 원자료 재현성 보존).
  const rngSplitRaw = o.rngSplit === 'true' ? true : o.rngSplit === 'false' ? false : o.rngSplit;
  if (rngSplitRaw !== undefined && rngSplitRaw !== true && rngSplitRaw !== false) throw new RangeError('rngSplit 은 true/false 만');
  const rngSplit = rngSplitRaw === true;
  const profile = xProfile(o.profile);
  const N = profile.N, sites = N ** 3;
  const camera = cameraFromFov({ width: o.width, height: o.height, fov: o.fov });
  const ctx = { N, sites, camera, dl: o.dl };
  const caps = Object.fromEntries(REAL_ORDERS.map(id => [id, xCapacity(profile, { ecc: o.ecc, scanOrderId: id, ...crcOpt })]));
  const payloadBytes = Math.min(...REAL_ORDERS.map(id => caps[id].payloadBytes));
  const models = [
    ...dropout.map(p => ({ model: 'dropout', param: p })),
    ...blob.map(r => ({ model: 'blob', param: r })),
    { model: 'view', param: o.minSep },
  ];
  const rows = [], pairs = [], outcomes = [];
  let modelIndex = 0;
  for (const { model, param } of models) {
    for (const q of qs) {
      const streamSeed = (o.seed * 1000003 + modelIndex * 101 + Math.round(q * 1000)) % 4294967296;
      const rng = makeRng(streamSeed);
      // rngSplit: payload 는 별도 스트림(streamSeed 에 고정 오프셋), 사건은 기존 스트림 — 기본(false) 이면 둘 다 같은 rng(기존 동작)
      const rngPayload = rngSplit ? makeRng((streamSeed + 0x5bd1e995) % 4294967296) : rng;
      modelIndex += 1;
      const agg = Object.fromEntries(REAL_ORDERS.map(id => [id, { fails: 0, wrongText: 0, erasures: [], corrected: [], unobservedLit: [] }]));
      const perTrial = [];
      const wrongTextEvents = []; // 조용한 오답 사건은 trial·GT·복호 본문·RS 통계까지 보존(D-3 00:42: binary outcome 만으론 재현·진단 불가)
      for (let t = 0; t < o.trials; t += 1) {
        const text = randomText(rngPayload, payloadBytes);
        const event = drawEvent(ctx, rng);
        const outcome = {};
        for (const orderId of REAL_ORDERS) {
          const enc = encodeX(text, profile, { ecc: o.ecc, scanOrderId: orderId, ...crcOpt });
          const levels = enc.levels;
          const lit = Uint8Array.from(levels, x => (x > 0 ? 1 : 0));
          const U = applyEvent(model, param, event, ctx, lit);
          const obs = new Array(sites);
          let unobservedLit = 0;
          for (let s = 0; s < sites; s += 1) {
            if (U[s]) {
              if (lit[s]) unobservedLit += 1;
              obs[s] = (o.unknownMode === 'oracle' && !lit[s]) ? 0 : null; // oracle: 소등 자리는 0 으로 «앎» · conservative: null
            } else {
              obs[s] = event.v[s] < q ? 1 - levels[s] : levels[s];
            }
          }
          const dec = decodeX({ levels: obs }, profile, { ecc: o.ecc, scanOrderId: orderId, ...crcOpt });
          const ok = dec.ok && dec.text === text && (crcOpt.crc ? dec.verified === true : true);
          const a = agg[orderId];
          if (!ok) a.fails += 1;
          if (crcOpt.crc && !dec.ok && dec.stage === 'crc') a.crcRejects = (a.crcRejects ?? 0) + 1; // CRC 가 잡은 오답 후보(길이/패딩/utf8 단계는 별도)
          if (dec.ok && dec.text !== text) {
            a.wrongText += 1;
            const nullCount = obs.reduce((n, v) => n + (v === null ? 1 : 0), 0);
            // GF(211) 심볼 수준 e/s — «2s+e > nsym» 를 직접 입증(codex 0050): 수신 digit → 심볼로 묶어 GT 코드워드와 대조
            const cap = caps[orderId];
            const recvDigits = cap.layout.triples.map(tr => xDigitFromLevels(tr.map(s => obs[s])));
            const used = recvDigits.slice(0, cap.symbols * 3);
            let symbolErasures = 0, symbolErrors = 0;
            const erasedSym = new Set();
            used.forEach((d, i) => { if (!(Number.isInteger(d) && d >= 0 && d < 6)) erasedSym.add(Math.floor(i / 3)); });
            const packed = packCellDigitsToSymbols(Uint8Array.from(used.map(d => (Number.isInteger(d) && d >= 0 && d < 6 ? d : 0))));
            for (let i = 0; i < cap.symbols; i += 1) {
              if (erasedSym.has(i) || packed.symbols[i] >= 211) symbolErasures += 1;
              else if (packed.symbols[i] !== enc.codeword[i]) symbolErrors += 1;
            }
            wrongTextEvents.push({
              model, param, q, orderId, trial: t, text, decoded: dec.text, payloadLength: dec.payloadLength,
              erasures: dec.erasures, corrected: dec.corrected, nsym: cap.nsym,
              symbolErasures, symbolErrors, budget: 2 * symbolErrors + symbolErasures, budgetExceeded: 2 * symbolErrors + symbolErasures > cap.nsym,
              unobservedLit, unobservedSites: nullCount, flippedSites: obs.reduce((n, v, s) => n + (v !== null && v !== levels[s] ? 1 : 0), 0),
            });
          }
          if (dec.ok) { a.erasures.push(dec.erasures); a.corrected.push(dec.corrected); }
          a.unobservedLit.push(unobservedLit);
          outcome[orderId] = ok ? 1 : 0;
        }
        perTrial.push(outcome);
      }
      const mean = arr => (arr.length ? arr.reduce((x, y) => x + y, 0) / arr.length : null);
      for (const orderId of REAL_ORDERS) {
        const a = agg[orderId];
        rows.push({
          profile: o.profile, N, ecc: o.ecc, symbols: caps[orderId].symbols, nsym: caps[orderId].nsym, payloadBytes, model, param, q, unknownMode: o.unknownMode, orderId,
          trials: o.trials, pFail: +(a.fails / o.trials).toFixed(4), wrongText: a.wrongText, crc: crcOpt.crc ?? null, crcRejects: crcOpt.crc ? (a.crcRejects ?? 0) : null,
          meanErasuresWhenOk: a.erasures.length ? +mean(a.erasures).toFixed(2) : null, meanCorrectedWhenOk: a.corrected.length ? +mean(a.corrected).toFixed(2) : null,
          meanUnobservedLit: +mean(a.unobservedLit).toFixed(1),
        });
      }
      const [A, B] = REAL_ORDERS;
      const b = perTrial.filter(x => x[A] === 0 && x[B] === 1).length, c = perTrial.filter(x => x[A] === 1 && x[B] === 0).length;
      pairs.push({ model, param, q, unknownMode: o.unknownMode, A, B, trials: o.trials, aFail_bOk: b, aOk_bFail: c, bothFail: perTrial.filter(x => x[A] === 0 && x[B] === 0).length, bothOk: perTrial.filter(x => x[A] === 1 && x[B] === 1).length });
      outcomes.push({ model, param, q, perTrial: perTrial.map(x => REAL_ORDERS.map(id => x[id])), wrongTextEvents });
    }
  }
  return {
    schemaVersion: 'TLcube:X:scan-order-real:v0', options: o, payloadBytes,
    // 실복호는 v0 단일 RS 블록 — options.blocks 는 이 경로에서 쓰이지 않아요(effectiveBlocks 1). CRC 는 TBD 라 «GT 본문 일치» 로 성공 판정(verified:false).
    effectiveBlocks: 1, crc: crcOpt.crc ?? null, rngSplit,
    successCriterion: crcOpt.crc ? 'decodeX ok ∧ text === GT ∧ verified (도메인 결속 CRC 통과)' : 'decodeX ok ∧ text === GT (RS/프레임 복호 + 정답 본문 대조; X domain/profile/본문 CRC 없음, verified:false)',
    orderDefinition: { 'cell-order-v0': 'cell centre siteId asc, triples in cell order', 'morton-v0': 'coordinate-sum (Σx,Σy,Σz) bit-interleave x→y→z 8 levels, ties by cell-order index, no rounding — xScanOrderCanonical golden' },
    caps: Object.fromEntries(REAL_ORDERS.map(id => [id, { symbols: caps[id].symbols, nsym: caps[id].nsym }])), rows, pairs, outcomes,
  };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]; if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) { out[a.slice(2)] = true; continue; }
    out[a.slice(2)] = /^-?\d+(\.\d+)?$/.test(next) ? Number(next) : next; i += 1;
  }
  return out;
}

if (process.argv[1]?.endsWith('x-scan-order-probe.mjs')) {
  const args = parseArgs(process.argv.slice(2));
  if (args.real) {
    const res = runRealProbe(args);
    const outDir = resolve(args.out ?? 'test/output/x-scan-order');
    mkdirSync(outDir, { recursive: true });
    const tag = `${res.crc ? '_crc' : ''}${res.rngSplit ? '_split' : ''}`; // 파일명에 crc/rngSplit 을 실어 원자료 충돌·오표기 방지
    const path = join(outDir, `${res.options.profile}_real_${res.options.unknownMode}_${res.options.ecc}_s${res.options.seed}_t${res.options.trials}${tag}.json`);
    writeFileSync(path, JSON.stringify(res, null, 1));
    console.log(`REAL profile ${res.options.profile} · payload ${res.payloadBytes} B · unknownMode ${res.options.unknownMode} · trials ${res.options.trials} → ${path}`);
    console.log('model      param  q      order          pFail   wrong  erasOk  corrOk  unobsLit');
    for (const r of res.rows) console.log(`${r.model.padEnd(10)} ${String(r.param).padEnd(6)} ${String(r.q).padEnd(6)} ${r.orderId.padEnd(14)} ${r.pFail.toFixed(3)}   ${String(r.wrongText).padStart(3)}   ${String(r.meanErasuresWhenOk ?? '-').padStart(5)}   ${String(r.meanCorrectedWhenOk ?? '-').padStart(5)}   ${r.meanUnobservedLit}`);
    console.log('pairs (A=cell-order-v0, B=morton-v0): aFail_bOk / aOk_bFail / bothFail / bothOk');
    for (const p of res.pairs) console.log(`  ${p.model.padEnd(8)} ${String(p.param).padEnd(5)} q${String(p.q).padEnd(5)} ${p.aFail_bOk} / ${p.aOk_bFail} / ${p.bothFail} / ${p.bothOk}`);
    process.exit(0);
  }
  const res = runProbe(args);
  const outDir = resolve(args.out ?? 'test/output/x-scan-order');
  mkdirSync(outDir, { recursive: true });
  const path = join(outDir, `${res.options.profile}_${res.options.ecc}_s${res.options.seed}_t${res.options.trials}.json`);
  writeFileSync(path, JSON.stringify(res, null, 1));
  console.log(`profile ${res.options.profile} · symbols ${res.symbols} · trials ${res.options.trials} → ${path}`);
  console.log('model      param  order          assign       B  pFail   meanE  p95E  meanS  maxBlkE  unobs');
  for (const r of res.rows) {
    console.log(`${r.model.padEnd(10)} ${String(r.param).padEnd(6)} ${r.orderId.padEnd(14)} ${r.assignment.padEnd(12)} ${r.blocks}  ${r.pFail.toFixed(3)}  ${String(r.meanE).padStart(5)}  ${String(r.p95E).padStart(4)}  ${String(r.meanS).padStart(5)}  ${String(r.meanMaxBlockE).padStart(7)}  ${r.meanUnobserved}`);
  }
}
