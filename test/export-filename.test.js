import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createExportFilenameFactory, formatExportTimestamp, sanitizeExportFilenamePart,
} from '../src/export-filename.js';

const SAME_SECOND = new Date(2026, 7, 12, 11, 20, 58);

test('파일명은 TLcube_날짜_시간_간략내용 형식이며 파일 시스템 금지문자를 남기지 않는다', () => {
  assert.equal(formatExportTimestamp(SAME_SECOND), '20260812_112058');
  assert.equal(sanitizeExportFilenamePart('center<>:"/\\|?*\u0000qr'), 'center-qr');
  assert.equal(sanitizeExportFilenamePart('CON'), 'CON-file');

  const next = createExportFilenameFactory(() => SAME_SECOND);
  const filename = next({
    extension: 'png', type: 'Y', version: '1T', finder: 'center<>:"/\\|?*qr',
  });
  assert.equal(filename, 'TLcube_20260812_112058_Y_1T_finder-center-qr.png');
  assert.doesNotMatch(filename, /[<>:"/\\|?*\u0000-\u001f]/);
});

test('같은 초에 PNG와 SVG를 연달아 저장해도 파일명이 겹치지 않는다', () => {
  const next = createExportFilenameFactory(() => SAME_SECOND);
  const first = next({ extension: 'png', type: 'O', version: '2', finder: 'bullseye' });
  const second = next({ extension: 'svg', type: 'O', version: '2', finder: 'bullseye' });
  const third = next({ extension: 'png', type: 'O', version: '2', finder: 'bullseye' });

  assert.equal(first, 'TLcube_20260812_112058_O_2_finder-bullseye.png');
  assert.equal(second, 'TLcube_20260812_112058_O_2_finder-bullseye_02.svg');
  assert.equal(third, 'TLcube_20260812_112058_O_2_finder-bullseye_03.png');
  assert.equal(new Set([first, second, third]).size, 3);
});
