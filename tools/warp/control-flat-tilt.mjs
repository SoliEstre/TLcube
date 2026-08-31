// 🔴 대조군 — 「yaw/pitch ±10° 실패」가 **기하** 탓인가 **재료** 탓인가.
//
// 왜 필요한가:
//   축 사다리가 yaw·pitch ±10° 에서 전멸했다. 그런데 실기 사진은 손각도가
//   있는데도 복호에 성공한다 — 10° 이내였을 리 없다. 둘 중 하나가 틀렸다.
//
//   해소 가설: **평면 인쇄 코드를 기울이는 것**과 **3D 큐브를 회전시키는 것**은
//   기하가 다르다. 앞은 단일 평면 호모그래피, 뒤는 세 면이 각각 다르게 변형된다
//   (설계 전제(세 면이 서로 다른 평면이다)). 그렇다면 축 사다리 결과는 그 전제를 실측으로 확인한 것이다.
//
//   경합 가설: v0 재료가 **한계에 걸쳐** 있어서 중립에서만 겨우 읽히고 무슨 왜곡이든
//   조금만 주면 죽는다. 그러면 ±10° 실패는 기하와 무관하고 축 사다리 전체가 무의미하다.
//
// 이 대조군이 둘을 가른다: **같은 v0 재료 · 같은 디코더**로
//   (A) 평면 2.5D 렌더 + 카메라 기울기(단일 호모그래피)
//   (B) 3D 큐브 회전 (축 사다리가 이미 잰 것)
// (A) 가 ≫10° 를 버티면 재료는 멀쩡하고 문제는 기하다.
import { encodeY } from '../../src/encodeY.js';
import { buildSceneY } from '../../src/sceneY.js';
import { getPreset, DEFAULT_PRESET, BULLSEYE_DARK, BULLSEYE_LIGHT } from '../../src/luminance.js';
import { rasterize } from '../../src/raster.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import { cameraTiltImage } from '../../test/harness/distort.mjs';

const PAYLOAD = 'https://tl.estre.so';
const PPU = 17;
const MARGIN = 4;
const P = getPreset(DEFAULT_PRESET);
const encoded = encodeY(PAYLOAD, { cellSurfaceLayout: 'v0', tones: 3, eccLevel: 'M' });
const PALETTE = {
  background: P.background, levels: P.levels,
  bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
};

function judge(raster) {
  try {
    const d = decodeFrontend({ width: raster.width, height: raster.height, pixels: raster.pixels }, {});
    if (d && d.ok) return String(d.text) === PAYLOAD ? 'ok' : `wrong(${String(d.text).length})`;
    return String((d && (d.reason || d.code)) || 'fail');
  } catch (e) { return `throw:${e.message.slice(0, 34)}`; }
}

// **정본 렌더 경로**를 쓴다 — 뷰어 mesh 가 아니라 sceneY. 이게 실제로 인쇄·내보내기되는 상이다.
const scene = buildSceneY(encoded, { palette: PALETTE, margin: MARGIN });
const flat = rasterize(scene, { pixelsPerUnit: PPU, supersample: 2 });

const base = judge(flat);
console.log(`기준선 (평면 정본 렌더, 기울기 0): ${base}`);
if (base !== 'ok') {
  console.log('❌ 평면 기준선조차 안 읽힌다 — 재료가 문제다. 축 사다리 해석을 보류하라.');
  process.exit(1);
}

const AXES = ['horizontal', 'vertical', 'diagonal'];
const DEGS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50];
console.log('\n── (A) 평면 정본 렌더 + 카메라 기울기 (단일 호모그래피) ──');
const limits = {};
for (const axis of AXES) {
  const row = [];
  let last = null;
  for (const deg of DEGS) {
    let v;
    try {
      const tilted = cameraTiltImage(flat, deg, { axis, fill: { ...P.background, a: 255 } });
      v = judge(tilted);
    } catch (e) { v = `skip:${e.message.slice(0, 20)}`; }
    row.push(`${deg}°${v === 'ok' ? '✓' : '✗'}`);
    if (v === 'ok') last = deg;
  }
  limits[axis] = last;
  console.log(`  ${axis.padEnd(11)} ${row.join(' ')}   → 마지막 성공 ${last}°`);
}

console.log('\n── 판정 ──');
const best = Math.max(...Object.values(limits).map((v) => (v === null ? -1 : v)));
console.log(`(A) 평면 기울기 한계: ${JSON.stringify(limits)}  (최대 ${best}°)`);
console.log('(B) 큐브 회전 한계 (축 사다리 실측): yaw 0° · pitch 0° — ±10° 부터 전멸');
if (best >= 15) {
  console.log(`\n⇒ **기하가 원인이다.** 같은 재료가 평면 기울기는 ${best}° 까지 버티는데`);
  console.log('   큐브 회전은 10° 에서 죽는다. 재료 취약이 아니라 «세 면이 서로 다른');
  console.log('   평면» 이라는 설계 전제(세 면이 서로 다른 평면이다)가 실측으로 확인됐다.');
} else if (best <= 5) {
  console.log(`\n⇒ **재료가 취약하다.** 평면 기울기조차 ${best}° 에서 죽는다.`);
  console.log('   축 사다리의 한계선은 기하가 아니라 재료를 잰 것이므로 해석을 보류해야 한다.');
} else {
  console.log(`\n⇒ 갈리지 않는다 (평면 ${best}°). 둘 다 좁아 원인을 단정할 수 없다 —`);
  console.log('   재료를 정본 인코더 산출물(파인더·disc 포함)로 바꿔 다시 재야 한다.');
}
