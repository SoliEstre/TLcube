/**
 * quiet-extent.js — 안전영역이 «코드 폭의 몇 배» 를 균일하게 덮는지 **잰다**.
 *
 * ## 왜 유도하지 않고 재는가
 *
 * 셀 수(margin)에서 배수를 유도하려면 ① 육각 실루엣의 가로/세로 비(1/sin60 = 1.1547)
 * ② `offsetConvex`/`offsetSimple` 의 코너 처리 ③ **캔버스 사각형 클립**
 * (`quietZonePolygons` 이 `clipToRect` 한다) 를 전부 사본으로 들고 있어야 한다.
 * 셋 중 하나라도 어긋나면 화면이 «1.9배» 라고 적는데 실제로는 1.4배인 상태가 된다 —
 * 그리고 그 거짓말은 운영자가 표본을 다 찍은 **뒤에** 드러난다.
 *
 * ## 🔴 «코드 폭» 은 안전영역이 **감싼 것** 의 폭이다
 *
 * 이 자리에서 두 번 틀렸다 (둘 다 실측으로 드러났다).
 *   1차: 비-안전영역 도형 **전부**의 bbox 를 썼다 → 코너 QR 이 있는 Type O 에서
 *        **0.67배**. QR 은 안전영역에서 제외되는데 분모엔 들어갔다. 안전영역이 코드보다
 *        작다는 뜻이라 물리적으로 불가능한 값이다.
 *   2차: 「가장 큰 안전영역 폴리곤 안에 든 도형」으로 좁혔다 → margin 이 커지면 링이
 *        QR 쪽까지 자라 그 필터가 다시 QR 을 주워, 배수가 **줄어드는** 구간이 생겼다.
 *
 * ⇒ 추측을 그만두고 **안전영역을 만드는 그 함수**(`markHulls`)에게 물어본다. 배제
 *    (selfQuietColors)와 클러스터링을 정확히 아는 유일한 자리다. 사본을 안 만들므로
 *    배제 규칙이 바뀌어도 이 지표가 따라온다.
 *
 * ## 무엇이 «필요» 인가
 *
 * PM/031 §7.12 실측: 스캐너는 코드 폭의 **1.85배** 짜리 정사각을 분석하고, 그 정사각을
 * 균일한 면이 전부 덮어야 실루엣 검출이 선다. 정사각이므로 **가로·세로 중 작은 쪽**이 구속한다.
 *
 * ⚠ 이 1.85 는 **운영자 판 하나**에서 나온 값이다 (보드 p-quiet-gauge 가 blocked 인
 * 이유). 화면은 이 값을 «권장» 으로 보이고 **보증하지 않는다**.
 *
 * @module quiet-extent
 */
import { markHulls } from './quietzone.js';

/** 스캐너 분석 정사각의 변 = 코드 폭 × 이 값 (PM/031 §7.12, 표본 1). */
export const RECOMMENDED_UNIFORM_MULTIPLE = 1.85;

/**
 * 두께 게이지의 눈금 범위 (셀).
 *
 * 하한이 **1** 인 이유: `addQuietZone(…, {margin: 0})` 은 «없음» 이 아니라 터진다
 * (quietzone.js §addQuietZone 주석). 「여백 없음」은 게이지가 아니라 **«없음» 카드**로
 * 표현한다 — 축이 둘로 갈려 있어야 상태가 모호해지지 않는다.
 *
 * 상한이 **20** 인 이유: `sceneY` 의 캔버스 여백이 20셀이고(`DEFAULT_MARGIN_FACTOR`)
 * 안전영역 폴리곤은 캔버스로 클립된다. 20 을 넘겨도 그림이 안 변한다 — 실측:
 * n=13 은 20 에서 2.77배, n=25 는 20 에서 1.92배로 **둘 다 포화**한다.
 */
export const QUIET_MARGIN_MIN = 1;
export const QUIET_MARGIN_MAX = 20;
/** 기본 두께 — 종전 상수(index.html QUIET_MARGIN_CELLS)를 그대로 승계한다. */
export const QUIET_MARGIN_DEFAULT = 2;

/** 게이지 값을 눈금 안으로 접는다. 정수가 아니면 기본값으로 떨어진다. */
export function clampQuietMargin(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return QUIET_MARGIN_DEFAULT;
  if (n < QUIET_MARGIN_MIN) return QUIET_MARGIN_MIN;
  if (n > QUIET_MARGIN_MAX) return QUIET_MARGIN_MAX;
  return n;
}

function bboxOfPointLists(lists) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const pts of lists) {
    if (!Array.isArray(pts)) continue;
    for (const p of pts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { width: maxX - minX, height: maxY - minY };
}

/**
 * 안전영역이 코드 폭의 몇 배를 덮는가.
 *
 * 입력은 **`addQuietZone` 을 거친 scene** 이다 — 안전영역 폴리곤이 앞쪽
 * `quietZone.count` 장이고 나머지가 원래 도형이다.
 *
 * 안전영역이 없으면(«없음» 선택) 균일 면은 코드 자신뿐이라 배수 **1** 이다 — 0 이 아니다.
 *
 * @param {{shapes: Array, width?: number, height?: number,
 *          quietZone?: {count: number, margin: number}}} scene
 * @param {Array<{r:number,g:number,b:number}>} [selfQuietColors]
 *   `addQuietZone` 에 넘긴 것과 **같은 값**이어야 한다 — 배제 대상을 가리는 기준이다.
 * @returns {{multiple:number, codeWidth:number, quietWidth:number, quietHeight:number,
 *            meetsRecommendation:boolean, clipped:boolean}|null}
 */
export function quietCoverage(scene, selfQuietColors = undefined) {
  if (scene === null || typeof scene !== 'object' || !Array.isArray(scene.shapes)) return null;
  const zone = scene.quietZone;
  const count = Number.isInteger(zone?.count) ? zone.count : 0;
  const rest = scene.shapes.slice(count);

  if (count === 0) {
    // 안전영역이 없다 = 균일 면이 코드 자신. 배수는 **정의상 1** 이라 폭이 판정에 안 든다.
    const box = bboxOfPointLists(rest.map((s) => s.points));
    if (box === null || box.width <= 0) return null;
    return {
      multiple: 1,
      codeWidth: box.width,
      quietWidth: box.width,
      quietHeight: box.height,
      meetsRecommendation: 1 >= RECOMMENDED_UNIFORM_MULTIPLE,
      clipped: false,
    };
  }

  const ring = bboxOfPointLists(scene.shapes.slice(0, count).map((s) => s.points));
  if (ring === null) return null;

  // 안전영역이 감싼 대상 — **그걸 만든 함수에게 묻는다** (§코드 폭 주석).
  let subject = null;
  try {
    subject = bboxOfPointLists(markHulls({ ...scene, shapes: rest }, zone.margin, selfQuietColors));
  } catch {
    subject = null;
  }
  // markHulls 가 못 서면(합성·부분 구성) 링에서 되돌린다: 링 = 대상 + 2·margin.
  if (subject === null || !(subject.width > 0)) {
    const back = ring.width - 2 * zone.margin;
    if (!(back > 0)) return null;
    subject = { width: back, height: Math.max(ring.height - 2 * zone.margin, 0) };
  }

  const multiple = Math.min(ring.width, ring.height) / subject.width;
  /*
   * 캔버스에 닿았는가 = **게이지를 더 올려도 안 넓어진다**. 화면이 이걸 말하지 않으면
   * 운영자가 슬라이더를 끝까지 밀고도 왜 배수가 안 오르는지 모른다 (n=25 는 20셀에서
   * 1.92배로 포화한다 — 권장 1.85 대비 여유가 4% 뿐이다).
   */
  const EPS = 1e-6;
  const clipped = Number.isFinite(scene.width) && Number.isFinite(scene.height)
    && (ring.width >= scene.width - EPS || ring.height >= scene.height - EPS);

  return {
    multiple,
    codeWidth: subject.width,
    quietWidth: ring.width,
    quietHeight: ring.height,
    meetsRecommendation: multiple >= RECOMMENDED_UNIFORM_MULTIPLE,
    clipped,
  };
}
