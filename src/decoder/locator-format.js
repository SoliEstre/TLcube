/**
 * locator-format.js — **로케이터 포즈에서 포맷 워드를 읽는다** (P2 · PM/029B §21·§23).
 *
 * R2 의 A3 어댑터가 라이브에서 ecc·mask 를 «스윕» 할 수 없어서 필요하다. 측정 도구는
 * `ecc × mask` 9조합을 전수로 돌려 맞는 걸 고르지만, 카메라 앞에서는 코드가 스스로
 * 말하는 것을 읽어야 한다.
 *
 * ## 이 파일의 소비자는 `src/r2/adapter-locator.js` 하나다
 * R1 은 이것을 쓰지 않는다 (`bootstrap.js` 가 자기 경로로 같은 층을 부른다).
 * 지우기 전에 그쪽을 봐라. 그리고 **여기에 R2 전용 로직을 넣지 마라** — 포맷 읽기
 * 자체는 `format-read.js` 의 `readFormatForHypothesis` 를 **그대로** 쓴다.
 * 재구현하면 그 사본이 R1 과 어긋나고, 그때 R1·R2 가 **다른 포맷을 읽는다.**
 *
 * ## 왜 포즈 3필드로 충분한가 (실측 2026-09-04)
 * `evaluateCellSurfaceGeometry({family:'cube', n, H}, sampler, opts)` 가 만드는
 * `referenceCalibration` 이 검출기가 만든 것과 **바이트 동일**하다. 그래서 앵커·선
 * 기하·`estimateCubePose` 가 전부 불필요하다. 비용 0.23\~0.70 ms (락 프레임 1회).
 *
 * ## 🔴 이 함수가 답하지 **않는** 것
 * **`n` 과 `layoutId` 는 포맷 워드에 없다.** 실측: y2(참값 v0tr)에서 라인업 5개 중
 * 무엇을 못박아도 crcOk 가 20\~21/110 로 **같다**. 그래서 `pose.layoutId` 를 **입력으로
 * 요구**하고 그대로 되돌려 준다 — 확인해 준 것이 아니다.
 * 「포맷을 읽었으니 격자가 맞다」는 결론을 **절대 쓰면 안 된다.**
 * 못박지 않고 스윕하면 답이 프레임마다 흔들린다 (y1 3종 · y2 2종 실측) — 그리고 그
 * 둘은 세션 격자가 다르다 (n=25 에서 v0tr 493셀 vs v0try 438셀).
 *
 * ## 🔴 `formatWireVersion` 을 끝까지 날라라
 * 후보에 실어 보낸다. 소비자는 그것을 `capacityForCellSurfaceFinal(n, ecc, tones,
 * layoutId, **formatWire**)` 와 `dataCellsInScanOrderCellSurfaceFinal(n, layoutId,
 * **formatWire**)` 에 넘겨야 한다. 안 넘기면 기본 wire=2 격자가 나오는데,
 * v0@13 은 wire2 **109셀** / wire1 **112셀** 이라 첫 차이 지점부터 스캔 인덱스가
 * 전부 밀린다. `test/format-legacy-fallback.test.js` 가 그 오독을 이미 이름 붙여 막는다.
 *
 * ## 🔴 반환에 디코더 내부 객체를 싣지 않는다
 * 후보는 **스칼라만**이다. `hypothesis` · `referenceCalibration` · `referenceSamples`
 * (내부 `Map`) 를 넘기면 import 그래프는 깨끗한 채로 결합이 실재한다 — 클린룸 자가
 * 초록인데 R1 리팩터가 R2 를 조용히 깬다. 재표본이 필요해지면 **객체가 아니라 함수**를
 * 돌려주는 쪽으로 바꿔라.
 */

import {
  FRONTEND_FAILURE,
  assertLumaField,
  fail,
  ok,
} from './contracts.js';
import { cubeSampleOptions, readFormatForHypothesis } from './format-read.js';
import { sampleCubeCell } from './cube-detect.js';
import { evaluateCellSurfaceGeometry } from './cellSurfaceY-detect.js';
import { ECC_NAME_BY_VALUE } from '../formatinfo.js';

/**
 * @param {{width:number, height:number, data:Float32Array}} luma
 * @param {{H:Float64Array, n:number, layoutId:string}} pose 로케이터가 세운 포즈.
 *   `H` 는 **반드시 `Float64Array(9)`** 다 — 평 `Array` 도 `Float32Array` 도
 *   `sampleCubeCell` 이 `missing-homography` 로 거절한다 (실측).
 * @param {object} [options] 디코더 옵션. `calibration` 을 담아 넘길 수 있다.
 * @returns {{ok:true, n, layoutId, accepted, candidates:Array, diagnostics}
 *          |{ok:false, reason, detail}}
 */
export function readFormatFromLocator(luma, pose, options = {}) {
  try {
    assertLumaField(luma);
  } catch (error) {
    return fail(FRONTEND_FAILURE.EMPTY_INPUT, {
      stage: 'locator-format',
      message: error.message,
    });
  }

  const H = pose && pose.H;
  const n = pose && Number(pose.n);
  const layoutId = pose && typeof pose.layoutId === 'string' ? pose.layoutId : '';
  if (!(H instanceof Float64Array) || H.length !== 9
    || !Number.isInteger(n) || n <= 0) {
    return fail(FRONTEND_FAILURE.HOMOGRAPHY_DEGENERATE, {
      stage: 'locator-format',
      cause: 'locator-pose-invalid',
      hasH: H instanceof Float64Array,
      n,
    });
  }
  if (!layoutId) {
    // 스윕은 답을 흔들리게 만든다 (위 §「답하지 않는 것」). 부르는 쪽이 락에서 고른
    // 레이아웃을 못박아야 한다 — 모르면 이 함수를 부를 때가 아니다.
    return fail(FRONTEND_FAILURE.NO_GRID_HYPOTHESIS, {
      stage: 'locator-format',
      cause: 'locator-layout-not-pinned',
      n,
    });
  }

  const opts = { ...options, cellSurfaceLayout: layoutId };
  const base = { family: 'cube', n, H };
  const sampleOptions = cubeSampleOptions(opts);
  const geometry = evaluateCellSurfaceGeometry(
    base,
    (i, j) => sampleCubeCell(luma, base, i, j, sampleOptions),
    opts,
  );
  if (!geometry.ok) return geometry;

  const candidates = [];
  const perTone = [];
  for (const patch of geometry.hypothesisPatches) {
    const hypothesis = { ...base, ...patch };
    const read = readFormatForHypothesis(luma, hypothesis, opts);
    if (!read.ok) {
      perTone.push({
        tones: patch.tones,
        reason: read.reason,
        cause: read.detail && read.detail.cause,
        erasedFormatCells: read.detail && read.detail.erasedFormatCells,
      });
      continue;
    }
    for (const proposal of read.formatCandidates) {
      candidates.push({
        tones: patch.tones,
        versionIndex: proposal.versionIndex,
        eccLevel: proposal.eccLevel,
        // 유도 표를 쓴다 (`formatinfo.js`). RESERVED 는 그 표에 없어 undefined 가 되고,
        // 그것이 용량 API 에 그대로 가는 것을 아래에서 막는다.
        eccName: ECC_NAME_BY_VALUE[proposal.eccLevel],
        // v1 워드에는 마스크 필드가 **없다** — 그 세대는 인덱스 0 고정이다.
        maskIndex: read.formatWireVersion === 2 ? proposal.maskIndex : 0,
        // 🔴 소비자는 이것을 용량·스캔 API 에 반드시 넘겨야 한다 (위 §formatWireVersion).
        formatWireVersion: read.formatWireVersion,
        consensus: proposal.consensus,
        source: proposal.source,
      });
    }
  }

  // RESERVED ecc 는 이름이 없다 — 후보로 내보내면 소비자가 RangeError 를 맞는다.
  const usable = candidates.filter((c) => c.eccName !== undefined);
  if (usable.length === 0) {
    return fail(FRONTEND_FAILURE.NO_FORMAT_CANDIDATE, {
      stage: 'locator-format',
      cause: 'locator-format-crc-no-candidate',
      n,
      layoutId,
      // ⚠ 진단으로만 싣는다. **게이트가 아니다** — 실측에서 accepted=false 인데 CRC 가
      // 서는 프레임이 있었다 (y2 에 v0t 못박음: accepted 18 vs crcOk 21).
      accepted: geometry.accepted,
      reservedDropped: candidates.length - usable.length,
      perTone,
    });
  }

  return ok({
    // 🔴 입력 그대로 되돌려 준다. 포맷이 확인해 준 값이 **아니다**.
    n,
    layoutId,
    accepted: geometry.accepted,
    // 고르지 않는다 — 심판은 본문 RS 다 (R1 규약). 실측 438프레임에서 crcOk 후보가
    // 2개 이상인 경우는 0건이었으나, 그 정책은 **미검증**이다.
    candidates: usable,
    diagnostics: geometry.diagnostics,
  });
}
