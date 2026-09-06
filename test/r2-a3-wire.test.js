/**
 * r2-a3-wire.test.js — A3 정합 어댑터 (H 배선 · F · 가시성 · 무할당).
 *
 * 기존 테스트는 고치지 않는다. 합성만 여기서 잠그고, 실물 시퀀스는
 * tools/a3-wire-measure.mjs + REPORT.md 가 잰다.
 *
 * ⚠ **계약 갱신 이력**
 *  · 2026-09-06 (레인 R, 변경 R1b) — `LOCK_MISS_LIMIT` 이 세는 단위를 「`alignInto`
 *    호출」에서 「**프레임**(= 같은 `timestamp` 의 호출 묶음)」으로 바꿨다. 라이브에서는
 *    세션이 후보마다 `alignInto` 를 부르므로(n=21·25 면 5개) 옛 뜻은 실질 «반 프레임» 이었다.
 *    아래 「F 연속 미달」 자가 stamp 를 올리도록 바뀌었고, 성질 자 「R1b 미스는 프레임당 1」이
 *    신설됐다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { CORNER_UNIT_OFFSETS } from '../src/hexgrid.js';
import {
  CELL_SURFACE_FINAL_ACTIVE_IDS,
  CELL_SURFACE_FINAL_NS,
  dataCellsInScanOrderCellSurfaceFinal,
  finalLayoutIdsForN,
} from '../src/cellSurfaceFinal.js';
import { estimateHomographyN } from '../src/decoder/homography.js';
import {
  A3_FAMILY_Y,
  FACE_LABELS,
  GRID_LOCK_GATE_F,
  GRID_LOCK_PEAK_F,
  LINEUP_NS,
  LOCK_MISS_LIMIT,
  createA3Adapters,
  homographyFromShape,
  CENTRE_WINDOW_FRACTION,
} from '../src/r2/adapter-locator.js';
import { accumulateCell, cellMarginQ8, createAccumulator } from '../src/r2/accumulate.js';
import { DEFAULT_R2_PARAMS, Q15_ONE, createR2Params } from '../src/r2/params.js';
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
      distrusted: 0,
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

/*
 * 🔴 **계약 갱신** (2026-09-06, 레인 R 변경 R1b): `LOCK_MISS_LIMIT` 은 이제
 * 「**프레임**」을 센다. 옛 자는 같은 `timestamp` 로 `alignInto` 를 3번 불러 「호출 3회」를
 * 쟀는데, 라이브에서는 세션이 **후보마다** `alignInto` 를 부르므로(n=21·25 면 5개)
 * 「호출 3회」가 **반 프레임**이었다 — 한 프레임 블러에 락이 날아갔다.
 * 프레임의 신원은 `timestamp` 다. 그래서 이 자도 stamp 를 올려 가며 부른다.
 */
test('F 연속 미달이면 어댑터가 스스로 락을 푼다 — 세는 단위는 «프레임» 이다', () => {
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
  let stamp = 0;
  const align = () => {
    stamp += 33;
    return adapters.alignInto(
      luma, width, height, stamp, null,
      buffers.detection, buffers.alignment,
      buffers.faceLuma, buffers.visibleCells,
    );
  };

  adapters.installHomography(similarityH(scale, originX, originY), n, SYN_LAYOUT);
  align();
  assert.equal(adapters.stats.locked, 1);
  assert.ok(adapters.stats.gridLockF >= GRID_LOCK_GATE_F);

  adapters.installHomography(similarityH(scale, originX + 80, originY + 80), n, SYN_LAYOUT);
  for (let k = 0; k < LOCK_MISS_LIMIT - 1; k += 1) {
    align();
    assert.equal(adapters.stats.locked, 1, `미달 ${k + 1}프레임 후에도 락`);
  }
  align();
  assert.equal(adapters.stats.locked, 0, `${LOCK_MISS_LIMIT}프레임 미달 후 해제`);

  const output = { found: 0, family: 0 };
  adapters.detectInto(blank, width, height, stamp + 33, null, output);
  assert.equal(output.found, 0, '해제 뒤 빈 프레임은 로케이터를 다시 돌리고 found=0');
});

/**
 * R1(b) 성질 자 — **후보 C 개가 한 프레임에 전부 미스여도 `lockMisses` 는 1 만 증가한다.**
 *
 * 옛 코드의 결함을 값으로 재현한다: 같은 프레임(=같은 timestamp)에 `alignInto` 를
 * 후보 수만큼 부른다. 호출 단위로 세면 첫 프레임에 이미 `LOCK_MISS_LIMIT` 를 넘어
 * 락이 사라진다. 프레임 단위로 세면 `LOCK_MISS_LIMIT` **프레임**까지 버틴다.
 *
 * 🟢 이 성질이 왜 옳은가: `computeGridLockF` 는 H·n·luma 만 쓰고 레이아웃과 무관하므로
 * 한 프레임 안 모든 후보의 F 가 같다 — 「어느 후보가 넘었나」와 「그 프레임이 넘었나」가 동치다.
 */
test('R1b 미스는 프레임당 1 — 한 프레임에 후보 5개가 전부 미스여도 락은 안 풀린다', () => {
  const n = SYN_N;
  const scale = SYN_SCALE;
  const width = SYN_W;
  const height = SYN_H;
  const luma = paintRhombille(width, height, 1 / scale, 120, 120, n);
  const cellCount = synCellCount();
  const buffers = emptyOutputs(cellCount);
  const CANDIDATES = 5;

  const adapters = createA3Adapters({ n, relocateEveryFrame: false });
  // 격자를 크게 밀어 F 를 붕괴시킨다 (같은 파일 위쪽 자가 그 붕괴를 이미 고정한다).
  adapters.installHomography(similarityH(scale, 120 + 80, 120 + 80), n, SYN_LAYOUT);

  const pushFrameAllCandidates = (stamp) => {
    for (let c = 0; c < CANDIDATES; c += 1) {
      adapters.alignInto(
        luma, width, height, stamp, null,
        buffers.detection, buffers.alignment,
        buffers.faceLuma, buffers.visibleCells,
      );
    }
  };

  // 전제(공허 방지): 이 H·프레임에서 게이트가 실제로 미달이어야 한다.
  pushFrameAllCandidates(33);
  assert.ok(adapters.stats.gridLockF < GRID_LOCK_GATE_F,
    `F=${adapters.stats.gridLockF} — 미달 시나리오가 아니다`);
  assert.equal(adapters.stats.locked, 1,
    `한 프레임에 후보 ${CANDIDATES}개가 전부 미스인데 락이 풀렸다 — lockMisses 가 `
    + '**호출** 단위로 세고 있다. 그러면 LOCK_MISS_LIMIT=3 이 실질 «반 프레임» 이라 '
    + '한 프레임 블러에 락이 날아간다');

  // LOCK_MISS_LIMIT-1 프레임까지는 버틴다.
  for (let f = 2; f < LOCK_MISS_LIMIT; f += 1) {
    pushFrameAllCandidates(f * 33);
    assert.equal(adapters.stats.locked, 1, `${f}프레임(호출 ${f * CANDIDATES}회) 후에도 락`);
  }
  // 그 다음 프레임에 풀린다 — 「프레임을 센다」의 반대쪽 자.
  pushFrameAllCandidates(LOCK_MISS_LIMIT * 33);
  assert.equal(adapters.stats.locked, 0,
    `${LOCK_MISS_LIMIT}프레임 미달인데 락이 남았다 — 이제는 아무것도 안 세고 있다`);
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

/*
 * ── R4 정합 weight 하한 (2026-09-06, 레인 R) ───────────────────────────────
 * weight 는 `F / GRID_LOCK_PEAK_F` 였다. 게이트 하한 F=10 이면 w=0.1 이고, 누적기의
 * 정상상태 마진이 `(w·β/(1−λ))·Δ = 3·w·Δ` 이므로 셀 확정(τ = 3 nats)에 **프레임당
 * Δ ≥ 10 nats** 가 필요하다 — 정상 조명에서 도달 불가다. 그래서 게이트를 통과한
 * 프레임에 한해 하한을 둔다 (`params.alignWeightFloorQ15`, 유도는 그 주석에).
 *
 * ⚠ **코퍼스가 못 가르는 축**: y0/y1/y2 실물의 락 F 는 435\~517 로 peakF(100)의 4\~5배라
 * weight 가 이미 포화(Q15_ONE)다. 하한 0 / 0.35 / 0.5 사다리에서 **DONE 프레임이
 * y0=6 · y1=5 · y2=4 로 셋 다 동일**했다 (실측 2026-09-06, HEAD 82ce614 기준선과도 동일).
 * 즉 이 코퍼스는 저-F 구간을 담고 있지 않아 값을 고를 근거를 못 준다 — 값은 위 유도에서
 * 나왔고, 코퍼스가 답한 것은 「나빠지지 않는다」 하나다.
 */

test('R4 weight 하한 — 게이트를 통과한 저-weight 프레임이 params 하한 아래로 안 내려간다', () => {
  const n = SYN_N;
  const scale = SYN_SCALE;
  const width = SYN_W;
  const height = SYN_H;
  const luma = paintRhombille(width, height, 1 / scale, 120, 120, n);
  const cellCount = synCellCount();
  const H = similarityH(scale, 120, 120);
  const floor = DEFAULT_R2_PARAMS.alignWeightFloorQ15;
  assert.ok(floor > 0 && floor < Q15_ONE, 'params 하한이 (0, 1) 안이 아니다');

  // 참정렬 F 는 봉우리라, peakF 를 그보다 훨씬 크게 잡아야 «게이트는 넘는데 w 가 작은»
  // 구간이 생긴다. 이것이 라이브의 저-F 락과 같은 모양이다 (F/peakF ≪ 1).
  const run = (opts) => {
    const adapters = createA3Adapters({ n, ...opts });
    adapters.installHomography(H, n, SYN_LAYOUT);
    const buffers = emptyOutputs(cellCount);
    adapters.alignInto(
      luma, width, height, 7, null,
      buffers.detection, buffers.alignment,
      buffers.faceLuma, buffers.visibleCells,
    );
    return { f: adapters.stats.gridLockF, out: buffers.alignment };
  };

  // peakF 를 이 프레임의 F 에서 **유도**한다 — 합성 paint 의 F 는 셀 내 분산이 0 이라
  // 1e30 급이라서, 상수 peakF 를 적으면 「저-w 시나리오가 아니다」가 조용히 된다.
  const baseline = run({ gateF: GRID_LOCK_GATE_F });
  assert.ok(baseline.f >= GRID_LOCK_GATE_F, `전제: 게이트는 통과한다 (F=${baseline.f})`);
  const targetRatio = 0.1;                       // 라이브의 저-F 락과 같은 모양 (F/peakF ≪ 1)
  const peakF = baseline.f / targetRatio;

  const hugePeak = run({ gateF: GRID_LOCK_GATE_F, peakF });
  assert.equal(hugePeak.out.gatePassed, 1);
  // 공허 방지 — 하한이 없었다면 이 프레임의 w 는 하한보다 훨씬 아래였다.
  assert.ok(Math.round(Q15_ONE * targetRatio) < floor,
    '전제가 아니다: 하한 없이도 w 가 이미 하한 위다 (targetRatio 를 더 낮춰라)');
  assert.equal(hugePeak.out.weightQ15, floor,
    'w 가 하한으로 안 올라갔다 — 저-F 락에서 D 가 영원히 정체한다 (운영자 실기 3차 ③)');

  // 하한을 0 으로 주면 옛 거동으로 되돌아간다 — 하한이 «params 에서 유도된다» 는 반대쪽 자.
  const noFloor = run({ gateF: GRID_LOCK_GATE_F, peakF, params: { alignWeightFloorQ15: 0 } });
  assert.ok(noFloor.out.weightQ15 < floor,
    '하한을 0 으로 줬는데 w 가 그대로다 — 어댑터가 params 가 아니라 자기 상수를 쓴다');

  // 반대쪽 — F 가 peakF 이상이면 하한과 무관하게 포화한다 (하한이 천장을 깎지 않는다).
  const saturated = run({ gateF: GRID_LOCK_GATE_F, peakF: 1 });
  assert.equal(saturated.out.weightQ15, Q15_ONE, '포화 구간에서 w 가 Q15_ONE 이 아니다');

  // 게이트 **미달** 프레임은 그대로 0 이다 — 하한이 게이트를 넓히면 안 된다.
  const shifted = similarityH(scale, 120 + 80, 120 + 80);
  const adapters = createA3Adapters({ n });
  adapters.installHomography(shifted, n, SYN_LAYOUT);
  const buffers = emptyOutputs(cellCount);
  adapters.alignInto(
    luma, width, height, 11, null,
    buffers.detection, buffers.alignment,
    buffers.faceLuma, buffers.visibleCells,
  );
  assert.equal(buffers.alignment.gatePassed, 0, '전제: 미달 프레임');
  assert.equal(buffers.alignment.weightQ15, 0,
    '게이트 미달인데 하한이 실렸다 — 하한이 게이트를 넓혔다');
});

/**
 * R4 의 **왜**: 하한이 없으면 F=게이트 프레임을 아무리 반복해도 셀 마진이 τ 에 못 닿는다.
 * 그것을 누적기 층에서 값으로 재 둔다 — 어댑터 weight 와 `accumulateCell` 을 잇는 유도
 * (`margin_ss = 3·w·Δ`, λ=0.9 · β=0.3) 가 맞는지까지 여기서 확인된다.
 */
test('R4 유도 확인 — w=F/peakF(0.1) 는 τ 에 못 닿고, 하한 w 는 닿는다 (같은 증거·같은 프레임 수)', () => {
  const params = createR2Params();
  const tau = params.tauCellQ8;
  // 프레임당 증거 격차 Δ = 3 nats (τ 와 같은 크기 — «보통» 프레임 하나로는 확정 못 하는 값).
  const gapQ8 = 3 * 256;
  const evidence = new Int16Array(6);
  evidence[0] = 0;
  for (let s = 1; s < 6; s += 1) evidence[s] = -gapQ8;

  const marginAfter = (weightQ15, frames) => {
    const acc = createAccumulator(1);
    for (let f = 0; f < frames; f += 1) accumulateCell(acc, 0, evidence, 0, weightQ15, 0);
    return cellMarginQ8(acc, 0);
  };

  const lowWeight = Math.round(Q15_ONE * (GRID_LOCK_GATE_F / GRID_LOCK_PEAK_F)); // 0.1
  const floorWeight = DEFAULT_R2_PARAMS.alignWeightFloorQ15;                      // 0.5
  const FRAMES = 200; // λ 정상상태보다 훨씬 길다 — 「느려서 못 닿았다」와 「못 닿는다」를 가른다.

  const low = marginAfter(lowWeight, FRAMES);
  const high = marginAfter(floorWeight, FRAMES);
  assert.ok(low < tau,
    `w=${(lowWeight / Q15_ONE).toFixed(2)} 에서 ${FRAMES}프레임 뒤 마진 ${low} ≥ τ(${tau}) — `
    + '유도(margin_ss = 3·w·Δ)가 틀렸거나 λ·β 가 바뀌었다. 그렇다면 params 의 하한 근거를 다시 써라');
  assert.ok(high >= tau,
    `하한 w=${(floorWeight / Q15_ONE).toFixed(2)} 에서도 마진 ${high} < τ(${tau}) — 하한이 너무 낮다`);
});

/*
 * ── 3d 락 마진 ────────────────────────────────────────────────────────────────
 *
 * 처방의 근거는 실측이다 (레인 r2-field3 `nrelottery.md`, 545 락 · 재조사 안 함):
 *   · 자세가 틀린 락도 **F 10\~42** 로 게이트(10)를 넘는다 — 절대 F 는 그 둘을 못 가른다(표 E).
 *   · 그런데 그런 프레임에서 F 는 n′ 에 대해 **단조 증가**한다(176/176) — 탭 간격이 캐노니컬
 *     단위라 n′ 이 커지면 화소 간격이 좁아져 within 분산이 준다(표 C). ⇒ 1위와 2위가 붙는다:
 *     오인군 마진 **최대 1.60** · 정상군 마진 **중앙 71**(최소 1.21).
 *   · 그래서 sep ≥ 3 에서 정상 365/369 통과 · 오인 **0/176** 통과(표 G).
 *
 * 아래 ⓐ 는 그 **기전을 합성으로 재현**한다 — 실측을 옮겨 적는 것이 아니라, 같은 자(어댑터)가
 * 같은 방향으로 갈리는지를 이 저장소 안에서 다시 만든다.
 */

/** 회전을 실은 상사변환 — 「크기·위치는 맞는데 자세가 틀린」 H 를 합성으로 만든다. */
function similarityRotH(scale, originX, originY, degrees) {
  const t = (degrees * Math.PI) / 180;
  const c = Math.cos(t);
  const s = Math.sin(t);
  return new Float64Array([
    scale * c, -scale * s, originX,
    scale * s, scale * c, originY,
    0, 0, 1,
  ]);
}

/** 한 프레임을 어댑터에 한 번 정합시키고 «그 프레임의 판정 전부» 를 돌려준다. */
function alignOnce(adapters, luma, width, height, stamp, cellCount) {
  const buffers = emptyOutputs(cellCount);
  adapters.alignInto(
    luma, width, height, stamp, null,
    buffers.detection, buffers.alignment,
    buffers.faceLuma, buffers.visibleCells,
  );
  return {
    out: buffers.alignment,
    f: adapters.stats.gridLockF,
    margin: adapters.stats.lockMargin,
    marginN: adapters.stats.lockMarginN,
    distrusted: adapters.stats.lockDistrusted,
    locked: adapters.stats.locked,
  };
}

/** 합성 프레임 하나에 임의의 H·n 락을 꽂고 재는 자리. `installHomography` 는 폭을 모르므로 크기 가드가 항등이다. */
function lockAndAlign(H, lockN, luma, width, height, stamp, opts) {
  const adapters = createA3Adapters({ n: lockN, ...(opts || {}) });
  adapters.installHomography(H, lockN, '');
  return { adapters, ...alignOnce(adapters, luma, width, height, stamp, synCellCount()) };
}

test('ⓐ 마진의 유도 — 참 자세는 sep 이 하한보다 크고, 자세가 틀리면 작다 (같은 실루엣에 라인업 n 을 갈아 끼운 F 셋)', () => {
  const width = SYN_W;
  const height = SYN_H;
  const luma = paintRhombille(width, height, 1 / SYN_SCALE, 120, 120, SYN_N);
  const min = DEFAULT_R2_PARAMS.lockMarginMin;
  assert.ok(min > 1, 'params 의 마진 하한이 1 이하다 — 그러면 게이트가 항등이다');

  // ① 참 자세·참 n — F 셋이 결정적으로 한 n 을 가리킨다.
  const truth = lockAndAlign(similarityH(SYN_SCALE, 120, 120), SYN_N, luma, width, height, 1);
  assert.equal(truth.marginN, SYN_N, '참 자세인데 F 가 다른 n 을 가리킨다 — 스케일 규칙이 틀렸다');
  assert.ok(truth.margin > min,
    '참 자세의 마진이 ' + truth.margin + ' 로 하한(' + min + ') 아래다 — 이 게이트는 정상 락을 죽인다');

  /*
   * ② 자세가 틀린 락 — **하위격자**(실루엣의 중심·반지름이 다른 도형). 실측의 두 서명 중 하나이고
   * (zoom 오인 37 중 24), 나머지 하나(「실루엣은 맞는데 회전·원근이 틀림」)는 ③ 이 만든다.
   * 요점은 **F 가 게이트를 넘는다**는 것 — 절대 F 로는 이 락을 못 거른다.
   */
  const subgrid = lockAndAlign(similarityH(SYN_SCALE * 0.35, 120, 120), 21, luma, width, height, 2);
  assert.ok(subgrid.f >= GRID_LOCK_GATE_F,
    '전제가 아니다: 하위격자 F 가 ' + subgrid.f + ' 로 게이트 미만이다 — 그러면 이 자는 마진이 아니라 F 를 재고 있다');
  assert.ok(subgrid.margin < min,
    '자세가 틀린 락의 마진이 ' + subgrid.margin + ' 로 하한(' + min + ') 위다 — 게이트가 이 락을 통과시킨다');

  // ③ 실루엣은 맞고 **회전**만 틀린 락 — 같은 방향으로 갈린다.
  const rotated = lockAndAlign(similarityRotH(SYN_SCALE, 120, 120, 17), SYN_N, luma, width, height, 3);
  assert.ok(rotated.margin < min,
    '회전이 틀린 락의 마진이 ' + rotated.margin + ' 다 — 자세 오차를 마진이 못 본다');

  /*
   * ④ 반대쪽 — 「실루엣도 자세도 맞는데 **n 라벨만** 틀린」 락은 마진이 크다(참 n 을 가리킨다).
   * ⚠ 이것은 실측 코퍼스에 **없던** 모양이다: 실물 오인군 176/176 은 자세 자체가 틀렸고 n 은 그
   *   증상이었다(nrelottery §11(c)). 여기 적어 두는 이유는 「마진이 크다 = 락이 옳다」가 **아니라는**
   *   것을 못 박기 위해서다 — 마진은 «F 가 결정적인가» 를 재지 «이 n 이 맞나» 를 재지 않는다.
   *   그 락은 F 게이트가 거른다(아래 단언).
   */
  const mislabel = lockAndAlign(similarityH((SYN_SCALE * SYN_N) / 21, 120, 120), 21, luma, width, height, 4);
  assert.equal(mislabel.marginN, SYN_N, 'n 라벨만 틀린 락에서 F 가 참 n 을 안 가리킨다');
  assert.ok(mislabel.f < GRID_LOCK_GATE_F,
    'n 라벨만 틀린 락이 F 게이트를 넘는다 — 그러면 이 모양은 마진이 아니라 F 로 걸러야 한다');
});

test('ⓑ 마진 게이트 — 미달 프레임은 누적 0 인데 **락은 유지**된다 (미스로 세면 3프레임 뒤 회복 경로가 죽는다)', () => {
  const width = SYN_W;
  const height = SYN_H;
  const luma = paintRhombille(width, height, 1 / SYN_SCALE, 120, 120, SYN_N);
  const H = similarityH(SYN_SCALE * 0.35, 120, 120);
  const cellCount = synCellCount();

  const first = lockAndAlign(H, 21, luma, width, height, 1);
  const adapters = first.adapters;
  // 전제 — 이 프레임은 F 로는 통과하고 마진으로만 걸린다 (그것이 이 게이트의 존재 이유다).
  assert.ok(first.f >= GRID_LOCK_GATE_F, '전제: F ' + first.f + ' 가 게이트 위');
  assert.ok(first.margin < DEFAULT_R2_PARAMS.lockMarginMin, '전제: 마진 ' + first.margin + ' 이 하한 아래');

  assert.equal(first.out.gatePassed, 0, '마진 미달 프레임이 게이트를 통과했다');
  assert.equal(first.out.weightQ15, 0, '마진 미달인데 weight 가 실렸다 — 틀린 격자에 증거가 쌓인다');
  assert.equal(first.out.matchCount, 0, '마진 미달인데 match 를 셌다');
  assert.equal(first.out.mismatchCount, 0, '마진 미달인데 mismatch 를 셌다');
  assert.equal(first.distrusted, true, 'lockDistrusted 가 안 섰다 — HUD 가 그릴 신호가 없다');
  assert.equal(first.locked, 1, '마진 미달이 락을 즉시 걷었다');

  /*
   * 🔴 핵심 — `LOCK_MISS_LIMIT` 을 **훌쩍 넘겨도** 락이 남아 있어야 한다. 미스로 세면 3프레임 주기
   * 락/해제 진동이 돌아오고(3c 결함 3), 락이 없으면 재검출·인내가 아예 안 돈다 — 자세를 고칠
   * 유일한 경로가 그 둘이다.
   */
  for (let k = 0; k < LOCK_MISS_LIMIT + 3; k += 1) {
    const step = alignOnce(adapters, luma, width, height, 10 + k, cellCount);
    assert.equal(step.out.gatePassed, 0, 'k=' + k + ' 에서 마진 미달이 통과했다');
    assert.equal(step.locked, 1,
      '마진 미달 ' + (k + 2) + '프레임에 락이 걷혔다 — 마진이 «생존» 축을 건드린다 (재검출·인내가 죽는다)');
  }

  // 반대쪽 — F 미달은 여전히 미스로 세고 락을 걷는다 (마진 게이트가 그 경로를 안 지웠다).
  const far = createA3Adapters({ n: SYN_N });
  far.installHomography(similarityH(SYN_SCALE, 200, 200), SYN_N, SYN_LAYOUT);
  for (let k = 0; k < LOCK_MISS_LIMIT; k += 1) {
    alignOnce(far, luma, width, height, 100 + k, cellCount);
  }
  assert.equal(far.stats.locked, 0, 'F 연속 미달인데 락이 안 걷혔다 — 미스 경로가 사라졌다');
});

test('ⓒ R4 가중 하한은 마진 게이트 **뒤**에 선다 — 미달 프레임에서 절대 안 켜진다', () => {
  const width = SYN_W;
  const height = SYN_H;
  const luma = paintRhombille(width, height, 1 / SYN_SCALE, 120, 120, SYN_N);
  const floor = DEFAULT_R2_PARAMS.alignWeightFloorQ15;
  // n=13 하위격자 — F 가 게이트 위이면서 peakF(100) 아래라, **하한이 실제로 발동하는** 구간이다.
  const H = similarityH(SYN_SCALE * 0.35, 120, 120);

  const gated = lockAndAlign(H, SYN_N, luma, width, height, 1);
  assert.ok(gated.f >= GRID_LOCK_GATE_F && gated.f < GRID_LOCK_PEAK_F,
    '전제가 아니다: F ' + gated.f + ' 가 [게이트, peak) 밖이라 하한이 애초에 안 켜진다');
  assert.ok(Math.round(Q15_ONE * (gated.f / GRID_LOCK_PEAK_F)) < floor,
    '전제가 아니다: 하한 없이도 w 가 이미 하한 위다');
  assert.equal(gated.out.weightQ15, 0, '마진 미달 프레임에 하한이 실렸다');

  /*
   * 🔴 **대조군 — 마진 게이트만 끈다** (`lockMarginMin: 0`). 같은 프레임·같은 H 에서 R4 하한이
   * 홀로 무엇을 하는지가 여기서 값으로 보인다: weight 가 0 → 하한(0.5)으로 뛴다. 그것이
   * PM/029B §27.13.2 의 경고 — 「자세가 틀린 락 위에 **자신 있게** 누적해 막대 100 % 뒤 복호 실패」 —
   * 의 기전이고, 실측에서 12표본 중 6이 D=1.0 에 닿았다(nrelottery §9.2).
   */
  const floorOnly = lockAndAlign(H, SYN_N, luma, width, height, 2, { params: { lockMarginMin: 0 } });
  assert.equal(floorOnly.out.gatePassed, 1, '마진 게이트를 껐는데도 안 통과한다 — 대조군이 아니다');
  assert.equal(floorOnly.out.weightQ15, floor,
    'R4 하한이 이 프레임에서 안 켜진다 — 그러면 ⓒ 가 「하한이 마진 뒤에 선다」를 재고 있지 않다');

  /*
   * 🔴 **주석의 «이 자가 막는다» 는 사실이어야 한다** (2026-09-06 검토 3d, 결함 3·5 —
   * memory: claims-in-comments-must-be-true). 3c 는 어댑터 주석에서 그 배치를
   * `test/r2-contract-properties.test.js` 가 잰다고 적었는데, 그 파일에는 마진·하한 단언이
   * 한 줄도 없었다 — 재는 자는 **이 자**다. 다음 사람이 그 문장을 믿고 여기를 안 보는 일이
   * 없도록, 어댑터가 지목하는 파일 이름을 값으로 확인한다.
   * ⚠ 이 한 줄은 «철자» 를 잰다 (파일이 재명명되면 같이 고쳐야 한다). 성질을 재는 것은
   *   위 두 단언이고, 이것은 그 성질이 **어디 적혀 있는지**를 맞춰 두는 자다.
   */
  const adapterSource = readFileSync(
    fileURLToPath(new URL('../src/r2/adapter-locator.js', import.meta.url)),
    'utf8',
  );
  const claimAt = adapterSource.indexOf('그 배치가 성질이다');
  assert.ok(claimAt > 0, '어댑터에서 «하한이 마진 뒤에 선다» 주석을 못 찾았다 — 배치 근거가 사라졌다');
  const claim = adapterSource.slice(claimAt, claimAt + 200);
  assert.ok(claim.includes('test/r2-a3-wire.test.js'),
    '어댑터 주석이 이 자가 아닌 다른 파일을 «값으로 잰다» 고 적는다: ' + claim.split('\n')[0]);
});

test('ⓓ matchCount 계약 — 게이트 통과 프레임만 가시 셀 수를 싣고, 불일치는 언제나 0 이다', () => {
  const width = SYN_W;
  const height = SYN_H;
  const luma = paintRhombille(width, height, 1 / SYN_SCALE, 120, 120, SYN_N);

  // ① 게이트 통과 — matchCount == 가시 셀 수 > 0.
  const pass = lockAndAlign(similarityH(SYN_SCALE, 120, 120), SYN_N, luma, width, height, 1);
  assert.equal(pass.out.gatePassed, 1, '전제: 참 자세는 통과한다');
  assert.ok(pass.out.visibleCount > 0, '전제: 보이는 셀이 있다');
  assert.equal(pass.out.matchCount, pass.out.visibleCount,
    'match 가 가시 셀 수와 다르다 — 세션의 COAST 해제 신호가 셀 수와 어긋난다(R3)');
  assert.equal(pass.out.mismatchCount, 0,
    'mismatch 가 0 이 아니다 — 셀 단위 재관측 불일치는 A4 의 몫이고 이 층은 안 센다');

  // ② 마진 미달 — 둘 다 0.
  const distrust = lockAndAlign(similarityH(SYN_SCALE * 0.35, 120, 120), 21, luma, width, height, 2);
  assert.equal(distrust.out.gatePassed, 0, '전제: 마진 미달');
  assert.equal(distrust.out.matchCount, 0, '마진 미달인데 match 를 실었다');
  assert.equal(distrust.out.mismatchCount, 0, '마진 미달인데 mismatch 를 실었다');

  // ③ F 미달 — 둘 다 0. (가시 셀은 있을 수 있다 — 「보인다」와 「믿는다」는 다른 축이다.)
  const miss = lockAndAlign(similarityH(SYN_SCALE, 200, 200), SYN_N, luma, width, height, 3);
  assert.equal(miss.out.gatePassed, 0, '전제: F 미달');
  assert.equal(miss.out.matchCount, 0, 'F 미달인데 match 를 실었다');
  assert.equal(miss.out.mismatchCount, 0, 'F 미달인데 mismatch 를 실었다');
});

test('ⓔ 라인업 n 은 cellSurfaceFinal 에서 **유도**된다 — 손 목록 {13,21,25} 이 아니다', () => {
  /*
   * 마진이 다투는 후보 집합. 오늘 값은 [13, 21, 25] 지만 그것은 **결과**다: 드랍이 한 번 더
   * 일어나거나(2026-08-17 에 v0X 계열이 그랬다) 새 n 이 편입되면(2026-08-25 에 n=25 가
   * 슬롯 계열로 되살아났다) 이 집합이 따라 움직여야 한다.
   *
   * ⚠ **이 자가 못 보는 것**: 어댑터가 오늘 `[13, 21, 25]` 를 **손으로 적어도** 값이 같으니 초록이다.
   * 이 자가 잡는 것은 그 다음 사건 — 라인업이 실제로 움직이는 날, 유도한 쪽만 따라오고 손 목록은
   * 그대로라 두 값이 갈린다. 즉 이 자는 「지금 유도인가」가 아니라 「**움직일 때 따라오는가**」를 잰다.
   */
  const derived = [];
  const seen = new Set();
  for (const id of CELL_SURFACE_FINAL_ACTIVE_IDS) {
    for (const n of CELL_SURFACE_FINAL_NS[id]) seen.add(n);
  }
  for (const n of [...seen].sort((a, b) => a - b)) {
    if (finalLayoutIdsForN(n).length > 0) derived.push(n);
  }
  assert.deepEqual([...LINEUP_NS], derived,
    '어댑터의 라인업 n 이 cellSurfaceFinal 의 활성 레이아웃에서 안 나온다 — 손 목록이 박혔다');
  assert.ok(LINEUP_NS.length >= 2,
    '라인업 n 이 하나뿐이다 — 그러면 마진은 항상 +Infinity 고 게이트가 항등이다 (그때는 이 자가 그것을 알려야 한다)');
});

/*
 * ── 3d 검토(2026-09-06) 결함 1·2·4 — «불신 락에 회복 경로가 실재하는가» ─────────────
 *
 * 3c 는 마진 게이트를 세우면서 「락을 유지하니 재검출·인내가 회복해 준다」를 근거로 적었다.
 * 그 문장이 코퍼스 어디서도 관측되지 않았다는 것이 이 두 자의 출발점이다 (실측:
 * y2-p9rot 109프레임 relocates 0 · c3-tl 108프레임 relocates 1 · 회복 0).
 */

/** 세션 하나를 실제 어댑터에 물려 준다. 레이아웃은 합성 n=13 이고 완주는 안 시킨다. */
function sessionOn(adapters) {
  return createR2Session({
    layout: {
      cellCount: synCellCount(),
      requiredSymbolCount: synCellCount(),
      safetySymbolCount: 0,
      maxPayloadBytes: 8,
    },
    detectInto: adapters.detectInto,
    alignInto: adapters.alignInto,
  });
}

test('ⓕ 불신은 **재검출 방아쇠**다 — F 가 안정적인 자세 오인 락에서도 재검출이 돌고, 간격은 지켜진다', () => {
  const width = SYN_W;
  const height = SYN_H;
  const luma = paintRhombille(width, height, 1 / SYN_SCALE, 120, 120, SYN_N);
  const cellCount = synCellCount();
  // n=13 하위격자 — F 는 게이트 위(안정)이고 마진만 미달인, 실측 오인군의 모양.
  const adapters = createA3Adapters({ n: SYN_N });
  adapters.installHomography(similarityH(SYN_SCALE * 0.35, 120, 120), SYN_N, SYN_LAYOUT);

  // 첫 프레임의 정합이 마진을 재고 불신을 세운다 (그 전에는 잴 대상이 없다).
  const first = alignOnce(adapters, luma, width, height, 1, cellCount);
  assert.equal(first.distrusted, true, '전제: 이 락은 마진 미달이다');
  assert.ok(first.f >= GRID_LOCK_GATE_F, '전제: F ' + first.f + ' 가 게이트 위다 (fStale 이 아니다)');
  assert.equal(adapters.stats.counters.relocates, 0, '전제: 아직 재검출이 안 돌았다');

  /*
   * 🔴 핵심 — `fStale`(F 반토막)도 `due`(96프레임)도 아닌데 재검출이 돈다. 3c 에서는 이 루프가
   * 끝날 때까지 `relocates` 가 0 이었다: 자세를 고칠 유일한 경로가 구조적으로 막혀 있었다.
   */
  const detection = { found: 0, family: 0, n: 0, H: null, layoutId: '' };
  for (let k = 0; k < 4; k += 1) {
    adapters.detectInto(luma, width, height, 10 + k, null, detection);
    alignOnce(adapters, luma, width, height, 10 + k, cellCount);
  }
  assert.ok(adapters.stats.counters.relocates >= 1,
    '불신 락에서 재검출이 한 번도 안 돌았다 — 3c 주석의 «회복 경로» 가 실재하지 않는다');

  /*
   * 그리고 **간격은 그대로다** — 불신은 매 프레임 참이라, 간격이 없으면 재검출이 프레임을
   * 통째로 먹는다(듀티비 상한은 여전히 `RELOCATE_MIN_GAP_FRAMES` 하나가 정한다).
   */
  const afterBurst = adapters.stats.counters.relocates;
  for (let k = 0; k < 6; k += 1) {
    adapters.detectInto(luma, width, height, 20 + k, null, detection);
    alignOnce(adapters, luma, width, height, 20 + k, cellCount);
  }
  assert.equal(adapters.stats.counters.relocates, afterBurst,
    '불신이 간격을 무시하고 매 프레임 재검출을 돌린다 — 듀티비 상한이 사라졌다');
});

test('ⓖ 불신 프레임은 세션에 «보류» 로 간다 — nCoast 를 넘겨도 DROPPED·hardDrops 가 안 생긴다', () => {
  const width = SYN_W;
  const height = SYN_H;
  const luma = paintRhombille(width, height, 1 / SYN_SCALE, 120, 120, SYN_N);
  const nCoast = Math.trunc(DEFAULT_R2_PARAMS.nCoast);
  assert.ok(nCoast >= 2, '전제: nCoast 가 ' + nCoast + ' 라 COAST 만료를 못 만든다');

  /*
   * 재검출은 여기서 끈다(간격을 크게). 이 자가 재는 축은 «세션이 불신을 어떻게 읽나» 하나고,
   * 재검출이 중간에 락을 갈아 끼우면 그 축이 아니라 로케이터를 재게 된다.
   */
  const quiet = { relocateEveryFrames: 1000000, relocateMinGapFrames: 1000000 };
  const adapters = createA3Adapters({ n: SYN_N, ...quiet });
  adapters.installHomography(similarityH(SYN_SCALE * 0.35, 120, 120), SYN_N, SYN_LAYOUT);
  const session = sessionOn(adapters);

  let sawDropped = 0;
  for (let k = 0; k < nCoast + 3; k += 1) {
    const r = session.pushFrame(luma, width, height, 100 + k, null);
    assert.equal(session.buffers.alignmentOutput.distrusted, 1,
      'k=' + k + ' 에서 어댑터가 불신을 세션에 안 내렸다 — 이 자의 전제가 깨졌다');
    assert.equal(r.indicator, R2_INDICATOR.HOLD,
      'k=' + k + ' 의 표시가 ' + r.indicator + ' 다 — 불신은 «보류» 여야 한다');
    if (r.indicator === R2_INDICATOR.DROPPED) sawDropped += 1;
  }
  assert.equal(sawDropped, 0, '불신 락 위에서 DROPPED 가 떴다');
  /*
   * 🔴 값 — `hardDrops` 는 패널의 「왜 리셋됐나」가 읽는 수다. 3c 배선에서는 이 루프가
   * nCoast 프레임째에 그 수를 올렸다 (실측 코퍼스: y2-p9rot 1 → 7 · c3-tl 0 → 9 · swap-multi 0 → 17).
   */
  assert.equal(session.counters.hardDrops, 0,
    '마진 미달이 하드 드랍으로 세어졌다 — 신원을 잃은 적이 없는데 «리셋» 이 ' + session.counters.hardDrops + '회다');
  assert.equal(adapters.stats.locked, 1, '세션 경로에서 락이 걷혔다 — 전제가 깨졌다');

  /*
   * 🔴 **대조군 — 마진 게이트만 끈다.** 같은 프레임·같은 H 인데 표시가 HOLD 가 아니게 된다.
   * 이것이 없으면 위 단언은 「이 시퀀스는 원래 HOLD 다」로도 초록이다.
   */
  const openAdapters = createA3Adapters({ n: SYN_N, ...quiet, params: { lockMarginMin: 0 } });
  openAdapters.installHomography(similarityH(SYN_SCALE * 0.35, 120, 120), SYN_N, SYN_LAYOUT);
  const open = sessionOn(openAdapters);
  const openResult = open.pushFrame(luma, width, height, 200, null);
  assert.equal(open.buffers.alignmentOutput.distrusted, 0, '대조군이 여전히 불신이다 — 게이트가 안 꺼졌다');
  assert.notEqual(openResult.indicator, R2_INDICATOR.HOLD,
    '마진 게이트를 껐는데도 HOLD 다 — 그러면 ⓖ 는 불신이 아니라 다른 것을 재고 있다');
});
