/**
 * capacityDaehan.js — daehan 파인더 변형(V1D/V2D/V3D)의 용량 회계.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 왜 `capacity.js` 의 `VERSIONS` 배열이 아니라 별도 모듈인가 (전례 둘)
 * ─────────────────────────────────────────────────────────────────────────
 * `capacity.js` 의 `VERSIONS` 는 **단순한 표가 아니다.** 그 배열은 동시에
 *   ① 인코더의 자동 버전 선택 목록 (`encode.chooseVersion` 이 순서대로 훑어
 *      «들어가는 첫 항목» 을 고른다), 그리고
 *   ② 디코더의 가설 목록 (`decode.js` 의 `VERSIONS.find(v => v.version === …)` ·
 *      `bootstrap.js` 의 familyProfiles)
 * 이다. daehan 은 version(1/2/3)과 k(6/8/10)가 기존과 **완전히 겹치므로**, 같은
 * 배열에 넣으면 `find` 가 조용히 엉뚱한 spec 을 집는다 — 던지지 않고 틀린 회계로
 * 복호한다. 이건 «표를 늘리는 일» 이 아니라 «두 코드를 한 이름으로 부르는 일» 이다.
 *
 * 그래서 코드베이스가 이미 두 번 쓴 전례를 그대로 따른다:
 *   · `src/capacityY.js` — `NSYM_TABLE_Y2W` + `capacityForY2Window` (Y2W 변형)
 *   · `src/markerO.js`   — `NSYM_TABLE_OCM` + `VERSIONS_OCM` + `capacityForOMarker` (O-CM 변형)
 * 즉 **별도 spec 배열 + 별도 NSYM 표 + 얇은 진입 함수**.
 *
 * ─ 왜 `markerO.js` 처럼 레이아웃 모듈 안이 아니라 새 파일인가 ────────────────
 * O-CM 은 마커 **기하**(tetrad 좌표·digit·회전 margin)와 회계가 한 몸이라
 * `markerO.js` 한 파일이 자연스럽다. daehan 은 다르다 — 기하(79셀 좌표·톤)는
 * `finder-daehan.js` 가 이미 정본 대조 대상으로 들고 있고, 그 파일은 **렌더러와
 * 검출기도 import 한다**. 거기에 RS·헤더·용량 회계를 얹으면 렌더 경로가 rs211 을
 * 끌고 오게 된다. 표현(무엇인가)과 회계(얼마나 담는가)를 갈라 둔다.
 *
 * ─ 왜 `capacityFor` 를 **재사용**하는가 ────────────────────────────────────
 * 회계가 본표와 완전히 동형이다 (총셀 → 오버헤드 뺌 → ⌊C/3⌋ → nsym → K → 페이로드).
 * `markerO.js` 는 이 본문을 통째로 베꼈고, 그 사본은 이미 원본과 조금 갈렸다
 * (`spec.name` 라벨). 세 번째 사본 대신 `capacity.capacityFor` 에 **표만 주입**한다
 * (기본값이 본표라 레거시 산출은 비트 동일 — `test/capacity-daehan.test.js` 가 대조).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 와이어 (formatIndex) — 신설하지 않는다 (2026-08-18 이 라운드 결정)
 * ─────────────────────────────────────────────────────────────────────────
 * daehan 은 **formatIndex 를 새로 만들지 않는다.** V1/V2/V3 인덱스를 그대로 쓰고,
 * daehan 유/무는 **광학 검출 + 사후 RS/CRC** 로 가른다 — `markerO.js` §4 및
 * `capacityY.js` 의 Y2W 가 이미 쓰는 계약과 같다. 디코더가 파인더를 검출하는 순간
 * patternId 가 daehan 계열인지를 알고(`isDaehanFinderPatternId`), 그것이 «어느 NSYM
 * 표를 볼 것인가» 를 가른다. **k 는 파인더가 말해 주지 않는다** — 잘림이 포함
 * 사슬이라 k6 템플릿이 k=8 프레임을 정당하게 맞춘다. k 는 기존대로 전 후보를
 * 열거해 RS/CRC 가 고른다.
 *
 * ⚠ 이 계약의 안전성은 **「daehan 프레임을 일반 V1/V2/V3 으로 잘못 읽으면 RS/CRC 가
 *   반드시 거절하는가」** 에 달려 있다. **실측 (2026-08-18,
 *   `test/output/lanes/claude-di-misread.mjs`): 거절 못 한 조합 0 건.**
 *   ① 셀 층 27조합 (k·ECC × 읽는 ECC) 전부 RS 거절 — 파인더 예약 셀이 데이터인 척
 *      섞인 열은 셀 수가 맞아 «길이로 거절» 이 안 통하는데도 전부 걸린다.
 *   ② 프레임 층 9조합 — 배포 기본 라인업(daehan 없음)은 daehan 프레임을 전부
 *      `frontend:no-format-candidate` 로 거절한다.
 *   ③ 역방향 9조합 — 레거시 프레임을 daehan 회계로 읽어도 전부 RS 거절.
 *   **k=12 확장 재실측 (2026-08-30, V4D 개방 게이트 — `test/output/lanes/claude-v4d-misread.mjs`):**
 *   ① 셀 층 — V4D 프레임을 평 V4 회계로 읽기 9조합(쓴 ECC × 읽는 ECC) 전부 RS 거절
 *      (V4Q 는 셀 회계가 평 V4 와 동일하므로 같은 실측이 덮는다).
 *   ② 프레임 층 — 배포 기본 라인업이 V4D 렌더를 전부 `frontend:no-format-candidate` 로 거절.
 *   ③ 역방향 — 평 V4 프레임을 V4D 회계로 읽기 9조합 전부 거절.
 *   새 조합에서 거절 실패가 나오면 그때는 전용 formatIndex(ⓐ)가 필요하고,
 *   VERSION_BITS 4 의 빈 슬롯에서 배정한다 — ⚠ 이 헤더의 구 문장 «빈 슬롯 3 · 7 · 8\~15»
 *   는 V4 신설(2026-08-30) 전 기준이라 낡았다: **3 은 V4 · 7 은 V4Q 가 점유**했고
 *   8\~11 은 cube 예약이다. k=12 열의 실제 빈 값은 {2, 4, 5, 6, 12\~15} 다.
 *
 * 런타임 의존성 0 · 순수 ESM.
 */

import { NSYM_TABLE_DAEHAN } from './rs211.js';
import { VERSIONS, capacityFor } from './capacity.js';
import { overheadBreakdown } from './placement.js';
import { DAEHAN_RADII, daehanReservedCells } from './finder-daehan.js';

/** V4D 의 k 는 본표 V4 행이 정본이다 (버전 ↔ k 대응을 두 벌 적지 않는다). */
const V4_K = VERSIONS.find((spec) => spec.version === 4).k;

const NSYM_SOURCE = Object.freeze({
  table: NSYM_TABLE_DAEHAN,
  tableName: 'NSYM_TABLE_DAEHAN',
});

/**
 * daehan 버전 정의. `overhead` 는 `placement.overheadBreakdown(k, 예약셀수)` 실계산이다
 * — 상수를 손으로 적지 않는다 (본표 `VERSIONS` 와 같은 규약).
 *
 * `version` 은 기존과 같은 1/2/3 이다 (와이어 formatIndex 를 공유하므로). 구별은
 * `name`(V1D…)과 이 배열의 정체성으로 한다 — 그래서 이 배열을 `VERSIONS` 와 절대
 * 합치면 안 된다 (모듈 헤더 참조). 2026-08-21: 예약 셀의 분류 이름은 sagoae.
 * taegeuk(내부 19)은 이미 불스아이 오버헤드에 들어 있어 두 번 세지 않는다.
 *
 * **V4D (2026-08-30 개방)** — `DAEHAN_RADII` 는 잘림 **템플릿** 반경 목록이라 절대
 * 늘리지 않는다 (`finder-daehan.js` 자기검증 ④b·⑤ 가 그 배열에 걸려 있다). k=12 는
 * `templateRadius` 클램프로 k10 완전판 79셀(예약 60)을 그대로 쓰므로, 여기서만
 * 명시 행 하나를 **유도 3행 뒤에** 붙인다. overhead 는 위 규약대로 실계산이다 —
 * 손 상수 117 을 박지 않는다 (사본 목록은 썩는다).
 *
 * @type {ReadonlyArray<{name:string, version:number, k:number, overhead:number, symbolKey:string}>}
 */
export const VERSIONS_DAEHAN = Object.freeze([
  ...DAEHAN_RADII.map((k, index) => Object.freeze({
    name: 'V' + (index + 1) + 'D',
    version: index + 1,
    k,
    overhead: overheadBreakdown(k, daehanReservedCells(k).length).total,
    symbolKey: 'V' + (index + 1) + 'D',
  })),
  Object.freeze({
    name: 'V4D',
    version: 4,
    // k=12 예약 셀은 완전판(k10) 60셀의 중심 고정 재사용이다 — daehanReservedCells 가
    // 클램프로 그 사실을 스스로 말한다 (아래 자기검증이 값으로 잠근다).
    k: V4_K,
    overhead: overheadBreakdown(V4_K, daehanReservedCells(V4_K).length).total,
    symbolKey: 'V4D',
  }),
]);

/** patternId 나 k 로 daehan spec 을 찾는다. 없으면 undefined. */
export function daehanSpecForK(k) {
  return VERSIONS_DAEHAN.find((spec) => spec.k === k);
}

/**
 * daehan 한 버전의 용량. 본표 회계를 그대로 승계하고 nsym 표만 갈아 끼운다 —
 * 표와 실계산이 어긋나면 조용히 맞추지 않고 던진다.
 * @param {{name:string, version:number, k:number, overhead:number, symbolKey:string}} spec
 * @param {'L'|'M'|'H'} [level]
 */
export function capacityForDaehan(spec, level = 'M') {
  const base = capacityFor(spec, level, NSYM_SOURCE);
  return { name: spec.name, daehanFinder: true, ...base };
}

/** 전 버전 daehan 용량표. */
export function capacityTableDaehan(level = 'M') {
  return VERSIONS_DAEHAN.map((spec) => capacityForDaehan(spec, level));
}

// ── 로드 자기검증 ──────────────────────────────────────────────────────────
// 회계는 셋(파인더 좌표 · 배치 · nsym 표)이 동시에 맞아야 성립한다. 하나가 움직이면
// 여기서 즉시 죽게 만든다 — 표는 조용히 썩는다.
{
  const EXPECT = {
    V1D: { k: 6, overhead: 65, dataCells: 62, symbols: 20, payload: { L: 15, M: 11, H: 7 } },
    V2D: { k: 8, overhead: 89, dataCells: 128, symbols: 42, payload: { L: 32, M: 26, H: 18 } },
    V3D: { k: 10, overhead: 113, dataCells: 218, symbols: 72, payload: { L: 57, M: 46, H: 32 } },
    V4D: { k: 12, overhead: 117, dataCells: 352, symbols: 117, payload: { L: 96, M: 78, H: 58 } },
  };
  // 역방향 — EXPECT 에만 있고 표에 없는 잉여 키를 잡는다. 없으면 «표 행 커밋이
  // 롤백되고 EXPECT 만 남은» 부분 되돌림이 조용히 초록으로 위장된다.
  for (const name of Object.keys(EXPECT)) {
    if (!VERSIONS_DAEHAN.some((spec) => spec.name === name)) {
      throw new Error('capacityDaehan: EXPECT 에만 있고 표에 없는 키 ' + name
        + ' — 표 행과 기대표는 같은 커밋으로 움직여야 한다');
    }
  }
  for (const spec of VERSIONS_DAEHAN) {
    const want = EXPECT[spec.name];
    if (!want) throw new Error('capacityDaehan: 기대표에 없는 키 ' + spec.name);
    if (spec.k !== want.k || spec.overhead !== want.overhead) {
      throw new Error(spec.name + ': k/오버헤드가 확정값과 다르다 — k=' + spec.k
        + ' overhead=' + spec.overhead + ' (기대 k=' + want.k + ' overhead=' + want.overhead + ')');
    }
    for (const level of ['L', 'M', 'H']) {
      const cap = capacityForDaehan(spec, level);
      if (cap.dataCells !== want.dataCells || cap.usedSymbols !== want.symbols) {
        throw new Error(spec.name + '/' + level + ': 데이터 셀·심볼이 확정값과 다르다 — '
          + cap.dataCells + '/' + cap.usedSymbols);
      }
      if (cap.maxPayloadBytes !== want.payload[level]) {
        throw new Error(spec.name + '/' + level + ': 순 페이로드 ' + cap.maxPayloadBytes
          + ' B 가 확정값 ' + want.payload[level] + ' B 와 다르다');
      }
    }
  }
}
