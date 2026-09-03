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
