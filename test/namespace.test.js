// namespace.test.js — ADR 0006 버전 네임스페이스 게이트 (D3 축 분리 검사 · D4 신설 게이트)
//
// **이 스위트의 목적은 통과가 아니라, 앞으로 버전이 하나 늘 때 깨지는 것이다.**
//
// ADR 0006 이 4bit 버전 인덱스를 "격자 수립 경로별 독립 표"로 재해석했다. 그 대가로
// **워드 공간은 여전히 전역**이다 — 포맷 워드는 `(인덱스, ECC)` 만의 함수라 서로 다른
// 패밀리가 같은 값을 쓰면 셀에 실리는 digit 이 문자 그대로 같다. 그래서 스코핑의 실질
// 리스크는 σ-회전 충돌이 아니라 **동일-워드 별칭**이고, 그게 위험해지는 조건은 워드가
// 같다는 사실이 아니라 **오판된 가설이 실제로 데이터를 읽어낼 수 있는가**다.
//
// 실제로 초안의 A0=0 배정이 그 함정에 빠졌다(V1 의 완전 도플갱어 — 외부 자문 [C8] 의
// 몬테카를로 실측 완전 오수락 2.7e-5/L, 설계 불변식 10⁻²⁰ 대비 15자릿수 위반). ADR
// 리스크 5 가 "이 검사는 ADR 체크리스트가 아니라 테스트여야 한다"고 요구한 이유다 —
// D3-4 의 **양방향 의무**(hex 가 나중에 8\~15 를 쓸 때 tri 배정에 대해 재검사)는 사람이
// 기억할 절차로 두면 잊힌다.
//
// 표는 **인코더 출력의 포맷 digit 을 복호해서** 만든다 — 설정값이 아니라 와이어를 읽는다.
// 그래야 encodeA.js 의 `+2` 오프셋 같은 산술이 바뀌면 여기서 바로 드러난다.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { encode } from '../src/encode.js';
import { encodeY } from '../src/encodeY.js';
import { encodeA } from '../src/encodeA.js';
import { VERSIONS } from '../src/capacity.js';
import { VERSIONS_Y } from '../src/capacityY.js';
import { VERSIONS_A } from '../src/capacityA.js';
import { decodeSingle, encode as encodeFormat, ECC_LEVEL } from '../src/formatinfo.js';

const LEVELS = ['L', 'M', 'H'];
const PROBE = 'x'; // 전 버전에 들어가는 최소 페이로드

// ── 표 구성 — 인코더가 실제로 실은 인덱스를 와이어에서 읽는다 ──────────────────

/**
 * 한 배정의 기술서.
 * @typedef {{family:'hex'|'cube'|'tri', name:string, index:number,
 *            finder:'bullseye'|'centerQR'|null, tiling:string, param:number}} Assignment
 */

/** 인코더 산출물의 포맷 digit(복제 1)을 복호해 실제 와이어 인덱스를 얻는다. */
function wireIndexOf(encoded) {
  const first = Array.from(encoded.formatDigits).slice(0, 5);
  const r = decodeSingle(first);
  assert.ok(r.ok, `포맷 워드가 복호되지 않는다: ${first.join('')}`);
  return r.version;
}

/** @returns {Assignment[]} */
function buildAssignments() {
  const out = [];
  for (const spec of VERSIONS) {
    for (const centerQr of [false, true]) {
      const enc = encode(PROBE, { version: spec.version, centerQr });
      out.push({
        family: 'hex',
        name: `V${spec.version}${centerQr ? 'Q' : ''}`,
        index: wireIndexOf(enc),
        finder: centerQr ? 'centerQR' : 'bullseye',
        tiling: 'hex',
        param: enc.k,
      });
    }
  }
  for (const spec of VERSIONS_A) {
    for (const centerQr of [false, true]) {
      const enc = encodeA(PROBE, { version: spec.version, centerQr });
      out.push({
        family: 'tri',
        name: `A${spec.version}${centerQr ? 'Q' : ''}`,
        index: wireIndexOf(enc),
        finder: centerQr ? 'centerQR' : 'bullseye',
        tiling: 'hex+tri', // 육각 코어를 좌표까지 그대로 포함한다
        param: enc.k,
      });
    }
  }
  for (const spec of VERSIONS_Y) {
    const enc = encodeY(PROBE, { version: spec.version, tones: spec.tones });
    out.push({
      family: 'cube',
      name: spec.name,
      index: wireIndexOf(enc),
      finder: null, // cube 엔 중심 파인더가 없다 — hex/tri 가설이 격자를 못 세운다
      tiling: 'cube3face',
      param: enc.n,
    });
  }
  return out;
}

const ASSIGNMENTS = buildAssignments();

/**
 * hex 표의 예약 슬롯 — 아직 배정 안 됐지만 D3-4 양방향 의무의 대상이다.
 *
 * **2026-08-30: 비었다.** 종전 `{3:'V4', 7:'V4Q'}` 두 칸은 V4 «대용량»(k=12) 신설로
 * **실배정**이 됐다 — 예약이 예약대로 쓰였다. 그래서 「예약 슬롯 ↔ tri 배정」의
 * 가정적 의무는 사라지고, 그 자리를 **실제 별칭 검사**(아래 ② ③)가 이어받는다:
 * A0Q(3, k6) ↔ V4(3, k12) 가 이제 살아 있는 별칭 쌍이고 축 분리를 실제로 잰다.
 * 아래 '양방향 의무' 테스트가 이 이관을 명시적으로 확인한다 — 빈 객체를 조용히
 * 두면 «예약이 없어졌다» 와 «검사를 지웠다» 가 똑같이 생긴다.
 */
const HEX_RESERVED = Object.freeze({});

describe('D2 무재배정 동결 — 기존 배정의 와이어 인덱스는 불변', () => {
  test('전 배정의 (이름 → 인덱스) 가 ADR 0006 D2·D3 표와 정확히 일치', () => {
    const actual = Object.fromEntries(ASSIGNMENTS.map((a) => [a.name, a.index]));
    assert.deepEqual(actual, {
      // hex — ADR 0005 D6 동결 (Q 는 +4 오프셋: 4칸 블록).
      // V4/V4Q(2026-08-30 «대용량», k=12)는 **그 블록의 예약 칸을 예약대로** 채웠다:
      // 종전 스냅샷의 빈 자리 3·7 이 정확히 V4·V4Q 다 (HEX_RESERVED 주석 참조).
      // 이로써 4칸 블록이 꽉 찼다 — V5 는 +4 오프셋으로는 못 앉는다(V5=4 가 V1Q 와
      // 충돌). `src/decode.js` 의 로드 가드가 같은 사실을 코드 쪽에서 던진다.
      V1: 0, V2: 1, V3: 2, V4: 3, V1Q: 4, V2Q: 5, V3Q: 6, V4Q: 7,
      // tri — A1/A2 동결, A0 는 ADR 0006 D3 신설 (Q 는 +2 오프셋)
      A0: 1, A1: 12, A2: 13, A0Q: 3, A1Q: 14, A2Q: 15,
      // cube — Y1/Y2/Y1T/Y2T 동결, Y0/Y0T 는 ADR 0006 D5 신설 (T 는 +2 오프셋)
      Y0: 0, Y1: 8, Y2: 9, Y0T: 2, Y1T: 10, Y2T: 11,
    });
  });

  test('패밀리별 인덱스는 그 패밀리 안에서 유일하다', () => {
    for (const family of ['hex', 'cube', 'tri']) {
      const idx = ASSIGNMENTS.filter((a) => a.family === family).map((a) => a.index);
      assert.equal(new Set(idx).size, idx.length, `${family} 표에 중복 인덱스가 있다: ${idx.join(',')}`);
    }
  });

  test('변형 오프셋은 패밀리별 고정 — hex Q +4 · tri Q +2 · cube T +2 (D3-5 쌍 불변식)', () => {
    const byName = Object.fromEntries(ASSIGNMENTS.map((a) => [a.name, a.index]));
    for (const spec of VERSIONS) {
      assert.equal(byName[`V${spec.version}Q`], byName[`V${spec.version}`] + 4);
    }
    for (const spec of VERSIONS_A) {
      assert.equal(byName[`A${spec.version}Q`], byName[`A${spec.version}`] + 2);
    }
    for (const spec of VERSIONS_Y.filter((v) => v.tones === 2)) {
      assert.equal(byName[`Y${spec.version}T`], byName[`Y${spec.version}`] + 2);
    }
  });
});

// ── D4 신설 게이트 ② — 동일-워드 교차 별칭 전수 열거 ─────────────────────────

/**
 * 워드 문자열 → 라벨 **배열**. 초안 스크립트는 워드를 Map 키로 쓰면서 값을 덮어써
 * 중복 워드가 마지막 라벨만 남았고, 이 위험군이 구조적으로 안 보였다([C8] Q2).
 * 여기서는 반드시 다중 라벨로 모은다.
 */
function aliasGroups() {
  const byWord = new Map();
  for (const a of ASSIGNMENTS) {
    for (const lv of LEVELS) {
      const w = encodeFormat({ version: a.index, eccLevel: ECC_LEVEL[lv] }).join('');
      if (!byWord.has(w)) byWord.set(w, []);
      byWord.get(w).push({ ...a, level: lv });
    }
  }
  return [...byWord.values()].filter((g) => new Set(g.map((x) => x.family)).size > 1);
}

/**
 * D3 축 분리 검사. 두 배정이 **격자 수립 경로를 공유**할 때만 검사 대상이고,
 * 그때는 **격자 파라미터(k/n)가 반드시 달라야** 한다.
 *
 * 파인더 종류 상이는 보조 축으로만 계상한다 — `centerQr` 은 셀 기하를 전혀 바꾸지
 * 않으므로(19셀 슬롯 동일) 그 축은 디코더의 명시적 비교에만 의존한다. 단독 근거로
 * 쓰면 파인더 오검출 한 번에 방어가 0 이 된다(D3-3).
 */
function sharesGridPath(a, b) {
  if (a.finder === null || b.finder === null) return false; // cube 는 경로 자체가 상이
  if (a.finder !== b.finder) return false; // 다른 파인더로는 같은 격자를 못 세운다
  return a.tiling.includes('hex') && b.tiling.includes('hex');
}

function axisSeparated(a, b) {
  return !sharesGridPath(a, b) || a.param !== b.param;
}

describe('D4 신설 게이트 ② — 동일-워드 교차 별칭 + ③ 축 분리 검사', () => {
  test('별칭 목록이 스냅샷과 일치 (늘거나 줄면 D3 검사를 다시 돌려야 한다)', () => {
    const summary = aliasGroups()
      .map((g) => g.map((x) => `${x.name}/${x.level}`).join('='))
      .sort();
    // A0Q(=3) 는 종전엔 hex **예약** 슬롯 V4 와 같은 값이라 «배정된 항목과는 별칭이
    // 안 생긴다» 였다. 2026-08-30 V4 신설로 그 예약이 실배정이 되면서 **가정이 실물이
    // 됐다** — V4/A0Q 세 쌍이 여기 새로 뜬다. 축 분리는 아래 테스트가 재고, 결론은
    // 이중으로 안전하다: 파인더가 다르고(bullseye ↔ centerQR) k 도 다르다(12 ↔ 6).
    // V4Q(=7)는 별칭이 없다 — 값 7 을 쓰는 다른 배정 자체가 없다(K 예약은 star 축이라
    // 이 표에 안 들어온다).
    assert.deepEqual(summary, [
      'V1/H=Y0/H',
      'V1/L=Y0/L',
      'V1/M=Y0/M',
      'V2/H=A0/H',
      'V2/L=A0/L',
      'V2/M=A0/M',
      'V3/H=Y0T/H',
      'V3/L=Y0T/L',
      'V3/M=Y0T/M',
      'V4/H=A0Q/H',
      'V4/L=A0Q/L',
      'V4/M=A0Q/M',
    ]);
  });

  test('모든 별칭 쌍이 축 분리 검사를 통과한다 — 도플갱어 0건', () => {
    const failures = [];
    for (const group of aliasGroups()) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const [a, b] = [group[i], group[j]];
          if (a.family === b.family) continue;
          if (!axisSeparated(a, b)) {
            failures.push(`${a.name}(${a.finder}/${a.param}) ↔ ${b.name}(${b.finder}/${b.param})`);
          }
        }
      }
    }
    assert.deepEqual(failures, [],
      `축 분리 실패 = 완전 도플갱어 후보다. 격자 파라미터가 같으면 오판된 가설이 페이로드를 그대로 읽는다: ${failures.join(' · ')}`);
  });

  test('tri 소형판은 hex 의 k=6 값 {0(V1), 4(V1Q)} 을 쓰지 않는다 — A0=0 사고의 직접 회귀', () => {
    const hexK6 = ASSIGNMENTS.filter((a) => a.family === 'hex' && a.param === 6).map((a) => a.index);
    assert.deepEqual(hexK6.slice().sort((x, y) => x - y), [0, 4]);
    for (const a of ASSIGNMENTS.filter((x) => x.family === 'tri' && x.param === 6)) {
      assert.ok(!hexK6.includes(a.index),
        `${a.name}(k=6) 가 hex 의 k=6 값 ${a.index} 을 쓴다 — 삼각 패치 마모 시 완전 도플갱어`);
    }
  });

  test('D3-4 양방향 의무: hex 예약 슬롯의 제약이 실배정으로 이관됐다', () => {
    // ── 이 테스트가 바뀐 이유 (2026-08-30) ──────────────────────────────────
    // 원판은 «A0Q=3 은 hex **예약** V4 와 값이 같다. V4 가 언젠가 정의될 때 k=6 이면
    // 축 분리가 깨진다 — hex k 가 단조 증가라 V4 는 k >= 12 로 구조적으로 안전하다»
    // 는 **가정적** 의무였고, 그 전제를 `hexKs === [6,8,10]` 으로 못 박아 두었다.
    // V4 가 실제로 정의되면서 그 단언이 깨졌고(설계대로 — 「목적은 통과가 아니라
    // 깨지는 것」), 논증을 다시 세운다:
    //   ① 전제였던 단조 증가는 **여전히** 요구한다 (V5 예약 논증이 여기 기댄다).
    //   ② 결론이었던 «V4 의 k >= 12» 는 이제 가정이 아니라 **실측 사실**이다.
    //   ③ 그래서 A0Q ↔ V4 는 예약 대 배정이 아니라 **살아 있는 별칭 쌍**이고,
    //      축 분리는 위 '모든 별칭 쌍이 축 분리 검사를 통과한다' 가 실제로 잰다.
    //      HEX_RESERVED 가 빈 것은 «검사를 지웠다» 가 아니라 이 이관의 결과다.
    const hexKs = VERSIONS.map((v) => v.k);
    for (let i = 1; i < hexKs.length; i += 1) {
      assert.ok(hexKs[i] > hexKs[i - 1],
        'hex k 는 버전마다 단조 증가해야 한다 (예약 슬롯 k 하한 논증의 전제)');
    }
    const v4 = ASSIGNMENTS.find((a) => a.name === 'V4');
    const a0q = ASSIGNMENTS.find((a) => a.name === 'A0Q');
    assert.ok(v4 && a0q, 'V4 · A0Q 배정이 표에서 사라졌다 — 이 논증의 대상이 없다');
    assert.equal(v4.index, a0q.index, 'V4 와 A0Q 가 더 이상 같은 값이 아니다 — 논증 재작성');
    assert.ok(v4.param >= 12,
      `V4 의 k 가 ${v4.param} 이다 — A0Q(k=${a0q.param}) 와 축 분리하려면 k >= 12 여야 한다`);
    assert.ok(axisSeparated(v4, a0q), 'V4 ↔ A0Q 축 분리가 깨졌다 — 완전 도플갱어');

    // 이관 확인 — 남은 예약 슬롯이 있으면 그 각각에 대해 tri 쪽 제약을 다시 적어야 한다.
    const triOnReserved = ASSIGNMENTS
      .filter((a) => a.family === 'tri' && HEX_RESERVED[a.index] !== undefined);
    assert.deepEqual(
      triOnReserved.map((a) => `${a.name}→${HEX_RESERVED[a.index]}`),
      [],
      'hex 예약 슬롯을 쓰는 tri 배정이 생겼다 — 각각에 대해 축 분리 제약을 문서화하라',
    );
  });
});

// ── D4 신설 게이트 ① — 패밀리 내 σ-이미지 전수 열거 ──────────────────────────

/** 3톤 순위 치환 (O · A · Y-T) — ADR 0005 D2. */
const SIGMA3 = Object.freeze([
  Object.freeze([4, 5, 1, 0, 3, 2]), // cw
  Object.freeze([3, 2, 5, 4, 0, 1]), // ccw
]);

/**
 * 2톤 면 순환 (Y 메인) — ADR 0006 D4 / [C8] Q6 교정. 2톤 digit 은 순위가 아니라
 * (T,L,R) 면 배정이므로 120° 회전의 digit 치환은 **면 순환**이다: d0=(1,0,0) →
 * (0,1,0)=d1 … 초안은 여기에 3톤 σ 를 적용했다(결론은 우연히 같았다).
 */
const SIGMA2 = Object.freeze([
  Object.freeze([1, 2, 0, 4, 5, 3]), // cw
  Object.freeze([2, 0, 1, 5, 3, 4]), // ccw
]);

/** 그 배정의 digit 의미론에 맞는 σ 쌍. */
function sigmasFor(a) {
  return (a.family === 'cube' && !a.name.endsWith('T')) ? SIGMA2 : SIGMA3;
}

describe('D4 신설 게이트 ① — 패밀리 내 σ-충돌 전수 열거 (자기고정 포함)', () => {
  for (const family of ['hex', 'cube', 'tri']) {
    test(`${family} 패밀리 σ-충돌 0건`, () => {
      const members = ASSIGNMENTS.filter((a) => a.family === family);
      const valid = new Map();
      for (const a of members) {
        for (const lv of LEVELS) {
          valid.set(encodeFormat({ version: a.index, eccLevel: ECC_LEVEL[lv] }).join(''), `${a.name}/${lv}`);
        }
      }
      const hits = [];
      for (const a of members) {
        for (const lv of LEVELS) {
          const w = encodeFormat({ version: a.index, eccLevel: ECC_LEVEL[lv] });
          for (const [si, sigma] of sigmasFor(a).entries()) {
            const key = w.map((d) => sigma[d]).join('');
            if (valid.has(key)) hits.push(`${a.name}/${lv} --σ${si === 0 ? 'cw' : 'ccw'}--> ${valid.get(key)}`);
          }
        }
      }
      assert.deepEqual(hits, [], `${family} 패밀리 안에서 회전 가설이 다른 유효 워드로 착지한다: ${hits.join(' · ')}`);
    });
  }

  test('[C7] 기지 교차 쌍 V3Q/L ↔ A1/L 은 여전히 재현된다 — 모델 정합 확인', () => {
    const byName = Object.fromEntries(ASSIGNMENTS.map((a) => [a.name, a.index]));
    const v3q = encodeFormat({ version: byName.V3Q, eccLevel: ECC_LEVEL.L });
    const a1 = encodeFormat({ version: byName.A1, eccLevel: ECC_LEVEL.L }).join('');
    const rotated = SIGMA3.map((s) => v3q.map((d) => s[d]).join(''));
    assert.ok(rotated.includes(a1),
      `σ(V3Q/L) 가 A1/L 을 못 맞춘다 — σ 모델이 바뀌었다면 D4 전체를 재검증하라 (got ${rotated.join(',')}, want ${a1})`);
  });

  test('cube 2톤에 3톤 σ 를 쓰면 안 된다 — 두 σ 가 실제로 다른 치환임을 고정', () => {
    assert.notDeepEqual([...SIGMA2[0]], [...SIGMA3[0]]);
    // 면 순환은 군으로서 위수 3 (cw ∘ cw ∘ cw = 항등) 이어야 한다.
    const cube = (s) => [...Array(6).keys()].map((d) => s[s[s[d]]]);
    assert.deepEqual(cube(SIGMA2[0]), [...Array(6).keys()]);
    assert.deepEqual(cube(SIGMA3[0]), [...Array(6).keys()]);
    // cw 와 ccw 는 서로 역이어야 한다.
    for (const [cw, ccw] of [SIGMA2, SIGMA3].map((p) => p)) {
      assert.deepEqual([...Array(6).keys()].map((d) => ccw[cw[d]]), [...Array(6).keys()]);
    }
  });
});
