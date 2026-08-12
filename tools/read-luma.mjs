/**
 * read-luma.mjs — `tools/photo-probe.html` 이 내보낸 **실사진 휘도 덤프**를 읽는다.
 *
 * 왜 있나: Node 에 JPEG 디코더가 없다. 그래서 레인(외부 CLI)은 실기기 사진으로 테스트할
 * 수 없었고, 합성 모사로만 개발하다 "합성은 고쳐졌는데 실사진은 그대로" 를 세 번 반복했다.
 * 브라우저가 canvas 로 디코드한 휘도를 raw 로 떨궈 두면, 여기서 `LumaField` 그대로 복원해
 * `detectCubeHypotheses`·`decodeFrontend` 같은 앞단에 **진짜 픽셀**을 먹일 수 있다.
 *
 * 만드는 법: dev 서버를 띄우고 `/tools/photo-probe.html` 에서 "휘도 덤프 내보내기".
 *   node tools/dev-server.mjs
 *
 * 형식(리틀엔디언): magic "TLLU" · u32 width · u32 height · u8[width*height]
 *   값은 relativeLuminance × 255 반올림. **8비트 양자화**라 미세 대비 실험엔 부적합하다.
 *
 * 사용:
 *   import { readLumaDump, listLumaDumps } from './tools/read-luma.mjs';
 *   const luma = readLumaDump('test/output/photos/luma/foo.960.luma');
 *   detectCubeHypotheses(luma, undefined, {});
 *
 * ⚠ 덤프는 `test/output/` 아래(gitignore)라 **repo 에 안 들어간다.** 없으면 위 절차로 다시 굽는다.
 */

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const LUMA_DIR = join(ROOT, 'test', 'output', 'photos', 'luma');

/**
 * 덤프 하나를 `LumaField` 로 읽는다 (`decoder/contracts.js` 의 계약과 같은 모양).
 * @param {string} path repo 루트 기준 상대경로 또는 절대경로
 * @returns {{width:number, height:number, data:Float32Array, alpha:null}}
 */
export function readLumaDump(path) {
  const absolute = path.includes(':') || path.startsWith('/') ? path : join(ROOT, path);
  if (!existsSync(absolute)) {
    throw new Error(
      `휘도 덤프가 없다: ${absolute}\n`
      + '  → node tools/dev-server.mjs 후 /tools/photo-probe.html 에서 "휘도 덤프 내보내기"',
    );
  }
  const buffer = readFileSync(absolute);
  const magic = buffer.length >= 4 ? buffer.toString('latin1', 0, 4) : '';
  const bytesPerSample = magic === 'TLL2' ? 2 : magic === 'TLLU' ? 1 : 0;
  if (bytesPerSample === 0) {
    throw new Error(`휘도 덤프 magic 이 아니다: ${absolute}`);
  }
  const width = buffer.readUInt32LE(4);
  const height = buffer.readUInt32LE(8);
  const expected = 12 + width * height * bytesPerSample;
  if (buffer.length !== expected) {
    throw new Error(
      `휘도 덤프 길이 불일치: ${buffer.length} != ${expected} (${width}x${height}, ${bytesPerSample * 8}bit)`,
    );
  }

  const data = new Float32Array(width * height);
  if (bytesPerSample === 2) {
    for (let i = 0; i < data.length; i += 1) data[i] = buffer.readUInt16LE(12 + i * 2) / 65535;
  } else {
    // 구형 8비트 덤프. Type A(tri) 앵커 경로는 이 양자화에서 실제로 깨진다 —
    // 같은 프레임이 원본 RGBA 로는 복호되는데 8비트 왕복이면 no-anchors 가 된다(실측).
    // 남아 있으면 읽어는 주되, 새로 구울 땐 16비트를 쓴다.
    for (let i = 0; i < data.length; i += 1) data[i] = buffer[12 + i] / 255;
  }
  return { width, height, data, alpha: null, bitDepth: bytesPerSample * 8 };
}

/** 선형 휘도 → sRGB 코드값. `luminance.js` 의 역변환이다. */
function srgbEncode(linear) {
  const l = linear <= 0 ? 0 : linear >= 1 ? 1 : linear;
  return l <= 0.0031308 ? l * 12.92 : 1.055 * (l ** (1 / 2.4)) - 0.055;
}

/**
 * `LumaField` → `decodeFrontend` 가 받는 **RGBA raster**.
 *
 * ⚠ **반드시 이 함수를 써라. 선형 휘도를 코드값으로 그대로 쓰면 안 된다.**
 *
 * 덤프에 든 값은 `relativeLuminance`, 즉 **선형** 휘도다. 그런데 `toRelativeLuminance` 는
 * 입력 RGBA 를 sRGB 코드값으로 보고 **다시 선형화**한다. 그래서 선형값을 그대로 바이트로
 * 넣으면 감마가 한 번 더 먹어 대비가 뭉개진다 — 실측(2026-08-11):
 *
 *     원래 L   0.05    0.20    0.50    0.80
 *     그대로   0.0040  0.0331  0.2159  0.6038   ← 6배까지 어두워진다
 *     sRGB인코딩 0.0497 0.2016  0.5029  0.7991   ← 복원된다
 *
 * 이 실수 때문에 실제로 오진이 났다: Type A 사진이 **원본 JPEG 으로는 복호되는데 덤프로는
 * 안 되는** 현상을 한동안 «8비트 양자화» 로 잘못 짚었고(16비트로 올려도 그대로였다),
 * 앵커 레인은 뭉개진 대비를 보고 "separation 이 임계값 아래" 라는 진단을 냈다.
 * 덤프로 재현이 안 되면 **먼저 이 변환을 의심하라.**
 */
export function lumaToRaster(luma) {
  const pixels = new Uint8ClampedArray(luma.width * luma.height * 4);
  for (let i = 0; i < luma.data.length; i += 1) {
    const byte = Math.round(srgbEncode(luma.data[i]) * 255);
    pixels[i * 4] = byte;
    pixels[i * 4 + 1] = byte;
    pixels[i * 4 + 2] = byte;
    pixels[i * 4 + 3] = 255;
  }
  return { width: luma.width, height: luma.height, pixels };
}

/**
 * 사용 가능한 덤프 목록. 없으면 빈 배열 — 호출부가 "덤프 없음" 을 스킵 사유로 쓸 수 있다.
 *
 * 촬영 세션 폴더(`hybrid-20260813/` 등)를 그대로 따라가므로 **재귀로 훑는다.** manifest 가
 * `photos/` 기준 상대경로를 담고 probe 가 그 경로 모양대로 덤프를 떨구기 때문이다.
 * `name` 은 LUMA_DIR 기준 상대경로이고 `/` 로 잇는다.
 */
export function listLumaDumps() {
  if (!existsSync(LUMA_DIR)) return [];
  const walk = (directory, prefix) => {
    const found = [];
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        found.push(...walk(join(directory, entry.name), `${prefix}${entry.name}/`));
      } else if (entry.name.endsWith('.luma')) {
        found.push({ name: prefix + entry.name, path: join(directory, entry.name) });
      }
    }
    return found;
  };
  return walk(LUMA_DIR, '').sort((left, right) => (left.name < right.name ? -1 : 1));
}
