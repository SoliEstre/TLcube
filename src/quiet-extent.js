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

/**
 * **자동 두께가 노리는 배수** — 운영자 표본 14장 실측 (2026-09-01 저녁).
 *
 * 실험: 같은 코드를 여백만 바꿔 화면 촬영 → 스캐너 규약(정사각 크롭 + 960px)으로 물림.
 *   · n=25 (Y2): 1.05·1.09 는 점유율 70% 를 요구하고 1.18 은 80%, **1.37 부터 조준
 *     가이드(54%)로 통과**. 1.55·1.74·1.92 도 통과.
 *   · n=13 (Y0): **1.09 에서 이미 통과** (2.77 까지 전부).
 * ⇒ 문턱은 n=25 에서 **1.18\~1.37 사이**, n=13 은 그보다 훨씬 아래다.
 *
 * 1.5 를 고른 이유: 검증된 최저 통과값(1.37) **위**에 한 단 여유를 둔다. 그리고 표면 색
 * 판은 §13 법칙상 무해하므로 **크게 잡는 쪽의 비용은 이미지 크기뿐**이다 — 작게 잡는
 * 쪽의 비용(복호 실패)보다 싸다.
 *
 * 🔴 **아래 ✅ 는 철회됐다 — 사다리를 «없음» 까지 늘리자 뒤집혔다** (PM/031 §18.9).
 *    같은 자·같은 조건에 **왼쪽 끝 4점**(1.00 = 판 없음 · 1.05 · 1.09 · 1.14)을 더했더니:
 *
 *      없음 **65.2%** ≫ 1.09 58.7% > 1.14 54.3% > 1.05 50.0% > 1.18 45.7% ≫ 1.23 **15.2%**
 *      … 그리고 1.5 는 **39.1%** — 즉 아래가 본 「단조 증가」는 **골짜기에서 기어 나오는
 *      구간**이었고, 시작점이 그보다 훨씬 높았다. 1.5 는 무릎이 아니라 **회복 도중**이다.
 *
 *    ⇒ Type Y 의 **표면 색 판**에 관한 한 이 값은 근거가 없다. 그래서 `auto` 는 이제 판을
 *      아예 안 깐다 (quiet-auto.js §QUIET_COLOR_SURFACE) — 이 상수가 닿는 곳은 사용자가
 *      **직접 판을 고른** 경로와 O/A 의 흑/백 판뿐이고, **그 두 축은 아직 안 쟀다.**
 *      값을 안 바꾼 이유: 안 잰 축(O/A)을 잰 축(Y-표면)의 수로 흔드는 것이 되기 때문이다.
 *      가르는 실험 = O/A 흑/백 판으로 같은 사다리(없음 포함) 한 번.
 *
 * ~~✅ **통제 실험이 이 값을 지지한다**~~ (2026-09-01 밤, PM/031 §18.8). 브라우저 스크린샷
 *    사다리 8장(카메라 없음 · 큐브 기하 동일)을 점유율 45~90% 1% 눈금(46점)으로 훑어
 *    **성공률**로 쟀더니 1.23→1.51 이 **6연속 단조 증가**(15.2%→39.1%)하고 **1.46~1.51 에서
 *    포화**한다. 1.5 가 그 무릎에 앉는다 — 위의 「1.37 위 한 단」과 **다른 근거**로 고른 값인데
 *    통제 실험이 같은 자리를 짚었다.
 *
 * ⚠ 그 전에 **자를 한 번 고쳤다**: 「가이드 54% 통과 여부」 한 칸은 동전 던지기였다
 *    (같은 이미지가 90⛔ 80⛔ 70✅ 54⛔ 45✅ — 재샘플링 앨리어싱). 사진 사다리 다섯 세트가
 *    세션마다 뒤집힌 것도 그 자 탓이다. 판정은 반드시 **성공률**로 한다.
 *
 * ⚠ 아래는 그 정정 **전에** 적은 것이다 — 사진 사다리는 여전히 세션 간 재현이 안 된다: (2026-09-01 밤, 5장,
 *    1.18\~1.37 을 촘촘히). 같은 **1.37 이 이번엔 가이드에서 실패**하고 점유율 90% 를
 *    요구했다 (첫 세트에서는 54% 통과였다). 즉 **배수는 세션을 건너 재현되지 않는다** —
 *    촬영 조건(거리·기울기·초점)이 같은 크기의 축으로 섞여 들어온다.
 *      · 세트 C 안에서 «더 두꺼우면 낫다» 는 경향은 있다 (1.18 전패 → 1.23·1.28 80%
 *        → 1.32 70%). 그런데 1.37 이 90% 로 그 추세를 깬다 — 한 장씩이라 못 가른다.
 *      · **어느 배수에도 세션 간 교차 확인이 없다.** 54% 통과 관측은 전부 첫 세트다.
 *    ⇒ 지금 이 수를 올리거나 내리면 그건 데이터가 아니라 내 감이다. 잠정으로 **둔다**.
 *    가르는 촬영: 같은 자리·같은 초점에서 **배수당 3장 이상**, 그리고 세션 두 번.
 *
 * ⚠ 종전 주석에 「1.18 이 1.09 보다 나빴다 — 표본 운」이라고 적었는데, 그 비단조가
 *    표본 운이 아니라 **세션 축의 그림자**였을 수 있다. 두 세트가 그렇게 갈렸다.
 *
 * ⚠ `RECOMMENDED_UNIFORM_MULTIPLE`(1.85)와 **다른 수다.** 그쪽은 마인크래프트 실물
 * (지형 배경 = 훨씬 나쁜 조건)에서 나왔고 화면에 «권장» 으로 계속 보인다. 이쪽은
 * 자동이 실제로 맞추는 값이다. 둘을 하나로 합치지 마라 — 근거가 다른 매체다.
 */
export const AUTO_TARGET_MULTIPLE = 1.5;

/**
 * 목표 배수를 맞추는 두께(셀)를 **닫힌 형태로** 푼다.
 *
 * 링은 대상을 margin 만큼 바깥으로 민 것이라 (클립 전) 축마다 `대상 + 2·margin` 이다.
 * 정사각이 구속하므로 작은 축이 목표를 넘겨야 한다:
 *   min(subjW, subjH) + 2·m = T · subjW   ⇒   m = (T·subjW − min(subjW, subjH)) / 2
 * 그래서 **후보마다 scene 을 다시 만들 필요가 없다** — 한 번 잰 값으로 바로 나온다.
 * (이분탐색을 돌리면 렌더마다 addQuietZone 을 대여섯 번 더 부르게 된다.)
 *
 * @param {{codeWidth:number, quietWidth:number, quietHeight:number}} coverage
 *   `quietCoverage` 결과. **클립되지 않은** 측정이라야 역산이 성립한다 — 클립된
 *   측정으로 풀면 대상이 실제보다 작게 나와 두께를 적게 잡는다.
 * @param {number} margin 그 측정이 쓰인 두께.
 * @param {number} [target] 목표 배수.
 * @returns {number} 눈금 안으로 접힌 두께.
 */
export function autoQuietMargin(coverage, margin, target = AUTO_TARGET_MULTIPLE) {
  if (coverage === null || typeof coverage !== 'object') return QUIET_MARGIN_DEFAULT;
  const { codeWidth, quietWidth, quietHeight } = coverage;
  if (!(codeWidth > 0) || !Number.isFinite(margin)) return QUIET_MARGIN_DEFAULT;
  /*
   * 🔴 **링이 없으면 역산이 성립하지 않는다.** 안전영역 «없음» 이면 quietCoverage 가
   *    quietWidth = codeWidth 를 돌려주므로(배수 1), 아래 식이 대상을 2·margin 만큼
   *    작게 보고 엉뚱한 두께를 낸다. 실측: 「없음」 상태에서 자동이 6 을 넣어 뒀고,
   *    색을 켜는 순간 그 값이 쓰일 참이었다. 링이 없으면 **손대지 않는다**.
   */
  if (!(quietWidth > codeWidth + 1e-9)) return clampQuietMargin(margin);
  // 측정에서 대상 치수를 되돌린다 (링 = 대상 + 2·margin).
  const subjW = quietWidth - 2 * margin;
  const subjH = quietHeight - 2 * margin;
  if (!(subjW > 0) || !(subjH > 0)) return QUIET_MARGIN_DEFAULT;
  const needed = (target * subjW - Math.min(subjW, subjH)) / 2;
  return clampQuietMargin(Math.ceil(needed));
}

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
