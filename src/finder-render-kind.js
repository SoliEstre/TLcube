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
 * 조회 순서는 렌더와 같다 (표 밖 중앙 id → OAK 표 → daehan 표 → 생성 도구 표).
 * 렌더와 다른 점은 «모르면 죽지 않는다» 하나다 — 분류 쪽에는 중앙 파인더가 아닌
 * 값(자리 예약 id · Type Y 로케이터 프로파일 id)도 들어오고, 그 답은 예외가
 * 아니라 «해당 없음» 이다.
 */
export function finderRenderKindOf(finderPatternId) {
  if (typeof finderPatternId !== 'string') return null;
  const outOfTable = OUT_OF_TABLE_FINDER_RENDER_KINDS[finderPatternId];
  if (outOfTable !== undefined) return outOfTable;
  const oak = getOakFinderPattern(finderPatternId);
  if (oak) return oak.renderKind;
  const daehan = getDaehanFinderPattern(finderPatternId);
  if (daehan) return daehan.renderKind;
  const table = FINDER_PATTERNS.find((pattern) => pattern.id === finderPatternId);
  if (table) return table.renderKind || 'cell-mask';
  return null;
}
