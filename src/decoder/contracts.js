/**
 * contracts.js — 디코더 앞단 모듈 간 **자료형 계약** (설계 §13 의 시그니처를 잇는 접착제)
 *
 * 앞단은 여러 모듈로 나뉘어 병렬 구현된다. 각 모듈이 자기 방식으로 좌표·휘도·기하를
 * 표현하면 통합 시점에 4-way 불일치가 난다. 그래서 **주고받는 값의 모양을 여기서 먼저
 * 고정**한다. 이 파일은 런타임 로직을 거의 갖지 않는다 — 타입 정의와 최소한의 생성자·
 * 불변식 검사만 둔다.
 *
 * 규약:
 *   · 좌표계는 두 개뿐이다 — **canonical**(격자 단위, 인코더가 쓰는 좌표)과
 *     **image**(픽셀). 둘을 섞지 않는다. 호모그래피는 항상 canonical → image 방향이다.
 *   · 휘도는 `luminance.js` 의 `relativeLuminance` 와 **같은 정의**의 0..1 실수다.
 *     8비트 값을 그대로 넘기지 않는다.
 *   · 실패는 예외가 아니라 `{ok:false, reason}` 이다 (후단 `decode.js` 와 같은 규약).
 *   · RNG 금지. 같은 입력 → 같은 출력.
 *
 * @module decoder/contracts
 */

/**
 * 상대휘도 필드. 원본 래스터에서 한 번만 만들고 이후 전 단계가 공유한다.
 *
 * @typedef {object} LumaField
 * @property {number} width
 * @property {number} height
 * @property {Float32Array} data  길이 width*height, 값은 **0..1 상대휘도**
 * @property {Uint8Array|null} alpha  투명 배경 입력의 알파(0..255). 없으면 null.
 */

/**
 * 이미지 픽셀 좌표. 정수가 아니어도 된다(서브픽셀).
 * @typedef {object} Point
 * @property {number} x
 * @property {number} y
 */

/**
 * 호모그래피. **canonical → image** 방향, row-major 3×3.
 * 역방향이 필요하면 `invertHomography` 로 만든다 — 방향을 헷갈리면 증상이
 * "격자가 조금 어긋난다" 로만 보여서 진단이 비싸다.
 * @typedef {Float64Array} Homography  길이 9
 */

/**
 * 불스아이 검출 후보.
 *
 * @typedef {object} BullseyeCandidate
 * @property {Point} center      영상에서의 중심
 * @property {number} cellSize   영상 픽셀 단위의 셀 크기 s (밴드 폭 = √13/6·s 에서 역산)
 * @property {number} score      0..1, 높을수록 좋음. 비교 가능해야 한다.
 * @property {object} bands      밴드별 측정 요약(진단용). 형태는 검출기 자유.
 * @property {boolean} hardChecksPassed  설계 §6.4 의 hard check 통과 여부
 */

/**
 * 격자 가설 하나. 앵커 탐색이 만들고 bootstrap 이 평가한다.
 *
 * @typedef {object} GridHypothesis
 * @property {'hex'|'tri'|'cube'} family
 * @property {number} k            격자 반경(hex·tri) 또는 n(cube)
 * @property {0|1|2} orientation   120° 회전 가설 인덱스
 * @property {boolean} centerQr    중앙 QR 변형 여부
 * @property {Point[]} anchors     앵커 3점(영상 좌표)
 * @property {Homography} H        canonical → image
 * @property {number} geometryResidual  재투영 잔차(픽셀). 낮을수록 좋음.
 */

/**
 * 한 면의 표본 통계. **median 만으로는 신뢰도를 알 수 없어** MAD 와 표본 수를 함께 낸다
 * (설계 §9.3 · §13 의 `sampleHexCell` 계약).
 *
 * @typedef {object} FaceSample
 * @property {number} median  0..1
 * @property {number} mad     median absolute deviation
 * @property {number} count   원판 안에 든 픽셀 수
 */

/**
 * 셀 하나의 세 면 표본 + 순위 신뢰도.
 *
 * @typedef {object} CellSample
 * @property {FaceSample} T
 * @property {FaceSample} L
 * @property {FaceSample} R
 * @property {number} separation  세 median 중 인접 간격의 **최솟값** (Δ). 클수록 안전.
 * @property {boolean} tie        strict 순서가 성립하지 않으면 true (동률·근접동률)
 */

/** 앞단 실패 코드. 후단(`decode.js`)의 reason 과 이름이 겹치지 않게 접두어를 둔다. */
export const FRONTEND_FAILURE = Object.freeze({
  EMPTY_INPUT: 'frontend:empty-input',
  LUMA_DEGENERATE: 'frontend:luma-degenerate',
  NO_FINDER: 'frontend:no-finder',
  FAMILY_AMBIGUOUS: 'frontend:family-ambiguous',
  NO_ANCHORS: 'frontend:no-anchors',
  HOMOGRAPHY_DEGENERATE: 'frontend:homography-degenerate',
  NO_GRID_HYPOTHESIS: 'frontend:no-grid-hypothesis',
  SAMPLE_STARVED: 'frontend:sample-starved',
  REFERENCE_MISMATCH: 'frontend:reference-mismatch',
  NO_FORMAT_CANDIDATE: 'frontend:no-format-candidate',
});

/** 성공/실패 반환의 공통 생성자 — 모듈마다 다른 모양을 만들지 않게 한다. */
export function ok(value) {
  return { ok: true, ...value };
}

/** @param {string} reason @param {object} [detail] */
export function fail(reason, detail) {
  return detail === undefined ? { ok: false, reason } : { ok: false, reason, detail };
}

/**
 * LumaField 불변식 검사. 통합 시점의 "조용한 어긋남" 을 막는 최소 가드다 —
 * 길이가 맞지 않는 필드는 샘플링 단계에서 엉뚱한 픽셀을 읽고, 그 증상은
 * "복호가 가끔 실패한다" 로만 보인다.
 */
export function assertLumaField(luma) {
  if (!luma || typeof luma !== 'object') throw new TypeError('LumaField 가 아니다');
  const { width, height, data } = luma;
  if (!Number.isInteger(width) || width <= 0) throw new RangeError(`width 가 양의 정수가 아니다: ${width}`);
  if (!Number.isInteger(height) || height <= 0) throw new RangeError(`height 가 양의 정수가 아니다: ${height}`);
  if (!(data instanceof Float32Array)) throw new TypeError('data 는 Float32Array 여야 한다');
  if (data.length !== width * height) {
    throw new RangeError(`data 길이 ${data.length} 가 width*height ${width * height} 와 다르다`);
  }
  return luma;
}

/** Homography 불변식 검사. 길이 9 · 전부 유한 · 마지막 원소 0 아님(정규화 가능). */
export function assertHomography(H) {
  if (!(H instanceof Float64Array) || H.length !== 9) {
    throw new TypeError('Homography 는 길이 9 의 Float64Array 여야 한다 (row-major, canonical→image)');
  }
  for (let i = 0; i < 9; i += 1) {
    if (!Number.isFinite(H[i])) throw new RangeError(`H[${i}] 가 유한하지 않다: ${H[i]}`);
  }
  return H;
}
