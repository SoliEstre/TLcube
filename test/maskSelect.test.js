/**
 * maskSelect.test.js — 마스크 선택 + 포맷 v2 와이어 계약 (2026-08-16 개정).
 *
 * 고정하는 것:
 *   ① autoplace 포맷 세대 스위치 — 기본 v1(15) 불변, v2(18) 는 명시 옵션.
 *   ② 인코더가 마스크 index 를 데이터·필러·포맷 워드 셋 다에 일관되게 싣는다.
 *   ③ 디코더가 포맷 워드에서 읽은 index 로만 언마스크한다 (index 가 틀리면 실패).
 *   ④ 선택기의 결정성 — 같은 입력 → 같은 index.
 *   ⑤ 채점 자는 로케이터 모듈 import (복제 금지) — 페널티 항이 실제로 반영된다.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  placeReservedCells, FORMAT_BLOCK_LENGTH_V1, FORMAT_BLOCK_LENGTH_V2,
} from '../src/autoplaceY.js';
import {
  cellSurfaceFinal, dataCellsInScanOrderCellSurfaceFinal, fillerCellsCellSurfaceFinal,
  CELL_SURFACE_FINAL_FORMAT_CELLS,
} from '../src/cellSurfaceFinal.js';
import { encodeY } from '../src/encodeY.js';
import { decodeCells } from '../src/decode.js';
import { decodeV2, FORMAT_CELLS_V2, DIGIT_COUNT_V2 } from '../src/formatinfo.js';
import { enumerateFormatProposalsV2 } from '../src/format-proposals.js';
import { MASK_COUNT, maskSub } from '../src/mask.js';
import {
  selectMaskIndexY, scoreMaskCandidate, encodeYWithMaskSelection, MASK_PENALTY_WEIGHTS,
} from '../src/maskSelectY.js';

const INSTANCES = [
  ['v0', 0, 13],
  ['v2r2', 1, 21],
  ['v2r2', 2, 25],
  ['v1r2', 1, 21],
  ['v0x', 1, 21],
];
const TEXT = 'https://tl.estre.so/mask';

function scanDigits(encoded, id, n) {
  const filler = new Set(fillerCellsCellSurfaceFinal(n, id).map((c) => c.i + ',' + c.j));
  const out = [];
  for (const cell of dataCellsInScanOrderCellSurfaceFinal(n, id)) {
    if (filler.has(cell.i + ',' + cell.j)) continue;
    out.push(encoded.cellDigits.get(cell.i + ',' + cell.j).digit);
  }
  return out;
}

describe('autoplace — 포맷 세대 스위치', () => {
  test('기본은 v1(15셀) — 옵션을 안 주면 개정 전과 동일', () => {
    for (const n of [13, 21, 25]) {
      const placed = placeReservedCells(n, []);
      assert.equal(placed.formatCells.length, 3 * FORMAT_BLOCK_LENGTH_V1);
      assert.equal(placed.formatBlockLength, 5);
    }
  });

  test('v2 는 18셀이고 v1 배치를 포함한다 (복제가 늘어날 뿐 옮겨 다니지 않는다)', () => {
    for (const n of [13, 21, 25]) {
      const v1 = placeReservedCells(n, []);
      const v2 = placeReservedCells(n, [], { formatBlockLength: FORMAT_BLOCK_LENGTH_V2 });
      assert.equal(v2.formatCells.length, 3 * FORMAT_BLOCK_LENGTH_V2);
      assert.equal(v2.formatBlockLength, 6);
      // reference 는 포맷보다 먼저 놓이므로 세대와 무관하게 같아야 한다.
      assert.deepEqual(
        v1.referenceCells.map((c) => c.i + ',' + c.j),
        v2.referenceCells.map((c) => c.i + ',' + c.j),
      );
      // 하한 게이트는 그대로 통과 (완화 없음).
      assert.ok(v2.metrics.dRef >= v2.metrics.dRefMin);
      assert.ok(v2.metrics.sFmtMax >= v2.metrics.sFmtMinRequired);
    }
  });

  test('허용 밖 길이는 예외 (조용히 5 로 떨어지지 않는다)', () => {
    assert.throws(() => placeReservedCells(21, [], { formatBlockLength: 4 }), RangeError);
    assert.throws(() => placeReservedCells(21, [], { formatBlockLength: 7 }), RangeError);
  });
});

describe('신세대 셀 표면 — 포맷 v2 회계', () => {
  test('다섯 인스턴스 전부 포맷 18 · reference 12', () => {
    for (const [id, , n] of INSTANCES) {
      const surface = cellSurfaceFinal(n, id);
      assert.equal(surface.formatCells.length, FORMAT_CELLS_V2);
      assert.equal(surface.formatCells.length, CELL_SURFACE_FINAL_FORMAT_CELLS);
      assert.equal(surface.referenceCells.length, 12);
      assert.equal(n * n, surface.locatorCount + 30 + surface.declaredDataCells);
    }
  });

  test('회계 전파 — data 선언값 (포맷 v1 → v2 에서 정확히 −3)', () => {
    const want = {
      'v0@13': 109, 'v2r2@21': 337, 'v2r2@25': 521, 'v1r2@21': 331, 'v0x@21': 346,
    };
    for (const [id, , n] of INSTANCES) {
      assert.equal(cellSurfaceFinal(n, id).declaredDataCells, want[id + '@' + n]);
    }
  });
});

describe('인코더 — 마스크 index 배선', () => {
  test('포맷 워드 18 digit 이 3복제 동일이고 index 를 담는다', () => {
    for (const [id, version, n] of INSTANCES) {
      for (let maskIndex = 0; maskIndex < MASK_COUNT; maskIndex += 1) {
        const encoded = encodeY(TEXT, {
          cellSurfaceLayout: id, version, tones: 2, eccLevel: 'M', maskIndex,
        });
        assert.equal(encoded.maskIndex, maskIndex);
        assert.equal(encoded.formatWireVersion, 2);
        assert.equal(encoded.formatDigits.length, FORMAT_CELLS_V2);
        const reads = [0, 1, 2].map((r) =>
          encoded.formatDigits.slice(r * DIGIT_COUNT_V2, (r + 1) * DIGIT_COUNT_V2));
        assert.deepEqual(reads[0], reads[1]);
        assert.deepEqual(reads[1], reads[2]);
        const info = decodeV2(reads);
        assert.equal(info.ok, true, `${id}@${n} mask ${maskIndex}`);
        assert.equal(info.maskIndex, maskIndex);
        assert.equal(info.version, encoded.formatIndex);
        // proposal 열거도 같은 답을 낸다 (디코더 앞단 경로).
        const enumerated = enumerateFormatProposalsV2(reads, {
          validVersionIndices: [encoded.formatIndex],
        });
        const okOnes = enumerated.proposals.filter((p) => p.crcOk);
        assert.ok(okOnes.length >= 1);
        assert.equal(okOnes[0].maskIndex, maskIndex);
      }
    }
  });

  test('데이터·필러 셀이 그 index 의 마스크로 실려 있다', () => {
    const [id, version, n] = ['v1r2', 1, 21];
    for (let maskIndex = 0; maskIndex < MASK_COUNT; maskIndex += 1) {
      const encoded = encodeY(TEXT, {
        cellSurfaceLayout: id, version, tones: 2, eccLevel: 'M', maskIndex,
      });
      // 필러는 프리마스크 0 이므로 언마스크하면 정확히 0 이어야 한다.
      for (const cell of fillerCellsCellSurfaceFinal(n, id)) {
        const entry = encoded.cellDigits.get(cell.i + ',' + cell.j);
        assert.equal(entry.role, 'filler');
        assert.equal(maskSub(entry.digit, cell.i, cell.j, maskIndex), 0);
      }
    }
  });

  test('index 범위 밖은 인코더가 거부', () => {
    assert.throws(() => encodeY(TEXT, {
      cellSurfaceLayout: 'v1r2', version: 1, tones: 2, eccLevel: 'M', maskIndex: MASK_COUNT,
    }), RangeError);
    assert.throws(() => encodeY(TEXT, {
      cellSurfaceLayout: 'v1r2', version: 1, tones: 2, eccLevel: 'M', maskIndex: -1,
    }), RangeError);
  });
});

describe('선택기 기본 OFF — 생성기·API 기본은 마스크 0 고정 (운영자 결정 B)', () => {
  // ── 왜 OFF 인가 (2026-08-16 r2, 실측 근거) ────────────────────────────────
  // §5.3 클러스터 도메인 페널티는 **왜곡 강건성의 대리가 아니다**. n=21 두 레이아웃
  // × 6 페이로드 × 3 마스크 = 12 프레임에서 «두 왜곡(S-커브 0.6 · 감마 0.7) 모두 통과»
  // 를 세면 오라클 10/12 · 고정 mask0 8/12 · **페널티 선택 6/12** 로, 선택기가 고정보다
  // **나쁘다**(순 −2). 마스크 축의 지렛대 자체는 크지만(오라클 10 vs 고정 8) 고르는 자가
  // 틀렸다. 그래서 와이어(포맷 v2 2bit)는 그대로 두고 — index 0 을 기록한다 —
  // **선택 동작만 끈다**. 페널티 선택기는 `maskSelectY.js` 의 옵트인 API 로만 돈다.
  //
  // 이 블록이 지키는 것: 기본값이 조용히 «켜짐» 으로 돌아가지 않는 것.

  test('encodeY 는 maskIndex 를 생략하면 0 을 쓴다 (개정 전과 같은 마스크 필드)', () => {
    for (const [id, version, n] of INSTANCES) {
      const bare = encodeY(TEXT, {
        cellSurfaceLayout: id, version, tones: 2, eccLevel: 'M',
      });
      const explicit = encodeY(TEXT, {
        cellSurfaceLayout: id, version, tones: 2, eccLevel: 'M', maskIndex: 0,
      });
      assert.equal(bare.maskIndex, 0, id + '@' + n + ' 기본 maskIndex');
      // 셀 digit 이 «명시 0» 과 바이트 동일해야 한다 — 기본값이 실제로 0 이라는 뜻.
      assert.deepEqual(
        [...bare.cellDigits.entries()].map(([k, v]) => k + ':' + v.digit),
        [...explicit.cellDigits.entries()].map(([k, v]) => k + ':' + v.digit),
        id + '@' + n + ' 기본 = 명시 0',
      );
      // 와이어는 유지된다 — 포맷 v2 6번째 digit 에 index 0 이 실린다.
      assert.equal(bare.formatWireVersion, 2);
      const reads = [0, 1, 2].map((r) =>
        bare.formatDigits.slice(r * DIGIT_COUNT_V2, (r + 1) * DIGIT_COUNT_V2));
      assert.equal(decodeV2(reads).maskIndex, 0, id + '@' + n + ' 와이어 index');
    }
  });

  test('선택기는 옵트인이다 — encodeY 자체는 maskSelectY 를 부르지 않는다', async () => {
    // encodeY.js 소스에 선택기 의존이 **없어야** 한다. 있으면 인코더가 렌더러·디코더를
    // 끌고 들어가 생성기 번들이 스캐너급으로 부푼다(§4.1 모듈 분리 이유).
    const { readFile } = await import('node:fs/promises');
    const source = await readFile(new URL('../src/encodeY.js', import.meta.url), 'utf8');
    assert.equal(/maskSelectY|selectMaskIndexY/.test(source), false,
      'encodeY 가 선택기를 import 한다 — 기본 OFF 계약 위반');
  });

  test('생성기 번들에 선택기가 없다 (배포 표면 결정 — 통합자 몫)', async () => {
    const { readFile } = await import('node:fs/promises');
    for (const bundle of ['../dist/trilume.html', '../sites/_shared/gen-finder.html']) {
      const html = await readFile(new URL(bundle, import.meta.url), 'utf8');
      assert.equal(html.includes('maskSelectY'), false, bundle + ' 에 선택기가 들어갔다');
      assert.equal(html.includes('encodeYWithMaskSelection'), false, bundle);
    }
  });

  test('옵트인 API 를 쓰면 그때만 index 가 0 이 아닐 수 있다', () => {
    const selected = encodeYWithMaskSelection(TEXT, {
      cellSurfaceLayout: 'v2r2', version: 1, tones: 2, eccLevel: 'M',
    });
    assert.ok(selected.maskSelection, '옵트인 경로에는 선택 진단이 붙는다');
    assert.equal(typeof selected.maskIndex, 'number');
    assert.ok(selected.maskIndex >= 0 && selected.maskIndex < MASK_COUNT);
    // 그 결과는 반드시 «그 index 로 인코딩한 것» 과 같다 (선택은 배선일 뿐).
    const direct = encodeY(TEXT, {
      cellSurfaceLayout: 'v2r2', version: 1, tones: 2, eccLevel: 'M',
      maskIndex: selected.maskIndex,
    });
    assert.deepEqual(
      [...selected.cellDigits.entries()].map(([k, v]) => k + ':' + v.digit),
      [...direct.cellDigits.entries()].map(([k, v]) => k + ':' + v.digit),
    );
  });
});

describe('디코더 — index 로만 언마스크한다', () => {
  test('전 조합 왕복 (레이아웃 5 × 톤 2 × 마스크 3)', () => {
    for (const [id, version, n] of INSTANCES) {
      for (const tones of [2, 3]) {
        for (let maskIndex = 0; maskIndex < MASK_COUNT; maskIndex += 1) {
          const encoded = encodeY(TEXT, {
            cellSurfaceLayout: id, version, tones, eccLevel: 'M', maskIndex,
          });
          const decoded = decodeCells(scanDigits(encoded, id, n), {
            type: 'Y',
            cellSurface: true,
            cellSurfaceLayout: id,
            n,
            tones,
            formatIndex: encoded.formatIndex,
            eccLevel: 'M',
            maskIndex,
          });
          assert.equal(decoded.ok, true,
            `${id}@${n} tones=${tones} mask=${maskIndex}: ${decoded.reason || ''}`);
          assert.equal(decoded.text, TEXT);
        }
      }
    }
  });

  test('틀린 index 로 읽으면 실패한다 (마스크가 실제로 데이터를 바꾼다)', () => {
    const [id, version, n] = ['v2r2', 1, 21];
    for (let maskIndex = 0; maskIndex < MASK_COUNT; maskIndex += 1) {
      const encoded = encodeY(TEXT, {
        cellSurfaceLayout: id, version, tones: 2, eccLevel: 'M', maskIndex,
      });
      const digits = scanDigits(encoded, id, n);
      for (let wrong = 0; wrong < MASK_COUNT; wrong += 1) {
        if (wrong === maskIndex) continue;
        const decoded = decodeCells(digits, {
          type: 'Y',
          cellSurface: true,
          cellSurfaceLayout: id,
          n,
          tones: 2,
          formatIndex: encoded.formatIndex,
          eccLevel: 'M',
          maskIndex: wrong,
        });
        assert.equal(decoded.ok && decoded.text === TEXT, false,
          `mask ${maskIndex} 를 ${wrong} 로 읽었는데 성공했다`);
      }
    }
  });

  test('포맷 v1 경로에 maskIndex 를 주면 조용히 무시하지 않고 거부', () => {
    const encoded = encodeY(TEXT, { version: 1, tones: 2, eccLevel: 'M' });
    const decoded = decodeCells(new Array(encoded.dataDigits.length).fill(0), {
      type: 'Y', version: 1, n: encoded.n, tones: 2, eccLevel: 'M', maskIndex: 1,
    });
    assert.equal(decoded.ok, false);
    assert.equal(decoded.reason.startsWith('format'), true, decoded.reason);
  });
});

describe('선택기 — 결정성과 계약', () => {
  test('같은 입력 → 같은 index · 같은 점수 (두 번 호출)', () => {
    const options = { cellSurfaceLayout: 'v2r2', version: 1, tones: 2, eccLevel: 'M' };
    const first = selectMaskIndexY(TEXT, options);
    const second = selectMaskIndexY(TEXT, options);
    assert.equal(first.maskIndex, second.maskIndex);
    assert.deepEqual(
      first.scores.map((s) => [s.maskIndex, s.penalty, s.trueClusters, s.mimicClusters]),
      second.scores.map((s) => [s.maskIndex, s.penalty, s.trueClusters, s.mimicClusters]),
    );
    assert.ok(first.maskIndex >= 0 && first.maskIndex < MASK_COUNT);
  });

  test('선택 결과가 실제로 그 index 로 인코딩된다', () => {
    const options = { cellSurfaceLayout: 'v0', version: 0, tones: 2, eccLevel: 'M' };
    const encoded = encodeYWithMaskSelection(TEXT, options);
    assert.equal(encoded.maskIndex, encoded.maskSelection.maskIndex);
    const reads = [0, 1, 2].map((r) =>
      encoded.formatDigits.slice(r * DIGIT_COUNT_V2, (r + 1) * DIGIT_COUNT_V2));
    assert.equal(decodeV2(reads).maskIndex, encoded.maskIndex);
  });

  test('페널티 항이 실제로 채점에 들어간다 (W_true 를 키우면 진짜 클러스터가 이긴다)', () => {
    const encoded = encodeY(TEXT, {
      cellSurfaceLayout: 'v2r2', version: 1, tones: 2, eccLevel: 'M', maskIndex: 0,
    });
    const base = scoreMaskCandidate(encoded);
    const heavier = scoreMaskCandidate(encoded, {
      weights: { ...MASK_PENALTY_WEIGHTS, true: MASK_PENALTY_WEIGHTS.true + 1 },
    });
    assert.ok(base.trueClusters > 0, '진짜 클러스터가 0 이면 자가 고장난 것');
    assert.equal(
      Number((base.penalty - heavier.penalty).toFixed(6)),
      Number(base.trueClusters.toFixed(6)),
    );
    // 거리 분류 합계가 전체와 맞는다.
    assert.equal(base.trueCores + base.nearCores + base.deepCores, base.cores);
    assert.equal(base.trueClusters + base.mimicClusters, base.clusters);
  });

  test('최종 라인업이 아닌 레이아웃에는 선택기를 못 쓴다', () => {
    assert.throws(
      () => selectMaskIndexY(TEXT, { cellSurfaceLayout: 'v1r2d', tones: 2, eccLevel: 'M' }),
      RangeError,
    );
  });
});
