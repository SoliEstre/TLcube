/**
 * claude-finish-rs-kat.mjs — rs211 소거 복호 전수 KAT (레인 자 검증용, 스위트와 별개).
 *
 * 경계 전수: nsym 별로 (v 오류, s 소거) 전 조합에서 2v+s ≤ nsym 이면 복구,
 * 2v+s = nsym+1 이면 «복구했으면 값이 맞고, 못 했으면 정직하게 실패» 를 확인한다.
 *
 * r2 추가 — **nsym+2 rung**. +1 rung 이 깨끗하다고 «정직성» 이 닫히지 않는다.
 * 한 칸 더 가면 정직성이 깨지고, 깨지는 정도가 잔여 패리티 `nsym − s` 에만
 * 의존한다. 특히 `s = nsym` (소거로 패리티 예산 전액 소진) 은 검출 마진이 정확히
 * 0 이라 미선언 오류 1개가 **100% 조용히 오정정**된다 — 확률이 아니라 구조다.
 * 이 rung 을 재지 않으면 «ECC 한계의 정직성 충족» 이 절벽 바로 앞에서 멈춘
 * 측정에 근거하게 된다.
 */
import { rsEncode, rsDecode, rsDecodeWithErasures } from '../../../src/rs211.js';

const P = 211;

function lcg(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1103515245 + 12345) >>> 0;
    return s;
  };
}

function makeMessage(k, seed) {
  const rand = lcg(seed);
  const msg = new Uint8Array(k);
  for (let i = 0; i < k; i += 1) msg[i] = rand() % P;
  return msg;
}

/** 서로 다른 위치 count 개를 결정적으로 고른다. */
function pickPositions(n, count, seed) {
  const rand = lcg(seed);
  const chosen = new Set();
  while (chosen.size < count) chosen.add(rand() % n);
  return [...chosen].sort((a, b) => a - b);
}

function corrupt(cw, positions, seed) {
  const rand = lcg(seed);
  const out = cw.slice();
  for (const p of positions) {
    let delta = 1 + (rand() % (P - 1));
    out[p] = (out[p] + delta) % P;
  }
  return out;
}

const rows = [];
let checked = 0;
let recoveredBeyond = 0;
let honestFailBeyond = 0;
let wrongBeyond = 0;

for (const nsym of [3, 7, 11, 14, 22, 23, 37]) {
  const k = 40;
  const msg = makeMessage(k, nsym * 7919 + 1);
  const cw = rsEncode(msg, nsym);
  const n = cw.length;

  for (let s = 0; s <= nsym; s += 1) {
    const maxV = Math.floor((nsym - s) / 2);
    for (let v = 0; v <= maxV; v += 1) {
      const all = pickPositions(n, s + v, nsym * 131 + s * 17 + v);
      const erasurePos = all.slice(0, s);
      const errorPos = all.slice(s);
      const received = corrupt(cw, all, nsym * 977 + s * 31 + v);
      const res = rsDecodeWithErasures(received, nsym, erasurePos);
      checked += 1;
      const good = res.ok
        && res.codeword.every((value, index) => value === cw[index]);
      if (!good) {
        rows.push(`FAIL nsym=${nsym} s=${s} v=${v} reason=${res.ok ? 'value-mismatch' : res.reason}`);
      }
      if (s === 0 && v === maxV) {
        // 소거 0 이면 기존 경로와 동일해야 한다.
        const plain = rsDecode(received, nsym);
        if (plain.ok !== res.ok) rows.push(`DIVERGE nsym=${nsym} s=0 v=${v}`);
      }
      void errorPos;
    }
  }

  // 경계 초과: 2v + s = nsym + 1
  for (let s = 0; s <= nsym + 1; s += 1) {
    const rest = nsym + 1 - s;
    if (rest < 0 || rest % 2 !== 0) continue;
    const v = rest / 2;
    if (s + v > n) continue;
    const all = pickPositions(n, s + v, nsym * 555 + s * 13 + v);
    const erasurePos = all.slice(0, s);
    const received = corrupt(cw, all, nsym * 311 + s * 7 + v);
    const res = rsDecodeWithErasures(received, nsym, erasurePos);
    if (res.ok) {
      const same = res.codeword.every((value, index) => value === cw[index]);
      if (same) recoveredBeyond += 1;
      else {
        wrongBeyond += 1;
        rows.push(`SILENT-MISCORRECT nsym=${nsym} s=${s} v=${v}`);
      }
    } else {
      honestFailBeyond += 1;
    }
  }
}

console.log('checked(경계 내) =', checked);
console.log('경계 +1 (2v+s = nsym+1): 우연 복구 =', recoveredBeyond,
  '· 정직 실패 =', honestFailBeyond, '· 조용한 오정정 =', wrongBeyond);

// ---- r2: 경계 +2 rung (2v + s = nsym + 2) ---------------------------------
// 잔여 패리티 nsym − s 별로 «조용한 오정정» 을 센다. residual 0 = s = nsym = 절벽.
const rung2 = new Map();
for (const nsym of [3, 7, 11, 14, 22, 23, 37]) {
  const k = 40;
  const cw = rsEncode(makeMessage(k, nsym * 6151 + 3), nsym);
  const n = cw.length;
  for (let s = nsym; s >= 0; s -= 2) {
    const rest = nsym + 2 - s;
    if (rest % 2 !== 0) continue;
    const v = rest / 2;
    if (v > 6 || s + v > n) continue;
    const residual = nsym - s;
    const bucket = rung2.get(residual) ?? { cases: 0, honest: 0, silent: 0, lucky: 0 };
    for (let trial = 0; trial < 60; trial += 1) {
      const all = pickPositions(n, s + v, nsym * 3701 + s * 53 + trial * 7 + 1);
      const received = corrupt(cw, all, nsym * 8291 + s * 29 + trial * 11 + 5);
      const res = rsDecodeWithErasures(received, nsym, all.slice(0, s));
      bucket.cases += 1;
      if (!res.ok) bucket.honest += 1;
      else if (res.codeword.every((value, index) => value === cw[index])) bucket.lucky += 1;
      else bucket.silent += 1;
    }
    rung2.set(residual, bucket);
  }
}
console.log('경계 +2 (2v+s = nsym+2) — 잔여 패리티 nsym−s 별 조용한 오정정률:');
for (const residual of [...rung2.keys()].sort((a, b) => a - b)) {
  const b = rung2.get(residual);
  const pct = ((b.silent / b.cases) * 100).toFixed(1);
  const tag = residual === 0 ? '  ← s = nsym 절벽 (검출 마진 0)' : '';
  console.log(`  잔여 ${String(residual).padStart(2)} | ${b.cases} 케이스 | 정직 실패 ${b.honest} `
    + `| 조용한 오정정 ${b.silent} (${pct}%) | 우연 복구 ${b.lucky}${tag}`);
}
const cliff = rung2.get(0);
if (cliff && cliff.silent !== cliff.cases) {
  rows.push(`CLIFF-ASSUMPTION-BROKEN 잔여 0 에서 silent ${cliff.silent} / ${cliff.cases}`);
}
console.log('→ ECC 가 방어선인 구간은 2v+s ≤ nsym+1 까지다. s 가 nsym 에 붙으면 '
  + '방어는 전적으로 상위층(base-211·길이 헤더·UTF-8·0 패딩) 몫이다.');

console.log(rows.length === 0 ? 'ALL OK' : rows.slice(0, 40).join('\n'));
