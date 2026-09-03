// miscorrection.test.js — isMiscorrectionSuspect

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { isMiscorrectionSuspect } from '../src/decoder/bootstrap.js';

describe('isMiscorrectionSuspect', () => {
  test('{text:\'\', corrected:5} → true', () => {
    assert.equal(isMiscorrectionSuspect({ text: '', corrected: 5 }), true);
  });

  test('{text:\'\', corrected:0} → false (정당한 빈 코드)', () => {
    assert.equal(isMiscorrectionSuspect({ text: '', corrected: 0 }), false);
  });

  test('{text:\'x\', corrected:99} → false', () => {
    assert.equal(isMiscorrectionSuspect({ text: 'x', corrected: 99 }), false);
  });

  test('null → false', () => {
    assert.equal(isMiscorrectionSuspect(null), false);
  });
});
