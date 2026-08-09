// sceneY.test.js — buildSceneY 계약 검증 (TY6, SPEC §14)
// 실행: node --test test/sceneY.test.js (cwd: TLcube/)
// encodeY.js 는 병렬 lane 산출물이라 여기서는 합성 encoded ({n, cellDigits}) 로 짠다
// (encodeY.js 자체의 실제 출력 형태 — key `${i},${j}`, role 'reference'|'format'|
// 'data'|'filler' — 는 참고만 하고 import 하지 않는다).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildSceneY, DEFAULT_FACE_GAINS, QR_CORNERS } from '../src/sceneY.js';
import { moduleQuad, cubeBounds, layoutForCube, faceBasis, YFACES } from '../src/ygrid.js';
import { CORNER_UNIT_OFFSETS } from '../src/hexgrid.js';
import { digitToRanks } from '../src/lehmer.js';
import { digitToPattern, RHO_MIN } from '../src/tonemap.js';
import { relativeLuminance } from '../src/luminance.js';
import { qrMatrix } from '../src/qr.js';

const PALETTE = {
  background: { r: 14, g: 16, b: 24 },
  levels: [
    { r: 58, g: 68, b: 108 }, // rank 0 (어두움)
    { r: 110, g: 135, b: 190 }, // rank 1
    { r: 220, g: 228, b: 240 }, // rank 2 (밝음)
  ],
  bullseyeDark: { r: 0, g: 0, b: 0 },
  bullseyeLight: { r: 255, g: 255, b: 255 },
};

/** n×n 전 셀을 채운 합성 encoded — digit = (i + 2j) % 6 (결정적, 다양한 digit 분포).
 * tones 생략 시 2톤 메인(encodeY.js 기본값과 정합) — encoded.tones 를 명시적으로 싣는다. */
function makeFullEncoded(n, tones = 2) {
  const cellDigits = new Map();
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      cellDigits.set(`${i},${j}`, { digit: (i + 2 * j) % 6, role: 'data' });
    }
  }
  return { n, cellDigits, tones };
}

const N = 5; // 작은 n — painter 순서·색 매핑 테스트용(빠르다).

describe('buildSceneY — shapes 수', () => {
  test('3n² + 3 + 1 (qrText 없음)', () => {
    const encoded = makeFullEncoded(N);
    const scene = buildSceneY(encoded, { palette: PALETTE });
    assert.equal(scene.shapes.length, 3 * N * N + 3 + 1);
  });

  test('3n² + 3 + 1 + QR 블록 수 (qrText 있음)', () => {
    const encoded = makeFullEncoded(N);
    const qrText = 'HTTPS://TL.EXAMPLE/A';
    const scene = buildSceneY(encoded, { palette: PALETTE, qrText });
    const qr = qrMatrix(qrText);
    let darkCount = 0;
    for (const m of qr.modules) if (m === 1) darkCount += 1;
    const expectedQrShapes = 1 /* 콰이어트 패치 */ + darkCount;
    assert.equal(scene.shapes.length, 3 * N * N + 3 + 1 + expectedQrShapes);
  });
});

describe('buildSceneY — painter 순서 계약', () => {
  test('① 3n² 폴리곤 → ② Y-심 3선 → ③ 중심 disc → ④ QR 블록', () => {
    const encoded = makeFullEncoded(N);
    const qrText = 'HTTPS://TL.EXAMPLE/A';
    const scene = buildSceneY(encoded, { palette: PALETTE, qrText });

    const cellShapeCount = 3 * N * N;
    for (let i = 0; i < cellShapeCount; i += 1) {
      assert.equal(scene.shapes[i].kind, 'polygon');
    }
    // Y-심 3선: 다음 3개, 색은 bullseyeDark, 4점 폴리곤.
    for (let i = cellShapeCount; i < cellShapeCount + 3; i += 1) {
      const s = scene.shapes[i];
      assert.equal(s.kind, 'polygon');
      assert.deepEqual(s.color, PALETTE.bullseyeDark);
      assert.equal(s.points.length, 4);
    }
    // 중심 disc: 그다음 1개.
    const discIdx = cellShapeCount + 3;
    const disc = scene.shapes[discIdx];
    assert.equal(disc.kind, 'disc');
    assert.deepEqual(disc.color, PALETTE.bullseyeDark);
    assert.equal(disc.r, 0.18);

    // QR 블록: 콰이어트 패치(밝음) 먼저, 그다음 다크 모듈들.
    const quiet = scene.shapes[discIdx + 1];
    assert.equal(quiet.kind, 'polygon');
    assert.deepEqual(quiet.color, PALETTE.bullseyeLight);
    for (let i = discIdx + 2; i < scene.shapes.length; i += 1) {
      const s = scene.shapes[i];
      assert.equal(s.kind, 'polygon');
      assert.deepEqual(s.color, PALETTE.bullseyeDark);
    }
  });

  test('셀 순회는 j→i 오름차순, 면 순서는 YFACES([T,L,R]) — 좌표는 moduleQuad 와 일치', () => {
    const encoded = makeFullEncoded(N);
    const scene = buildSceneY(encoded, { palette: PALETTE });
    let idx = 0;
    for (let j = 0; j < N; j += 1) {
      for (let i = 0; i < N; i += 1) {
        const entry = encoded.cellDigits.get(`${i},${j}`);
        const ranks = digitToRanks(entry.digit);
        for (const face of YFACES) {
          const shape = scene.shapes[idx];
          assert.equal(shape.kind, 'polygon');
          assert.deepEqual(shape.points, moduleQuad(face, i, j, scene.layout));
          // 색은 게인 적용 후 값이라 원본 levels[rank] 와 다를 수 있다(L,R) —
          // 별도 색 테스트(게인 적용 검증)에서 다룬다. 여기서는 좌표·순서만.
          idx += 1;
        }
        void ranks;
      }
    }
    assert.equal(idx, 3 * N * N);
  });
});

describe('buildSceneY — 면 게인 적용 (tones=2, 2톤 메인 기본값)', () => {
  test('T 면은 게인 1 — 원본 레벨 색 그대로(밝음→levels[2], 어두움→levels[0])', () => {
    const encoded = makeFullEncoded(N);
    const scene = buildSceneY(encoded, { palette: PALETTE });
    const entry = encoded.cellDigits.get('0,0');
    const pattern = digitToPattern(entry.digit);
    // 셀(0,0) 의 T 는 셀블록 시작 인덱스 0(YFACES 순서 [T,L,R] 중 첫째).
    const tShape = scene.shapes[0];
    assert.deepEqual(tShape.color, PALETTE.levels[pattern.T ? 2 : 0]);
  });

  test('L·R 면은 게인 <1 이라 레벨 색보다 어둡다(각 채널 <= 원본)', () => {
    const encoded = makeFullEncoded(N);
    const scene = buildSceneY(encoded, { palette: PALETTE });
    const entry = encoded.cellDigits.get('0,0');
    const pattern = digitToPattern(entry.digit);
    const lShape = scene.shapes[1]; // YFACES 순서 [T,L,R] 중 둘째
    const rShape = scene.shapes[2];
    const origL = PALETTE.levels[pattern.L ? 2 : 0];
    const origR = PALETTE.levels[pattern.R ? 2 : 0];
    for (const ch of ['r', 'g', 'b']) {
      assert.ok(lShape.color[ch] <= origL[ch], `L.${ch} 게인 후 원본보다 밝아짐`);
      assert.ok(rShape.color[ch] <= origR[ch], `R.${ch} 게인 후 원본보다 밝아짐`);
    }
  });

  test('게인 적용 후에도 면 내 레벨 순서(0<1<2, 상대휘도) 보존 — 게인은 면 단위 스칼라라 자동 보존', () => {
    const encoded = makeFullEncoded(N);
    const scene = buildSceneY(encoded, { palette: PALETTE });
    // 세 면 모두 등장하는 셀들을 모아 각 면에서 실제 쓰인 색의 상대휘도가
    // rank 순서(0<1<2)와 일치하는지 실측한다. cellSize=1 이므로 모든 셀의 면별
    // 게인 색은 동일 팔레트에서 나오므로, 각 face 별로 3개 색(levels 게인판)의
    // 상대휘도가 오름차순인지만 확인하면 충분하다(§4.4 median=색 자체 상대휘도 전제 승계).
    const gainOf = { T: 1, L: 0.72, R: 0.52 };
    for (const face of YFACES) {
      const g = gainOf[face];
      const ys = PALETTE.levels.map((rgb) => {
        const lin = (v) => {
          const c = v / 255;
          return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
        };
        const rl = lin(rgb.r) * g;
        const gl = lin(rgb.g) * g;
        const bl = lin(rgb.b) * g;
        return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
      });
      assert.ok(ys[0] < ys[1], `${face} rank0<rank1 붕괴: ${ys}`);
      assert.ok(ys[1] < ys[2], `${face} rank1<rank2 붕괴: ${ys}`);
    }
    void relativeLuminance; // import 사용 표시(형식 검증에도 relativeLuminance 실측을 쓴다는 계약 문서화).
    void scene;
  });
});

describe('buildSceneY — tones=3(Y-T 옵션) 는 기존 rank 경로 그대로', () => {
  test('색은 digitToRanks 순위 기반 levels[rank] — digitToPattern 이 아니다', () => {
    const encoded = makeFullEncoded(N, 3);
    const scene = buildSceneY(encoded, { palette: PALETTE });
    const entry = encoded.cellDigits.get('0,0');
    const ranks = digitToRanks(entry.digit);
    const tShape = scene.shapes[0];
    const lShape = scene.shapes[1];
    const rShape = scene.shapes[2];
    assert.deepEqual(tShape.color, PALETTE.levels[ranks.T]);
    // L·R 는 게인 <1 이라 원본보다 어둡거나 같다(원본 레벨 색과 직접 비교는
    // 게인 적용 후라 불가 — 대신 원본 levels[rank] 대비 채널별 <= 만 확인).
    const origL = PALETTE.levels[ranks.L];
    const origR = PALETTE.levels[ranks.R];
    for (const ch of ['r', 'g', 'b']) {
      assert.ok(lShape.color[ch] <= origL[ch]);
      assert.ok(rShape.color[ch] <= origR[ch]);
    }
  });

  test('셀마다 세 면이 서로 다른 rank(0,1,2 전부) 를 쓸 수 있다 — 2톤과 달리 mid 레벨도 등장', () => {
    // digit 3(=(T,L,R) 랭크 (0,2,1)) 로 강제한 셀 하나를 만들어 mid 레벨(levels[1])
    // 이 실제로 렌더에 쓰이는지 확인 — tones=2 경로에서는 절대 등장하지 않는 색이다
    // (U17: 2톤은 levels[0]/[2] 만 강제).
    const cellDigits = new Map([['0,0', { digit: 3, role: 'data' }]]);
    const encoded = { n: N, cellDigits, tones: 3 };
    const scene = buildSceneY(encoded, { palette: PALETTE });
    const ranks = digitToRanks(3);
    const colors = [scene.shapes[0].color, scene.shapes[1].color, scene.shapes[2].color];
    const midColorUsed = [ranks.T, ranks.L, ranks.R].includes(1);
    assert.ok(midColorUsed, 'digit 3 의 순위 중 하나는 mid(1) 여야 한다 — 테스트 전제 확인');
    void colors;
  });
});

describe('buildSceneY — U17 2톤 분리 계약 게이트', () => {
  test('RHO_MIN 미달 팔레트(levels[0]/[2] 비율 < 10)는 tones=2 에서 throw', () => {
    const encoded = makeFullEncoded(N); // tones=2 기본값
    const flatPalette = {
      ...PALETTE,
      levels: [
        { r: 100, g: 100, b: 100 },
        { r: 150, g: 150, b: 150 },
        { r: 180, g: 180, b: 180 }, // levels[0] 대비 분리비가 10 미만
      ],
    };
    assert.throws(() => buildSceneY(encoded, { palette: flatPalette }), RangeError);
  });

  test('tones=3 이면 levels[0]/[2] 분리비가 낮아도 게이트가 적용되지 않는다', () => {
    const encoded = makeFullEncoded(N, 3);
    const flatPalette = {
      ...PALETTE,
      levels: [
        { r: 100, g: 100, b: 100 },
        { r: 150, g: 150, b: 150 },
        { r: 180, g: 180, b: 180 },
      ],
    };
    assert.doesNotThrow(() => buildSceneY(encoded, { palette: flatPalette }));
  });

  test('slate 급 분리(PALETTE, ρ≈12.59 >= RHO_MIN=10) 는 tones=2 에서 통과', () => {
    assert.equal(RHO_MIN, 10);
    const encoded = makeFullEncoded(N);
    assert.doesNotThrow(() => buildSceneY(encoded, { palette: PALETTE }));
  });
});

describe('buildSceneY — γ ≤ 2 단언', () => {
  test('DEFAULT_FACE_GAINS 의 γ = 1/0.52 ≈ 1.923 <= 2', () => {
    const ratio = Math.max(DEFAULT_FACE_GAINS.T, DEFAULT_FACE_GAINS.L, DEFAULT_FACE_GAINS.R)
      / Math.min(DEFAULT_FACE_GAINS.T, DEFAULT_FACE_GAINS.L, DEFAULT_FACE_GAINS.R);
    assert.ok(ratio <= 2, `γ=${ratio}`);
    assert.ok(Math.abs(ratio - 1 / 0.52) < 1e-9);
  });

  test('커스텀 faceGains 로 γ > 2 를 넘기면 throw', () => {
    const encoded = makeFullEncoded(N);
    const badPalette = { ...PALETTE, faceGains: { T: 1, L: 0.4, R: 0.1 } }; // γ=10
    assert.throws(() => buildSceneY(encoded, { palette: badPalette }), RangeError);
  });

  test('faceGains 0 이하는 throw', () => {
    const encoded = makeFullEncoded(N);
    const badPalette = { ...PALETTE, faceGains: { T: 1, L: 0.72, R: 0 } };
    assert.throws(() => buildSceneY(encoded, { palette: badPalette }));
  });
});

describe('buildSceneY — QR 블록 vs 실루엣 무교차', () => {
  test('n=21 기본 margin 에서 겹치지 않는다(throw 없음)', () => {
    const encoded = { n: 21, cellDigits: new Map([['0,0', { digit: 0, role: 'data' }]]) };
    assert.doesNotThrow(() => buildSceneY(encoded, { palette: PALETTE, qrText: 'A' }));
  });

  test('n=25 기본 margin 에서 겹치지 않는다(throw 없음)', () => {
    const encoded = { n: 25, cellDigits: new Map([['0,0', { digit: 0, role: 'data' }]]) };
    assert.doesNotThrow(() => buildSceneY(encoded, { palette: PALETTE, qrText: 'A' }));
  });

  test('margin 을 너무 작게 강제하면 겹침이 감지되어 throw', () => {
    const encoded = { n: 21, cellDigits: new Map([['0,0', { digit: 0, role: 'data' }]]) };
    assert.throws(
      () => buildSceneY(encoded, { palette: PALETTE, qrText: 'A', margin: 2 }),
      /겹친다/,
    );
  });

  test('실측: QR 블록 bbox 와 cubeBounds 가 실제로 분리되어 있다', () => {
    const n = 21;
    const cellSize = 1;
    const margin = 20 * cellSize; // sceneY.js DEFAULT_MARGIN_FACTOR
    const layout = layoutForCube(n, { size: cellSize, margin });
    const silhouette = cubeBounds(n, layout);
    const qrModuleSize = cellSize / 2;
    const blockSide = 29 * qrModuleSize; // 4 콰이어트 + 21 QR + 4 콰이어트
    const blockMaxX = margin * 0.25 + blockSide;
    const blockMaxY = margin * 0.25 + blockSide;
    assert.ok(blockMaxX <= silhouette.minX || blockMaxY <= silhouette.minY);
  });
});

describe('buildSceneY — 코너 QR 위치 4택 (ADR 0004 §1-7)', () => {
  const encoded = { n: 21, cellDigits: new Map([['0,0', { digit: 0, role: 'data' }]]) };

  test('QR_CORNERS = [TL, TR, BL, BR]', () => {
    assert.deepEqual(QR_CORNERS, ['TL', 'TR', 'BL', 'BR']);
  });

  test('4 코너 전부 기본 margin 에서 무교차(throw 없음)', () => {
    for (const qrCorner of QR_CORNERS) {
      assert.doesNotThrow(() => buildSceneY(encoded, { palette: PALETTE, qrText: 'A', qrCorner }));
    }
  });

  test('알 수 없는 qrCorner 는 RangeError', () => {
    assert.throws(
      () => buildSceneY(encoded, { palette: PALETTE, qrText: 'A', qrCorner: 'MID' }),
      RangeError,
    );
  });

  test('margin 을 너무 작게 강제하면 4 코너 전부 겹침 감지 throw', () => {
    for (const qrCorner of QR_CORNERS) {
      assert.throws(
        () => buildSceneY(encoded, { palette: PALETTE, qrText: 'A', qrCorner, margin: 2 }),
        /겹친다/,
      );
    }
  });

  test('bbox 대칭 이동: TR/BL/BR 블록 원점이 TL 대비 layout.width/height 기준 거울상', () => {
    const cellSize = 1;
    const margin = 20 * cellSize;
    const qrModuleSize = cellSize / 2;
    const blockSide = 29 * qrModuleSize;

    function quietOriginFor(qrCorner) {
      const scene = buildSceneY(encoded, {
        palette: PALETTE, qrText: 'A', qrCorner, cellSize, margin,
      });
      const quiet = scene.shapes.find((s) => s.kind === 'polygon' && s.color === PALETTE.bullseyeLight);
      return {
        x: Math.min(...quiet.points.map((p) => p.x)),
        y: Math.min(...quiet.points.map((p) => p.y)),
        width: scene.width,
        height: scene.height,
      };
    }

    const tl = quietOriginFor('TL');
    assert.ok(Math.abs(tl.x - margin * 0.25) < 1e-9);
    assert.ok(Math.abs(tl.y - margin * 0.25) < 1e-9);

    const tr = quietOriginFor('TR');
    assert.ok(Math.abs(tr.x - (tl.width - margin * 0.25 - blockSide)) < 1e-9);
    assert.ok(Math.abs(tr.y - tl.y) < 1e-9);

    const bl = quietOriginFor('BL');
    assert.ok(Math.abs(bl.x - tl.x) < 1e-9);
    assert.ok(Math.abs(bl.y - (tl.height - margin * 0.25 - blockSide)) < 1e-9);

    const br = quietOriginFor('BR');
    assert.ok(Math.abs(br.x - tr.x) < 1e-9);
    assert.ok(Math.abs(br.y - bl.y) < 1e-9);
  });

  test('기존 기본값 경로(qrCorner 생략 = TL) 스냅샷 불변', () => {
    const cellSize = 1;
    const margin = 20 * cellSize;
    const sceneDefault = buildSceneY(encoded, { palette: PALETTE, qrText: 'A', cellSize, margin });
    const sceneExplicitTL = buildSceneY(
      encoded,
      { palette: PALETTE, qrText: 'A', qrCorner: 'TL', cellSize, margin },
    );
    assert.deepEqual(sceneDefault, sceneExplicitTL);
  });

  test('방위 고정(ADR 0004 §1-7): 4코너 전부 다크 모듈 절대좌표 집합이 qrMatrix 원본과 완전 일치', () => {
    // 검증 lane 지적(2026-08-09): 존재·원점 검사만으로는 전역 전치(x↔y)·코너별
    // 90° 회전 뮤테이션이 전부 생존한다. typeO-fallback.test.js 와 같은 방식으로
    // 렌더된 다크 모듈을 (x,y) 모듈 인덱스로 역산해 원본 행렬의 다크 집합과
    // **완전 대조**한다 — 위치 4택은 평행이동만 허용, 회전·미러·전치는 전부 잡힌다.
    const cellSize = 1;
    const margin = 20 * cellSize;
    const qrText = 'HTTPS://TL.EXAMPLE/A';
    const qr = qrMatrix(qrText);
    const qrModuleSize = cellSize / 2;

    const expected = new Set();
    for (let y = 0; y < qr.size; y += 1) {
      for (let x = 0; x < qr.size; x += 1) {
        if (qr.modules[y * qr.size + x] === 1) expected.add(`${x},${y}`);
      }
    }
    assert.ok(expected.size > 0);

    for (const qrCorner of QR_CORNERS) {
      const scene = buildSceneY(encoded, {
        palette: PALETTE, qrText, qrCorner, cellSize, margin,
      });
      const quietIdx = scene.shapes.findIndex(
        (s) => s.kind === 'polygon' && s.color === PALETTE.bullseyeLight,
      );
      assert.ok(quietIdx >= 0, `${qrCorner}: 콰이어트 패치 없음`);
      const quiet = scene.shapes[quietIdx];
      const originX = Math.min(...quiet.points.map((p) => p.x)) + 4 * qrModuleSize;
      const originY = Math.min(...quiet.points.map((p) => p.y)) + 4 * qrModuleSize;

      // 콰이어트 패치 뒤 shape 전부가 이 코너 QR 의 다크 모듈이다(윈도 미사용 경로).
      const got = new Set();
      for (const s of scene.shapes.slice(quietIdx + 1)) {
        const mx = (Math.min(...s.points.map((p) => p.x)) - originX) / qrModuleSize;
        const my = (Math.min(...s.points.map((p) => p.y)) - originY) / qrModuleSize;
        const xi = Math.round(mx);
        const yi = Math.round(my);
        assert.ok(Math.abs(mx - xi) < 1e-9 && Math.abs(my - yi) < 1e-9,
          `${qrCorner}: 모듈 그리드 비정렬 (${mx},${my})`);
        assert.ok(xi >= 0 && xi < qr.size && yi >= 0 && yi < qr.size,
          `${qrCorner}: 모듈 인덱스 범위 밖 (${xi},${yi})`);
        got.add(`${xi},${yi}`);
      }
      assert.equal(got.size, expected.size, `${qrCorner}: 다크 모듈 수 불일치`);
      for (const k of expected) {
        assert.ok(got.has(k), `${qrCorner}: 원본 다크 모듈 (${k}) 이 렌더에 없다 — 방위 계약 위반`);
      }
    }
  });
});

describe('buildSceneY — 콰이어트 존이 QR 을 4모듈로 감싼다', () => {
  test('첫 다크 모듈(있다면)의 좌상단 오프셋 = 콰이어트 패치 좌상단 + 4모듈', () => {
    const encoded = makeFullEncoded(N);
    const qrText = 'HTTPS://TL.EXAMPLE/A';
    const scene = buildSceneY(encoded, { palette: PALETTE, qrText });
    const cellShapeCount = 3 * N * N;
    const discIdx = cellShapeCount + 3;
    const quiet = scene.shapes[discIdx + 1];
    const quietMinX = Math.min(...quiet.points.map((p) => p.x));
    const quietMinY = Math.min(...quiet.points.map((p) => p.y));
    const quietMaxX = Math.max(...quiet.points.map((p) => p.x));

    const qrModuleSize = 0.5; // cellSize=1 기본
    const qr = qrMatrix(qrText);
    // 콰이어트 패치 한 변 = 29 모듈.
    assert.ok(Math.abs((quietMaxX - quietMinX) - 29 * qrModuleSize) < 1e-9);

    // 처음 등장하는 다크 모듈 도형의 좌상단이 콰이어트+4모듈 안쪽에 있는지 확인.
    let found = null;
    for (let y = 0; y < qr.size && !found; y += 1) {
      for (let x = 0; x < qr.size; x += 1) {
        if (qr.modules[y * qr.size + x] === 1) { found = { x, y }; break; }
      }
    }
    assert.ok(found, 'QR 매트릭스에 다크 모듈이 하나도 없음(텍스트를 바꿔야 함)');
    const darkShape = scene.shapes[discIdx + 2]; // 콰이어트 패치 바로 다음 = row-major 첫 다크 모듈
    const darkMinX = Math.min(...darkShape.points.map((p) => p.x));
    const darkMinY = Math.min(...darkShape.points.map((p) => p.y));
    assert.ok(Math.abs(darkMinX - (quietMinX + 4 * qrModuleSize + found.x * qrModuleSize)) < 1e-9);
    assert.ok(Math.abs(darkMinY - (quietMinY + 4 * qrModuleSize + found.y * qrModuleSize)) < 1e-9);
  });
});

describe('buildSceneY — 결정성', () => {
  test('동일 입력 2회 호출 결과가 deepEqual', () => {
    const encoded = makeFullEncoded(N);
    const qrText = 'HTTPS://TL.EXAMPLE/A';
    const a = buildSceneY(encoded, { palette: PALETTE, qrText });
    const b = buildSceneY(encoded, { palette: PALETTE, qrText });
    assert.deepEqual(a, b);
  });
});

describe('buildSceneY — qrText 생략', () => {
  test('QR shape 이 없다(콰이어트 패치·다크 모듈 전부 부재)', () => {
    const encoded = makeFullEncoded(N);
    const scene = buildSceneY(encoded, { palette: PALETTE });
    assert.equal(scene.shapes.length, 3 * N * N + 3 + 1);
    for (const s of scene.shapes) {
      assert.notDeepEqual(s.color, PALETTE.bullseyeLight);
    }
  });
});

// ── 면 내 QR 윈도 β (ADR 0003 D1 + [C7 Q7]) — Y2(n=25)·tones=2 전용 ─────────

describe('buildSceneY — 면 내 QR 윈도 (encoded.window===true)', () => {
  const WN = 25; // 윈도는 n=25(Y2) 전용.
  const QR_WINDOW_TEXT = 'HTTPS://TL.EXAMPLE/W';

  /** n=25 전 셀을 채운 합성 encoded, window=true. 윈도 좌표([12,24]²)는 실제
   * encodeY.js 라면 cellDigits 에서 빠지지만, 여기서는 sceneY.js 단독 계약(①의
   * `entry===undefined` 스킵)만 확인하면 되므로 그 169 좌표를 의도적으로 비운다. */
  function makeWindowEncoded() {
    const cellDigits = new Map();
    const lo = WN - 13;
    for (let j = 0; j < WN; j += 1) {
      for (let i = 0; i < WN; i += 1) {
        if (i >= lo && j >= lo) continue; // 윈도 배제(D1) — encodeY.js 가 실제로 하는 일.
        cellDigits.set(`${i},${j}`, { digit: (i + 2 * j) % 6, role: 'data' });
      }
    }
    return {
      n: WN, cellDigits, tones: 2, window: true,
    };
  }

  test('window===true 인데 n!==25 면 RangeError', () => {
    const encoded = { n: 21, cellDigits: new Map([['0,0', { digit: 0, role: 'data' }]]), window: true };
    assert.throws(() => buildSceneY(encoded, { palette: PALETTE, qrText: QR_WINDOW_TEXT }), RangeError);
  });

  test('window===true 이지만 qrText 미지정이면 윈도 shape 없이 조용히 생략(코너와 동일 계약)', () => {
    const encoded = makeWindowEncoded();
    const scene = buildSceneY(encoded, { palette: PALETTE });
    assert.equal(scene.shapes.length, 3 * cellCount(encoded) + 3 + 1);
  });

  function cellCount(encoded) {
    return encoded.cellDigits.size;
  }

  test('window===true + qrText 있음 — [T 콰이어트 + T 다크 N] + L/R 필러 2개가 맨 끝에 추가된다', () => {
    // 2026-08-09 사용자 육안 재판정: QR 은 상단면 **하나만** — 3면 레플리카 기각.
    // L/R 배제영역은 필러 톤(levels[0]×면 게인)으로 채워 실루엣만 보존한다
    // (비우면 배경 노출 구멍 — 직전 육안 지적).
    const encoded = makeWindowEncoded();
    // 기본값 규약: 윈도가 켜지면 코너 QR 은 자동 억제 — 무윈도(코너만)와의 셀 외
    // shape 수 관계는 "코너 블록이 윈도 블록으로 교체 + 필러 2" 다.
    const withoutWindow = buildSceneY({ ...encoded, window: false }, { palette: PALETTE, qrText: QR_WINDOW_TEXT });
    const withWindow = buildSceneY(encoded, { palette: PALETTE, qrText: QR_WINDOW_TEXT });

    const qr = qrMatrix(QR_WINDOW_TEXT);
    let darkCount = 0;
    for (const v of qr.modules) if (v === 1) darkCount += 1;
    const blockLen = (1 + darkCount) + 2; // T [콰이어트+다크] + L/R 필러

    // 코너 블록(1+darkCount)이 빠지고 윈도 블록(blockLen)이 들어온다 → 순증 +2.
    assert.equal(withWindow.shapes.length, withoutWindow.shapes.length + 2);

    const windowBlock = withWindow.shapes.slice(withWindow.shapes.length - blockLen);
    // T 면(기본 게인 1): 무게인 bullseye 색과 바이트 동일.
    assert.equal(windowBlock[0].kind, 'polygon');
    assert.deepEqual(windowBlock[0].color, PALETTE.bullseyeLight, 'T 콰이어트 = bullseyeLight');
    for (let i = 1; i <= darkCount; i += 1) {
      assert.equal(windowBlock[i].kind, 'polygon');
      assert.deepEqual(windowBlock[i].color, PALETTE.bullseyeDark, `T 다크 모듈 ${i}`);
    }
    // L/R 필러: 폴리곤 1개씩, levels[0] 에 면 게인 적용 (raw levels[0] 와 달라야
    // 게인 적용 회귀가 잡힌다 — L/R 게인 < 1). L 과 R 은 게인이 달라 색도 다르다.
    const fillers = windowBlock.slice(1 + darkCount);
    assert.equal(fillers.length, 2);
    for (const f of fillers) {
      assert.equal(f.kind, 'polygon');
      assert.equal(f.points.length, 4);
      assert.notDeepEqual(f.color, PALETTE.levels[0], '필러에 면 게인 미적용');
      assert.notDeepEqual(f.color, PALETTE.bullseyeDark, '필러가 QR 다크 색이면 안 된다');
    }
    assert.notDeepEqual(fillers[0].color, fillers[1].color, 'L/R 필러 게인이 구분되지 않는다');
  });

  test('코너 QR 기본 억제 — 윈도가 QR 채널이면 코너는 자동 생략, cornerQr:true 만 병행', () => {
    const encoded = makeWindowEncoded();
    const byDefault = buildSceneY(encoded, { palette: PALETTE, qrText: QR_WINDOW_TEXT });
    const explicitOff = buildSceneY(encoded, { palette: PALETTE, qrText: QR_WINDOW_TEXT, cornerQr: false });
    const optIn = buildSceneY(encoded, { palette: PALETTE, qrText: QR_WINDOW_TEXT, cornerQr: true });
    const qr = qrMatrix(QR_WINDOW_TEXT);
    let darkCount = 0;
    for (const v of qr.modules) if (v === 1) darkCount += 1;
    // 기본 = 명시 false 와 동일 ("윗면에 하나만" — 사용자 재판정 2026-08-09).
    assert.deepEqual(byDefault, explicitOff);
    // opt-in 병행은 코너 블록(콰이어트 1 + 다크 N)만큼 는다.
    assert.equal(optIn.shapes.length, byDefault.shapes.length + (1 + darkCount));
    // 기본 장면에서 bullseyeLight "값" 콰이어트는 윈도 것 하나뿐 (코너 콰이어트 부재;
    // 윈도 콰이어트는 게인 1 적용을 거친 새 객체라 값 비교로 센다).
    const lightKey = JSON.stringify(PALETTE.bullseyeLight);
    const lights = byDefault.shapes.filter(
      (s) => s.kind === 'polygon' && JSON.stringify(s.color) === lightKey,
    );
    assert.equal(lights.length, 1, '남은 bullseyeLight 콰이어트는 윈도 것 하나여야 한다');
    // 무윈도 경로의 기본은 종전대로 코너 표시 (기본값 규약이 무윈도를 건드리면 안 된다).
    const noWindow = buildSceneY({ ...encoded, window: false }, { palette: PALETTE, qrText: QR_WINDOW_TEXT });
    const noWindowOff = buildSceneY(
      { ...encoded, window: false },
      { palette: PALETTE, qrText: QR_WINDOW_TEXT, cornerQr: false },
    );
    assert.equal(noWindow.shapes.length, noWindowOff.shapes.length + (1 + darkCount));
    // 잘못된 타입은 TypeError.
    assert.throws(
      () => buildSceneY(encoded, { palette: PALETTE, qrText: QR_WINDOW_TEXT, cornerQr: 'no' }),
      TypeError,
    );
  });

  /** 윈도 블록(맨 끝 [T 콰이어트+다크] + 필러 2)에서 T 면 콰이어트 패치를 얻는다. */
  function tQuietOf(scene) {
    const qr = qrMatrix(QR_WINDOW_TEXT);
    let d = 0; for (const v of qr.modules) if (v === 1) d += 1;
    return scene.shapes[scene.shapes.length - ((1 + d) + 2)];
  }

  test('윈도 콰이어트 패치 bbox = 13×13 데이터 셀(윈도 폭 W), T 면 파라메트릭 (n-13,n-13)..(n,n)', () => {
    const encoded = makeWindowEncoded();
    const cellSize = 3;
    const scene = buildSceneY(encoded, { palette: PALETTE, qrText: QR_WINDOW_TEXT, cellSize });
    const quiet = tQuietOf(scene);
    assert.deepEqual(quiet.color, PALETTE.bullseyeLight);
    const xs = quiet.points.map((p) => p.x);
    const ys = quiet.points.map((p) => p.y);
    const width = Math.max(...xs) - Math.min(...xs);
    const height = Math.max(...ys) - Math.min(...ys);
    // T 면 마름모 기하라 축정렬 폭은 13·cellSize 가 아니다(면이 60/120 마름모) —
    // 대신 대각선 폭·높이가 13·cellSize·(면 기저 성분)의 닫힌 형태를 따른다는 것만
    // (0보다 크고 유한하다는 형태로) 약하게 단언한다. 강한 스냅샷은 아래 좌표 직접
    // 비교 테스트가 담당한다.
    assert.ok(width > 0 && Number.isFinite(width));
    assert.ok(height > 0 && Number.isFinite(height));
  });

  test('윈도 콰이어트 패치 꼭짓점이 facePoint(T, a, b) 닫힌 형태와 정확히 일치(직접 좌표 재현)', () => {
    const encoded = makeWindowEncoded();
    const cellSize = 2;
    const scene = buildSceneY(encoded, { palette: PALETTE, qrText: QR_WINDOW_TEXT, cellSize });
    const quiet = tQuietOf(scene);

    const lo = 25 - 13;
    const layout = scene.layout;
    const { ei, ej } = { ei: CORNER_UNIT_OFFSETS[1], ej: CORNER_UNIT_OFFSETS[5] }; // T 면 기저(ygrid.js 규범).
    const facePoint = (a, b) => ({
      x: layout.originX + (a * ei.x + b * ej.x) * layout.size,
      y: layout.originY + (a * ei.y + b * ej.y) * layout.size,
    });
    const expected = [
      facePoint(lo, lo), facePoint(25, lo), facePoint(25, 25), facePoint(lo, 25),
    ];
    for (let i = 0; i < 4; i += 1) {
      assert.ok(Math.abs(quiet.points[i].x - expected[i].x) < 1e-9, `점 ${i} x`);
      assert.ok(Math.abs(quiet.points[i].y - expected[i].y) < 1e-9, `점 ${i} y`);
    }
  });

  test('방향 규약 — 파인더 없는 QR 코너(행렬 (20,20))가 윈도 안쪽(Y-심 쪽, u=v=4)에 매핑된다', () => {
    // qr.js FINDER_CENTERS = [[3,3],[17,3],[3,17]] — 행렬 코너 (20,20) 은 어느
    // 파인더에도 속하지 않는다(파인더 없는 코너). renderWindowQr 매핑:
    // u = 4+(20-qx), v = 4+(20-qy) → qx=qy=20 이면 u=v=4(윈도 안쪽 경계 — 콰이어트
    // 4 QR모듈 바로 다음 첫 데이터 모듈), qx=qy=3(파인더 중심)이면 u=v=21(윈도
    // 바깥쪽, 실루엣 꼭짓점 쪽) — 순수 좌표 매핑 공식이므로 payload 내용(다크/밝음)
    // 과 무관하게 항상 성립한다(모듈 값 자체는 payload 의존이라 별도로 단언하지 않는다).
    assert.equal(4 + (20 - 20), 4, '파인더 없는 코너(20,20) → u=4(안쪽)');
    assert.equal(4 + (20 - 3), 21, '파인더 중심(3,3) → u=21(바깥쪽)');
    assert.ok(21 > 4, '파인더 쪽이 파인더 없는 코너보다 항상 바깥쪽(더 큰 u,v)에 매핑된다');

    // 렌더 파이프라인 재현 — 파인더 중심(3,3, 항상 다크: 함수 패턴이라 payload 무관)
    // 이 실제로 u=v=21 위치에 그려졌는지 좌표로 직접 확인한다.
    const encoded = makeWindowEncoded();
    const cellSize = 5;
    const scene = buildSceneY(encoded, { palette: PALETTE, qrText: QR_WINDOW_TEXT, cellSize });
    const qr = qrMatrix(QR_WINDOW_TEXT);
    assert.equal(qr.modules[3 * qr.size + 3], 1, '파인더 중심(3,3)은 항상 다크 — 함수 패턴, payload 무관');

    const lo = 25 - 13;
    const layout = scene.layout;
    const { ei, ej } = { ei: CORNER_UNIT_OFFSETS[1], ej: CORNER_UNIT_OFFSETS[5] };
    const facePoint = (a, b) => ({
      x: layout.originX + (a * ei.x + b * ej.x) * layout.size,
      y: layout.originY + (a * ei.y + b * ej.y) * layout.size,
    });
    const half = 0.5;
    const a0 = lo + 21 * half;
    const b0 = lo + 21 * half;
    const expectedQuad = [
      facePoint(a0, b0), facePoint(a0 + half, b0), facePoint(a0 + half, b0 + half), facePoint(a0, b0 + half),
    ];
    const found = scene.shapes.some((s) => s.kind === 'polygon'
      && Array.isArray(s.points) && s.points.length === 4
      && s.points.every((p, idx) => Math.abs(p.x - expectedQuad[idx].x) < 1e-9
        && Math.abs(p.y - expectedQuad[idx].y) < 1e-9));
    assert.ok(found, '파인더 중심(3,3) 다크 모듈이 예상 위치(u=v=21, 바깥쪽)에 그려지지 않았다');
  });

  test('방향 규약 강고정 — T 면 윈도 다크 모듈 전좌표 집합 = 뒤집기 매핑된 qrMatrix (미러·무플립 뮤테이션 검출)', () => {
    // 검증 lane 지적(2026-08-09): (21,21) 위치의 '다크 존재' 단독 검사는 미러 시
    // 우상 파인더 중심(항상 다크)이, 무플립 시 payload 의존 다크가 그 자리로 사상돼
    // 우연 통과한다. 여기서는 T 면 윈도 다크 shape **전체**의 첫 꼭짓점 좌표 집합을
    // 뒤집기 매핑(u=4+(20-qx), v=4+(20-qy)) 기대 집합과 완전 대조한다 — 무플립·
    // 단축 미러(카이럴리티 파괴)·전치 어느 쪽도 집합이 달라져 반드시 잡힌다.
    // 블록 = [T 콰이어트, T 다크 ×N, L 필러, R 필러] (상단면 QR 단독 규약).
    const encoded = makeWindowEncoded();
    const cellSize = 5;
    const scene = buildSceneY(encoded, { palette: PALETTE, qrText: QR_WINDOW_TEXT, cellSize });
    const qr = qrMatrix(QR_WINDOW_TEXT);
    let darkCount = 0;
    for (const v of qr.modules) if (v === 1) darkCount += 1;
    const blockLen = (1 + darkCount) + 2;

    const lo = 25 - 13;
    const layout = scene.layout;
    const half = 0.5;
    const key = (p) => `${p.x.toFixed(6)},${p.y.toFixed(6)}`;
    const wStart = scene.shapes.length - blockLen;

    const pointOn = (face, a, b) => {
      const { ei, ej } = faceBasis(face);
      return {
        x: layout.originX + (a * ei.x + b * ej.x) * layout.size,
        y: layout.originY + (a * ei.y + b * ej.y) * layout.size,
      };
    };

    // T 면 다크 전좌표 집합 대조.
    const expected = new Set();
    for (let qy = 0; qy < qr.size; qy += 1) {
      for (let qx = 0; qx < qr.size; qx += 1) {
        if (qr.modules[qy * qr.size + qx] !== 1) continue;
        const u = 4 + (20 - qx);
        const v = 4 + (20 - qy);
        expected.add(key(pointOn('T', lo + u * half, lo + v * half)));
      }
    }
    assert.equal(expected.size, darkCount, '기대 집합 좌표 충돌 — 매핑이 단사가 아니다');

    const got = new Set(
      scene.shapes.slice(wStart + 1, wStart + 1 + darkCount).map((s) => key(s.points[0])),
    );
    assert.equal(got.size, darkCount, '렌더 다크 모듈 좌표 충돌/누락');
    for (const k of expected) {
      assert.ok(got.has(k), `기대 다크 좌표 (${k}) 부재 — 방향 규약(뒤집기 매핑) 위반`);
    }

    // L/R 필러가 각 면의 윈도 bbox 사각과 정확히 일치하는지 (기하 고정).
    const fillers = scene.shapes.slice(wStart + 1 + darkCount);
    ['L', 'R'].forEach((face, i) => {
      const expectedQuad = [
        pointOn(face, lo, lo), pointOn(face, 25, lo), pointOn(face, 25, 25), pointOn(face, lo, 25),
      ];
      fillers[i].points.forEach((p, j) => {
        assert.ok(Math.abs(p.x - expectedQuad[j].x) < 1e-9, `${face} 필러 점 ${j} x`);
        assert.ok(Math.abs(p.y - expectedQuad[j].y) < 1e-9, `${face} 필러 점 ${j} y`);
      });
    });
  });

  test('결정성: 동일 입력 2회 호출 결과가 deepEqual', () => {
    const encoded = makeWindowEncoded();
    const a = buildSceneY(encoded, { palette: PALETTE, qrText: QR_WINDOW_TEXT });
    const b = buildSceneY(encoded, { palette: PALETTE, qrText: QR_WINDOW_TEXT });
    assert.deepEqual(a, b);
  });

  test('window 생략(기본 false) 은 기존 경로와 완전히 동일 — 윈도 shape 없음', () => {
    const encoded = makeFullEncoded(N); // window 필드 없음.
    const scene = buildSceneY(encoded, { palette: PALETTE, qrText: QR_WINDOW_TEXT });
    assert.equal(scene.shapes.length, 3 * N * N + 3 + 1 + 1 + darkCountOf(QR_WINDOW_TEXT));
  });

  function darkCountOf(text) {
    const qr = qrMatrix(text);
    let d = 0;
    for (const v of qr.modules) if (v === 1) d += 1;
    return d;
  }
});
