/**
 * finder-daehan.test.js — daehan 편입 (2026-08-18).
 *
 * 이 파일이 지키는 명제는 다섯이다.
 *
 *  ① **표가 정본과 같다.** 바깥 repo 의 편집기 export 가 있으면 79셀 좌표와 237면
 *     톤을 **전수** 재유도해 대조한다. 없으면(공개 체크아웃) 그 사실을 밝히고
 *     repo 사본으로 대조하고, 그것도 없으면 자기 일관성만 잰다 — 조용히 skip 하지
 *     않는다. skip 은 «통과» 로 읽히고, 그렇게 거짓 초록이 난다.
 *
 *  ② **기존 회계가 한 값도 안 바뀌었다.** 예약 인자를 안 넘기는 경로 전부.
 *     이게 초록이면 이 편입은 이미 발행된 V1/V2/V3 프레임을 안 건드린 것이다.
 *
 *  ③ **daehan 회계가 확정값과 같다.** 오버헤드 65/89/113 · 심볼 20/42/72 ·
 *     순 페이로드 9칸. 그리고 **nsym 본표가 안 바뀌었다** (V1D 함정).
 *
 *  ④ **왕복이 선다.** encode(daehan) → decodeCells 가 k×ECC 9칸 전부 원문을 돌려준다.
 *
 *  ⑤ **광학 왕복이 선다.** 그린 것을 검출기가 daehan 으로 되찾고 게이트를 통과한다.
 *     표현을 둘로 나눠 놓고 이걸 안 재면 «그린 것과 읽는 것» 이 갈려도 아무도 모른다.
 *
 *  ⑥ **patternId 는 프레임의 k 를 말해 주지 못한다.** 잘림이 포함 사슬이라 그렇다.
 *     이 명제가 배선의 모양을 정했으므로 값으로 잠근다 — 안 잠그면 다음 사람이
 *     «patternId 가 k 니까» 로 되돌린다 (내가 그렇게 짰다가 k=8 부터 죽었다).
 *
 *  ⑦ **배포 기본 라인업은 daehan 을 안 든다.** 옵트인이다. 이게 「실사진 149장
 *     무영향」의 구조적 근거다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DAEHAN_FINDER_CELLS, DAEHAN_CELL_LEVELS, DAEHAN_FINDER_PATTERNS,
  DAEHAN_FINDER_PATTERN_IDS, DAEHAN_LEVEL_FACE_INDEX, DAEHAN_RADII,
  DAEHAN_NAME, TAEGUK_ID, SAGOAE_ID,
  daehanFinderCellsFor, daehanReservedCells, daehanPatternId, daehanKForPatternId,
  getDaehanFinderPattern, isDaehanFinderPatternId,
  taegeukCells, sagoaeCells,
} from '../src/finder-daehan.js';
import { NSYM_TABLE, NSYM_TABLE_DAEHAN } from '../src/rs211.js';
import { VERSIONS_DAEHAN, capacityForDaehan } from '../src/capacityDaehan.js';
import { VERSIONS, capacityFor } from '../src/capacity.js';
import { overheadBreakdown, buildRoleSets, roleOf } from '../src/placement.js';
import { dataCellsInScanOrder, fillerCells, layoutMap } from '../src/layout.js';
import { occupiedCells } from '../src/bullseye.js';
import { hexDistance } from '../src/hexgrid.js';
import { encode } from '../src/encode.js';
import { decodeCells } from '../src/decode.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import {
  containmentPairs, detectCellFinders, UNVERIFIED_CELL_FINDER_CALIBRATION,
} from '../src/decoder/cell-finder-detect.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { rasterize } from '../src/raster.js';
import { buildScene } from '../src/scene.js';
import { FINDER_CELL_MASK_PATTERNS } from '../src/finder-patterns.js';
import { OAK_FINDER_PATTERNS, OAK_RENDER_ONLY_FINDER_PATTERNS } from '../src/finder-oak-patterns.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CANON = ROOT + '../.agent/decoder/data/daehan-k10.json';
const REPO_COPY = ROOT + 'test/output/lanes/daehan-k10.json';
const FACES = ['T', 'L', 'R'];
const key = (c) => c.q + ',' + c.r;

function loadCanonical() {
  if (existsSync(CANON)) return { source: '정본(.agent)', json: JSON.parse(readFileSync(CANON, 'utf8')) };
  if (existsSync(REPO_COPY)) return { source: 'repo 사본(test/output/lanes)', json: JSON.parse(readFileSync(REPO_COPY, 'utf8')) };
  return { source: null, json: null };
}

test('① 표가 정본과 같다 — 좌표 79 · 면 톤 237 전수', () => {
  const { source, json } = loadCanonical();
  if (!json) {
    // skip 하지 않는다. 정본이 없으면 «정본 대조를 못 했다» 를 남기고 자기 일관성만 잰다.
    console.log('  [정본 없음] .agent 도 repo 사본도 없다 — 자기 일관성만 검사한다');
    assert.equal(DAEHAN_FINDER_CELLS.length, 79);
    assert.equal(DAEHAN_CELL_LEVELS.length, 79);
    return;
  }
  console.log('  대조 원본: ' + source);
  assert.equal(json.schema, 'tlcube-cell-editor/v2');
  assert.equal(json.name, 'daehan');
  assert.equal(json.k, 10);

  // 좌표 — 등장 순서까지 그대로여야 한다 (순서가 발자국 벡터의 순서다).
  assert.equal(DAEHAN_FINDER_CELLS.length, json.userNonData.length);
  for (let i = 0; i < json.userNonData.length; i += 1) {
    assert.deepEqual(
      { q: DAEHAN_FINDER_CELLS[i].q, r: DAEHAN_FINDER_CELLS[i].r },
      { q: json.userNonData[i].q, r: json.userNonData[i].r },
      'i=' + i + ' 좌표가 정본과 다르다',
    );
  }

  // 톤 — 정본 규약대로 재유도(override 없는 면은 중간톤 1)해 전수 대조.
  const tone = new Map(json.toneOverrides.map((t) => [t.face + ':' + t.q + ',' + t.r, t.tone]));
  for (let i = 0; i < DAEHAN_FINDER_CELLS.length; i += 1) {
    const cell = DAEHAN_FINDER_CELLS[i];
    for (const face of FACES) {
      const want = tone.has(face + ':' + key(cell)) ? tone.get(face + ':' + key(cell)) : 1;
      assert.equal(
        DAEHAN_CELL_LEVELS[i][DAEHAN_LEVEL_FACE_INDEX[face]], want,
        '셀 ' + key(cell) + ' 면 ' + face + ' 톤이 정본과 다르다',
      );
    }
  }

  // 정본이 스스로 선언한 독립 계수도 같이 잰다.
  assert.equal(json._transcriptionCheck.cells, DAEHAN_FINDER_CELLS.length);
  assert.equal(json._transcriptionCheck.faceObservations, json.toneOverrides.length);
  assert.deepEqual(json.counts, { total: 331, data: 218, detector: 79, fixed: 34 });
});

test('① -b 잘림이 정본 규약대로다 — 절대 좌표 · 반경 밖 잘림 · 포함 사슬', () => {
  const EXPECT = { 6: 39, 8: 59, 10: 79 };
  for (const k of DAEHAN_RADII) {
    const alive = daehanFinderCellsFor(k);
    assert.equal(alive.length, EXPECT[k], 'k=' + k);
    for (const cell of alive) assert.ok(hexDistance(cell.q, cell.r) <= k);
    // 잘림은 **절대 좌표를 그대로 두고 거르기만** 한다 — 좌표를 옮기지 않는다.
    const full = new Set(DAEHAN_FINDER_CELLS.map(key));
    for (const cell of alive) assert.ok(full.has(key(cell)));
  }
  // 불스아이 19셀은 전부 daehan 안에 있고, 예약은 그 밖이다.
  const finderSet = new Set(DAEHAN_FINDER_CELLS.map(key));
  for (const c of occupiedCells()) assert.ok(finderSet.has(key(c)), '불스아이 ' + key(c));
  const RESERVED = { 6: 20, 8: 40, 10: 60 };
  for (const k of DAEHAN_RADII) {
    const reserved = daehanReservedCells(k);
    assert.equal(reserved.length, RESERVED[k], 'k=' + k + ' 예약');
    for (const cell of reserved) assert.ok(hexDistance(cell.q, cell.r) > 2);
  }
});

test('② 기존 회계 무변경 — 예약 인자를 안 넘기는 경로 전부', () => {
  // 이 값들이 바로 «이미 발행된 프레임» 의 회계다. 하나라도 움직이면 편입이 아니라 파괴다.
  assert.equal(overheadBreakdown(6).total, 45);
  assert.equal(overheadBreakdown(8).total, 49);
  assert.equal(overheadBreakdown(10).total, 53);
  assert.equal(dataCellsInScanOrder(6).length, 82);
  assert.equal(dataCellsInScanOrder(8).length, 168);
  assert.equal(dataCellsInScanOrder(10).length, 278);
  assert.equal(fillerCells(6).length, 1);
  assert.equal(fillerCells(8).length, 0);
  assert.equal(fillerCells(10).length, 2);
  for (const spec of VERSIONS) {
    for (const level of ['L', 'M', 'H']) {
      const cap = capacityFor(spec, level);
      assert.equal(cap.usedSymbols, NSYM_TABLE[spec.symbolKey].symbols);
      assert.equal(cap.nsym, NSYM_TABLE[spec.symbolKey][level]);
    }
  }
  // V1/V2/V3 순 페이로드 (M) — 공표된 값.
  assert.deepEqual(VERSIONS.map((s) => capacityFor(s, 'M').maxPayloadBytes), [18, 39, 65]);
  // layoutMap 도 예약을 안 넘기면 'finder' 역할을 절대 안 만든다.
  for (const k of [6, 8, 10]) {
    const roles = new Set(Array.from(layoutMap(k).values()).map((e) => e.role));
    assert.ok(!roles.has('finder'), 'k=' + k + ': 예약 없이 finder 역할이 생겼다');
  }
  // roleOf 도 마찬가지.
  const sets = buildRoleSets(6);
  assert.equal(sets.finder.size, 0);
  assert.equal(roleOf(6, 0, 6, sets), 'anchor');
});

test('③ nsym 본표가 안 바뀌었다 — V1D 함정', () => {
  // V1D 의 nsym 3/7/11 은 V1 과 **문자 그대로 같다**. 「V1 행에서 symbols 만 고치면
  // 되겠네」로 읽히기 쉬운 자리라, 본표가 그대로인지를 값으로 잠근다.
  assert.deepEqual({ ...NSYM_TABLE.V1 }, { symbols: 27, L: 3, M: 7, H: 11 });
  assert.deepEqual({ ...NSYM_TABLE.V2 }, { symbols: 56, L: 7, M: 14, H: 22 });
  assert.deepEqual({ ...NSYM_TABLE.V3 }, { symbols: 92, L: 11, M: 23, H: 37 });
  assert.deepEqual({ ...NSYM_TABLE_DAEHAN.V1D }, { symbols: 20, L: 3, M: 7, H: 11 });
  assert.deepEqual({ ...NSYM_TABLE_DAEHAN.V2D }, { symbols: 42, L: 7, M: 14, H: 22 });
  assert.deepEqual({ ...NSYM_TABLE_DAEHAN.V3D }, { symbols: 72, L: 11, M: 23, H: 37 });
  // 두 표가 **다른 객체**이고 키가 안 겹친다 — 한쪽 수정이 다른 쪽에 새지 않는다.
  for (const k of Object.keys(NSYM_TABLE)) assert.ok(!(k in NSYM_TABLE_DAEHAN));
  for (const k of Object.keys(NSYM_TABLE_DAEHAN)) assert.ok(!(k in NSYM_TABLE));
  // nsym 은 «정정능력 t 를 현행과 동일 유지» 다 — 동명 버전과 값이 같아야 한다.
  for (let i = 0; i < 3; i += 1) {
    const legacy = NSYM_TABLE['V' + (i + 1)];
    const daehan = NSYM_TABLE_DAEHAN['V' + (i + 1) + 'D'];
    for (const level of ['L', 'M', 'H']) assert.equal(daehan[level], legacy[level]);
  }
});

test('③ -b daehan 회계가 확정값과 같다', () => {
  const EXPECT = {
    V1D: { k: 6, overhead: 65, dataCells: 62, symbols: 20, payload: { L: 15, M: 11, H: 7 } },
    V2D: { k: 8, overhead: 89, dataCells: 128, symbols: 42, payload: { L: 32, M: 26, H: 18 } },
    V3D: { k: 10, overhead: 113, dataCells: 218, symbols: 72, payload: { L: 57, M: 46, H: 32 } },
  };
  assert.equal(VERSIONS_DAEHAN.length, 3);
  for (const spec of VERSIONS_DAEHAN) {
    const want = EXPECT[spec.name];
    assert.equal(spec.k, want.k);
    assert.equal(spec.overhead, want.overhead);
    // 오버헤드는 손 상수가 아니라 실계산이어야 한다.
    assert.equal(spec.overhead, overheadBreakdown(spec.k, daehanReservedCells(spec.k).length).total);
    for (const level of ['L', 'M', 'H']) {
      const cap = capacityForDaehan(spec, level);
      assert.equal(cap.dataCells, want.dataCells);
      assert.equal(cap.usedSymbols, want.symbols);
      assert.equal(cap.maxPayloadBytes, want.payload[level]);
      assert.equal(cap.daehanFinder, true);
      assert.equal(cap.residualCells, 2);
    }
    // scan order 길이가 회계와 짝이다.
    assert.equal(dataCellsInScanOrder(spec.k, daehanReservedCells(spec.k)).length, want.dataCells);
    assert.equal(fillerCells(spec.k, daehanReservedCells(spec.k)).length, 2);
  }
  // VERSIONS_DAEHAN 은 VERSIONS 와 **다른 배열**이다 (같은 배열에 넣으면 find 가
  // 조용히 엉뚱한 spec 을 집는다 — capacityDaehan.js 헤더).
  for (const spec of VERSIONS_DAEHAN) assert.ok(!VERSIONS.includes(spec));
});

test('③ -c 예약 셀이 anchor/format/reference 와 안 겹친다', () => {
  for (const k of DAEHAN_RADII) {
    const base = buildRoleSets(k);
    for (const cell of daehanReservedCells(k)) {
      assert.equal(
        roleOf(cell.q, cell.r, k, base), 'data',
        'k=' + k + ' 예약 셀 ' + key(cell) + ' 이 원래 data 가 아니었다 — 회계가 깨진다',
      );
    }
    // 예약을 넘기면 그 셀들이 'finder' 가 되고 data 에서 빠진다.
    const withFinder = buildRoleSets(k, daehanReservedCells(k));
    for (const cell of daehanReservedCells(k)) {
      assert.equal(roleOf(cell.q, cell.r, k, withFinder), 'finder');
    }
    const map = layoutMap(k, daehanReservedCells(k));
    const finderRoles = Array.from(map.values()).filter((e) => e.role === 'finder');
    assert.equal(finderRoles.length, daehanReservedCells(k).length);
  }
});

test('④ 왕복 — encode(daehan) → decodeCells 가 k×ECC 9칸 전부 원문', () => {
  const base = 'daehan roundtrip 0123456789 abcdefghijklmnopqrstuvwxyz';
  for (const spec of VERSIONS_DAEHAN) {
    for (const level of ['L', 'M', 'H']) {
      const cap = capacityForDaehan(spec, level);
      let text = '';
      while (text.length < cap.maxPayloadBytes) text += base;
      text = text.slice(0, cap.maxPayloadBytes);

      const enc = encode(text, { version: spec.version, eccLevel: level, daehanFinder: true });
      assert.equal(enc.daehanFinder, true);
      assert.equal(enc.k, spec.k);
      const scan = dataCellsInScanOrder(spec.k, daehanReservedCells(spec.k));
      const digits = scan.map((c) => enc.cellDigits.get(key(c)).digit);
      const out = decodeCells(digits, {
        type: 'O', daehanFinder: true, k: spec.k, formatIndex: spec.version - 1, eccLevel: level,
      });
      assert.ok(out.ok, 'k=' + spec.k + '/' + level + ': ' + out.reason);
      assert.equal(out.text, text);

      // 예약 셀에는 digit 이 없다 (불스아이와 같은 취급) — 있으면 렌더가 데이터를 덮는다.
      for (const cell of daehanReservedCells(spec.k)) {
        assert.equal(enc.cellDigits.has(key(cell)), false, 'k=' + spec.k + ' ' + key(cell));
      }
    }
  }
});

test('④ -b 레거시 회계로 daehan 을 읽으면 조용히 성공하지 않는다', () => {
  // daehan 이 전용 formatIndex 를 안 만드는 계약의 안전성 근거 — 회계가 다르면
  // 셀 수부터 안 맞아 decodeCells 가 **거절**한다 (조용한 오독이 아니다).
  const enc = encode('daehan wire', { version: 2, eccLevel: 'M', daehanFinder: true });
  const scan = dataCellsInScanOrder(8, daehanReservedCells(8));
  const digits = scan.map((c) => enc.cellDigits.get(key(c)).digit);
  const out = decodeCells(digits, { type: 'O', k: 8, formatIndex: 1, eccLevel: 'M' });
  assert.equal(out.ok, false, '레거시 회계가 daehan digits 를 조용히 받아들였다');
});

test('⑤ 광학 — 그린 것을 검출기가 daehan 으로 되찾고 게이트를 통과한다', () => {
  // 게이트는 한 값도 안 건드린다.
  assert.equal(UNVERIFIED_CELL_FINDER_CALIBRATION.minCorrelation, 0.56);
  assert.equal(UNVERIFIED_CELL_FINDER_CALIBRATION.minContrastRatio, 0.24);
  assert.equal(UNVERIFIED_CELL_FINDER_CALIBRATION.minOrientationMargin, 0.035);

  const preset = getPreset(DEFAULT_PRESET);
  const palette = {
    background: preset.background, levels: preset.levels,
    bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
  };
  const lineup = [...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS, ...DAEHAN_FINDER_PATTERNS];

  // k=6 하나만 잰다. 씨앗 없는 전 척도 스윕 × 발자국 4개는 k=10 프레임에서
  // 분 단위로 든다 (실측 3 k 합계 313 s). 나머지 두 해상도는 아래 ⑦ 이 **원문까지**
  // 확인하므로, 같은 것을 두 번 재느라 스위트를 느리게 만들지 않는다.
  for (const spec of VERSIONS_DAEHAN.filter((v) => v.k === 6)) {
    const enc = encode('optical', { version: spec.version, eccLevel: 'M', daehanFinder: true });
    const scene = buildScene(enc, {
      palette, cellSize: 26, finderPatternId: daehanPatternId(spec.k),
    });
    const raster = rasterize(scene);
    const luma = toRelativeLuminance(raster, {});
    const detected = detectCellFinders(luma, lineup, {
      centerSeeds: [{ x: luma.width / 2, y: luma.height / 2 }],
    });
    assert.ok(detected.ok, 'k=' + spec.k + ' 검출 실패: ' + JSON.stringify(detected.reason));
    const best = detected.candidates[0];
    // **자기 이름이 아니라 «daehan 계열인가»** 를 잰다 — 잘림이 포함 사슬이라
    // k=8/k=10 프레임을 k6 템플릿이 정당하게 맞춘다 (테스트 ⑥ 이 그 사실을 잠근다).
    assert.ok(isDaehanFinderPatternId(best.patternId),
      'k=' + spec.k + ' 오수용: ' + best.patternId);
    assert.equal(best.hardChecks.all, true, 'k=' + spec.k + ' 게이트 탈락');
    // ⚠ 문턱을 0.99 로 두지 **않는다**. 씨앗 없이 도는 이 조건에서 상관은
    //   페이로드에 따라 0.95~1.00 사이를 오간다 (실측: 같은 k=6 프레임이
    //   페이로드에 따라 1.0000 과 0.9559). 그건 이 편입이 만든 성질이 아니라
    //   씨앗·척도 탐색의 기존 성질이고, 여기서 0.99 를 단언하면 **다른 것을 재는
    //   테스트가 초록/빨강을 오간다**. 이 테스트가 지키는 명제는 «게이트를 통과하는
    //   daehan 으로 되찾는가» 이고, «원문까지 돌아오는가» 는 아래 ⑦ 이 잰다.
    assert.ok(best.correlation >= 0.9, 'k=' + spec.k + ' corr ' + best.correlation);
  }
});

test('⑤ -b 패턴 명부 — 이름·발자국·술어', () => {
  assert.deepEqual([...DAEHAN_FINDER_PATTERN_IDS],
    ['oak-daehan-k6', 'oak-daehan-k8', 'oak-daehan-k10']);
  for (const k of DAEHAN_RADII) {
    assert.equal(daehanKForPatternId(daehanPatternId(k)), k);
    assert.equal(getDaehanFinderPattern(daehanPatternId(k)).finderCells.length,
      daehanFinderCellsFor(k).length);
    assert.equal(isDaehanFinderPatternId(daehanPatternId(k)), true);
  }
  // 기존 후보 이름에는 절대 안 걸린다 — 걸리면 레거시 프레임이 daehan 회계로 읽힌다.
  for (const pattern of [...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS]) {
    assert.equal(daehanKForPatternId(pattern.id), undefined, pattern.id);
    assert.equal(isDaehanFinderPatternId(pattern.id), false, pattern.id);
  }
  assert.equal(daehanKForPatternId(undefined), undefined);
  // 발자국이 k 마다 **다르다** — 하나로 합칠 수 없다는 사실을 값으로 잠근다.
  const sizes = DAEHAN_FINDER_PATTERNS.map((p) => p.finderCells.length);
  assert.deepEqual(sizes, [39, 59, 79]);
});

test('⑥ 포함 사슬 — patternId 는 프레임의 k 를 말해 주지 **못한다**', () => {
  // 이 명제가 이 편입의 설계를 정했다. 값으로 잠가 두지 않으면 다음 사람이
  // 「patternId 가 k 니까 거기서 회계를 고르자」로 되돌린다 (내가 그렇게 짰었다).
  const preset = getPreset(DEFAULT_PRESET);
  const palette = {
    background: preset.background, levels: preset.levels,
    bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
  };
  const enc = encode('nest', { version: 2, eccLevel: 'M', daehanFinder: true });
  const scene = buildScene(enc, { palette, finderPatternId: daehanPatternId(8) });
  const luma = toRelativeLuminance(rasterize(scene, { pixelsPerUnit: 24, supersample: 2 }), {});
  const lineup = [...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS, ...DAEHAN_FINDER_PATTERNS];
  const detected = detectCellFinders(luma, lineup, {
    centerSeeds: [{ x: luma.width / 2, y: luma.height / 2 }],
  });
  assert.ok(detected.ok);
  // C2b 2차(finish 전환 가드, 2026-08-24) 전에는 부분집합 해석이 상위집합을
  // 개명·소거해 무노이즈 합성에서도 이름이 k6 «만» 남았다. 가드 후 무노이즈
  // 합성에선 k8 이 1위가 **될 수 있다** — 그래도 patternId 로 k 를 고르는 배선은
  // 여전히 금지다: 실사진에선 바깥 고리가 깨지는 순간 부분집합 이름(k'<k)만
  // 남는 것이 포함 사슬의 귀결이고(finished 단계에 k6 해석이 실재함을 프로브
  // 실측), k 는 RS/CRC 가설 열거가 고른다 (⑦ 이 그 경로를 잠근다).
  assert.ok(isDaehanFinderPatternId(detected.candidates[0].patternId));
  assert.ok(detected.candidates[0].correlation >= 0.99);
  // 사슬은 **아래로만** 이름낸다 — k=8 프레임에서 k10(상위집합 과주장) 이름이
  // 게이트를 통과하면 그건 포함 사슬이 아니라 오수용이다.
  const chainKs = detected.candidates.map((c) => daehanKForPatternId(c.patternId))
    .filter((k) => k !== undefined);
  assert.ok(chainKs.length > 0, 'daehan 해석이 전부 사라졌다');
  assert.ok(chainKs.every((k) => k <= 8),
    '상위집합 과주장 (k>8) 이 게이트를 통과했다: ' + chainKs.join(','));
});

test('⑦ 전 경로 왕복 + 배포 기본 라인업은 daehan 을 **안 든다** (옵트인)', async () => {
  const { decodeFrontend } = await import('../src/decoder/frontend.js');
  const preset = getPreset(DEFAULT_PRESET);
  const palette = {
    background: preset.background, levels: preset.levels,
    bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
  };
  for (const spec of VERSIONS_DAEHAN) {
    const text = 'optin-k' + spec.k;
    const enc = encode(text, { version: spec.version, eccLevel: 'M', daehanFinder: true });
    const scene = buildScene(enc, { palette, finderPatternId: daehanPatternId(spec.k) });
    const raster = rasterize(scene, { pixelsPerUnit: 24, supersample: 2 });

    // 기본 옵션 — daehan 라인업이 없으므로 **거절해야 한다**. 여기가 초록이라는 것이
    // 「실사진 149장이 안 바뀐다」의 구조적 근거다 (라인업이 같으면 결과가 같다).
    const off = decodeFrontend(raster, {});
    assert.equal(off.ok, false,
      'k=' + spec.k + ': 기본 라인업이 daehan 을 읽었다 — 옵트인이 아니게 됐다');

    // 옵트인 — 같은 프레임이 **원문까지** 돌아온다. 이것이 «그린 것과 읽는 것이
    // 같다» 의 최종 증명이고, 파인더 검출 → 회계 선택 → RS/CRC 가 k 를 고르는
    // 경로가 전부 실재한다는 뜻이다.
    const on = decodeFrontend(raster, { bootstrap: { cellFinderDaehan: true } });
    assert.equal(on.ok, true, 'k=' + spec.k + ': ' + JSON.stringify(on.reason));
    assert.equal(on.text, text);
  }
});

test('⑨ 포함쌍 — finish 전환·NMS 이중 면제로 두 해석이 공존한다 (C2b 2차)', () => {
  // (a) 기본 라인업(전부 19셀 발자국)은 포함쌍이 **구조적으로 0** — 진부분집합은
  //     더 작은 발자국을 요구하므로. 이 0 이 「면제·가드가 기본 경로(실사진 코퍼스)에
  //     한 값도 영향 없다」의 근거다. 값으로 잠근다.
  assert.equal(containmentPairs([...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS]).size, 0);
  // (b) taegeuk-solo 를 얹으면 손 목록 없이 값 대조 유도가 포함쌍을 만든다 —
  //     solo ⊂ daehan(전부) + daehan 포함 사슬(k6⊂k8⊂k10).
  const lineup = [
    ...FINDER_CELL_MASK_PATTERNS, ...OAK_FINDER_PATTERNS,
    ...DAEHAN_FINDER_PATTERNS, ...OAK_RENDER_ONLY_FINDER_PATTERNS,
  ];
  const pairs = containmentPairs(lineup);
  assert.ok(pairs.has('oak-taegeuk-solo|oak-daehan-k6'), 'solo ⊂ k6 유도 실패');
  assert.ok(pairs.has('oak-daehan-k6|oak-taegeuk-solo'), '면제는 양방향이어야 한다');
  assert.ok(pairs.has('oak-daehan-k6|oak-daehan-k10'), '포함 사슬(k6⊂k10) 자동 유도 실패');
  // (c) 실효 — ss1 k6 프레임에서 solo 와 daehan 이 **모두** 후보로 남는다.
  //     finish 전환 가드 없인 daehan 정교화 후보가 fit 1.0000 동률에서도 전부
  //     solo 로 개명돼 소멸했다 (2026-08-24 프로브 실측 — NMS 면제만으론 부족).
  const preset = getPreset(DEFAULT_PRESET);
  const palette = {
    background: preset.background, levels: preset.levels,
    bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
  };
  const enc = encode('TLcube', { version: 1, eccLevel: 'M', daehanFinder: true });
  const scene = buildScene(enc, { palette, finderPatternId: daehanPatternId(6) });
  const luma = toRelativeLuminance(rasterize(scene, { pixelsPerUnit: 24, supersample: 1 }), {});
  const detected = detectCellFinders(luma, lineup, {
    centerSeeds: [{ x: luma.width / 2, y: luma.height / 2 }],
  });
  assert.ok(detected.ok);
  const ids = new Set(detected.candidates.map((c) => c.patternId));
  assert.ok(ids.has('oak-taegeuk-solo'), 'solo 해석이 사라졌다: ' + [...ids].join(','));
  assert.ok([...ids].some((id) => isDaehanFinderPatternId(id)),
    'daehan 해석이 사라졌다 (finish 전환 가드 회귀): ' + [...ids].join(','));
});

test('⑩ 시디드 경로 왕복 — ss1 프레임이 옵트인 라인업에서 원문까지 돈다 (C2b 완결)', async () => {
  // ss1(무 슈퍼샘플) 렌더는 outline 유도 씨앗(centerSeeds/cellSizeSeeds) 경로를
  // 타는 재현 프레임이다 — 가드 전에는 daehan 후보가 finish 전환으로 전멸해
  // finderCount 1 → 왕복 사망이었다 (2026-08-24 프로브 실측). 이 왕복이 곧
  // «편입 게이트 해소» 의 실효 잠금이다. ss2 는 ⑦ 이 이미 잠근다.
  const { decodeFrontend } = await import('../src/decoder/frontend.js');
  const preset = getPreset(DEFAULT_PRESET);
  const palette = {
    background: preset.background, levels: preset.levels,
    bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
  };
  const enc = encode('TLcube', { version: 1, eccLevel: 'M', daehanFinder: true });
  const scene = buildScene(enc, { palette, finderPatternId: daehanPatternId(6) });
  const raster = rasterize(scene, { pixelsPerUnit: 24, supersample: 1 });
  const on = decodeFrontend(raster, { bootstrap: { cellFinderDaehan: true } });
  assert.equal(on.ok, true, JSON.stringify(on.reason ?? null));
  assert.equal(on.text, 'TLcube');
  // 기본 라인업은 여전히 거절해야 한다 — solo 편입이 옵트인 경계를 안 넘었다.
  const off = decodeFrontend(raster, {});
  assert.equal(off.ok, false, 'solo 편입이 기본 라인업으로 샜다');
});

test('⑧ 분류 층 id — taegeuk 19 = 슬롯, sagoae = 예약, 와이어 이름은 daehan', () => {
  assert.equal(DAEHAN_NAME, 'daehan');
  assert.equal(TAEGUK_ID, 'taegeuk');
  assert.equal(SAGOAE_ID, 'sagoae');
  assert.equal(taegeukCells().length, 19);
  for (const k of DAEHAN_RADII) {
    assert.equal(sagoaeCells(k).length, daehanReservedCells(k).length);
  }
});
