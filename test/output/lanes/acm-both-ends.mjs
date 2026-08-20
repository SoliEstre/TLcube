// A-CM 의 «양 끝» 이 같은 표를 보는가 — 생성기가 그린 것을 fallback 검출기가 읽는가.
//
// 정상 경로(앵커 생존)는 formatIndex 로 읽으므로 이 파일이 재는 것이 아니다.
// `cornerMarkerHypotheses` 는 `NO_ANCHORS` 일 때만 도는 fallback 이라 합성 왕복
// 테스트가 안 건드린다 — 그래서 조용히 어긋날 수 있다. 여기서 직접 부른다.
import { encodeA } from '../../../src/encodeA.js';
import { buildScene } from '../../../src/scene.js';
import { rasterize } from '../../../src/raster.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { findACornerMarkerHypotheses } from '../../../src/decoder/corner-marker-detect.js';
import { markerCellsA } from '../../../src/markerA.js';
import { getPreset, DEFAULT_PRESET, BULLSEYE_DARK, BULLSEYE_LIGHT } from '../../../src/luminance.js';

const preset = getPreset(DEFAULT_PRESET);
const palette = { background: preset.background, levels: preset.levels,
  bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT };

const PPU = 14;
for (const version of [0, 1, 2]) {
  const encoded = encodeA('TLcube-both-ends', { version, eccLevel: 'M', cornerMarker: true });
  const k = encoded.k;

  // ① 생성기가 마커 셀에 톤을 실었는가
  const markerEntries = [...encoded.cellDigits.values()].filter((v) => v.role === 'marker');
  const withTones = markerEntries.filter((v) => v.tones).length;

  // ② 렌더 → fallback 검출기
  const scene = buildScene(encoded, { palette, margin: 20 });
  const raster = rasterize(scene, { pixelsPerUnit: PPU, supersample: 2 });
  const luma = toRelativeLuminance(raster);
  const cx = luma.width / 2;
  const cy = luma.height / 2;
  const bullseye = { center: { x: cx, y: cy }, cellSize: PPU };
  let found = null;
  try {
    const res = findACornerMarkerHypotheses(luma, bullseye, [k], {});
    found = Array.isArray(res) ? res : (res && res.hypotheses) || null;
  } catch (err) {
    found = 'ERR ' + err.message;
  }
  const n = Array.isArray(found) ? found.length : found;
  const best = Array.isArray(found) && found.length
    ? found.map((h) => (h.agreement ?? h.verification?.agreement ?? '?')).join(',') : '—';
  console.log(
    'A' + version + 'CM  k=' + k
    + ' · 마커셀 ' + markerEntries.length + ' (톤 실림 ' + withTones + ')'
    + ' · 기대 21 = ' + markerCellsA(k).length
    + ' · fallback 가설 ' + n + ' · agreement ' + best,
  );
}
