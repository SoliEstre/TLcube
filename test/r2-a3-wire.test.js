/**
 * r2-a3-wire.test.js — A3 정합 어댑터 (H 배선 · F · 가시성 · 무할당).
 *
 * 기존 테스트는 고치지 않는다. 합성만 여기서 잠그고, 실물 시퀀스는
 * tools/a3-wire-measure.mjs + REPORT.md 가 잰다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { CORNER_UNIT_OFFSETS } from '../src/hexgrid.js';
import { dataCellsInScanOrderCellSurfaceFinal } from '../src/cellSurfaceFinal.js';
import { estimateHomographyN } from '../src/decoder/homography.js';
import {
  A3_FAMILY_Y,
  FACE_LABELS,
  GRID_LOCK_GATE_F,
  LOCK_MISS_LIMIT,
  createA3Adapters,
  homographyFromShape,
  CENTRE_WINDOW_FRACTION,
} from '../src/r2/adapter-locator.js';
import { Q15_ONE } from '../src/r2/params.js';
import {
  R2_INDICATOR,
  R2_SESSION_STATUS,
  createR2Session,
} from '../src/r2/session.js';

const SQRT3_HALF = Math.sqrt(3) / 2;
const SYN_N = 13;
const SYN_LAYOUT = 'v0';
const SYN_SCALE = 9;
const SYN_W = 240;
const SYN_H = 240;

function applyH(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  return {
    x: (H[0] * x + H[1] * y + H[2]) / w,
    y: (H[3] * x + H[4] * y + H[5]) / w,
  };
}

function similarityH(scale, originX, originY) {
  return new Float64Array([
    scale, 0, originX,
    0, scale, originY,
    0, 0, 1,
  ]);
}

function shapeFromH(H, n) {
  const vertices = [];
  for (let k = 0; k < 6; k += 1) {
    const c = CORNER_UNIT_OFFSETS[k];
    vertices.push(applyH(H, c.x * n, c.y * n));
  }
  return {
    center: applyH(H, 0, 0),
    vertices,
    estimatedN: n,
    score: 1,
    blockLocator: { family: 'v0', layoutId: 'v0' },
  };
}

function classifyCanonical(cx, cy, n) {
  let a = (-2 * cy + cx / SQRT3_HALF) / 2;
  let b = (-2 * cy - cx / SQRT3_HALF) / 2;
  if (a >= 0 && a < n && b >= 0 && b < n) {
    return { face: 0, i: a | 0, j: b | 0 };
  }
  a = -cx / SQRT3_HALF;
  b = cy + 0.5 * a;
  if (a >= 0 && a < n && b >= 0 && b < n) {
    return { face: 1, i: a | 0, j: b | 0 };
  }
  b = cx / SQRT3_HALF;
  a = cy + 0.5 * b;
  if (a >= 0 && a < n && b >= 0 && b < n) {
    return { face: 2, i: a | 0, j: b | 0 };
  }
  return null;
}

function tone01(face, i, j) {
  return 0.15 + 0.25 * ((face + 2 * i + 3 * j) % 4);
}

function paintRhombille(width, height, HinvScale, originX, originY, n) {
  const luma = new Float32Array(width * height);
  luma.fill(0.55);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const cx = (x + 0.5 - originX) * HinvScale;
      const cy = (y + 0.5 - originY) * HinvScale;
      const hit = classifyCanonical(cx, cy, n);
      if (hit) luma[y * width + x] = tone01(hit.face, hit.i, hit.j);
    }
  }
  return luma;
}

function emptyOutputs(cellCount) {
  return {
    detection: { found: 0, family: 0 },
    alignment: {
      gatePassed: 0,
      weightQ15: 0,
      mismatchCount: 0,
      matchCount: 0,
      visibleCount: 0,
    },
    faceLuma: new Uint16Array(cellCount * 3),
    visibleCells: new Uint8Array(cellCount),
  };
}

function synCellCount() {
  return dataCellsInScanOrderCellSurfaceFinal(SYN_N, SYN_LAYOUT).length;
}

test('가설1: center+vertices[6] 7점 최소제곱이 알려진 H 를 재구성한다', () => {
  const n = 13;
  const truth = new Float64Array([
    19.2, 0.35, 140,
    -0.22, 18.7, 110,
    0.00031, -0.00027, 1,
  ]);
  const shape = shapeFromH(truth, n);
  const recovered = homographyFromShape(shape);
  assert.ok(recovered, 'H 가 나와야 한다');
  const probes = [
    [0, 0],
    [n, 0],
    [0, n],
    [3.5, 4.5],
    [CORNER_UNIT_OFFSETS[1].x * n, CORNER_UNIT_OFFSETS[1].y * n],
  ];
  let maxErr = 0;
  for (const [x, y] of probes) {
    const a = applyH(truth, x, y);
    const b = applyH(recovered, x, y);
    maxErr = Math.max(maxErr, Math.hypot(a.x - b.x, a.y - b.y));
  }
  assert.ok(maxErr < 1e-6, `재투영 잔차 ${maxErr}`);
});

test('퇴화 shape 에서 4점 DLT 폴백이 H 를 복원한다', () => {
  const n = 13;
  const truth = new Float64Array([
    19.2, 0.35, 140,
    -0.22, 18.7, 110,
    0.00031, -0.00027, 1,
  ]);
  const shape = shapeFromH(truth, n);
  // 이미지 점 중복으로 N점 최소제곱을 죽인다. spine (0,2,4)+center 는 살아 있다.
  shape.vertices[1] = { x: shape.vertices[0].x, y: shape.vertices[0].y };
  const canonicalN = [{ x: 0, y: 0 }];
  const imageN = [{ x: shape.center.x, y: shape.center.y }];
  for (let k = 0; k < 6; k += 1) {
    const c = CORNER_UNIT_OFFSETS[k];
    canonicalN.push({ x: c.x * n, y: c.y * n });
    imageN.push({ x: shape.vertices[k].x, y: shape.vertices[k].y });
  }
  assert.equal(
    estimateHomographyN(canonicalN, imageN),
    null,
    'N점은 중복 꼭짓점에서 죽어야 한다',
  );
  const recovered = homographyFromShape(shape);
  assert.ok(recovered, '4점 폴백이 H 를 내야 한다');
  const probes = [
    [0, 0],
    [CORNER_UNIT_OFFSETS[0].x * n, CORNER_UNIT_OFFSETS[0].y * n],
    [CORNER_UNIT_OFFSETS[2].x * n, CORNER_UNIT_OFFSETS[2].y * n],
    [CORNER_UNIT_OFFSETS[4].x * n, CORNER_UNIT_OFFSETS[4].y * n],
  ];
  let maxErr = 0;
  for (const [x, y] of probes) {
    const a = applyH(truth, x, y);
    const b = applyH(recovered, x, y);
    maxErr = Math.max(maxErr, Math.hypot(a.x - b.x, a.y - b.y));
  }
  assert.ok(maxErr < 1e-6, `spine 재투영 잔차 ${maxErr}`);
});

test('면 라벨 T/L/R 을 검출 출력에 명시로 싣는다', () => {
  const adapters = createA3Adapters({ relocateEveryFrame: true });
  const output = { found: 0, family: 0 };
  adapters.detectInto(new Float32Array(4), 2, 2, 0, null, output);
  assert.deepEqual(output.faceLabels, FACE_LABELS);
  assert.equal(FACE_LABELS[0], 'T');
  assert.equal(FACE_LABELS[1], 'L');
  assert.equal(FACE_LABELS[2], 'R');
  assert.equal(A3_FAMILY_Y, 6);
});

test('합성 참정렬에서 F 가 크고 ±0.5셀 밀면 붕괴한다', () => {
  const n = SYN_N;
  const scale = SYN_SCALE;
  const originX = 120;
  const originY = 120;
  const width = SYN_W;
  const height = SYN_H;
  const luma = paintRhombille(width, height, 1 / scale, originX, originY, n);
  const H = similarityH(scale, originX, originY);
  const cellCount = synCellCount();
  const buffers = emptyOutputs(cellCount);
  const adapters = createA3Adapters({ n, gateF: GRID_LOCK_GATE_F });
  adapters.installHomography(H, n, SYN_LAYOUT);

  const status = adapters.alignInto(
    luma, width, height, 0, null,
    buffers.detection, buffers.alignment,
    buffers.faceLuma, buffers.visibleCells,
  );
  assert.equal(status, R2_SESSION_STATUS.OK);
  const alignedF = adapters.stats.gridLockF;
  assert.ok(alignedF > 100, `참정렬 F=${alignedF} — 봉우리여야 한다`);
  assert.equal(buffers.alignment.gatePassed, 1);
  assert.ok(buffers.alignment.visibleCount > 0);
  assert.ok(buffers.alignment.weightQ15 > 0);
  assert.ok(buffers.alignment.weightQ15 <= Q15_ONE);
  assert.equal(adapters.stats.scanMapped, 1, '제품 스캔순서 매핑이 타야 한다');
  assert.notEqual(cellCount, n * n, 'dataCells === n² 인 조합은 없다');

  const shifted = similarityH(scale, originX, originY);
  shifted[2] += 0.5 * scale * SQRT3_HALF;
  shifted[5] += 0.5 * scale * -0.5;
  adapters.installHomography(shifted, n, SYN_LAYOUT);
  adapters.alignInto(
    luma, width, height, 0, null,
    buffers.detection, buffers.alignment,
    buffers.faceLuma, buffers.visibleCells,
  );
  const shiftedF = adapters.stats.gridLockF;
  assert.ok(
    shiftedF < 10 || shiftedF < alignedF / 20,
    `±0.5셀 F=${shiftedF} (정렬 ${alignedF}) — 붕괴해야 한다`,
  );
});

test('alignInto 는 안 쓴 셀의 faceLuma 를 지운다', () => {
  const n = SYN_N;
  const scale = SYN_SCALE;
  const originX = 120;
  const originY = 36;
  const width = SYN_W;
  const height = SYN_H;
  const luma = paintRhombille(width, height, 1 / scale, originX, originY, n);
  const H = similarityH(scale, originX, originY);
  const cellCount = synCellCount();
  const faceLuma = new Uint16Array(cellCount * 3);
  const visibleCells = new Uint8Array(cellCount);
  faceLuma.fill(0x2222);
  visibleCells.fill(1);
  const adapters = createA3Adapters({ n });
  adapters.installHomography(H, n, SYN_LAYOUT);
  const alignment = {
    gatePassed: 0, weightQ15: 0, mismatchCount: 0, matchCount: 0, visibleCount: 0,
  };
  adapters.alignInto(
    luma, width, height, 0, null,
    { found: 1, family: A3_FAMILY_Y },
    alignment,
    faceLuma,
    visibleCells,
  );
  let unused = 0;
  let used = 0;
  for (let cell = 0; cell < cellCount; cell += 1) {
    if (visibleCells[cell] === 0) {
      unused += 1;
      assert.equal(faceLuma[cell * 3], 0, `미사용 셀 ${cell} T`);
      assert.equal(faceLuma[cell * 3 + 1], 0, `미사용 셀 ${cell} L`);
      assert.equal(faceLuma[cell * 3 + 2], 0, `미사용 셀 ${cell} R`);
    } else {
      used += 1;
    }
  }
  assert.ok(unused > 0, '부분 가시 — 안 쓴 셀이 있어야 한다');
  assert.ok(used > 0, '보이는 셀도 있어야 한다');
  assert.equal(adapters.stats.scanMapped, 1);
});

test('alignInto 핫 루프 2회 호출 사이 객체 정체성', () => {
  const n = SYN_N;
  const scale = SYN_SCALE;
  const originX = 120;
  const originY = 120;
  const width = SYN_W;
  const height = SYN_H;
  const luma = paintRhombille(width, height, 1 / scale, originX, originY, n);
  const H = similarityH(scale, originX, originY);
  const cellCount = synCellCount();
  const buffers = emptyOutputs(cellCount);
  const adapters = createA3Adapters({ n });
  adapters.installHomography(H, n, SYN_LAYOUT);
  const run = () => adapters.alignInto(
    luma, width, height, 0, null,
    buffers.detection, buffers.alignment,
    buffers.faceLuma, buffers.visibleCells,
  );
  run();
  const href = adapters.H;
  const statsRef = adapters.stats;
  const faceRef = buffers.faceLuma;
  const visRef = buffers.visibleCells;
  const outRef = buffers.alignment;
  run();
  run();
  assert.equal(run(), R2_SESSION_STATUS.OK);
  assert.equal(adapters.H, href);
  assert.equal(adapters.stats, statsRef);
  assert.equal(buffers.faceLuma, faceRef);
  assert.equal(buffers.visibleCells, visRef);
  assert.equal(buffers.alignment, outRef);
});

test('세션 주입: detect found=0 이면 align 을 안 타고 SEARCHING 이다', () => {
  const adapters = createA3Adapters({ relocateEveryFrame: true });
  let alignCalls = 0;
  const session = createR2Session({
    layout: {
      cellCount: synCellCount(),
      requiredSymbolCount: 3,
      safetySymbolCount: 0,
      maxPayloadBytes: 8,
    },
    detectInto: adapters.detectInto,
    alignInto: (...args) => {
      alignCalls += 1;
      return adapters.alignInto(...args);
    },
  });
  const luma = new Float32Array(16);
  luma.fill(0.4);
  const result = session.pushFrame(luma, 4, 4, 0, null);
  assert.equal(result.status, R2_SESSION_STATUS.OK);
  assert.equal(session.buffers.detectionOutput.found, 0);
  assert.equal(result.indicator, R2_INDICATOR.SEARCHING);
  assert.equal(alignCalls, 0, 'found=0 이면 alignInto 를 호출하지 않는다');
});

test('F 연속 미달이면 어댑터가 스스로 락을 푼다', () => {
  const n = SYN_N;
  const scale = SYN_SCALE;
  const originX = 120;
  const originY = 120;
  const width = SYN_W;
  const height = SYN_H;
  const luma = paintRhombille(width, height, 1 / scale, originX, originY, n);
  const blank = new Float32Array(width * height);
  blank.fill(0.5);
  const cellCount = synCellCount();
  const buffers = emptyOutputs(cellCount);
  const adapters = createA3Adapters({ n, relocateEveryFrame: false });
  adapters.installHomography(similarityH(scale, originX, originY), n, SYN_LAYOUT);
  adapters.alignInto(
    luma, width, height, 0, null,
    buffers.detection, buffers.alignment,
    buffers.faceLuma, buffers.visibleCells,
  );
  assert.equal(adapters.stats.locked, 1);
  assert.ok(adapters.stats.gridLockF >= GRID_LOCK_GATE_F);

  adapters.installHomography(similarityH(scale, originX + 80, originY + 80), n, SYN_LAYOUT);
  for (let k = 0; k < LOCK_MISS_LIMIT - 1; k += 1) {
    adapters.alignInto(
      luma, width, height, 0, null,
      buffers.detection, buffers.alignment,
      buffers.faceLuma, buffers.visibleCells,
    );
    assert.equal(adapters.stats.locked, 1, `미달 ${k + 1}회 후에도 락`);
  }
  adapters.alignInto(
    luma, width, height, 0, null,
    buffers.detection, buffers.alignment,
    buffers.faceLuma, buffers.visibleCells,
  );
  assert.equal(adapters.stats.locked, 0, `${LOCK_MISS_LIMIT}회 미달 후 해제`);

  const output = { found: 0, family: 0 };
  adapters.detectInto(blank, width, height, 0, null, output);
  assert.equal(output.found, 0, '해제 뒤 빈 프레임은 로케이터를 다시 돌리고 found=0');
});

// ─────────────────────────────────────────────────────────────────────────
// 중앙 창 선언 — 성질만 잠근다.
//
// ⚠ 이 테스트가 **못 재는 것**을 먼저 적는다: 「창이 실제로 QR 을 배제하는가」는
// 실사진 시퀀스에서만 보이고 그 덤프는 gitignore 영역이라 여기 없다. 정본 실측은
// PM/029B §15.3 이고 하네스는 `tools/a3-wire-measure.mjs`
// (`TL_CENTRE_WINDOW` 로 사다리를 돌린다). 여기서 잠그는 것은 **배선의 성질** 셋뿐이다.
// 그리고 로케이터 테스트가 `embed960` 으로 코드를 정중앙에 놓으므로
// **「코드가 프레임 가장자리에 있을 때」는 이 파일도 저쪽도 안 덮는다.**

// 🔴 **여기 «중앙 창이 실제로 듣는가» 테스트가 없는 이유** (2026-09-03, 지어 봤다가 뺐다).
//
// 두 번 시도했고 두 번 다 **공허하게 통과**했다:
//   ① 「가장자리 코드는 좁은 창에서 안 잡힌다」 — 열린 팔도 0 이었다.
//   ② 「중앙 코드는 기본 선언 아래에서도 잡힌다」 — 열린 팔이 여전히 0 이었다.
// 원인은 하나다 — 이 파일의 합성 프레임(`paintRhombille`)은 `installHomography` 로
// 쓰라고 만든 것이고 **로케이터가 그걸 코드로 안 본다.** 그래서 이 파일에는
// `detectInto` 가 «찾는» 경로를 지나는 테스트가 애초에 없다 (마지막 테스트도
// 빈 프레임에서 `found === 0` 만 본다).
//
// 「값이 있나 → 값이 맞나」 순서로 물어 둘 다 잡았고, **못 만드는 자를 넣는 대신
// 이 주석을 남긴다.** 억지로 통과하는 테스트는 다음 사람에게 「이 축은 덮여 있다」고
// 거짓말을 한다.
//
// 실제 증거는 실사진 438프레임 측정이다 (PM/029B §15.3):
//   y0 조준 0/108 → 108/108 · aimError 2.332 → 0.040 · F 14.8 → 597.3
//   하네스 `tools/a3-wire-measure.mjs`, 사다리는 `TL_CENTRE_WINDOW` 환경변수.
//
// ⚠ **덮이지 않은 축**: 「코드가 프레임 가장자리에 있을 때」. 로케이터 테스트는
// `embed960` 으로 코드를 정중앙에 놓고, 위 이유로 여기서도 못 만든다.
// 덮는 방법은 **코드를 프레임 구석에 두고 촬영한 시퀀스**를 코퍼스에 넣는 것이고
// 그건 운영자 촬영이 필요하다 (PM/029B §15.4).

test('중앙 창 기본값은 이 코퍼스의 QR 위치에서 유도됐다 — 성질이 아니다', () => {
  // y0 의 QR 은 960 프레임에서 (90, 81). 창이 그것을 배제하려면
  //   |90 − 480| = 390 > 960 · cw / 2   ⇒   cw < 0.8125
  // 사다리 실측이 그것과 맞는다: 0.90·0.95·1.0 에서 y0 이 0/108, 0.75 에서 108/108.
  // 이 단언은 **기본값이 그 경계 아래라는 것만** 잠근다. QR 이 더 안쪽인 촬영에서는
  // 이 창이 안 듣는다는 사실을 같이 박아 둔다 (PM/029B §15.3 의 ⚠).
  const QR_OFFSET_PX = 390;
  const FRAME_PX = 960;
  const boundary = (QR_OFFSET_PX * 2) / FRAME_PX;
  assert.ok(boundary > 0.8 && boundary < 0.82, `경계 유도 확인 ${boundary}`);
  assert.ok(CENTRE_WINDOW_FRACTION < boundary,
    `기본값 ${CENTRE_WINDOW_FRACTION} 는 경계 ${boundary.toFixed(4)} 아래여야 이 코퍼스에서 듣는다`);
});
