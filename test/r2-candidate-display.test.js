import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { candidateDisplayState } from '../src/r2-candidate-display.js';
import { confirmationRows, progressNote, r2StatusStep, R2_STATUS_ACTION, CONFIRM_STATE } from '../src/r2-confirmation-model.js';
import { hudCorrectionLatch } from '../src/r2-hud-model.js';
import { R2_INDICATOR } from '../src/r2/session.js';
import { C_FORMAT_INDEX } from '../src/formatC.js';

const stats = Object.freeze({ candidateCount: 1, lockedN: 13, progressD: .2, indicator: R2_INDICATOR.COLLECTING,
  lockDistrusted: false, candidates: [{ layoutId: 'v0', D: .2, alive: true }] });
const view = Object.freeze({ n: 13, layoutId: 'v0' });
const y = Object.freeze({ id: 'y-generation', type: 'Y', geometryMode: 'y-grid', n: 13,
  layoutId: 'v0', D: .2, indicator: R2_INDICATOR.COLLECTING, alive: true });

test('C 전 라인업은 실제 format 표의 버전/k를 표시하고 Y 버전으로 오인하지 않아요', () => {
  for (const spec of C_FORMAT_INDEX) {
    const c = { id: `c-${spec.name}`, type: 'C', geometryMode: 'c-hex', dimensionKind: 'radius-k',
      n: spec.k, k: spec.k, layoutId: spec.name, D: .6, indicator: R2_INDICATOR.COLLECTING, alive: true };
    const display = candidateDisplayState(stats, view, [y, c]);
    assert.equal(display.candidateId, c.id); assert.equal(display.family, 'C');
    const rows = confirmationRows({ ...display });
    assert.equal(rows.find(r => r.key === 'type').text, 'Type C');
    assert.equal(rows.find(r => r.key === 'version').text, `C${spec.version} (k${spec.k})`);
    assert.equal(rows.find(r => r.key === 'layout').text, spec.name);
    assert.equal(progressNote(display), `k${spec.k}·2`);
    assert.equal(r2StatusStep({ collecting: false }, display.stats, 10).action, R2_STATUS_ACTION.COLLECTING);
    assert.equal(r2StatusStep({ collecting: false, holdUntil: 20 }, display.stats, 10).action, R2_STATUS_ACTION.NONE);
    assert.equal(stats.candidateCount, 1); assert.equal(view.n, 13);
  }
});

test('C 수용 래치는 다른 Y가 남아 있어도 자기 타입/버전/정정 수를 유지해요', () => {
  const spec = C_FORMAT_INDEX.find(row => row.name === 'CQ2');
  const rows = confirmationRows({ stats, view,
    latched: { profile: 'C', layoutId: spec.name, n: spec.k, correctedCount: 3 } });
  assert.equal(rows[0].text, 'Type C'); assert.equal(rows[1].text, `C2 (k${spec.k})`);
  assert.ok(rows.every(row => row.state === CONFIRM_STATE.CONFIRMED));
  assert.equal(rows[3].correctedCount, 3);
  const invalid = confirmationRows({ latched: { profile: 'C', layoutId: spec.name, n: 13 } });
  assert.equal(invalid[1].state, CONFIRM_STATE.NONE, 'C k를 Y n으로 해석했어요');
});

test('3D Y는 Type Y를 유지하고 최대 D/보존/동률 선두가 HUD와 같아요', () => {
  const faces = { ...y, id: 'faces-generation', geometryMode: 'y-faces', D: .7, tracking: false, retained: true };
  const other = { ...y, D: .7 };
  const display = candidateDisplayState(stats, view, [other, faces], faces.id);
  assert.equal(display.candidateId, faces.id); assert.equal(display.family, 'Y');
  assert.equal(confirmationRows(display)[1].text, 'Y0 (n13)');
  const dropped = { ...faces, indicator: R2_INDICATOR.DROPPED, D: 1 };
  assert.equal(candidateDisplayState(stats, view, [other, dropped], faces.id).candidateId, other.id);
  const empty = candidateDisplayState(stats, view, []);
  assert.equal(empty.stats, stats); assert.equal(empty.view, view);
  const hidden = candidateDisplayState(stats, view, [], '', { visibleOnly: true });
  assert.equal(hidden.stats.candidateCount, 0);
  assert.equal(hidden.stats.progressD, 0);
  assert.ok(confirmationRows(hidden).every(row => row.state === CONFIRM_STATE.NONE));
});

test('정정 래치는 ID/revision 둘 다 보존하고 미공급 legacy 표면을 바꾸지 않아요', () => {
  const base = { correctedCount: 1, correctedCells: Uint16Array.of(0), layoutId: 'v0', n: 13, formatWire: 2 };
  const old = hudCorrectionLatch(base, 10);
  assert.equal(Object.hasOwn(old, 'candidateId'), false); assert.equal(Object.hasOwn(old, 'revision'), false);
  const latch = hudCorrectionLatch({ ...base, candidateId: y.id, revision: 7 }, 10);
  assert.equal(latch.candidateId, y.id); assert.equal(latch.revision, 7);
  assert.equal(latch.cells, base.correctedCells);
});

test('scanner 수용 래치와 후보 정정 소비자는 같은 revision을 연결해요', () => {
  const source = fs.readFileSync(new URL('../sites/tlscan/scanner.js', import.meta.url), 'utf8');
  const latch = source.slice(source.indexOf('r2Latched = {'), source.indexOf('r2Correction = hudCorrectionLatch'));
  assert.match(latch, /revision:\s*hit\.revision/);
  assert.match(latch, /profile:\s*hit\.profile/);
  const render = source.slice(source.indexOf('function renderCandidateR2CellMap'), source.indexOf('function renderR2CellMap'));
  assert.match(render, /candidateId:\s*r2Latched\.candidateId,\s*revision:\s*r2Latched\.revision/);
});
