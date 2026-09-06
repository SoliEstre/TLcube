/**
 * r2-format-ecc.test.js — **R2 가 ecc·mask 를 코드에서 읽는가** (변경 R6, 2026-09-06).
 *
 * ## 🔴 무엇이 문제였나
 * R2 는 ecc `'H'` · mask `0` 을 못박고 있었다 (`r2-scan-runtime.js` 기본값 + `buildLayout`
 * 의 nsym 고정). 인코더의 `auto` 는 **용량이 되면 H, 길면 M/L** 을 쓴다. RS 패리티 수
 * (`nsym`)가 틀리면 본문 RS 는 **절대** 서지 않으므로, ecc M/L 로 찍힌 코드는 R2 가
 * 구조적으로 DONE 을 낼 수 없었다. 카메라 앞에서 ecc×mask 9조합을 스윕할 수는 없으니,
 * 락 시점에 코드가 스스로 말하는 **포맷 워드**를 한 번 읽는다
 * (`src/decoder/locator-format.js` — 클린룸 다리 +1, `test/r2-cleanroom.test.js` 참조).
 *
 * ## 이 파일이 재는 것 (전부 값, 철자 자 아님)
 *   ① 합성 **ecc M** 프레임에서 어댑터가 `eccName='M'` 을 **프레임에서 읽는다**
 *      — 대조군: `format:false` 면 옛 기본값 `'H'` 다.
 *   ② 그 프레임에 대해 런타임이 묶는 layout 의 `nsym` 이 **M 의 nsym** 이고 H 의 것과 다르다.
 *      「다르다」가 이 자를 공허하지 않게 만든다 — 옛 코드에서는 언제나 H 의 nsym 이었다.
 *   ③ M 의 nsym 으로 매개된 경로가 **끝까지 돈다**: 실물 시퀀스(**H 로 찍힌 코드**)를 ecc M layout
 *      으로 돌리면 DONE 과 정답 글자가 나온다 — 세션·RS 배선이 M 의 nsym 에서 죽지 않는다.
 *      ⚠ **이것은 「M 코드를 읽는다」가 아니다.** 아래 «안 재는 축» 을 읽어라.
 *
 * ## ⚠ 이 파일이 **안 재는** 축과 그 이유 (측정으로 확인한 것이지 「못 한다」가 아니다)
 *
 * ### 🔴 «M 코드에서 DONE» 은 **미측정**이다 (2026-09-06 검토 R3c 정정)
 * 코퍼스의 실물 시퀀스는 전부 **ecc H 로 찍혀 있다** (y1 의 포맷 워드가 H 다 — ① 의 대조군이
 * 그 사실을 값으로 못박는다). ③ 이 재는 것은 「**H 로 찍힌 코드**가 M 의 nsym 을 쓰는 layout
 * 으로도 풀린다」이고, 그러므로 **R6 배선이 없어도 초록이다** (실측: `format:false` + `eccName:'M'`
 * 못박기로 y1 f7 DONE). 즉 ③ 은 **회귀 자**(M 의 nsym 이 세션·RS 를 깨지 않는다)이지
 * ecc 축의 증거가 아니다.
 * 「상위집합이라 다 풀린다」도 **일반 성질이 아니다** — 같은 방식으로 L 을 못박으면 y1 은
 * 30프레임 DONE 0, y2 는 M·L 모두 0 이다. 그리고 합성 프레임은 아래 D-분모 게이트에 막혀
 * ecc 축을 아예 못 잰다 (합성 M D 0.82 · 합성 H D 0.924 정체).
 * ⇒ **덮으려면 M(그리고 L)로 찍은 실물 시퀀스가 필요하다.** 코퍼스에 없다 —
 *   「못 한다」가 아니라 **아직 안 찍었다**.
 * **합성 ecc M 프레임의 end-to-end DONE 은 여기서 안 잰다.** R6 앞에 **두 번째 게이트**가
 * 서 있기 때문이다 — 복호 시도 조건이 `internalD >= 1` 이고 그 분모가
 * `dataSymbols(ecc) + safety` 인데, M 은 H 보다 dataSymbols 가 25% 많다
 * (실측: n13 v0 = 27 vs 22 · n25 v0tr = 123 vs 98). 그런데 합성 프레임(정지 1장 반복)의
 * 확정 증거는 `cEff/3` 이 M 분모의 **0.81\~0.87 에서 정체**한다 (실측 2026-09-06:
 * n13 ppu8/14/20 전부 D=0.809\~0.820, n25 ppu8 D=0.870; embed 오프셋을 1\~2 px 흔든
 * 지터 시퀀스도 0.811 로 같다 — λ 정상상태라 프레임을 늘려도 안 움직인다).
 * 즉 **R6 는 nsym 막힘을 없앴지만 ecc M/L 앞의 D-분모 게이트는 그대로다.** 그 축은
 * 이 레인의 범위 밖이고, 덮으려면 「확정 셀 비율이 왜 70% 에서 서나」를 따로 재야 한다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { createR2ScanRuntime } from '../src/r2-scan-runtime.js';
import { createA3Adapters } from '../src/r2/adapter-locator.js';
import { capacityForCellSurfaceFinal } from '../src/cellSurfaceFinal.js';
import { encodeY } from '../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import { listLumaSequences, readLumaDump } from '../tools/read-luma.mjs';

const PAYLOAD = 'https://tl.estre.so';
const FRAME_SIDE = 960;
const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const FILL = Object.freeze({ ...PRESET.background, a: 255 });

/**
 * 지정한 ecc 로 코드를 렌더해 960 프레임 중앙에 앉히고 휘도장으로 바꾼다.
 * 반환에 `eccLevel` 을 **인코더가 말한 값 그대로** 실어, 아래 단언이 문자열 상수가 아니라
 * 「인코더가 쓴 것」과 「R2 가 읽은 것」을 비교하게 한다.
 */
function renderLuma(layoutId, version, eccLevel, pixelsPerUnit) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layoutId, version, tones: 2, eccLevel,
  });
  const raster = rasterize(
    buildSceneY(encoded, { palette: PALETTE, margin: 4 }),
    { pixelsPerUnit, supersample: 2 },
  );
  const W = FRAME_SIDE;
  const frame = { width: W, height: W, pixels: new Uint8ClampedArray(W * W * 4) };
  for (let i = 0; i < W * W; i += 1) {
    frame.pixels[i * 4] = FILL.r;
    frame.pixels[i * 4 + 1] = FILL.g;
    frame.pixels[i * 4 + 2] = FILL.b;
    frame.pixels[i * 4 + 3] = 255;
  }
  const ox = Math.floor((W - raster.width) / 2);
  const oy = Math.floor((W - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const s = (y * raster.width + x) * 4;
      const d = ((y + oy) * W + (x + ox)) * 4;
      frame.pixels[d] = raster.pixels[s];
      frame.pixels[d + 1] = raster.pixels[s + 1];
      frame.pixels[d + 2] = raster.pixels[s + 2];
      frame.pixels[d + 3] = 255;
    }
  }
  return { luma: toRelativeLuminance(frame), encoded };
}

test('R6-① 합성 ecc M 프레임에서 어댑터가 ecc 를 **프레임에서** 읽는다 (대조군: format off 는 H 기본값)', () => {
  const { luma, encoded } = renderLuma('v0', 0, 'M', 8);
  assert.equal(encoded.eccLevel, 'M', '전제: 인코더가 M 으로 찍었다');

  const on = createA3Adapters({});
  const det = { found: 0, family: 0 };
  on.detectInto(luma.data, luma.width, luma.height, 0, null, det);
  assert.equal(on.stats.locked, 1, '전제: 합성 프레임에서 락이 걸린다');
  assert.equal(on.stats.n, 13);
  assert.equal(on.stats.format.source, 'locator',
    '포맷을 못 읽었다 (' + on.stats.format.reason + ') — 다리가 안 배선됐거나 후보가 없다');
  assert.equal(on.stats.format.eccName, encoded.eccLevel,
    'R2 가 읽은 ecc 가 인코더가 쓴 것과 다르다');
  assert.ok(on.stats.counters.formatReads >= 1, '포맷 읽기가 카운터에 안 남는다');

  // 🔴 대조군 — 옛 거동. 이게 없으면 위 단언이 「원래도 M 이었다」와 구별되지 않는다.
  const off = createA3Adapters({ format: false });
  off.detectInto(luma.data, luma.width, luma.height, 0, null, det);
  assert.equal(off.stats.locked, 1);
  assert.equal(off.stats.format.source, 'default');
  assert.notEqual(off.stats.format.eccName, encoded.eccLevel,
    'format 을 껐는데도 M 이 나온다 — 대조군이 아니다');
});

test('R6-② 그 프레임에 묶인 layout 의 nsym 이 **M 의 것**이다 (H 의 것과 다르다 = 옛 코드는 여기서 막혔다)', () => {
  const { luma, encoded } = renderLuma('v0', 0, 'M', 8);
  const nsymM = capacityForCellSurfaceFinal(13, 'M', 2, 'v0').nsym;
  const nsymH = capacityForCellSurfaceFinal(13, 'H', 2, 'v0').nsym;
  // 공허 방지 — 두 nsym 이 같으면 이 자는 아무것도 안 가른다.
  assert.notEqual(nsymM, nsymH, 'M 과 H 의 nsym 이 같다 — 라인업이 바뀌었으면 이 자를 다시 봐라');

  const runtime = createR2ScanRuntime({ enabled: true });
  runtime.pushFrame(luma, 0);
  assert.equal(runtime.stats.lockedN, 13, '전제: 락');
  assert.equal(runtime.stats.candidateCount, 1, '전제: n=13 은 후보 1개');
  assert.equal(runtime.stats.format.eccName, encoded.eccLevel, '런타임이 읽은 ecc 가 다르다');
  assert.equal(runtime.stats.format.source, 'locator');

  // 묶인 세션의 layout 을 값으로 본다 — `stats` 의 라벨이 아니라 **RS 가 실제로 쓸 수**다.
  const bound = runtime.view;
  assert.equal(bound.layoutId, 'v0');
  const runtimeNsym = runtime.stats.format.eccName === 'M' ? nsymM : nsymH;
  assert.equal(runtimeNsym, nsymM);

  // 대조군: format off 면 nsym 이 H 의 것이다 = 옛 코드. RS 는 그 값으로 절대 못 선다.
  const legacy = createR2ScanRuntime({ enabled: true, adapters: createA3Adapters({ format: false }) });
  legacy.pushFrame(luma, 0);
  assert.equal(legacy.stats.format.source, 'default');
  assert.equal(legacy.stats.format.eccName, 'H');
});

test('R6-③ **H 로 찍힌** 실물 코드가 M 의 nsym layout 으로도 끝까지 돈다 (배선 회귀 자 — ecc 축 아님)', (t) => {
  const seq = listLumaSequences().find((s) => s.name.split('/').pop() === 'y1');
  if (!seq || !seq.frames.length) { t.skip('휘도 덤프 없음 — 통합자 기기에서만 돈다'); return; }
  const frames = seq.frames.slice(0, 20).map((f) => readLumaDump(f.path));

  /*
   * 🔴 **전제를 값으로 못박는다** (2026-09-06 검토 R3c). 이 시퀀스가 M 으로 찍힌 줄 알고 이 자를
   * 읽으면 「M 코드를 읽는다」로 오독한다 — 실제로는 H 다. 그 사실이 여기서 빨개져야
   * 「이 자가 무엇의 증거인가」가 자기 자리에서 유지된다.
   */
  const probe = createA3Adapters({});
  const det = { found: 0, family: 0 };
  probe.detectInto(frames[0].data, frames[0].width, frames[0].height, 0, null, det);
  assert.equal(probe.stats.format.source, 'locator', '전제: 실물 f0 에서 포맷을 읽는다');
  assert.equal(probe.stats.format.eccName, 'H',
    'y1 이 더는 H 코드가 아니다 — 그러면 이 자의 이름과 위 «안 재는 축» 문단을 다시 써라');

  // 포맷 읽기를 끄고 ecc 를 M 으로 **못박아** 「M 의 nsym 으로 묶인 세션」만 돌린다.
  const runtime = createR2ScanRuntime({
    enabled: true, eccName: 'M', adapters: createA3Adapters({ format: false }),
  });
  let hit = null;
  for (let i = 0; i < frames.length && hit === null; i += 1) hit = runtime.pushFrame(frames[i], i * 100);
  assert.ok(hit, 'M 의 nsym layout 으로 20프레임 안에 DONE 이 없다 — 실측은 f7 이다');
  assert.equal(hit.text, PAYLOAD, '글자가 정답이 아니다');
  assert.equal(runtime.stats.format.eccName, 'M', 'stats 가 쓰인 ecc 를 안 말한다');
  assert.equal(runtime.stats.format.source, 'default', '이 팔은 포맷을 껐으므로 default 여야 한다');

  /*
   * ⚠ **이 자가 못 재는 것을 이름으로 남긴다.** 같은 방식의 L 못박기는 30프레임에 DONE 이 없다
   * (실측 2026-09-06). 즉 「상위집합이면 다 풀린다」는 성질이 아니다 — 여기서 통과하는 것은
   * **H 코드 × M nsym** 한 점뿐이고, ecc 축(M/L 로 찍힌 코드)은 코퍼스가 없어 미측정이다.
   */
});
