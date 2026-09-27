// cell-shape-measured-floors.test.js — 잰 하한(허용표 MEASURED_FLOORS) ↔ 제품 하한(export-options minRoundtripPpu) (DESIGN_002 §4.5, 2026-09-28)
//
// 허용표 행은 «그 문맥의 **제품 하한 ppu** 부터 위로 잰 사다리» 에서 열렸다(영수증의 floorPpu — 비디더). 생성기(gen-allow)는 행을 연
// 증거의 floorPpu 를 하한 키마다 MEASURED_FLOORS 로 표에 싣는다. 제품 하한이 그 값보다 **낮아지면** 그 사이 ppu 는 잰 적 없이 열린다
// (과허가 — 옆 레인이 폴백 하한 12 를 낮추는 착지가 실제 위험이었다). 런북 순서로는 다른 착지를 못 막으니 공개 자로 막는다.
//
// 재는 것(성질 — 수치는 박제하지 않는다. 키 · 값은 표와 제품 코드에서 읽는다):
//   ① 표의 모든 하한 대상 행(oak · y · h)은 제품 유도(cell-shape `allowRowFloorCtx` → export-options `minRoundtripPpuKey`)로 하한 키가
//      나오고 그 키가 MEASURED_FLOORS 에 있다(생성기 쪽 철자가 제품과 어긋나면 여기서 빨개진다). MEASURED_FLOORS 에 행 없는 키도 없다.
//      qr 행은 px/모듈이라 하한 키가 없다(유도가 null).
//   ② 모든 키에서 제품 minRoundtripPpu(비디더) ≥ MEASURED_FLOORS — 제품 하한을 내리는 착지는 여기서 빨개진다(재측정하거나 순서를 바꿀 것).
//   ③ Y 행의 하한 문맥(n)은 내보내기 경로의 모양(버전 — index.html `minRoundtripPpu({type, version, cellSurfaceLayout})`)과 같은 키다.
//   ④ 판정 함수의 판별력 — 심은 결함 표(하한 하나 올림 · 키 하나 빠짐 · 행 없는 키 · 모르는 실효 타입 행)마다 그 결함이 **각각** 잡힌다.
// 못 재는 것: 디더 하한(L6 격자가 비디더 점만 잰다 — 이름 붙인 축) · MEASURED_FLOORS 값 자체가 참인가(private 영수증 · gen-allow 의 몫).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as ALLOW from '../src/cell-shape-allow.js';
import { CELL_SHAPE_GENERATOR_TYPE_OF, allowRowFloorCtx, cellShapeTypeOf } from '../src/cell-shape.js';
import { minRoundtripPpu, minRoundtripPpuKey } from '../src/export-options.js';
import { versionForFinalN } from '../src/cellSurfaceFinal.js';
import { GENERATOR_TYPES } from '../src/generator-types.js';

/**
 * 판정 — 표(ROWS · MEASURED_FLOORS) → 문제 목록. 문제 = {kind, key, …}. kind:
 *   no-floor-ctx(하한 대상 표의 행인데 제품 유도가 null — 모르는 실효 타입 등) · missing-key(행의 하한 키가 MEASURED_FLOORS 에 없다) ·
 *   stale-key(MEASURED_FLOORS 에 행 없는 키) · bad-value(양의 유한수가 아니다) · below-measured(제품 하한 < 잰 하한).
 */
function floorProblems(table) {
  const problems = [];
  const floors = table.MEASURED_FLOORS;
  if (!floors || typeof floors !== 'object') return [{ kind: 'no-export' }];
  const rowKeys = new Map(); // 키 → 첫 행의 하한 문맥
  for (const row of table.ROWS) {
    if (row.table === 'qr') continue;
    const ctx = allowRowFloorCtx(row);
    if (ctx === null) { problems.push({ kind: 'no-floor-ctx', row }); continue; }
    const key = minRoundtripPpuKey(ctx);
    if (!rowKeys.has(key)) rowKeys.set(key, ctx);
    if (!Object.prototype.hasOwnProperty.call(floors, key)) problems.push({ kind: 'missing-key', key, row });
  }
  for (const [key, value] of Object.entries(floors)) {
    if (!(typeof value === 'number' && Number.isFinite(value) && value > 0)) problems.push({ kind: 'bad-value', key, value });
    if (!rowKeys.has(key)) { problems.push({ kind: 'stale-key', key }); continue; }
    const product = minRoundtripPpu(rowKeys.get(key)); // 비디더(ditherBits 없음)
    if (!(product >= value)) problems.push({ kind: 'below-measured', key, product, measured: value });
  }
  return problems;
}
const kindsOf = (problems) => [...new Set(problems.map((p) => p.kind))].sort();

test('① · ② 생성 허용표: 모든 하한 대상 행의 제품 하한 키가 MEASURED_FLOORS 에 있고(행 없는 키 없음), 모든 키에서 제품 하한 ≥ 잰 하한', (t) => {
  assert.ok(Object.isFrozen(ALLOW.MEASURED_FLOORS), 'MEASURED_FLOORS 가 동결돼 있지 않다');
  const problems = floorProblems(ALLOW);
  assert.deepEqual(problems, [], '잰 하한 ↔ 제품 하한 — '
    + 'missing/stale-key 면 생성기(gen-allow)의 하한 키 철자가 제품 minRoundtripPpuKey 와 어긋났다 · '
    + 'below-measured 면 제품 하한이 잰 하한보다 낮다 — 그 사이 ppu 는 잰 적 없이 열린다(재측정하거나 착지 순서를 바꿀 것)');
  // 비공허 — 셀 표(oak · y)와 H 표의 키가 실제로 있다.
  const keys = Object.keys(ALLOW.MEASURED_FLOORS);
  const rowTables = new Set(ALLOW.ROWS.filter((r) => r.table !== 'qr').map((r) => r.table));
  for (const tbl of rowTables) {
    assert.ok(ALLOW.ROWS.some((r) => r.table === tbl && keys.includes(minRoundtripPpuKey(allowRowFloorCtx(r)))), `${tbl} 행의 하한 키가 없다`);
  }
  const margins = keys.map((k) => {
    const row = ALLOW.ROWS.find((r) => r.table !== 'qr' && minRoundtripPpuKey(allowRowFloorCtx(r)) === k);
    return `${k} 제품 ${minRoundtripPpu(allowRowFloorCtx(row))} ≥ 잰 ${ALLOW.MEASURED_FLOORS[k]}`;
  });
  t.diagnostic(margins.join(' · '));
});

test('① qr 행은 하한 키가 없고, 하한 대상 행은 늘 문맥이 있다 · 실효 타입 → 생성기 타입은 cellShapeTypeOf 의 역이다', () => {
  for (const row of ALLOW.ROWS) {
    const ctx = allowRowFloorCtx(row);
    if (row.table === 'qr') assert.equal(ctx, null, 'qr 행에 하한 문맥이 생겼다');
    else assert.ok(ctx && typeof ctx.type === 'string', `하한 문맥 없음: ${JSON.stringify(row)}`);
  }
  // 역 사상의 성질: 생성기 타입은 GENERATOR_TYPES 안이고, 그 생성기 타입에서 cellShapeTypeOf 가 그 실효 타입을 낼 수 있다(유도 입력으로).
  const probes = [[{}, {}], [{ notchC: true }, {}], [{}, { innerSeat: 'o-cm' }], [{}, { turnA: true }]];
  for (const [eff, gen] of Object.entries(CELL_SHAPE_GENERATOR_TYPE_OF)) {
    assert.ok(GENERATOR_TYPES.includes(gen), `${eff} → ${gen}: 생성기 타입이 아니다`);
    assert.ok(probes.some(([e, s]) => cellShapeTypeOf(gen, e, s) === eff), `${gen} 에서 실효 타입 ${eff} 가 안 나온다`);
  }
  // 표의 oak 행 실효 타입은 전부 역 사상에 있다(G · C → O, V → A 포함 — 없으면 ① 이 no-floor-ctx 로 빨개진다).
  for (const type of new Set(ALLOW.ROWS.filter((r) => r.table === 'oak').map((r) => r.type))) {
    assert.ok(Object.prototype.hasOwnProperty.call(CELL_SHAPE_GENERATOR_TYPE_OF, type), `실효 타입 ${type}`);
  }
});

test('③ Y 행의 하한 키 = 내보내기 경로 모양(버전 · 레이아웃)의 하한 키 — n 과 버전이 같은 키로 간다', () => {
  let n = 0;
  for (const row of ALLOW.ROWS.filter((r) => r.table === 'y')) {
    const ctx = allowRowFloorCtx(row);
    const exportShape = { type: 'Y', version: versionForFinalN(ctx.n), cellSurfaceLayout: ctx.cellSurfaceLayout };
    assert.equal(minRoundtripPpuKey(ctx), minRoundtripPpuKey(exportShape), `y 행 ${JSON.stringify(row)}`);
    assert.equal(minRoundtripPpu(ctx), minRoundtripPpu(exportShape));
    n += 1;
  }
  assert.ok(n > 0, 'y 행이 없다 — 자가 비었다');
});

test('④ 판정 함수 판별력 — 심은 결함 표마다 그 결함이 각각 잡힌다(하한 올림 · 키 빠짐 · 행 없는 키 · 모르는 실효 타입 · 값 도메인)', () => {
  const keys = Object.keys(ALLOW.MEASURED_FLOORS);
  assert.ok(keys.length > 0);
  const with_ = (floors, rows = ALLOW.ROWS) => ({ ROWS: rows, MEASURED_FLOORS: floors });
  // 하한 올림 — 제품 하한보다 0.5 높은 잰 하한(키마다 따로): below-measured 가 그 키 하나로만 잡힌다.
  for (const key of keys) {
    const row = ALLOW.ROWS.find((r) => r.table !== 'qr' && minRoundtripPpuKey(allowRowFloorCtx(r)) === key);
    const raised = { ...ALLOW.MEASURED_FLOORS, [key]: minRoundtripPpu(allowRowFloorCtx(row)) + 0.5 };
    const p = floorProblems(with_(raised));
    assert.deepEqual(p.map((x) => `${x.kind}:${x.key}`), [`below-measured:${key}`], `하한 올림 ${key}`);
  }
  // 키 빠짐 — 그 키의 행 전부가 missing-key 로(다른 종류 없음).
  const { [keys[0]]: _gone, ...less } = ALLOW.MEASURED_FLOORS;
  const pm = floorProblems(with_(less));
  assert.deepEqual(kindsOf(pm), ['missing-key']);
  assert.ok(pm.every((x) => x.key === keys[0]) && pm.length > 0, '빠진 키의 행만 잡혀야 한다');
  // 행 없는 키(생성기 철자 어긋남 흉내 — 예 'G:2' 는 제품 키가 아니다: 실효 G 는 O 로 간다).
  assert.deepEqual(floorProblems(with_({ ...ALLOW.MEASURED_FLOORS, 'G:2': 8.5 })).map((x) => `${x.kind}:${x.key}`), ['stale-key:G:2']);
  // 모르는 실효 타입 행 — 하한 문맥 없음.
  const oakRow = ALLOW.ROWS.find((r) => r.table === 'oak');
  const alien = { ...oakRow, type: 'Z' };
  assert.deepEqual(kindsOf(floorProblems(with_(ALLOW.MEASURED_FLOORS, [...ALLOW.ROWS, alien]))), ['no-floor-ctx']);
  // 값 도메인 — 0 · 음수 · 문자열은 bad-value(제품 하한 ≥ 그 값이라 below-measured 로는 안 잡힌다).
  for (const bad of [0, -1, '9', Number.NaN]) {
    assert.ok(kindsOf(floorProblems(with_({ ...ALLOW.MEASURED_FLOORS, [keys[0]]: bad }))).includes('bad-value'), `값 ${String(bad)}`);
  }
  // export 가 없으면 크게 멈춘다.
  assert.deepEqual(floorProblems({ ROWS: ALLOW.ROWS }), [{ kind: 'no-export' }]);
});
