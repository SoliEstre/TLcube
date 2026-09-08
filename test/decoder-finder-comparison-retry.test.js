/**
 * finder 비교 재시도는 실제로 finder 탐색을 생략한 cube 양성 경로만 복구해야 한다.
 *
 * 이 자는 제품 함수 본문을 그대로 실행한다. 광학 후보 생성과 포맷/본문 검증만
 * 결정론적 stub으로 바꿔, 재귀 제어흐름과 옵션 전달을 작고 빠르게 격리한다.
 * `TLCUBE_RETRY_GUARD_MUTANT=old`는 새 cause 절을 제거한 이전 guard를 실행한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const BOOTSTRAP_SOURCE = readFileSync(
  new URL('../src/decoder/bootstrap.js', import.meta.url),
  'utf8',
);

function enumerateFunctionSource(source) {
  const declaration = 'export function enumerateGridHypotheses';
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, 'enumerateGridHypotheses 선언을 찾지 못했다');

  const nextSection = source.indexOf(' * 중앙 QR 기하 진입점.', start);
  assert.notEqual(nextSection, -1, 'enumerateGridHypotheses 다음 섹션을 찾지 못했다');
  const end = source.lastIndexOf('}', nextSection);
  assert.ok(end > start, 'enumerateGridHypotheses 본문의 끝을 찾지 못했다');

  return source.slice(start, end + 1).replace('export function', 'function');
}

function selectedFunctionSource() {
  const current = enumerateFunctionSource(BOOTSTRAP_SOURCE);
  if (process.env.TLCUBE_RETRY_GUARD_MUTANT !== 'old') return current;

  const oldGuard = current.replace(
    /\r?\n\s*&& geometry\.diagnostics\?\.finderFailure\?\.detail\?\.cause === 'cube-positive-independent-path';/,
    ';',
  );
  assert.notEqual(oldGuard, current, 'old-guard 변이가 적용되지 않았다');
  return oldGuard;
}

function compileEnumerate(dependencies) {
  const names = Object.keys(dependencies);
  const values = Object.values(dependencies);
  return Function(
    ...names,
    `${selectedFunctionSource()}\nreturn enumerateGridHypotheses;`,
  )(...values);
}

function runControlFlow({ diagnostics, retryOutcome = 'fail', options = {} }) {
  const geometryCalls = [];
  let validationCalls = 0;

  const enumerateGridHypotheses = compileEnumerate({
    withStage: (_options, _stage, operation) => operation(),
    enumerateGeometryHypotheses: (_luma, _familyEvidence, callOptions) => {
      geometryCalls.push({ ...callOptions });
      return {
        ok: true,
        hypotheses: [{ family: 'tri', source: 'mock-grid' }],
        diagnostics: geometryCalls.length === 1
          ? diagnostics
          : { finderSource: 'mock-forced-comparison' },
      };
    },
    validateGridHypotheses: () => {
      validationCalls += 1;
      if (validationCalls === 2 && retryOutcome === 'success') {
        return {
          ok: true,
          candidates: [{ hypothesisId: 'mock-rescued' }],
          diagnostics: { mockValidation: 'success' },
        };
      }
      return {
        ok: false,
        reason: 'mock-no-valid-grid',
        detail: { diagnostics: { formatFailures: [] } },
      };
    },
    exhaustiveCubeFamilyOptions: (value) => value,
    recastHypothesesByFormat: () => [],
    relocationTargets: () => ({ families: [], evidence: [] }),
    summarizeFormatFailures: () => ({ clipEvidenceDominates: false }),
    recastCentralBeaconCandidates: () => null,
    FRONTEND_FAILURE: {
      SYMBOL_CLIPPED: 'symbol-clipped',
      NO_GRID_HYPOTHESIS: 'no-grid-hypothesis',
    },
    fail: (reason, detail) => ({ ok: false, reason, detail }),
    ok: (value) => ({ ok: true, ...value }),
  });

  const result = enumerateGridHypotheses(
    { width: 8, height: 8 },
    { family: 'tri' },
    {
      _cubeAlternativeRetry: false,
      _familyRelocation: false,
      _formatRecast: false,
      ...options,
    },
  );
  return { result, geometryCalls, validationCalls };
}

const CUBE_POSITIVE_SKIP = Object.freeze({
  finderSource: 'none-cube-positive',
  finderFailure: {
    detail: { cause: 'cube-positive-independent-path' },
  },
});

test('이미 실행한 finder 실패는 none-cube-positive 라벨만으로 재시도하지 않는다', () => {
  const observed = runControlFlow({
    diagnostics: {
      finderSource: 'none-cube-positive',
      finderFailure: { detail: { cause: 'finder-search-exhausted' } },
    },
  });

  assert.equal(observed.geometryCalls.length, 1);
  assert.equal(observed.validationCalls, 1);
  assert.equal(observed.result.ok, false);
});

test('cube 양성으로 finder를 생략한 실패는 강제 비교 한 번으로 구제한다', () => {
  const observed = runControlFlow({
    diagnostics: CUBE_POSITIVE_SKIP,
    retryOutcome: 'success',
  });

  assert.equal(observed.geometryCalls.length, 2);
  assert.equal(observed.geometryCalls[1].alwaysCompareFinders, true);
  assert.equal(observed.geometryCalls[1]._finderComparisonRetry, false);
  assert.equal(observed.result.ok, true);
  assert.equal(observed.result.diagnostics.finderComparisonRetry, true);
});

test('강제 finder 비교도 실패하면 재시도는 한 번에서 멈춘다', () => {
  const observed = runControlFlow({ diagnostics: CUBE_POSITIVE_SKIP });

  assert.equal(observed.geometryCalls.length, 2);
  assert.equal(observed.validationCalls, 2);
  assert.equal(observed.result.ok, false);
});

test('_finderComparisonRetry false는 cube 양성 생략 경로도 재시도하지 않는다', () => {
  const observed = runControlFlow({
    diagnostics: CUBE_POSITIVE_SKIP,
    options: { _finderComparisonRetry: false },
  });

  assert.equal(observed.geometryCalls.length, 1);
});

test('alwaysCompareFinders true인 호출은 finder 비교를 다시 재생하지 않는다', () => {
  const observed = runControlFlow({
    diagnostics: CUBE_POSITIVE_SKIP,
    options: { alwaysCompareFinders: true },
  });

  assert.equal(observed.geometryCalls.length, 1);
});

test('central-n7-isolated-fallback은 finder 비교 재시도 대상이 아니다', () => {
  const observed = runControlFlow({
    diagnostics: {
      finderSource: 'central-n7-isolated-fallback',
      finderFailure: CUBE_POSITIVE_SKIP.finderFailure,
    },
  });

  assert.equal(observed.geometryCalls.length, 1);
});
