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
 *
 * **음영 레이어** (`scene.shading`, 선택 — `src/shading.js`): `<defs>` 의
 * `<linearGradient>` 로 내고 도형 뒤에 폴리곤을 얹는다. 없으면 defs 도 폴리곤도 아예
 * 안 나가므로 종전 산출물이 바이트 동일하게 유지된다. 래스터 백엔드는 같은 선형
 * 그라데이션 정의를 명령형으로 구현하고, 둘의 일치는 test/shading.test.js 가 표본으로 잰다.
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

/**
 * {r,g,b} 8bit → #rrggbb.
 *
 * 투명은 여기서 표현하지 않는다 — scene.background === null 은 호출자가 **rect 를 아예
 * 내지 않는** 방식으로 처리하고, shape.color 에는 투명 자체가 없다. null 이 들어오면
 * `c.r` 이 «reading 'r'» 로 터지면서 어디서 왔는지를 감추므로 이름을 붙여 던진다
 * (2026-08-12 라이브 결함: 중앙 3톤 큐브 슬롯칠이 투명 배경색을 그대로 물고 왔다).
 */
export function colorToHex(c) {
  if (c === null || typeof c !== 'object') {
    throw new TypeError(`색은 {r,g,b} 객체여야 한다: ${c} — 투명은 배경에서만 표현한다`);
  }
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

  // 음영 띠(scene.shading) — 없으면 defs 자체를 안 낸다. 이 «없으면 아무것도 안 낸다» 가
  // 종전 산출물의 바이트 동일성을 지킨다 (결정성 핀이 SVG 전문에 걸려 있다).
  const shading = Array.isArray(scene.shading) && scene.shading.length > 0
    ? scene.shading : null;

  const lines = [];
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${pxW}" height="${pxH}" `
    + `viewBox="0 0 ${n(scene.width)} ${n(scene.height)}">`,
  );
  if (shading !== null) {
    // id 는 인덱스 기반 고정 문자열이라 결정적이다. `tlsh` 접두는 삽입 대상 문서의
    // 기존 id 와 부딪히지 않게 하려는 것 (SVG 를 다른 문서에 붙여 넣는 사용이 있다).
    lines.push('<defs>');
    for (let i = 0; i < shading.length; i += 1) {
      const g = shading[i].gradient;
      const fill = colorToHex(shading[i].color);
      lines.push(
        `<linearGradient id="tlsh${i}" gradientUnits="userSpaceOnUse" `
        + `x1="${n(g.x1)}" y1="${n(g.y1)}" x2="${n(g.x2)}" y2="${n(g.y2)}">`
        + `<stop offset="0" stop-color="${fill}" stop-opacity="${num(g.a1, 4)}"/>`
        + `<stop offset="1" stop-color="${fill}" stop-opacity="${num(g.a2, 4)}"/>`
        + '</linearGradient>',
      );
    }
    lines.push('</defs>');
  }
  // 투명 배경(scene.background === null)은 배경 rect 자체를 내지 않는다 —
  // fill="none" 이 아니라 **요소 부재**여야 편집기·브라우저 어디서도 투명이다.
  if (scene.background !== null) {
    lines.push(
      `<rect x="0" y="0" width="${n(scene.width)}" height="${n(scene.height)}" `
      + `fill="${colorToHex(scene.background)}"/>`,
    );
  }

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

  // 음영은 **맨 위**다. 셀과 교차가 0 이라(shading.js 계약) 위에 놓아도 데이터를 못
  // 가리고, 투명 배경으로 내보내면 이 레이어가 남아 삽입 배경 위에 그대로 얹힌다.
  // stroke 를 안 준다 — 심 커버는 인접 동일색 도형용이고, 여기 stroke 를 주면 그
  // 선만 그라데이션 없이 진하게 남는다.
  if (shading !== null) {
    for (let i = 0; i < shading.length; i += 1) {
      const pts = shading[i].points.map((p) => `${n(p.x)},${n(p.y)}`).join(' ');
      lines.push(`<polygon points="${pts}" fill="url(#tlsh${i})"/>`);
    }
  }

  lines.push('</svg>');
  return `${lines.join('\n')}\n`;
}
