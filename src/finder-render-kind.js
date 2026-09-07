// finder-render-kind.js — finderPatternId → renderKind 의 **단일 출처**
//
// 왜 모듈로 뺐나 (2026-09-06, 010 리뷰 F4): 같은 조회가 두 벌이었다.
// `scene.js resolveFinderRenderPattern`(그린다)과 `generator-render-config
// .detectorRenderKind`(분류한다)가 «표 밖 중앙 id → renderKind» 를 각자 손으로
// 들고 있었고, 한쪽만 늙어도 아무 자가 안 죽었다 (실측: LEGACY 를 'cell-mask' 로
// 바꿔도 스위트 전부 초록 — 사유가 우연히 같아 안 보였을 뿐이다).
// scene.js 가 generator-render-config 를 import 하므로 역방향은 순환이라,
// **둘 다 아래를 보게** 하는 것이 유일한 해소다.

import {
  FINDER_PATTERNS, LEGACY_FINDER_PATTERN_ID,
} from './finder-patterns.js';
import {
  CENTER_QR_FINDER_PATTERN_ID, CENTRAL_V0_FINDER_PATTERN_ID,
} from './finder-selection.js';
import { CENTRAL_MARKER_N7_FINDER_PATTERN_ID } from './centralMarkerN7.js';
import { CENTRAL_N7_FINDER_PATTERN_ID } from './centralN7Schema.js';
import { getOakFinderPattern } from './finder-oak-patterns.js';
import { getDaehanFinderPattern } from './finder-daehan.js';
import { CELL_SURFACE_LOCATOR_RENDER_KIND } from './centralN7Emphasis.js';
import { isCellSurfaceLocatorProfileY } from './locatorY.js';

/**
 * **생성 도구 표 밖**에서 렌더가 직접 푸는 중앙 id → renderKind.
 *
 * scene.js 의 `resolveFinderRenderPattern` 도, 분류하는 쪽도 여기서 읽는다.
 * 새 표 밖 중앙 id 는 여기 한 줄이면 양쪽이 같이 안다 — 그리고 자
 * (test/detector-emphasis-ui.test.js)의 전수도 이 키 목록에서 유도되므로
 * «신설 id 만 조용히 미측정» 이 안 생긴다.
 */
export const OUT_OF_TABLE_FINDER_RENDER_KINDS = Object.freeze({
  [LEGACY_FINDER_PATTERN_ID]: 'bullseye',
  [CENTER_QR_FINDER_PATTERN_ID]: 'center-qr',
  [CENTRAL_V0_FINDER_PATTERN_ID]: 'central-v0',
  [CENTRAL_MARKER_N7_FINDER_PATTERN_ID]: 'central-marker-n7',
  [CENTRAL_N7_FINDER_PATTERN_ID]: 'central-n7-payload',
});

/**
 * finderPatternId → renderKind, **모르는 id 에서는 null**.
 *
 * 조회 순서는 렌더와 같다 (표 밖 중앙 id → **Y 셀 표면 로케이터** → OAK 표 →
 * daehan 표 → 생성 도구 표). 렌더와 다른 점은 «모르면 죽지 않는다» 하나다 —
 * 분류 쪽에는 중앙 파인더가 아닌 값(자리 예약 id)도 들어오고, 그 답은 예외가
 * 아니라 «해당 없음» 이다.
 *
 * ⭐ **Type Y 가 여기서 답을 받는다 (2026-09-07 (C), 운영자 「Y 의 경우는 v0 이나
 * v0T, v0TR 같은 로케이터 강조가 되어야 하는데 이쪽은 미지원 상태」)** — Y 의 검출기
 * «선택» 은 `finderPatternId` 가 아니라 `locatorProfileY`(= `cell-surface-*`)이고
 * (`detector-emphasis-ui-model.detectorEmphasisDetectorId`), 그것을 그리는 화법이
 * `cell-surface-locator` 다. 종전엔 그 id 가 표 어디에도 없어 `null` → «아직 대상 아님»
 * 으로 떨어졌고, 그게 화면의 «미지원» 이었다. 판정은 손 목록이 아니라 로케이터 정본
 * 술어(`isCellSurfaceLocatorProfileY`)에서 유도하므로 프로파일이 늘면 분류·렌더·화면이
 * 같이 안다. 셀 표면이 아닌 Y 프로파일(`off` · `hex-frame-v1`)은 계속 `null` — 그 둘은
 * 레이아웃이 톤을 고정한 **셀**이 아니라 별도 도형이라 이 축의 실측이 없다.
 */
export function finderRenderKindOf(finderPatternId) {
  if (typeof finderPatternId !== 'string') return null;
  const outOfTable = OUT_OF_TABLE_FINDER_RENDER_KINDS[finderPatternId];
  if (outOfTable !== undefined) return outOfTable;
  if (isCellSurfaceLocatorProfileY(finderPatternId)) return CELL_SURFACE_LOCATOR_RENDER_KIND;
  const oak = getOakFinderPattern(finderPatternId);
  if (oak) return oak.renderKind;
  const daehan = getDaehanFinderPattern(finderPatternId);
  if (daehan) return daehan.renderKind;
  const table = FINDER_PATTERNS.find((pattern) => pattern.id === finderPatternId);
  if (table) return table.renderKind || 'cell-mask';
  return null;
}
