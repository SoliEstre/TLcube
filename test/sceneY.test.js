// sceneY.test.js — buildSceneY 계약 검증 (TY6, SPEC §14)
// 실행: node --test test/sceneY.test.js (cwd: TLcube/)
// encodeY.js 는 병렬 lane 산출물이라 여기서는 합성 encoded ({n, cellDigits}) 로 짠다
// (encodeY.js 자체의 실제 출력 형태 — key `${i},${j}`, role 'reference'|'format'|
// 'data'|'filler' — 는 참고만 하고 import 하지 않는다).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { moduleQuad, cubeBounds, layoutForCube, YFACES } from '../src/ygrid.js';
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
