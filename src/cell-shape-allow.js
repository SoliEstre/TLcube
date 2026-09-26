// 측정 영수증에서 생성되는 파일 — 손으로 고치지 않는다. 생성 명령은 L6 측정 레인이 이 줄에 적는다(DESIGN_001 §3.4).
/**
 * cell-shape-allow.js — 셀 꾸미기 허용표 (DESIGN_001 §3.4)
 *
 * ⚠ **지금은 «전부 잠금» 스텁이다** (L2a, 2026-09-26). 행이 하나도 없으므로
 * `resolveCellShapeSpec` 은 square 가 아닌 모든 선택을 `spec:null + lockReason` 으로
 * 돌려준다. 측정 레인(L6)이 끝단 복호 영수증(§7.2)에서 통과 행만 모아 이 파일을
 * **다시 생성**한다 — 그때 `RECEIPT_SHA256`(영수증 sha256) · `MEASURED_AT`(ISO 시각) ·
 * `FINGERPRINT`(잰 대상 지문: HEAD · 생성기/스캐너 번들 sha · 디코더 소스 sha)가 함께 채워진다.
 *
 * 행 모양(키 목록의 정본은 `src/cell-shape.js` 의 `CELL_SHAPE_ALLOW_KEYS`):
 *   O/A/K(+C/G/V): { table:'oak', type, version, finderPatternId, tones, gapGrade, bgMode,
 *                    paletteGrade, qrPosition, cellShape, param }
 *   Y:             { table:'y', cellSurfaceLayout, locatorProfile, nBand, tones, gapGrade,
 *                    bgMode, paletteGrade, seamAdjacent, cellShape, param }
 * 행에 키가 하나라도 빠지면 그 행은 아무것도 허가하지 않는다(와일드카드 없음 — fail-closed).
 *
 * 이 파일은 의존이 없다 — public 테스트는 표 내부 일관성과 지문 존재만 잴 수 있고,
 * 측정 사실 자체는 private 영수증에 있다(§7.6).
 */

/** 허용 행. 스텁은 빈 표 = 전부 잠금. */
export const ROWS = Object.freeze([]);

/** 이 표를 만든 측정 영수증의 sha256. 스텁은 영수증이 없어 null. */
export const RECEIPT_SHA256 = null;

/** 측정 시각(ISO 8601). 스텁은 측정 전이라 null. */
export const MEASURED_AT = null;

/** 잰 대상 지문 {head, generatorBundleSha256, scannerBundleSha256, decoderSourceSha256}. 스텁은 null. */
export const FINGERPRINT = null;
