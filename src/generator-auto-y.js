/**
 * generator-auto-y.js — Type Y **자동** 선정의 우선순위 계약.
 *
 * 운영자 지시 (2026-08-25): 「v0 선택했다고 v0 고정이 우선순위가 되면 안 됨.
 * 파인더는 해상도랑 ECC 자동옵션 선정 후 그 조건 안에서 파인더 선정이 들어가야됨.」
 * 「내용 늘리면 Y1-Y2로 먼저 넘어가야 하는데 ECC 축소가 먼저 들어가는 것 같네.」
 *
 * ## 무엇이 뒤집혀 있었나
 *
 * 종전 자동은 「콘텐츠가 v0 용량에 **L 기준으로** 들어가나」를 먼저 물었다. 그런데
 * 로케이터 프로파일은 `generator-render-config` 에서 **버전을 하드핀**한다
 * (`v0 → version 0` · `v0TR → version 1`). 그래서 그 한 물음이 곧 해상도 결정이었고,
 * 남은 손잡이가 ECC 뿐이라 `encodeWithEcc` 가 H→M→L 로 내려갔다 —
 * **해상도가 파인더에 종속**된 상태다.
 *
 * ## 뒤집은 규칙 — ECC 는 해상도를 다 쓴 뒤에만 내린다
 *
 *     for level of [H, M, L]:        ← 바깥 루프 = ECC (마지막에 양보한다)
 *         for rung of 사다리 오름차순:  ← 안쪽 루프 = 해상도 (먼저 키운다)
 *             들어가면 채택
 *
 * 사다리는 (버전 ↔ 로케이터) 일대일이다 — 이 대응은 현행 설계의 사실이지
 * 이 모듈이 만든 규칙이 아니다:
 *
 * | 단 | 버전 | n  | 로케이터 | 근거 |
 * |---|---|---|---|---|
 * | 0 | Y0 | 13 | v0    | v0 은 n=13 전용 |
 * | 1 | Y1 | 21 | v0TR  | v0TR n=21 (데이터 309) |
 * | 2 | Y2 | 25 | v0TR  | **9ce2883 로 열린 단** — v0TR n=25 (데이터 493) |
 * | 3 | Y2 | 25 | **끔** | 마지막 수단. 여기까지 와야 마커를 버린다 |
 *
 * ⚠ **사다리는 (버전 ↔ 로케이터) 일대일이 아니다** (2026-08-25 부터). v0TR 이 1·2단에
 *   둘 다 서므로 「프로파일만 정하면 버전이 따라온다」는 논증은 **만료됐다** — 그래서
 *   `encodeOptionsForY` 의 v0TR 하드핀을 걷었고, 자동이 고른 버전을 UI 가
 *   `effectiveVersionYForEncode()` 로 인코더까지 옮긴다. 로케이터를 또 늘릴 때는
 *   이 세 자리를 **함께** 본다: RUNGS · encodeOptionsForY 의 version · 그 전달 경로.
 *
 * ## 귀결 — 코드가 커진다
 *
 * Y0@M 으로 되던 콘텐츠가 Y1@H 로 나온다. 그게 「ECC 축소가 먼저 들어가면 안 된다」의
 * 직접적 귀결이다 — 강건성을 크기보다 위에 둔 선택이고, 되돌리려면 이 모듈의 루프
 * 순서만 바꾸면 된다 (그래서 순서를 여기 한 곳에 모았다).
 */

import {
  CELL_SURFACE_FINAL_V0, CELL_SURFACE_FINAL_V0TR, capacityForCellSurfaceFinal,
} from './cellSurfaceFinal.js';
import { VERSIONS_Y, capacityForY } from './capacityY.js';
import {
  LOCATOR_PROFILE_CELL_SURFACE_V0, LOCATOR_PROFILE_CELL_SURFACE_V0TR, LOCATOR_PROFILE_OFF,
} from './locatorY.js';

/** ECC 자동의 시도 순서 — `encodeWithEcc` 와 **같은 사다리**여야 한다 (다르면 자동이 고른
 *  (버전, ECC) 를 인코더가 재현하지 못한다). */
export const AUTO_ECC_LADDER = Object.freeze(['H', 'M', 'L']);

/** 해상도 사다리 — 오름차순. 각 단의 용량은 «그 단에서 실제로 쓰일 로케이터» 기준이다. */
const RUNGS = Object.freeze([
  Object.freeze({ version: 0, n: 13, profile: LOCATOR_PROFILE_CELL_SURFACE_V0, layout: CELL_SURFACE_FINAL_V0 }),
  Object.freeze({ version: 1, n: 21, profile: LOCATOR_PROFILE_CELL_SURFACE_V0TR, layout: CELL_SURFACE_FINAL_V0TR }),
  // ⭐ **Y2 + v0TR (2026-08-25 편입)** — 그전엔 이 단이 없어서 Y1 을 넘기는 순간
  // 「끔」으로 떨어졌다. 운영자 신고: 「Y1에서 Y2로 먼저 넘어가야되는데, 마커가
  // 먼저 없어지는데?」 — 사다리가 게을러서가 아니라 **갈 곳이 없었다** (활성 T 계열이
  // 전부 n=21 전용). 「면 모서리 기준 배치」(SPEC §4.11)가 n=25 를 열어 이 단이 생겼다.
  Object.freeze({ version: 2, n: 25, profile: LOCATOR_PROFILE_CELL_SURFACE_V0TR, layout: CELL_SURFACE_FINAL_V0TR }),
  // 마지막 수단 — 마커를 버린다. 여기까지 와야 파인더가 사라진다.
  Object.freeze({ version: 2, n: 25, profile: LOCATOR_PROFILE_OFF, layout: null }),
]);

/**
 * 그 단이 **실제로 담을 수 있는 페이로드 바이트**.
 *
 * ⚠ `dataBytes` 가 아니라 **`maxPayloadBytes`** 다. 둘은 `headerBytes` 만큼 다르고
 *   (v0@13/H/3톤: 21 vs 20), 인코더가 거절하는 기준은 후자다. 처음에 dataBytes 로
 *   짰다가 경계에서 «사다리는 들어간다는데 인코더는 던지는» 상태가 됐다 — 그러면
 *   encodeWithEcc 가 ECC 를 내려서 **고치려던 그 증상이 그대로 재현**된다.
 *   (생성기 용량 게이지가 늘 maxPayloadBytes 를 쓰고 있었고, 그 불일치가 단서였다.)
 */
function capacityOfRung(rung, level, tones) {
  if (rung.layout !== null) {
    return capacityForCellSurfaceFinal(rung.n, level, tones, rung.layout).maxPayloadBytes;
  }
  // 끔 = 평 Y. VERSIONS_Y 는 (버전 × 톤) 행이라 둘 다로 고른다.
  const spec = VERSIONS_Y.find((s) => s.version === rung.version && s.tones === tones)
    ?? VERSIONS_Y.find((s) => s.version === rung.version);
  if (!spec) return -1;
  return capacityForY(spec, level).maxPayloadBytes;
}

/**
 * 자동이 고를 (해상도, ECC, 로케이터).
 *
 * @param {{payloadBytes:number, tones:2|3, eccLevel:'auto'|'L'|'M'|'H'}} input
 * @returns {{version:number, ecc:'L'|'M'|'H', locatorProfileY:string, fits:boolean}}
 *   `fits:false` = 최대 단·최저 ECC 로도 안 들어간다 (인코더가 던지게 둔다 —
 *   여기서 조용히 자르면 «왜 잘렸는지» 가 화면에서 사라진다).
 */
export function resolveAutoY({ payloadBytes, tones, eccLevel }) {
  if (!Number.isFinite(payloadBytes) || payloadBytes < 0) {
    throw new RangeError('payloadBytes 는 0 이상 유한수여야 한다: ' + payloadBytes);
  }
  const t = tones === 3 ? 3 : 2;
  const levels = eccLevel === 'auto' ? AUTO_ECC_LADDER : [eccLevel];
  for (const level of levels) {
    for (const rung of RUNGS) {
      let cap;
      try { cap = capacityOfRung(rung, level, t); } catch { continue; }
      if (cap >= 0 && payloadBytes <= cap) {
        return { version: rung.version, ecc: level, locatorProfileY: rung.profile, fits: true };
      }
    }
  }
  const last = RUNGS[RUNGS.length - 1];
  return {
    version: last.version,
    ecc: levels[levels.length - 1],
    locatorProfileY: last.profile,
    fits: false,
  };
}
