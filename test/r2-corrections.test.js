/*
 * r2-corrections.test.js — **RS 정정 위치 → 셀 → 화면** 사슬의 자 (3b · PM/029B §27.4).
 *
 * 재는 것을 먼저 적는다 (자마다 «어떤 성질» 인지):
 *   ⓐ **왕복 성질** — 코드워드에서 e ≤ t 개 심볼을 망가뜨리고 복호하면 정정 위치 집합이
 *      **망가뜨린 집합과 정확히 같다**. RS 는 e ≤ t 에서 그 자리를 정확히 고치므로 이것은
 *      알고리즘의 성질이다. (셀 배치와의 왕복은 ⓑ 가 따로 잰다.)
 *   ⓑ **매핑 성질** — 위치 p → 셀 {3p, 3p+1, 3p+2} 가 (i) 인코더가 실제로 얹은 자리와 같고
 *      (ii) 서로소이며 (iii) [0, cellCount) 안이다. 3 은 손 상수가 아니라 base211 에서 온다.
 *   ⓒ **색 성질** — «RS 정정» 색이 셀맵 «소거»(분홍)와 **갈린다**. 철자가 아니라 rgb 거리로.
 *   ⓓ **α 성질** — `hudCorrectionAlpha` 가 창 안에서만 1 → 0 단조 감소.
 *   ⓔ **역표 성질** — `invertScanGrid` 가 `scanGrid` 의 역함수다 (라인업 전수).
 *   ⓕ **사전 성질** — `r2.state.rsfix` 가 여덟 언어에 있고 **개수 자리**를 갖는다.
 *   ⓖ **패널 성질** — 정정 0 이면 progress 행에 수가 **없고**, > 0 이면 그 수가 실린다.
 *   ⓗ **세션 성질** — correctedCount 의 수명이 `payload` 와 **같다**: DONE 과 그 흡수 프레임에서
 *      유효하고, 그 밖의 프레임·`rejectPayload()`·`reset()` 뒤에는 0 (3b 검토 F2·F12).
 *   ⓘ **접착 성질** — `correctedCellsForHit` 가 세션 결과를 적중의 `{count, cells}` 로 옮긴다:
 *      스크래치가 자라고, 뷰가 정확히 잘리고, 매핑 불가면 «수는 맞고 자리는 없다».
 *
 * ⚠ 이 파일이 **못** 재는 축 (이름을 붙여 둔다):
 *   · 화면 픽셀. 캔버스에 실제로 흰 마름모가 찍혔는가는 브라우저 밖에서 못 잰다 —
 *     여기서 재는 것은 «어느 셀을 그리기로 했는가» 까지다.
 *   · **보이는 시간 — 지금은 0 프레임이다** (3b 검토 F1, 미해소). 수용된 적중은 같은 태스크에서
 *     `stopCamera()` 로 이어지고 그 안의 `renderR2CellMap()` 이 캔버스 둘을 `hidden = true` 로
 *     세운다 — 합성 전이라 브라우저가 한 장도 안 보여 준다. 「DONE 프레임 한 장은 남는다」던
 *     옛 문구도 거짓이었다. 표면을 여는 결정((i) stopCamera 유예 · (ii) 결과 시트 HUD)은
 *     운영자 몫이고, 그 결정이 서기 전에는 **어떤 자도 이 축을 못 덮는다** — 「캔버스가
 *     hidden = false 인 채로 ≥1 프레임 지난다」를 값으로 재려면 실브라우저가 필요하다.
 *   · 그림 자체(붓·α·게이트의 배선)는 `test/r2-hud.test.js` ⓞ·ⓟ 가 철자로 잠근다.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  DIGITS_PER_SYMBOL, bytesToSymbols, unpackSymbolsToCellDigits,
} from '../src/base211.js';
import { rsEncode } from '../src/rs211.js';
import { frame as frameBytes } from '../src/header.js';
import {
  R2_CELLS_PER_SYMBOL, correctedCellsForHit, correctedCellsFromPositions, symbolCountOf,
} from '../src/r2/corrections.js';
import { createRsDecodeInto } from '../src/r2/decode-rs.js';
import { R2_SESSION_STATUS, R2_INDICATOR, createR2Session } from '../src/r2/session.js';
import { Q15_ONE } from '../src/r2/params.js';
import {
  HUD_COUNT_PLACEHOLDER, HUD_RSFIX_STATE_KEY, HUD_STATE_KEYS_BEYOND_INDICATOR,
  R2_HUD_CORRECTION_MS, buildRoleGrids, fillCount, hudCorrectionAlpha, invertScanGrid,
} from '../src/r2-hud-model.js';
import { confirmationRows } from '../src/r2-confirmation-model.js';
import {
  capacityForCellSurfaceFinal, dataCellsInScanOrderCellSurfaceFinal, finalLayoutIdsForN,
  // ⓙ (빚 3) — 정정 강조가 «그 프레임의 포맷 세대» 를 따르는지 재려면 세대 상수와 레이아웃 맵이 필요하다.
  CELL_SURFACE_FINAL_FORMAT_WIRE, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY,
  hasLegacyFormatWire, layoutMapCellSurfaceFinal,
} from '../src/cellSurfaceFinal.js';
import { SCANNER_STRINGS } from '../sites/tlscan/strings.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SCANNER_JS = readFileSync(ROOT + 'sites/tlscan/scanner.js', 'utf8');

const PAYLOAD = new Uint8Array([0x54, 0x4c, 0x63, 0x75, 0x62, 0x65, 0x21]);

/**
 * ⓑ 의 one-hot 심볼 값. 세 digit 이 **전부 0 이 아닌** 값이어야 「어디에 얹혔나」가 셋 다 보인다 —
 * 43 = 1·36 + 1·6 + 1 → [1, 1, 1]. 값 자체는 자가 성립하는지(placed.length === 3)로 확인한다.
 */
const ONE_HOT_SYMBOL = 43;

/** 세션이 넘길 모양(코드워드 · 신뢰도 · 소거)을 인코더와 **같은 경로**로 만든다. */
function buildFrame(payload, nsym) {
  const message = bytesToSymbols(payload);
  const codeword = rsEncode(message, nsym);
  const values = new Uint8Array(codeword.length);
  values.set(codeword);
  const confidence = new Int16Array(codeword.length);
  confidence.fill(2000);
  return {
    values,
    confidence,
    erasures: new Uint8Array(codeword.length),
    symbolCount: codeword.length,
    messageLength: message.length,
  };
}

function runDecode(input) {
  const decodeInto = createRsDecodeInto();
  const output = {
    accepted: 0,
    payloadLength: 0,
    tResidual: 0,
    correctedCount: 0,
    correctedPositions: new Uint16Array(input.symbolCount),
  };
  const buffer = new Uint8Array(512);
  const status = decodeInto(
    input.values, input.confidence, input.erasures, input.symbolCount,
    { nsym: input.symbolCount - input.messageLength },
    output, buffer,
  );
  return { status, output, buffer };
}

test('ⓐ 왕복 — e ≤ t 개 심볼을 망가뜨리면 정정 집합이 **그 집합과 정확히 같다**', () => {
  const nsym = 12;                       // t = 6
  const probe = buildFrame(PAYLOAD, nsym);
  const last = probe.symbolCount - 1;     // 패리티 끝 — 데이터 밖도 지목해야 한다
  for (const broken of [[0], [3, last], [1, 5, probe.messageLength, last]]) {
    const f = buildFrame(PAYLOAD, nsym);
    assert.ok(broken.every((p) => p >= 0 && p < f.symbolCount),
      '망가뜨릴 자리가 코드워드(' + f.symbolCount + ') 밖이다 — 자가 공허하다');
    assert.ok(broken.length * 2 <= nsym, 'e > t 다 — RS 가 정확히 그 자리를 고친다는 전제가 깨진다');
    for (const p of broken) {
      f.values[p] = (f.values[p] + 37) % 211;
      f.confidence[p] = 40;              // 실제 오독은 신뢰도가 낮게 나온다
    }
    const { output } = runDecode(f);
    assert.equal(output.accepted, 1, broken.join(',') + ' 를 못 살렸다 — 나머지 단언이 공허해진다');
    const got = Array.from(output.correctedPositions.subarray(0, output.correctedCount)).sort((a, b) => a - b);
    assert.deepEqual(got, [...broken].sort((a, b) => a - b),
      '정정 위치 집합이 망가뜨린 집합과 다르다 — RS 는 e ≤ t 에서 정확히 그 자리를 고친다');
  }
});

test('ⓐ-b **정정이 없으면 0** — 무결 코드워드는 위치를 하나도 내지 않는다 (거짓 강조 금지)', () => {
  const f = buildFrame(PAYLOAD, 12);
  const { output } = runDecode(f);
  assert.equal(output.accepted, 1);
  assert.equal(output.correctedCount, 0, '고친 게 없는데 위치가 나왔다 — HUD 가 없는 결함을 지목한다');
});

test('ⓐ-c **framed 경로**(실물 Y 코드가 타는 길)에서도 위치가 나오고, 그 셀이 격자 안이다', () => {
  /*
   * ⚠ ⓐ 는 `{ nsym }` 만 준 **원시** 경로다 (decode-rs 의 `framed` 유도: maskDigits 가 있으면 framed).
   * 실물 코드는 인코더가 `frame(text, dataBytes)` 를 씌우고 런타임이 maskDigits 를 넘기므로
   * **다른 수용 지점**을 지난다 — 그쪽에서 정정 위치를 안 내면 화면엔 영원히 0 이 뜬다.
   */
  const n = 25;
  const layoutId = 'v0tr';
  const capacity = capacityForCellSurfaceFinal(n, 'H', 2, layoutId);
  const scan = dataCellsInScanOrderCellSurfaceFinal(n, layoutId);
  const payload = frameBytes('https://tl.estre.so', capacity.dataBytes);
  const message = bytesToSymbols(payload);
  assert.equal(message.length, capacity.dataSymbols, '인코더 회계와 어긋난다 — 이 자가 실물 경로가 아니다');
  const codeword = rsEncode(message, capacity.nsym);
  const values = new Uint8Array(codeword.length);
  values.set(codeword);
  const confidence = new Int16Array(codeword.length).fill(2000);
  const broken = [2, capacity.dataSymbols + 1];       // 데이터 하나 · 패리티 하나
  for (const p of broken) {
    values[p] = (values[p] + 53) % 211;
    confidence[p] = 40;
  }
  const output = {
    accepted: 0, payloadLength: 0, tResidual: 0,
    correctedCount: 0, correctedPositions: new Uint16Array(codeword.length),
  };
  const layout = {
    nsym: capacity.nsym,
    payloadBytes: capacity.dataBytes,
    cellCount: scan.length,
    maskDigits: new Uint8Array(scan.length),          // 존재가 곧 «framed» 다 (decode-rs 머리말)
  };
  const status = createRsDecodeInto({ codewordCapacity: codeword.length })(
    values, confidence, new Uint8Array(codeword.length), codeword.length,
    layout, output, new Uint8Array(capacity.dataBytes),
  );
  assert.equal(status, R2_SESSION_STATUS.OK);
  assert.equal(output.accepted, 1, 'framed 경로가 2오류를 못 살렸다 — 나머지 단언이 공허해진다');
  const got = Array.from(output.correctedPositions.subarray(0, output.correctedCount)).sort((a, b) => a - b);
  assert.deepEqual(got, [...broken].sort((a, b) => a - b), 'framed 수용 지점이 정정 위치를 안 낸다');

  const cells = new Uint16Array(output.correctedCount * R2_CELLS_PER_SYMBOL);
  const written = correctedCellsFromPositions(output.correctedPositions, output.correctedCount, layout, cells);
  assert.equal(written, cells.length);
  for (const cell of cells) assert.ok(cell >= 0 && cell < scan.length, '정정 셀이 격자 밖이다');
});

test('ⓑ 매핑 — 위치 p 의 셀 3개가 **인코더가 실제로 얹은 자리**와 같다 (라인업 전수)', () => {
  assert.equal(R2_CELLS_PER_SYMBOL, DIGITS_PER_SYMBOL, '셀/심볼이 base211 에서 안 온다 — 손 상수 3 이다');
  let measured = 0;
  for (const n of [13, 21, 25]) {
    for (const layoutId of finalLayoutIdsForN(n)) {
      const capacity = capacityForCellSurfaceFinal(n, 'H', 2, layoutId);
      const scan = dataCellsInScanOrderCellSurfaceFinal(n, layoutId);
      const layout = { cellCount: scan.length };
      const positions = Uint16Array.from([0, 1, Math.floor(capacity.usedSymbols / 2), capacity.usedSymbols - 1]);
      const out = new Uint16Array(positions.length * R2_CELLS_PER_SYMBOL);
      const written = correctedCellsFromPositions(positions, positions.length, layout, out);
      assert.equal(written, out.length, n + '/' + layoutId + ': 매핑이 거절됐다');

      const seen = new Set();
      for (let idx = 0; idx < positions.length; idx += 1) {
        const p = positions[idx];
        /*
         * 🔴 **기대값을 인코더에서 뽑는다** (3b 검토 F3·F8). 옛 자는 기대값을 `p * 3 + k` 로 적어
         * `corrections.js` 의 계산식을 그대로 되풀이했다 — 인코더가 인터리빙으로 바뀌어도 초록인
         * 항진 자였다(검토가 base211 배치를 인터리빙으로 갈아도 11/11 통과시켰다).
         *
         * 이제는 **one-hot**으로 인코더에게 직접 묻는다: 심볼 p 만 0 이 아닌 값(43 → digit [1,1,1])
         * 으로 두고 나머지를 0 으로 두면, `unpackSymbolsToCellDigits` 가 실제로 얹은 자리가
         * 「digit 이 0 이 아닌 인덱스」로 **값에서** 드러난다. 배치가 바뀌면 그 인덱스가 움직이고
         * 이 자가 빨개진다.
         */
        const symbols = new Uint8Array(capacity.usedSymbols);
        symbols[p] = ONE_HOT_SYMBOL;
        const digits = unpackSymbolsToCellDigits(symbols);
        assert.equal(digits.length, capacity.usedSymbols * R2_CELLS_PER_SYMBOL);
        assert.ok(digits.length <= scan.length, 'digit 이 스캔 셀보다 많다 — 배치 전제가 깨졌다');
        const placed = [];
        for (let cell = 0; cell < digits.length; cell += 1) if (digits[cell] !== 0) placed.push(cell);
        assert.equal(placed.length, R2_CELLS_PER_SYMBOL,
          '인코더가 심볼 하나를 ' + placed.length + '칸에 얹었다 — one-hot 전제(43 → [1,1,1])가 깨졌다');

        const got = [];
        for (let k = 0; k < R2_CELLS_PER_SYMBOL; k += 1) got.push(out[idx * R2_CELLS_PER_SYMBOL + k]);
        // (i) 인코더가 **실제로** 얹은 자리와 같다 (순서까지).
        assert.deepEqual(got, placed, n + '/' + layoutId + ' p' + p + ': 셀이 인코더 배치와 다르다');
        for (const cell of got) {
          // (ii) 서로소 · (iii) 범위 안.
          assert.ok(!seen.has(cell), '셀이 겹친다');
          seen.add(cell);
          assert.ok(cell >= 0 && cell < scan.length, '셀이 격자 밖이다');
        }
      }
      measured += 1;
    }
  }
  assert.ok(measured >= 4, '라인업을 ' + measured + '개만 봤다 — 훑기가 깨졌다');
});

test('ⓑ-b 매핑은 **거절**한다 — 범위 밖 위치 · 짧은 버퍼 · 모르는 레이아웃은 -1 (예외 없음)', () => {
  const out = new Uint16Array(12);
  assert.equal(correctedCellsFromPositions(Uint16Array.from([99]), 1, 10, out), -1, '범위 밖 위치를 받았다');
  assert.equal(correctedCellsFromPositions(Uint16Array.from([0, 1]), 2, 10, new Uint16Array(5)), -1, '짧은 버퍼를 받았다');
  assert.equal(correctedCellsFromPositions(Uint16Array.from([0]), 1, null, out), -1, '레이아웃 없이 그렸다');
  assert.equal(correctedCellsFromPositions(null, 0, 10, out), -1);
  assert.equal(correctedCellsFromPositions(Uint16Array.from([0]), 0, 10, out), 0, 'count 0 은 정상적으로 0 이다');
  // `symbolCells` 표가 있으면 그 표를 따른다 (기본 연속 3칸이 아니다).
  const table = Uint16Array.from([5, 6, 7, 0, 1, 2]);
  const layout = { symbolCells: table, cellCount: 8 };
  assert.equal(symbolCountOf(layout), 2);
  const got = new Uint16Array(3);
  assert.equal(correctedCellsFromPositions(Uint16Array.from([1]), 1, layout, got), 3);
  assert.deepEqual(Array.from(got), [0, 1, 2], 'symbolCells 표를 무시하고 연속 3칸을 썼다');
});

/** 'rgb(r,g,b[,a])' → [r,g,b]. 파싱 못 하면 null. */
function rgbOf(color) {
  const m = /^rgba?\(([^)]*)\)$/i.exec(String(color).trim());
  if (!m) return null;
  const parts = m[1].split(',').map((v) => Number(v.trim()));
  return parts.length >= 3 && parts.slice(0, 3).every(Number.isFinite) ? parts.slice(0, 3) : null;
}

test('ⓒ 색 — «RS 정정» 이 셀맵 «소거»(분홍)와 **갈린다** (철자가 아니라 rgb 거리)', () => {
  const at = SCANNER_JS.indexOf('const R2_CELL_COLOR = Object.freeze({');
  assert.ok(at > 0, '팔레트를 못 찾았다');
  const block = SCANNER_JS.slice(at, SCANNER_JS.indexOf('});', at));
  const rsfixLine = /\[HUD_RSFIX_STATE_KEY\]:\s*'([^']+)'/.exec(block);
  assert.ok(rsfixLine, 'RS 정정 색이 팔레트에 없거나 키가 상수에서 안 온다');
  const erasureLine = /\[CELL_MAP_STATE\.ERASURE\]:\s*'([^']+)'/.exec(block);
  assert.ok(erasureLine, '소거 색을 못 찾았다');
  const a = rgbOf(rsfixLine[1]);
  const b = rgbOf(erasureLine[1]);
  assert.ok(a && b, '두 색이 rgb 로 안 읽힌다 — 거리를 잴 수 없다');
  // 「갈린다」의 정의: 채널 하나라도 크게 다르다. 두 그림이 같은 화면에 뜨고 뜻이 반대다
  // («격자를 못 믿는다» vs «RS 가 고쳤다»).
  const distance = Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  assert.ok(distance >= 96,
    'RS 정정 색이 소거 분홍과 너무 가깝다 (최대 채널차 ' + distance + ')');
  // 그리고 팔레트의 **어느 항목과도** 같은 값이 아니다 (사본으로 되돌아오는 것을 막는다).
  const others = [...block.matchAll(/:\s*'(rgba?\([^']+\))'/g)].map((m) => m[1]);
  const same = others.filter((c) => c === rsfixLine[1]);
  assert.equal(same.length, 1, 'RS 정정 색이 팔레트의 다른 항목과 같은 값이다');
});

test('ⓓ α — 창 안에서만 1 → 0 단조 감소, 밖에서는 0 (시계는 주입)', () => {
  const at = 1000;
  assert.equal(R2_HUD_CORRECTION_MS, 600, '수명이 운영자 결정(600 ms)과 다르다');
  assert.equal(hudCorrectionAlpha(at, at), 1, '래치 순간이 최댓값이 아니다');
  assert.equal(hudCorrectionAlpha(at - 1, at), 0, '래치 **전**에 그린다 — DONE 도 아닌데 셀이 지목된다');
  assert.equal(hudCorrectionAlpha(at + R2_HUD_CORRECTION_MS, at), 0, '수명이 지나도 남는다');
  assert.equal(hudCorrectionAlpha(at + 9999, at), 0);
  let previous = Infinity;
  for (let dt = 0; dt < R2_HUD_CORRECTION_MS; dt += 25) {
    const alpha = hudCorrectionAlpha(at + dt, at);
    assert.ok(alpha <= previous, 'dt=' + dt + ' 에서 α 가 올라갔다');
    assert.ok(alpha > 0 && alpha <= 1, 'dt=' + dt + ' 에서 α 가 창 밖 값이다');
    previous = alpha;
  }
  assert.equal(hudCorrectionAlpha(NaN, at), 0);
  assert.equal(hudCorrectionAlpha(at, undefined), 0);
  assert.equal(hudCorrectionAlpha(at, at, 0), 0);
});

test('ⓔ 역표 — invertScanGrid 가 scanGrid 의 역함수다 (라인업 전수)', () => {
  let measured = 0;
  for (const n of [13, 21, 25]) {
    for (const layoutId of finalLayoutIdsForN(n)) {
      const grids = buildRoleGrids(n, layoutId);
      assert.ok(grids, n + '/' + layoutId + ': 역할 격자가 없다');
      const inverse = new Int32Array(grids.counts.data);
      const mapped = invertScanGrid(grids.scanGrid, inverse);
      assert.equal(mapped, grids.counts.data, n + '/' + layoutId + ': 데이터 셀 수와 역표 크기가 다르다');
      for (let k = 0; k < inverse.length; k += 1) {
        const idx = inverse[k];
        assert.ok(idx >= 0 && idx < grids.scanGrid.length, 'k=' + k + ' 가 격자 밖을 가리킨다');
        assert.equal(grids.scanGrid[idx], k, '역표가 scanGrid 의 역함수가 아니다');
      }
      measured += 1;
    }
  }
  assert.ok(measured >= 4, '라인업을 ' + measured + '개만 봤다');
  assert.equal(invertScanGrid(null, new Int32Array(2)), -1);
  assert.equal(invertScanGrid(new Int16Array(2), null), -1);
});

/*
 * ── ⓙ 빚 3 — **정정 강조는 그 프레임의 포맷 세대 위에서만 참이다** ────────────────────────
 *
 * 사슬의 앞쪽(`correctedCellsFromPositions`)은 «스캔 순번» 을 낸다 — 세대와 무관한 번호다.
 * 세대가 들어오는 곳은 **그 번호를 격자 칸으로 바꾸는 자리**(HUD 역표)다. 3a 유산으로 그 자리가
 * 세대를 몰랐고, 레거시(와이어 1) 프레임에서 정정 강조가 **다른 칸**을 지목했다.
 *
 * 여기서 잠그는 성질 (인코더를 안 부른다 — 기대값은 레이아웃 맵의 `{role:'data', index:k}` 다):
 *   ① 세대 w 의 역표가 짚는 칸은 **세대 w 의 맵에서 그 순번의 데이터 칸**이다.
 *   ② 두 세대는 실제로 다른 칸을 짚는다 — 그리고 첫 어긋남부터는 **정정 셀이 통째로 옮겨간다**.
 *   ③ 🔴 **틀린 세대의 격자로 그리면 «데이터가 아닌 칸» 을 칠한다** — 그것이 이 결함의 피해다.
 */
test('ⓙ 빚3 — 정정 셀 → 격자 칸이 포맷 세대를 따른다 (와이어 1 vs 2, 순번이 갈리는 지점부터)', () => {
  const pairs = [];
  for (const n of [13, 21, 25]) {
    for (const id of finalLayoutIdsForN(n)) if (hasLegacyFormatWire(id)) pairs.push({ n, id });
  }
  assert.ok(pairs.length >= 1, '레거시 세대를 가진 라인업이 0개다 — 이 자가 공허해진다');

  for (const { n, id } of pairs) {
    const grid = new Map();
    for (const wire of [CELL_SURFACE_FINAL_FORMAT_WIRE, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY]) {
      const grids = buildRoleGrids(n, id, wire);
      const inverse = new Int32Array(grids.counts.data);
      assert.equal(invertScanGrid(grids.scanGrid, inverse), grids.counts.data);
      // ① 세대 w 의 칸은 세대 w 의 맵에서 그 순번의 데이터 칸이다 (기대값의 출처가 다른 함수다).
      const map = layoutMapCellSurfaceFinal(n, id, wire);
      for (let k = 0; k < inverse.length; k += 1) {
        const i = inverse[k] % n;
        const j = (inverse[k] - i) / n;
        const entry = map.get(i + ',' + j);
        assert.ok(entry && entry.role === 'data' && entry.index === k,
          n + '@' + id + ' wire' + wire + ': 순번 ' + k + ' 가 데이터 칸 ' + k + ' 가 아니다');
      }
      grid.set(wire, { grids, inverse, map });
    }

    const now = grid.get(CELL_SURFACE_FINAL_FORMAT_WIRE);
    const legacy = grid.get(CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY);
    const shared = Math.min(now.inverse.length, legacy.inverse.length);
    let firstDiff = -1;
    for (let k = 0; k < shared; k += 1) {
      if (now.inverse[k] !== legacy.inverse[k]) { firstDiff = k; break; }
    }
    assert.ok(firstDiff >= 0, n + '@' + id + ': 두 세대의 역표가 같다 — 세대가 격자에 안 닿았다');

    /*
     * ② 첫 어긋남을 **포함하는 심볼**부터 잡는다. 정정은 심볼 단위(셀 3칸)라, 그 심볼의 세 칸이
     *    통째로 옮겨간 것을 확인해야 「강조가 다른 자리에 뜬다」가 성립한다.
     */
    const symbol = Math.floor(firstDiff / R2_CELLS_PER_SYMBOL);
    const symbolCount = Math.floor(shared / R2_CELLS_PER_SYMBOL);
    assert.ok(symbol < symbolCount, n + '@' + id + ': 어긋나는 심볼이 범위 밖이다');
    const cells = new Uint16Array(R2_CELLS_PER_SYMBOL);
    assert.equal(
      correctedCellsFromPositions(Uint16Array.from([symbol]), 1, symbolCount, cells),
      R2_CELLS_PER_SYMBOL,
      '정정 셀 매핑이 거절됐다 — 이 자가 공허해진다',
    );

    let moved = 0;
    let landedOffData = 0;
    for (const cell of cells) {
      const idxNow = now.inverse[cell];
      const idxLegacy = legacy.inverse[cell];
      if (idxNow !== idxLegacy) moved += 1;
      /*
       * ③ 피해의 정의 — **레거시 프레임을 현행 세대의 격자로** 그리면, 그 칸이 레거시 맵에서
       *    데이터 칸 `cell` 이 아니다 (포맷 칸이거나 다른 순번의 데이터 칸이다).
       */
      const i = idxNow % n;
      const j = (idxNow - i) / n;
      const entry = legacy.map.get(i + ',' + j);
      if (!entry || entry.role !== 'data' || entry.index !== cell) landedOffData += 1;
    }
    assert.ok(moved > 0,
      n + '@' + id + ': 심볼 ' + symbol + ' 의 셀이 두 세대에서 같은 칸이다 — 세대가 강조에 안 닿는다');
    assert.ok(landedOffData > 0,
      n + '@' + id + ': 틀린 세대로 그려도 참 칸에 떨어진다 — 이 결함의 피해가 재현되지 않는다');
  }
});

test('ⓕ 사전 — r2.state.rsfix 가 여덟 언어에 있고 **개수 자리**를 갖는다 · 스캐너는 키를 상수에서 만든다', () => {
  assert.ok(HUD_STATE_KEYS_BEYOND_INDICATOR.includes(HUD_RSFIX_STATE_KEY),
    '새 상태 단어가 «인디케이터 밖» 목록에 없다 — scanner-i18n 의 죽은 문구 판정이 이 키를 지운다고 말한다');
  const key = 'r2.state.' + HUD_RSFIX_STATE_KEY;
  const langs = Object.keys(SCANNER_STRINGS);
  assert.equal(langs.length, 8, '사전이 ' + langs.length + '언어다');
  for (const lang of langs) {
    const value = SCANNER_STRINGS[lang][key];
    assert.equal(typeof value, 'string', lang + ' 에 ' + key + ' 가 없다');
    assert.ok(value.includes(HUD_COUNT_PLACEHOLDER),
      lang + '/' + key + ' 에 개수 자리(' + HUD_COUNT_PLACEHOLDER + ')가 없다 — 그 언어에서만 수가 사라진다');
  }
  assert.equal(fillCount(SCANNER_STRINGS.en[key], 3), 'RS-fixed 3');
  assert.equal(fillCount('자리 없음', 3), '자리 없음', '자리가 없으면 문구를 잃지 말고 그대로');
  /*
   * ⚠ **철자 자** — 브라우저 밖에서 못 도는 층. 지키려는 명제 하나: 스캐너가 키 문자열 'rsfix' 를
   * 다시 적지 않는다 (적으면 상수를 바꾸는 날 화면만 옛 키를 불러 «빈 라벨» 이 된다).
   */
  assert.match(SCANNER_JS, /t\('r2\.state\.' \+ HUD_RSFIX_STATE_KEY\)/,
    '스캐너가 RS 정정 문구를 원본 상수로 안 붙인다');
  assert.doesNotMatch(SCANNER_JS, /'r2\.state\.rsfix'/, '스캐너가 사전 키를 문자열로 다시 적는다');
});

test('ⓖ 패널 — 정정 0 이면 progress 행에 수가 **없고**, > 0 이면 그 수가 실린다', () => {
  const base = { layoutId: 'v0t', n: 13, leadingId: 'v0t' };
  const zero = confirmationRows({ latched: { ...base, correctedCount: 0 } });
  const zeroRow = zero.find((r) => r.key === 'progress');
  assert.equal(zeroRow.text, 'DONE');
  assert.equal(zeroRow.correctedCount, undefined, '정정 0 인데 수가 실렸다 — 화면에 «정정 0» 이 뜬다');
  const some = confirmationRows({ latched: { ...base, correctedCount: 4 } });
  assert.equal(some.find((r) => r.key === 'progress').correctedCount, 4);
  // 래치가 없으면(라이브) 정정 수는 아예 없는 축이다.
  const live = confirmationRows({ stats: { candidateCount: 1, lockedN: 13, progressD: 0.5 } });
  assert.equal(live.find((r) => r.key === 'progress').correctedCount, undefined);
});

test('ⓗ 세션 — correctedCount 의 수명이 **payload 와 같고**, 위치 버퍼는 caller-owned 로 등록돼 있다', () => {
  const layout = { cellCount: 9, requiredSymbolCount: 2, safetySymbolCount: 0, maxPayloadBytes: 16 };
  let calls = 0;
  const session = createR2Session({
    layout,
    params: { tauCellQ8: 256, erasureMarginQ8: 256 },
    detectInto: (luma, width, height, timestamp, pose, out) => {
      out.found = 1;
      out.family = 7;
      return R2_SESSION_STATUS.OK;
    },
    alignInto: (luma, width, height, timestamp, pose, detection, out, faceLuma, visibleCells) => {
      out.gatePassed = 1;
      out.weightQ15 = Q15_ONE;
      out.mismatchCount = 0;
      out.matchCount = 0;
      out.visibleCount = visibleCells.length;
      for (let cell = 0; cell < visibleCells.length; cell += 1) {
        visibleCells[cell] = 1;
        faceLuma[cell * 3] = 255;
        faceLuma[(cell * 3) + 1] = 128;
        faceLuma[(cell * 3) + 2] = 0;
      }
      return R2_SESSION_STATUS.OK;
    },
    decodeInto: (values, conf, er, count, lay, output, payload) => {
      calls += 1;
      output.correctedCount = 0;
      if (calls < 2) return R2_SESSION_STATUS.OK;      // 아직 아님 — 정정 수는 0 이어야 한다
      output.accepted = 1;
      output.payloadLength = 2;
      payload[0] = 65;
      payload[1] = 66;
      output.correctedPositions[0] = 1;
      output.correctedCount = 1;
      return R2_SESSION_STATUS.OK;
    },
  });
  assert.ok(session.buffers.correctedPositions instanceof Uint16Array,
    '정정 위치 버퍼가 buffers 에 없다 — caller-owned 계약이 깨졌다');
  assert.equal(session.result.correctedCount, 0, '첫 프레임 전에 이미 값이 있다');
  const luma = new Uint8Array(64);
  let done = false;
  for (let f = 0; f < 12 && !done; f += 1) {
    const result = session.pushFrame(luma, 8, 8, f * 33);
    if (result.indicator === R2_INDICATOR.DONE) done = true;
    else assert.equal(result.correctedCount, 0, 'f' + f + ': DONE 이 아닌데 정정 수가 있다');
  }
  assert.ok(done, 'DONE 이 안 났다 — 이 자가 공허하다 (주입 decodeInto 가 안 불렸다)');
  assert.equal(session.result.correctedCount, 1);
  assert.equal(session.result.correctedPositions[0], 1);
  assert.equal(session.result.correctedPositions, session.buffers.correctedPositions,
    'result 와 buffers 가 다른 배열이다 — 사본이 하나 늘었다');

  /*
   * 🔴 **수명은 payload 와 같다** (3b 검토 F12 — 옛 계약 「나머지 프레임은 0」은 흡수 구간에서
   * 거짓이었다). DONE 뒤 세션은 흡수 상태라 `pushFrame` 이 조기 반환하고 payload 도 정정 수도
   * 그대로 남는다. 그 둘이 **같이** 움직이는지를 값으로 잰다 — 갈리면 어느 쪽이든 거짓말이다.
   */
  for (let f = 0; f < 3; f += 1) {
    const absorbed = session.pushFrame(luma, 8, 8, (20 + f) * 33);
    assert.equal(absorbed.indicator, R2_INDICATOR.DONE, '흡수 프레임이 DONE 이 아니다');
    assert.equal(absorbed.payloadLength, 2, '흡수 프레임에서 payload 가 사라졌다');
    assert.equal(absorbed.correctedCount, 1,
      '흡수 프레임에서 정정 수만 사라졌다 — payload 와 수명이 갈렸다');
  }
  /*
   * 🔴 **무름·리셋 뒤에는 0** (3b 검토 F2·F11b — `reset()` 이 이 값을 안 내려서 SEARCHING 인데
   * 옛 DONE 의 수가 남았다). payload 를 비우는 자리는 전부 이 값도 비운다.
   */
  assert.equal(session.rejectPayload(), 1, 'DONE 을 못 물렀다 — 다음 단언이 공허해진다');
  assert.equal(session.result.correctedCount, 0, 'rejectPayload 뒤에 옛 정정 수가 남는다');
  assert.equal(session.result.payloadLength, 0);
  const afterReset = session.reset();
  assert.equal(afterReset.indicator, R2_INDICATOR.SEARCHING);
  assert.equal(afterReset.payloadLength, 0);
  assert.equal(afterReset.correctedCount, 0,
    'reset() 뒤에 옛 DONE 의 정정 수가 남는다 — SEARCHING 화면이 「k 개를 고쳤다」고 말한다');
});

test('ⓘ 접착 — correctedCellsForHit 가 세션 결과를 적중의 {count, cells} 로 옮긴다 (스크래치 성장 · 뷰 · 매핑 실패)', () => {
  /*
   * 🔴 이 접착부는 런타임의 **DONE 분기 안에만** 있었고, 코퍼스의 DONE 은 전부 `correctedCount 0`
   * 이라 (y0 f6 · y1 f5 · y2 f4 모두 c=0) 한 번도 안 타는 자리였다 — 3b 검토 F4.
   * 그래서 순수 함수로 빼고 여기서 **값으로** 지난다.
   */
  const layout = { cellCount: 30 };                     // 심볼 10개 (30 / 3)
  const holder = { scratch: new Uint16Array(0), count: 0, cells: new Uint16Array(0) };

  // ① 정정 0 — 그릴 게 없다. 스크래치도 안 자란다 (없는 결함을 지목하지 않는다).
  assert.equal(correctedCellsForHit({ correctedCount: 0, correctedPositions: new Uint16Array(4) }, layout, holder), 0);
  assert.equal(holder.count, 0);
  assert.equal(holder.cells.length, 0);
  assert.equal(holder.scratch.length, 0, '그릴 게 없는데 스크래치가 자랐다');

  // ② 정정 2 — 스크래치가 필요한 만큼 자라고, 뷰가 정확히 잘리고, 셀이 매핑 규칙과 같다.
  const result = { correctedCount: 2, correctedPositions: Uint16Array.from([1, 4, 9, 9]) };
  assert.equal(correctedCellsForHit(result, layout, holder), 2 * R2_CELLS_PER_SYMBOL);
  assert.equal(holder.count, 2, '적중이 말하는 수가 세션의 수와 다르다');
  assert.equal(holder.cells.length, 2 * R2_CELLS_PER_SYMBOL, '뷰가 유효 범위로 안 잘렸다');
  assert.ok(holder.scratch.length >= holder.cells.length, '스크래치가 안 자랐다');
  const expect = new Uint16Array(2 * R2_CELLS_PER_SYMBOL);
  assert.equal(correctedCellsFromPositions(result.correctedPositions, 2, layout, expect), expect.length);
  assert.deepEqual(Array.from(holder.cells), Array.from(expect), '접착부가 매핑 정본과 다른 셀을 낸다');
  assert.equal(holder.cells.buffer, holder.scratch.buffer, '뷰가 아니라 사본을 냈다 — DONE 마다 할당이 는다');

  // ③ 스크래치는 **자라기만** 한다 — 다음 DONE 이 더 작아도 다시 잡지 않는다.
  const grown = holder.scratch;
  assert.equal(correctedCellsForHit({ correctedCount: 1, correctedPositions: Uint16Array.from([0]) }, layout, holder),
    R2_CELLS_PER_SYMBOL);
  assert.equal(holder.scratch, grown, '더 작은 DONE 에서 스크래치를 다시 잡았다 (할당)');
  assert.equal(holder.cells.length, R2_CELLS_PER_SYMBOL, '뷰가 옛 길이로 남았다');

  /*
   * ④ **매핑 불가면 «수는 맞고 자리는 없다»** — 위치가 심볼 범위 밖이면 매핑이 -1 이다.
   * 반쪽 강조는 「어느 셀이 틀렸나」에 거짓말이라 셀을 통째로 비우되, 결과 카드가 읽는 **수**는
   * 살아 있어야 한다 (수는 RS 가 낸 사실이고, 못 그리는 것은 격자 쪽 사정이다).
   */
  assert.equal(correctedCellsForHit({ correctedCount: 1, correctedPositions: Uint16Array.from([99]) }, layout, holder), 0);
  assert.equal(holder.count, 1, '매핑이 안 된다고 수까지 잃었다 — 결과 카드의 «RS 정정 k» 가 사라진다');
  assert.equal(holder.cells.length, 0, '매핑이 안 됐는데 셀을 그린다 — 다른 칸을 지목한다');

  // ⑤ 잘못된 입력은 예외가 아니라 0 이다 (런타임 DONE 경로가 try 밖이다).
  assert.equal(correctedCellsForHit(null, layout, holder), 0);
  assert.equal(holder.count, 0);
  assert.equal(correctedCellsForHit(result, layout, null), 0);
});

test('ⓘ-b 런타임 접착 — DONE 적중이 그 함수의 결과를 그대로 싣는다 (배선 확인)', () => {
  /*
   * ⚠ **철자 자** — 런타임의 DONE 분기는 실물 프레임 없이 못 도는데, 코퍼스가 그 분기를 정정 > 0
   * 으로 지나지 않는다(위 주석). 그래서 「런타임이 자기 식을 다시 적지 않는다」만 잠근다:
   * 값은 ⓘ 가 재고, 여기서는 **그 값이 적중으로 나가는 배선**을 본다.
   */
  const runtimeSrc = readFileSync(ROOT + 'src/r2-scan-runtime.js', 'utf8');
  assert.match(runtimeSrc, /correctedCellsForHit\(candidate\.session\.result, candidate\.session\.layout, correctedHolder\)/,
    '런타임이 정정 셀을 정본 함수에 안 묻는다');
  assert.match(runtimeSrc, /correctedCount: correctedHolder\.count/, '적중의 수가 보관함에서 안 온다');
  assert.match(runtimeSrc, /correctedCells: correctedHolder\.cells/, '적중의 셀이 보관함에서 안 온다');
  assert.doesNotMatch(runtimeSrc, /correctedCellsFromPositions/,
    '런타임이 매핑 규칙을 다시 적는다 — 정본이 둘이 된다');
});
