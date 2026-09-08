import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createScannerR2Runtime, r2ExpansionDebugLine, R2_EXPANSION_SETTINGS, R2_EXPANSION_CAPABILITIES } from '../src/r2-expansion-engine.js';
import { R2_CAPABILITIES } from '../src/r2-scan-runtime.js';
import { scanScopeCopyKey } from '../src/scanner-scan-assist.js';
import { SCANNER_STRINGS } from '../sites/tlscan/strings.js';
import { listLumaSequences, readLumaDump } from '../tools/read-luma.mjs';

test('정식 팩토리는 기존 Y 런타임만 반환하고 시험판만 확장 소켓을 가진다', () => {
  const stable = createScannerR2Runtime({ enabled: true });
  assert.equal(stable.enabled, true);
  assert.equal('expansionStats' in stable, false);
  assert.deepEqual(R2_CAPABILITIES.accumulatesFamilies, ['Y']);
  const trial = createScannerR2Runtime({ enabled: false, trial: true });
  assert.ok(trial.expansionStats); assert.ok(trial.cStats); assert.ok(trial.cubeYStats);
  assert.deepEqual(R2_EXPANSION_CAPABILITIES.accumulatesFamilies, ['Y', 'C']);
  assert.equal(R2_EXPANSION_CAPABILITIES.trialOnly, true);
  const field = { width: 16, height: 16, data: new Float32Array(256) };
  assert.equal(trial.pushFrame(field, 0), null);
  assert.equal(trial.stats.frames, 0); assert.equal(trial.cStats.frames, 0); assert.equal(trial.cubeYStats.frames, 0);
});

test('8언어 안내는 실제 시험판 확장과 QR 런타임 가용 여부를 구별한다', () => {
  assert.equal(scanScopeCopyKey(false, true, true), 'guide.tlcubeOnly');
  assert.equal(scanScopeCopyKey(true, true, false), 'guide.scope.r2qr');
  assert.equal(scanScopeCopyKey(true, false, false), 'guide.scope.r2');
  assert.equal(scanScopeCopyKey(true, true, true), 'guide.scope.r2expandedQr');
  assert.equal(scanScopeCopyKey(true, null, true), 'guide.scope.r2expanded');
  assert.equal(Object.keys(SCANNER_STRINGS).length, 8);
  for (const strings of Object.values(SCANNER_STRINGS)) {
    for (const key of ['guide.scope.r2expandedQr', 'guide.scope.r2expanded']) {
      assert.equal(typeof strings[key], 'string');
      assert.ok(strings[key].includes('Y') && strings[key].includes('C'));
    }
  }
  const source = readFileSync(new URL('../sites/tlscan/scanner.js', import.meta.url), 'utf8');
  assert.match(source, /const r2Expanded = isLabPath\(\);/);
  assert.match(source, /createScannerR2Runtime\(\{ enabled: r2Available && r2Wanted, trial: r2Expanded \}\)/);
  assert.match(source, /scanScopeCopyKey\(r2Runtime\.enabled, qrBridge\.supported, r2Expanded\)/);
});

test('추가 서비스 진단은 실제 총 후보와 시간/soft 초과를 별도 한 줄로 보여준다', () => {
  assert.equal(r2ExpansionDebugLine(null), '');
  const line = r2ExpansionDebugLine({ totalCandidateCount: 8, cCandidateCount: 2, cubeYCandidateCount: 1,
    lastYMs: 12, lastCMs: 30, lastCubeYMs: 8, lastAdditionalMs: 38 });
  assert.match(line, /K8 C2 Y3D1/); assert.match(line, /12\.0\/30\.0\/8\.0ms/); assert.match(line, /soft\+6\.0ms/);
  assert.equal(line.includes('\n'), false); assert.ok(line.length < 126);
});

for (const [name, expectedFrame] of [['y0', 6], ['y1', 5], ['y2', 4]]) {
  test(`실제 ${name} 첫 수용 프레임은 확장 팩토리에서도 f${expectedFrame} 그대로다`, () => {
    const seq = listLumaSequences().find(row => row.name.split('/').pop() === name);
    assert.ok(seq && seq.frames.length > expectedFrame, '로컬 회귀에 필요한 실제 시퀀스가 없어요');
    const runtime = createScannerR2Runtime({ enabled: true, trial: true });
    let hit = null;
    for (let frame = 0; frame <= expectedFrame; frame++) {
      hit = runtime.pushFrame(readLumaDump(seq.frames[frame].path), frame * 100);
      if (hit) break;
      assert.ok(runtime.expansionStats.totalCandidateCount <= R2_EXPANSION_SETTINGS.maxCandidates);
      assert.equal(runtime.cStats.lastError, null);
      assert.equal(runtime.cubeYStats.lastError, null);
    }
    assert.ok(hit, '기존 Y의 첫 수용 시점을 늦췄어요');
    assert.equal(hit.frame, expectedFrame);
    assert.equal(hit.text, 'https://tl.estre.so');
    assert.equal(runtime.expansionStats.lastWinner, 'Y');
    assert.ok(runtime.hudCandidates.some(row => row.id === hit.candidateId));
  });
}
