/**
 * format-legacy-fallback.test.js — **레거시 판독 공존** 계약 (2026-08-16 통합자 결정 A).
 *
 * 문제: 포맷 v2 는 포맷 셀을 15 → 18 로 늘리므로 예약 셀이 3개 늘고 **데이터 좌표까지**
 * 달라진다. 세대 비트는 와이어에 없고 레이아웃이 세대를 정하는 구조라, 아무 대책이
 * 없으면 개정 전에 발행된 v0 · v0x · v1r2 · v2r2 프레임은 신 디코더에서 **영구히**
 * 안 읽힌다 (적대 검증 F3 — 「완전한 단절」).
 *
 * 대책: CS 레이아웃 디코더가 **v2(18셀) 우선 → 포맷 CRC 후보 전멸 시 v1(15셀) 폴백**.
 * 두 좌표 집합은 `autoplaceY.placeReservedCells` 의 세대 파라미터로 계산한다 —
 * 손 좌표표를 새로 만들지 않는다(c0e7321 계약 유지).
 *
 * 이 파일이 고정하는 것:
 *   ① 레거시 세대 유도가 **개정 전 트리와 같은 좌표·회계**를 낸다 (§3.1 v1 표 · 회계표).
 *   ② 레거시 프레임이 신 디코더에서 **종단 복호**된다 (5 인스턴스 × 4 페이로드).
 *   ③ v2 프레임은 폴백에 가로채이지 않는다 — v2 우선이 먼저 성공한다.
 *   ④ **오독 0** — 세대 교차 판독은 CRC 를 통과하지 못한다 (양방향 스윕).
 *   ⑤ 3복제 합의 구조는 그대로다 — 폴백도 같은 `enumerateFormatProposals` 를 쓴다.
 *   ⑥ v1 워드에는 마스크 필드가 없으므로 폴백 경로의 maskIndex 는 **0 고정**이다.
 *
 * 레거시 프레임은 `test/harness/legacy-format-v1-frame.mjs` 가 만든다 — 그 합성기는
 * 개정 전 트리의 `encodeY` 와 586 프레임에서 바이트 동일함을 확인했다(파일 헤더 참조).
 * 생성 경로(`encodeY`)에는 레거시 스위치를 **두지 않았다** — 구세대는 읽기만 한다.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL_SURFACE_FINAL_FORMAT_WIRE,
  CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY,
  CELL_SURFACE_FINAL_FORMAT_WIRES,
  capacityForCellSurfaceFinal,
  cellSurfaceFinal,
  dataCellsInScanOrderCellSurfaceFinal,
  formatCellsCellSurfaceFinal,
} from '../src/cellSurfaceFinal.js';
import { encodeY } from '../src/encodeY.js';
import { decodeCells } from '../src/decode.js';
import { enumerateFormatProposals, enumerateFormatProposalsV2 } from '../src/format-proposals.js';
import { encodeLegacyFormatV1 } from './harness/legacy-format-v1-frame.mjs';

const INSTANCES = [
  ['v0', 0, 13],
  ['v2r2', 1, 21],
  ['v2r2', 2, 25],
  ['v1r2', 1, 21],
  ['v0x', 1, 21],
];
const LEVELS = ['L', 'M', 'H'];
/** 신세대 셀 표면이 쓰는 formatIndex 쌍 — 2톤 1 · 3톤 3. 폴백의 버전 필터가 이것이다. */
const VALID_PAIR = Object.freeze([1, 3]);
/** 최악 가정 — 버전 필터를 아예 안 건 판독기. 오독 상한을 재는 자다. */
const VALID_ALL = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

const key = (cell) => cell.i + ',' + cell.j;

/** RNG 없는 결정적 코퍼스 — URL 계열 / 고엔트로피 / 저엔트로피 반복. */
function corpus(count) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const out = [];
  for (let k = 0; k < count; k += 1) {
    if (k % 3 === 0) out.push('https://tl.estre.so/' + k.toString(36));
    else if (k % 3 === 1) {
      let s = '';
      for (let i = 0; i < 13; i += 1) s += alphabet[(k * 7 + i * 11) % alphabet.length];
      out.push(s);
    } else out.push('TL' + (k % 9) + String((k % 5) + 1).repeat(5));
  }
  return out;
}

function digitsAt(cellDigits, cells) {
  return cells.map((cell) => cellDigits.get(key(cell)).digit);
}

function replicas(digits, per) {
  return [0, 1, 2].map((r) => digits.slice(r * per, r * per + per));
}

function bodyDigits(encoded, id, n, wire) {
  const scan = dataCellsInScanOrderCellSurfaceFinal(n, id, wire);
  return scan.map((cell) => encoded.cellDigits.get(key(cell)).digit);
}

// ─────────────────────────────────────────────────────────────────────────
// ① 레거시 세대 유도 = 개정 전 좌표·회계
// ─────────────────────────────────────────────────────────────────────────

describe('레거시 세대 유도 — 개정 전 좌표·회계와 같다', () => {
  // §3.1 표의 **v1 열** 그대로. 개정 전 트리(04fdff4)에서 그대로 뜬 값이며,
  // 이 단언이 「폴백이 다른 자리를 읽는다」를 막는 1차 방벽이다.
  const V1_FORMAT_CELLS = {
    'v0@13': '3,1 4,1 5,1 6,1 7,1 1,3 1,4 1,5 1,6 1,7 5,11 6,11 7,11 8,11 9,11',
    'v2r2@21': '5,1 6,1 7,1 8,1 9,1 1,5 1,6 1,7 1,8 1,9 9,19 10,19 11,19 12,19 13,19',
    'v2r2@25': '5,1 6,1 7,1 8,1 9,1 1,5 1,6 1,7 1,8 1,9 13,23 14,23 15,23 16,23 17,23',
    'v1r2@21': '5,1 6,1 7,1 8,1 9,1 1,5 1,6 1,7 1,8 1,9 11,19 12,19 13,19 14,19 15,19',
    'v0x@21': '4,1 5,1 6,1 7,1 8,1 1,4 1,5 1,6 1,7 1,8 10,19 11,19 12,19 13,19 14,19',
  };
  // 개정 전 회계 (data · S · 잔여) — 포맷 v2 는 각각 −3 · −1 · 동일이다.
  const V1_ACCOUNTING = {
    'v0@13': { data: 112, symbols: 37, residual: 1 },
    'v2r2@21': { data: 340, symbols: 113, residual: 1 },
    'v2r2@25': { data: 524, symbols: 174, residual: 2 },
    'v1r2@21': { data: 334, symbols: 111, residual: 1 },
    'v0x@21': { data: 349, symbols: 116, residual: 1 },
  };

  test('포맷 셀 좌표가 §3.1 v1 열과 일치한다', () => {
    for (const [id, , n] of INSTANCES) {
      const cells = formatCellsCellSurfaceFinal(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY);
      assert.equal(cells.length, 15, id + '@' + n);
      assert.equal(cells.map(key).join(' '), V1_FORMAT_CELLS[id + '@' + n], id + '@' + n);
    }
  });

  test('회계(data · S · 잔여)가 개정 전 값과 같다', () => {
    for (const [id, , n] of INSTANCES) {
      const legacy = cellSurfaceFinal(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY);
      const want = V1_ACCOUNTING[id + '@' + n];
      assert.equal(legacy.declaredDataCells, want.data, id + '@' + n + ' data');
      assert.equal(legacy.usedSymbols, want.symbols, id + '@' + n + ' S');
      assert.equal(legacy.residualCells, want.residual, id + '@' + n + ' 잔여');
      assert.equal(legacy.formatWire, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY);
    }
  });

  test('파인더·reference 는 세대 불변 — 달라지면 폴백이 다른 프레임을 읽는다', () => {
    for (const [id, , n] of INSTANCES) {
      const now = cellSurfaceFinal(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE);
      const legacy = cellSurfaceFinal(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY);
      assert.deepEqual(
        legacy.referenceCells.map(key), now.referenceCells.map(key), id + '@' + n,
      );
      assert.equal(legacy.locatorCount, now.locatorCount, id + '@' + n);
      // v1 포맷 셀은 v2 의 **부분집합**이다 (autoplace 가 같은 런을 한 칸 «연장»).
      const v2Keys = new Set(now.formatCells.map(key));
      assert.ok(legacy.formatCells.every((cell) => v2Keys.has(key(cell))),
        id + '@' + n + ': v1 포맷 좌표가 v2 의 부분집합이 아니다');
      assert.equal(now.formatCells.length - legacy.formatCells.length, 3);
    }
  });

  test('생성 기본값은 현행 세대다 — 레거시는 명시해야만 나온다', () => {
    assert.equal(CELL_SURFACE_FINAL_FORMAT_WIRE, 2);
    assert.equal(CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY, 1);
    assert.deepEqual([...CELL_SURFACE_FINAL_FORMAT_WIRES], [2, 1], '디코더 시도 순서');
    for (const [id, , n] of INSTANCES) {
      assert.equal(cellSurfaceFinal(n, id).formatWire, 2);
      assert.equal(formatCellsCellSurfaceFinal(n, id).length, 18);
      assert.equal(encodeY('x', { cellSurfaceLayout: id, n, tones: 2, eccLevel: 'M' })
        .formatWireVersion, 2);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ②③⑥ 세대별 본문 복호 — decodeCells 층 (기하 없이 계약만)
// ─────────────────────────────────────────────────────────────────────────

describe('두 세대 본문 복호 — decodeCells 층', () => {
  test('레거시 프레임이 formatWire:1 로 복호된다 (5 인스턴스 × 3 ECC)', () => {
    let count = 0;
    for (const [id, , n] of INSTANCES) {
      for (const level of LEVELS) {
        const text = 'legacy ' + id + ' ' + level;
        const encoded = encodeLegacyFormatV1(text, {
          cellSurfaceLayout: id, n, tones: 2, eccLevel: level,
        });
        const decoded = decodeCells(
          bodyDigits(encoded, id, n, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY),
          {
            type: 'Y',
            n,
            tones: 2,
            cellSurface: true,
            cellSurfaceLayout: id,
            formatIndex: encoded.formatIndex,
            eccLevel: level,
            formatWire: CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY,
          },
        );
        assert.equal(decoded.ok, true, id + '@' + n + ' ' + level + ': ' + (decoded.reason || ''));
        assert.equal(decoded.text, text);
        count += 1;
      }
    }
    assert.equal(count, 15);
  });

  test('세대를 틀리게 주면 복호가 실패한다 (좌표가 다르다는 대조군)', () => {
    for (const [id, , n] of INSTANCES) {
      const encoded = encodeLegacyFormatV1('generation control', {
        cellSurfaceLayout: id, n, tones: 2, eccLevel: 'M',
      });
      const digits = bodyDigits(encoded, id, n, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY);
      // v1 본문 digit 을 v2 프로필(3셀 짧음)로 읽으면 길이부터 어긋난다.
      const decoded = decodeCells(digits, {
        type: 'Y',
        n,
        tones: 2,
        cellSurface: true,
        cellSurfaceLayout: id,
        formatIndex: encoded.formatIndex,
        eccLevel: 'M',
      });
      assert.equal(decoded.ok, false, id + '@' + n + ' 가 틀린 세대로 읽혔다');
    }
  });

  test('⑥ 레거시 세대에 maskIndex ≠ 0 을 주면 거부한다 (v1 에는 필드가 없다)', () => {
    const decoded = decodeCells([], {
      type: 'Y',
      n: 21,
      tones: 2,
      cellSurface: true,
      cellSurfaceLayout: 'v2r2',
      formatIndex: 1,
      eccLevel: 'M',
      formatWire: CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY,
      maskIndex: 1,
    });
    assert.equal(decoded.ok, false);
    assert.ok(decoded.reason.startsWith('format:'), decoded.reason);
    assert.match(decoded.reason, /마스크 index 필드가 없다/);
  });

  test('세대 값은 2 | 1 뿐이다', () => {
    const decoded = decodeCells([], {
      type: 'Y',
      n: 21,
      tones: 2,
      cellSurface: true,
      cellSurfaceLayout: 'v2r2',
      formatIndex: 1,
      eccLevel: 'M',
      formatWire: 3,
    });
    assert.equal(decoded.ok, false);
    assert.ok(decoded.reason.startsWith('format:'), decoded.reason);
    assert.match(decoded.reason, /포맷 와이어 세대는/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ④⑤ 오독 0 — 세대 교차 판독 스윕
// ─────────────────────────────────────────────────────────────────────────

describe('세대 교차 오독 — 양방향 0 이어야 한다', () => {
  const PAYLOADS = corpus(9);

  test('① v2 프레임을 v1 폴백 판독기가 읽으면 CRC 통과 0', () => {
    let frames = 0;
    let candidateWords = 0;
    let crcChecked = 0;
    let passedPair = 0;
    let passedAll = 0;
    for (const [id, version, n] of INSTANCES) {
      const v1Cells = formatCellsCellSurfaceFinal(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY);
      for (const level of LEVELS) {
        for (const text of PAYLOADS) {
          for (const maskIndex of [0, 1, 2]) {
            let encoded;
            try {
              encoded = encodeY(text, {
                cellSurfaceLayout: id, version, tones: 2, eccLevel: level, maskIndex,
              });
            } catch {
              continue; // 용량 초과 조합은 코퍼스에서 자연히 빠진다.
            }
            frames += 1;
            const reads = replicas(digitsAt(encoded.cellDigits, v1Cells), 5);
            const pair = enumerateFormatProposals(reads, { validVersionIndices: VALID_PAIR });
            const all = enumerateFormatProposals(reads, { validVersionIndices: VALID_ALL });
            candidateWords += all.diagnostics.generated.unique;
            crcChecked += all.diagnostics.crcChecked;
            passedPair += pair.proposals.filter((p) => p.crcOk).length;
            passedAll += all.proposals.filter((p) => p.crcOk).length;
          }
        }
      }
    }
    assert.ok(frames >= 300, '스윕 규모가 줄었다: ' + frames);
    assert.ok(candidateWords >= 600, '검사 워드가 줄었다: ' + candidateWords);
    assert.equal(passedPair, 0, 'v2 프레임이 v1 폴백에서 CRC 를 통과했다 (오독)');
    assert.equal(passedAll, 0, '버전 필터 없이도 0 이어야 한다 (오독 상한)');
    assert.ok(crcChecked > 0, 'CRC 검사에 도달한 워드가 하나도 없다 — 스윕이 헛돌았다');
  });

  test('② v1 프레임을 v2 우선 판독기가 읽으면 CRC 통과 0', () => {
    let frames = 0;
    let candidateWords = 0;
    let passedPair = 0;
    let passedAll = 0;
    for (const [id, , n] of INSTANCES) {
      const v2Cells = formatCellsCellSurfaceFinal(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE);
      for (const level of LEVELS) {
        for (const text of PAYLOADS) {
          let encoded;
          try {
            encoded = encodeLegacyFormatV1(text, {
              cellSurfaceLayout: id, n, tones: 2, eccLevel: level,
            });
          } catch {
            continue;
          }
          frames += 1;
          const reads = replicas(digitsAt(encoded.cellDigits, v2Cells), 6);
          const pair = enumerateFormatProposalsV2(reads, { validVersionIndices: VALID_PAIR });
          const all = enumerateFormatProposalsV2(reads, { validVersionIndices: VALID_ALL });
          candidateWords += all.diagnostics.generated.unique;
          passedPair += pair.proposals.filter((p) => p.crcOk).length;
          passedAll += all.proposals.filter((p) => p.crcOk).length;
        }
      }
    }
    assert.ok(frames >= 100, '스윕 규모가 줄었다: ' + frames);
    assert.ok(candidateWords >= 200, '검사 워드가 줄었다: ' + candidateWords);
    assert.equal(passedPair, 0, 'v1 프레임이 v2 우선 경로에서 CRC 를 통과했다 (오독)');
    assert.equal(passedAll, 0, '버전 필터 없이도 0 이어야 한다 (오독 상한)');
  });

  test('⑤ 3복제 합의 요구가 그대로다 — 폴백도 같은 열거기를 쓴다', () => {
    // 복제 3개가 서로 다르면 다수결 proposal 은 안 만들어지고 복제별 후보만 남는다.
    const encoded = encodeLegacyFormatV1('replica consensus', {
      cellSurfaceLayout: 'v2r2', n: 21, tones: 2, eccLevel: 'M',
    });
    const cells = formatCellsCellSurfaceFinal(21, 'v2r2', CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY);
    const clean = replicas(digitsAt(encoded.cellDigits, cells), 5);
    const cleanEnum = enumerateFormatProposals(clean, { validVersionIndices: VALID_PAIR });
    assert.equal(cleanEnum.diagnostics.generated.majority, 1, '무손상 판독은 다수결 proposal 을 만든다');
    assert.ok(cleanEnum.proposals.some((p) => p.crcOk));

    // 한 복제만 1-digit 오염 → 다수결이 그 복제를 덮어 복구한다 (합의가 값을 한다).
    const oneBad = clean.map((r) => r.slice());
    oneBad[2][0] = (oneBad[2][0] + 1) % 6;
    const recovered = enumerateFormatProposals(oneBad, { validVersionIndices: VALID_PAIR });
    const majority = recovered.proposals.find((p) => p.sources.includes('majority'));
    assert.ok(majority && majority.crcOk, '3중 다수결이 1-digit 오염을 복구하지 못했다');

    // 세 복제가 전부 다르면 위치별 합의가 깨져 다수결 proposal 자체가 없다.
    const noConsensus = clean.map((r, index) => r.map((d) => (d + index) % 6));
    const broken = enumerateFormatProposals(noConsensus, { validVersionIndices: VALID_PAIR });
    assert.equal(broken.diagnostics.generated.majority, 0, '합의 없이 다수결 proposal 이 생겼다');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ② 종단 — 프론트엔드 왕복 (렌더 → 디코드)
// ─────────────────────────────────────────────────────────────────────────

describe('종단 — 레거시 프레임이 실제로 읽힌다', async () => {
  const { buildSceneY, DEFAULT_FACE_GAINS } = await import('../src/sceneY.js');
  const { rasterize } = await import('../src/raster.js');
  const { decodeFrontend } = await import('../src/decoder/frontend.js');
  const {
    BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
  } = await import('../src/luminance.js');

  const PRESET = getPreset(DEFAULT_PRESET);
  const PALETTE = Object.freeze({
    background: PRESET.background,
    levels: PRESET.levels,
    bullseyeDark: BULLSEYE_DARK,
    bullseyeLight: BULLSEYE_LIGHT,
    faceGains: DEFAULT_FACE_GAINS,
  });
  const FILL = Object.freeze({ ...PRESET.background, a: 255 });

  function embed960(raster) {
    const W = 960;
    const H = 960;
    const out = { width: W, height: H, pixels: new Uint8ClampedArray(W * H * 4) };
    for (let index = 0; index < W * H; index += 1) {
      out.pixels[index * 4] = FILL.r;
      out.pixels[index * 4 + 1] = FILL.g;
      out.pixels[index * 4 + 2] = FILL.b;
      out.pixels[index * 4 + 3] = 255;
    }
    const ox = Math.floor((W - raster.width) / 2);
    const oy = Math.floor((H - raster.height) / 2);
    for (let y = 0; y < raster.height; y += 1) {
      for (let x = 0; x < raster.width; x += 1) {
        const s = (y * raster.width + x) * 4;
        const d = ((y + oy) * W + (x + ox)) * 4;
        out.pixels[d] = raster.pixels[s];
        out.pixels[d + 1] = raster.pixels[s + 1];
        out.pixels[d + 2] = raster.pixels[s + 2];
        out.pixels[d + 3] = raster.pixels[s + 3];
      }
    }
    return out;
  }

  function decodeLab(frame) {
    return decodeFrontend(
      { width: frame.width, height: frame.height, pixels: frame.pixels },
      { bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } } },
    );
  }

  test('레거시(포맷 v1) 프레임 5 인스턴스 × 2 페이로드 = 10/10 복호', { timeout: 600_000 }, () => {
    let ok = 0;
    for (const [id, , n] of INSTANCES) {
      for (const text of ['https://tl.estre.so', 'legacy-frame-' + id]) {
        const encoded = encodeLegacyFormatV1(text, {
          cellSurfaceLayout: id, n, tones: 2, eccLevel: 'M',
        });
        const frame = embed960(rasterize(
          buildSceneY(encoded, { palette: PALETTE, margin: 4 }),
          { pixelsPerUnit: 15, supersample: 2 },
        ));
        const result = decodeLab(frame);
        assert.equal(result.ok, true, id + '@' + n + ' 레거시 복호: ' + (result.reason || ''));
        assert.equal(result.text, text, id + '@' + n);
        assert.equal(result.hypothesis.cellSurfaceLayout, id, id + '@' + n + ' 교차 오수용');
        ok += 1;
      }
    }
    assert.equal(ok, 10);
  });

  test('현행(포맷 v2) 프레임은 폴백에 가로채이지 않는다 — 마스크 3종 전부', {
    timeout: 600_000,
  }, () => {
    let ok = 0;
    for (const [id, version, n] of INSTANCES) {
      for (const maskIndex of [0, 1, 2]) {
        const text = 'v2-priority-' + id + '-' + maskIndex;
        const encoded = encodeY(text, {
          cellSurfaceLayout: id, version, tones: 2, eccLevel: 'M', maskIndex,
        });
        const frame = embed960(rasterize(
          buildSceneY(encoded, { palette: PALETTE, margin: 4 }),
          { pixelsPerUnit: 15, supersample: 2 },
        ));
        const result = decodeLab(frame);
        assert.equal(result.ok, true, id + '@' + n + ' m' + maskIndex + ': ' + (result.reason || ''));
        assert.equal(result.text, text);
        assert.equal(result.hypothesis.cellSurfaceLayout, id);
        ok += 1;
      }
    }
    assert.equal(ok, 15);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// 용량표 — 두 세대의 payload 는 실측값이어야 한다
// ─────────────────────────────────────────────────────────────────────────

test('capacityForCellSurfaceFinal 이 세대를 반영한다 (v2r2@25-M 은 124 B)', () => {
  // 적대 검증 F1: 「−1심볼 → −1 B」 손산술이 틀렸다. nsym 은 **비율 기반**이라
  // S 가 174→173 이 되며 반올림 문턱을 넘어 nsym 45→43, 데이터 심볼이 오히려 늘었다.
  const legacy = capacityForCellSurfaceFinal(25, 'M', 2, 'v2r2', CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY);
  const now = capacityForCellSurfaceFinal(25, 'M', 2, 'v2r2');
  assert.equal(legacy.maxPayloadBytes, 123);
  assert.equal(now.maxPayloadBytes, 124, '포맷 v2 에서 v2r2@25-M payload 는 늘어난다');
  assert.equal(legacy.formatWire, 1);
  assert.equal(now.formatWire, 2);
});
