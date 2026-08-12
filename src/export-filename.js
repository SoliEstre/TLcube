// export-filename.js — 다운로드 파일명 규약 (브라우저 의존 없음)
//
// 생성물이 여러 번 저장될 때 운영체제의 중복 파일명 확인창을 피하면서, 파일명 자체가
// 실험 라벨이 되도록 한다. 렌더 바이트의 결정성 계약과는 별개로, 이 모듈은 사용자가
// 저장하는 순간의 로컬 시각과 페이지 안의 순번을 소비한다.

const FORBIDDEN_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001f]+/g;
const NON_PORTABLE_FILENAME_CHARS = /[^A-Za-z0-9._-]+/g;
const WINDOWS_RESERVED_BASENAMES = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
]);

function pad2(value) {
  return String(value).padStart(2, '0');
}

/** 사용자의 로컬 시각을 파일 시스템 안전한 `YYYYMMDD_HHMMSS`로 만든다. */
export function formatExportTimestamp(date) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) {
    throw new TypeError('유효한 Date가 필요하다');
  }
  return String(date.getFullYear())
    + pad2(date.getMonth() + 1)
    + pad2(date.getDate())
    + '_'
    + pad2(date.getHours())
    + pad2(date.getMinutes())
    + pad2(date.getSeconds());
}

/**
 * Windows·macOS·Linux 어디에서도 안전하게 쓸 짧은 파일명 조각.
 * 파일 시스템마다 해석이 갈리는 공백·제어문자·예약명도 제거해 다운로드명을 이식 가능하게 한다.
 */
export function sanitizeExportFilenamePart(value, fallback = 'code') {
  const cleaned = String(value === undefined || value === null ? '' : value)
    .normalize('NFKD')
    .replace(FORBIDDEN_FILENAME_CHARS, '-')
    .replace(NON_PORTABLE_FILENAME_CHARS, '-')
    .replace(/[-_.]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const safe = cleaned || fallback;
  return WINDOWS_RESERVED_BASENAMES.has(safe.toUpperCase()) ? `${safe}-file` : safe;
}

function safeExtension(extension) {
  return sanitizeExportFilenamePart(String(extension || '').replace(/^\.+/, ''), 'bin');
}

/**
 * 동일 초·동일 실험 라벨에서 이어지는 저장은 `_02`, `_03` …을 붙인다.
 * 확장자가 달라도 같은 stem은 순번을 공유해 PNG와 SVG를 연달아 눌러도 이름이 겹치지 않는다.
 */
export function createExportFilenameFactory(now = () => new Date()) {
  if (typeof now !== 'function') throw new TypeError('now는 함수여야 한다');
  const countsByStem = new Map();

  return function nextExportFilename({ extension, type, version, finder } = {}) {
    const timestamp = formatExportTimestamp(now());
    const stem = [
      'TLcube',
      timestamp,
      sanitizeExportFilenamePart(type, 'code'),
      sanitizeExportFilenamePart(version, 'v'),
      'finder-' + sanitizeExportFilenamePart(finder, 'default'),
    ].join('_');
    const count = (countsByStem.get(stem) || 0) + 1;
    countsByStem.set(stem, count);
    const ordinal = count === 1 ? '' : '_' + String(count).padStart(2, '0');
    return `${stem}${ordinal}.${safeExtension(extension)}`;
  };
}
