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
  if (buffer.length < 12 || buffer.toString('latin1', 0, 4) !== 'TLLU') {
    throw new Error(`휘도 덤프 magic 이 아니다: ${absolute}`);
  }
  const width = buffer.readUInt32LE(4);
  const height = buffer.readUInt32LE(8);
  if (buffer.length !== 12 + width * height) {
    throw new Error(
      `휘도 덤프 길이 불일치: ${buffer.length} != ${12 + width * height} (${width}x${height})`,
    );
  }
  const data = new Float32Array(width * height);
  for (let i = 0; i < data.length; i += 1) data[i] = buffer[12 + i] / 255;
  return { width, height, data, alpha: null };
}

/** 사용 가능한 덤프 목록. 없으면 빈 배열 — 호출부가 "덤프 없음" 을 스킵 사유로 쓸 수 있다. */
export function listLumaDumps() {
  if (!existsSync(LUMA_DIR)) return [];
  return readdirSync(LUMA_DIR).filter((n) => n.endsWith('.luma')).sort()
    .map((name) => ({ name, path: join(LUMA_DIR, name) }));
}
