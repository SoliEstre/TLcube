/**
 * svg.js — scene → SVG 문자열 직렬화 (SPEC §8 내보내기, T10)
 *
 * 결정성이 계약이다 (M0 완료 기준: 동일 입력 → 바이트 동일). 그래서:
 * - 좌표는 전부 toFixed(4) 고정 소수 표기 + `-0.0000` 정규화. 부동소수의
 *   17자리 가변 표기(String())를 쓰지 않는다.
 * - 속성 순서·공백·개행을 코드가 완전히 고정한다. 직렬화 라이브러리 없음.
 * - scene.shapes 의 painter 순서를 그대로 문서 순서로 옮긴다 — 렌더 백엔드
 *   (canvas / 래스터 / SVG) 간 시각 동일성은 scene 이 단일 진실이라서 성립한다.
 *
 * 인접 마름모 사이 안티에일리어싱 헤어라인 심(seam)은 canvas 백엔드와 같은
 * 방식(동일색 얇은 스트로크 중첩)으로 막는다.
 */

const SEAM_STROKE_WIDTH = 0.03;

/**
 * 고정 소수 좌표 표기. 부호 있는 0("-0.0000")을 0 으로 정규화한다 (결정성·비교 안정).
 * 주의: `(-0).toFixed(4)` 는 "0.0000" 이라 -0 리터럴과 비교하는 가드는 죽은 코드다 —
 * 실제로 새는 것은 음의 극소값(예: margin 0 에서 경계 꼭짓점 x = -2.2e-16)이 반올림된
 * "-0.0000" 이므로, 반올림 **결과 문자열**의 부호를 본다 (T9 검증 라운드 발견).
 */
function num(n, precision) {
  const s = n.toFixed(precision);
  return Number(s) === 0 && s.startsWith('-') ? s.slice(1) : s;
}

function hex2(v) {
  return v.toString(16).padStart(2, '0');
}

/** {r,g,b} 8bit → #rrggbb. */
export function colorToHex(c) {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
}

/**
 * scene → 완결된 SVG 문서 문자열.
 *
 * @param {object} scene buildScene() 산출물
 * @param {{pixelsPerUnit?: number, precision?: number}} [options]
 *   pixelsPerUnit 은 width/height 픽셀 속성에만 쓰인다 — 좌표계는 scene 단위
 *   viewBox 그대로라 확대·축소에 무손실이다.
 * @returns {string}
 */
export function sceneToSvg(scene, options = {}) {
  const ppu = options.pixelsPerUnit === undefined ? 24 : options.pixelsPerUnit;
  const precision = options.precision === undefined ? 4 : options.precision;
  if (!Number.isFinite(ppu) || ppu <= 0) {
    throw new RangeError(`pixelsPerUnit 은 유한한 양수여야 한다: ${ppu}`);
  }
  if (!Number.isInteger(precision) || precision < 1 || precision > 8) {
    throw new RangeError(`precision 은 1..8 정수여야 한다: ${precision}`);
  }
  const n = (v) => num(v, precision);
  const pxW = Math.round(scene.width * ppu);
  const pxH = Math.round(scene.height * ppu);

  const lines = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${pxH}" `
    + `viewBox="0 0 ${n(scene.width)} ${n(scene.height)}">`,
  );
  lines.push(
    `<rect x="0" y="0" width="${n(scene.width)}" height="${n(scene.height)}" `
    + `fill="${colorToHex(scene.background)}"/>`,
  );

  for (const s of scene.shapes) {
    const fill = colorToHex(s.color);
    if (s.kind === 'polygon') {
      const pts = s.points.map((p) => `${n(p.x)},${n(p.y)}`).join(' ');
      // stroke-width 는 좌표 precision 과 무관하게 고정 표기 — precision 1 에서
      // num(0.03, 1) = "0.0" 이 되어 심 커버가 소멸하는 코너를 막는다 (검증 라운드 발견).
      lines.push(
        `<polygon points="${pts}" fill="${fill}" stroke="${fill}" `
        + `stroke-width="${SEAM_STROKE_WIDTH}" stroke-linejoin="round"/>`,
      );
    } else if (s.kind === 'disc') {
      lines.push(`<circle cx="${n(s.cx)}" cy="${n(s.cy)}" r="${n(s.r)}" fill="${fill}"/>`);
    } else {
      throw new RangeError(`알 수 없는 shape kind: ${s.kind}`);
    }
  }

  lines.push('</svg>');
  return `${lines.join('\n')}\n`;
}
