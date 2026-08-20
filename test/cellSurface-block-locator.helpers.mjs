/**
 * cellSurface-block-locator.helpers.mjs — 분할된 로케이터 회귀가 공유하는 헬퍼.
 *
 * 원본 `cellSurface-block-locator.test.js` 를 축별로 나눌 때 본문은 옮기기만 하고
 * (이름·단언 불변), 파일 여러 개가 같이 쓰던 렌더/복원 스위치만 여기로 모았다.
 */

/**
 * cellSurface-block-locator.test.js — CS 파인더 블록 로케이터 회귀.
 *
 * 강한 톤 시프트(감마·S-커브)에서 실루엣 hull 이 0.5셀+ 어긋나면 CS agreement 에
 * gradient 가 없어 소프트 탐침으로도 «수용»까지 못 가거나(감마 계열 전멸),
 * 수용돼도 body RS 가 실패했다(v0 S-커브, 2026-08-15 claude-acceptance.md).
 * 블록 로케이터는 마스크·실루엣 없이 파인더 블록(동심 링 서명)을 직접 찾아
 * 기하를 재정렬한다 — 이 테스트가 고정하는 것:
 *
 *   1. v0 S-커브 — CS 수용을 넘어 **body RS 복호까지** 간다 (직전 병목의 승격 기준).
 *   2. 감마 0.7 — 종전 전멸 케이스가 v0/v2r2 모두 복호된다.
 *   3. 물리 회전 120° + 감마 — 회전 슬롯과 무관하게 복호된다 (로케이터는 면 T 앵커를
 *      직접 식별해 회전을 H 에 흡수한다 — hull 꼭짓점 인덱싱 병리에 면역).
 *   4. 결정성 — 같은 프레임 두 번 → 동일 shape/진단.
 *   5. 게이트 완화 없음 — 로케이터를 끄면(csBlockLocator:false) 감마 0.7 은 종전대로
 *      실패한다 (개선이 게이트가 아니라 기하 재정렬에서 왔다는 대조군).
 *   6. 정식 경로 불변 — enableCellSurfaceY 미설정이면 로케이터는 돌지 않는다.
 *   7. (2026-08-15 밤) v1r2 패밀리 — 네 코너 블록. 회전 스윕 없이 중앙+면T 먼코너
 *      similarity 시드 → 4앵커 직접 DLT → 12 서브앵커 최소제곱.
 *      ⚠ (2026-08-16 r2 재고정) 이 축은 **무왜곡만 초록**이었다. 톤 왜곡(S-커브 0.6 ·
 *      감마 0.7/0.6)과 rot0 에서는 복호가 실패하는 것이 정본 거동이었고,
 *      아래 «알려진 약점 핀» 블록이 그 실패의 **종류와 단계까지** 고정했다.
 *      근거: 개정 전에도 이 레이아웃은 6 페이로드 중 1개만 통과했다(픽스처 운).
 *      ⚠ (2026-08-16 과업 #16) 그중 **S-커브 0.6 축이 해소됐다** — R 면 게인 0.52→0.62
 *      만으로 복호가 선다(문턱 0.57~0.60, 단조). 감마 0.7/0.6 축의 핀은 그대로 남는다.
 *   8. (2026-08-16 중앙 통일) 조기 분기 — 세 패밀리 중앙이 공유 K3 라 패밀리·n 판별은
 *      2차 앵커(K5 원거리 코어)가 맡는다. n=21 에선 v2r2·v1r2 후보 포즈가 **둘 다**
 *      서는 것이 새 기대(오수용 부재는 복호 결과로 고정), v0 프레임은 앵커드 포즈 0,
 *      구 v2r2 중앙(닫힌 링 스택)은 legacy 분류만 남고 포즈 0 (소각 차단).
 *   9. (2026-08-16) v0X 패밀리 — SE 6×6 동심 사각이 **3면 동일 톤**이라 K5 원거리
 *      코어가 120° 간격 **셋** 뜬다(v1r2·v2r2 는 면 T 하나뿐). 이 «사각 링 동반자»
 *      가 반경 18.0 을 공유하는 v1r2 와 v0X 를 가르는 시딩 게이트다.
 *  10. (2026-08-17) v0xq 패밀리 — **K3 중앙이 없다**(중앙 QR 슬롯). 3코너 삼중점이
 *      중앙·스케일·위상을 주고 중앙 QR 블록이 4번째 앵커다. 코너 검증은 별도 순회라
 *      다른 패밀리의 poseCount 가 흔들리지 않아야 한다 (§10 대조군 3종).
 *  11. (2026-08-16) v0W 패밀리 — K3 중앙은 **있고**, 동심 사각이 v0X 와 같은 블록인데
 *      **심 꼭짓점**에 앉는다(반경 16.7033 vs 18.0). 두 반경 차 1.30 은
 *      ANCHOR_SNAP_CELLS(3.2) 안이고 사각 링 동반자도 양쪽 다 참이라 **시드 단계에서
 *      안 갈라진다** — 가르는 것은 패치 Pearson 과 CS 수용 게이트다. 그래서 §11 은
 *      «포즈 0» 이 아니라 **«복호 오수용 0»** 을 재는 것이 본론이다 (양방향 전수).
 */

import { encodeY } from '../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../src/sceneY.js';
import { rasterize } from '../src/raster.js';
import { decodeFrontend } from '../src/decoder/frontend.js';
import { detectQrFinderTriples } from '../src/decoder/bootstrap.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../src/luminance.js';
import { toRelativeLuminance } from '../src/decoder/luma.js';
import {
  CS_BLOCK_LOCATOR_INTERNALS, detectCellSurfaceBlockShapes,
} from '../src/decoder/cellsurface-block-detect.js';
import { estimateHomography4 } from '../src/decoder/homography.js';
import { CORNER_UNIT_OFFSETS } from '../src/hexgrid.js';
import {
  V0WQ_BLOCKS, V0W_BLOCKS, V0W2_BLOCKS, V0XQ_BLOCKS,
  allFinalLayoutIdsForN, cellSurfaceFinal, centerQrSlotCellsFor, centerQrSlotOriginFor,
  finalLayoutIdForN, finalLayoutIdsForN,
  isDroppedFinalLayout, locatorCellsCellSurfaceFinal,
} from '../src/cellSurfaceFinal.js';
import { faceBasis } from '../src/ygrid.js';
import { encode } from '../src/encode.js';
import { encodeA } from '../src/encodeA.js';
import { buildScene } from '../src/scene.js';
import { TL_READER_URL } from '../src/qr.js';
import { distortImage } from './harness/distort.mjs';

export {
  encodeY, buildSceneY, DEFAULT_FACE_GAINS, BULLSEYE_DARK, BULLSEYE_LIGHT,
  rasterize, decodeFrontend,
  detectQrFinderTriples, toRelativeLuminance,
  CS_BLOCK_LOCATOR_INTERNALS, detectCellSurfaceBlockShapes,
  estimateHomography4, CORNER_UNIT_OFFSETS,
  V0WQ_BLOCKS, V0W_BLOCKS, V0W2_BLOCKS, V0XQ_BLOCKS,
  allFinalLayoutIdsForN, cellSurfaceFinal, centerQrSlotCellsFor, centerQrSlotOriginFor,
  finalLayoutIdForN, finalLayoutIdsForN,
  isDroppedFinalLayout, locatorCellsCellSurfaceFinal,
  faceBasis, encode, encodeA, buildScene, TL_READER_URL, distortImage,
};

export const PRESET = getPreset(DEFAULT_PRESET);
export const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
export const FILL = Object.freeze({ ...PRESET.background, a: 255 });
export const PAYLOAD = 'https://tl.estre.so';

export function renderFinal(layout, version, pixelsPerUnit) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 4 });
  return rasterize(scene, { pixelsPerUnit, supersample: 2 });
}

export function embed960(raster) {
  const W = 960;
  const H = 960;
  const out = { width: W, height: H, pixels: new Uint8ClampedArray(W * H * 4) };
  for (let index = 0; index < W * H; index += 1) {
    out.pixels[index * 4] = FILL.r;
    out.pixels[index * 4 + 1] = FILL.g;
    out.pixels[index * 4 + 2] = FILL.b;
    out.pixels[index * 4 + 3] = 255;
  }
  const ox = Math.floor((W - raster.width) / 2);
  const oy = Math.floor((H - raster.height) / 2);
  for (let y = 0; y < raster.height; y += 1) {
    for (let x = 0; x < raster.width; x += 1) {
      const s = (y * raster.width + x) * 4;
      const d = ((y + oy) * W + (x + ox)) * 4;
      out.pixels[d] = raster.pixels[s];
      out.pixels[d + 1] = raster.pixels[s + 1];
      out.pixels[d + 2] = raster.pixels[s + 2];
      out.pixels[d + 3] = raster.pixels[s + 3];
    }
  }
  return out;
}

export function decodeLab(frame, cube = {}) {
  return decodeFrontend({
    width: frame.width, height: frame.height, pixels: frame.pixels,
  }, {
    bootstrap: {
      family: {
        cube: { enableLocatorY: true, enableCellSurfaceY: true, ...cube },
      },
    },
  });
}

/** 3톤 변형 — 톤 열화 구간에서 v0xq 시딩 게이트의 실효 단계를 재는 데 쓴다. */
export function renderFinal3Tone(layout, version, pixelsPerUnit) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version, tones: 3, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, { palette: PALETTE, margin: 4 });
  return rasterize(scene, { pixelsPerUnit, supersample: 2 });
}

/**
 * **드랍 복원 스위치** (운영자 확정 2026-08-16 «v2r2 · v1r2 실험판 드랍»
 * · 2026-08-17 «v0XQ 실기기 드랍»(2라운드) · 2026-08-17 «v0X 실기기 드랍»(3라운드)).
 *
 * 드랍은 «차단» 이지 «삭제» 가 아니다. 아래 v2r2 · v1r2 · v0xq · **v0x** 축의
 * 회귀는 그대로 살려 두되, 검출 라인업이 아니라 이 스위치로 켠다:
 *   · `calibration.csBlockLocator.{v2r2Family, v1r2Family, v0xqFamily, v0xFamily}`
 *     → 블록 로케이터 패밀리
 *   · `includeDroppedCellSurfaceLayouts` → CS 평가 후보 (decodeLab 경로에서만 필요)
 * 게이트(0.78 · 0.035 · CRC · RS)는 한 값도 안 건드렸다.
 * 근거·측정: `test/output/claude-v0w-program.md` · `claude-v0w2-program.md` ·
 * `claude-v0wy-program.md`.
 *
 * ⚠ **v0xqFamily 를 여기 넣는 것은 «v0wq 를 켜는 것» 이 아니다.** 코너 수집만
 * 공유한다. 그 독립성 자체를 아래 §«v0XQ 드랍» 회귀가 매 실행 증명한다.
 * ⚠ 같은 이유로 **v0xFamily 를 켜는 것은 v0w·v0w2 를 켜는 것이 아니다** — 셋은
 * 앵커드 순회의 서로 독립한 `if` 다. 아래 §«v0X 드랍» 회귀가 그것을 증명한다.
 *
 * **의도적 갱신 «v0T 편입 + v0W 계열 전체 드랍» (운영자 확정 2026-08-17)** —
 * v0w · v0wq · v0w2 · v0wy 네 스위치가 여기 합류했다 (같은 차단·비삭제 규약).
 * v0W 계열 축 전용으로는 아래 `RESTORE_V0W_SERIES*` 를 쓴다 — «무엇이 켜졌나» 를
 * 좁게 적기 위해서다.
 */
export const RESTORE_DROPPED_LOCATOR = Object.freeze({
  calibration: {
    csBlockLocator: {
      v2r2Family: true, v1r2Family: true, v0xqFamily: true, v0xFamily: true,
      v0wFamily: true, v0wqFamily: true, v0w2Family: true, v0wyFamily: true,
    },
  },
});
export const RESTORE_DROPPED = Object.freeze({
  includeDroppedCellSurfaceLayouts: true,
  ...RESTORE_DROPPED_LOCATOR,
});

/**
 * v0W 계열 넷만 되돌리는 스위치 (2026-08-17 v0T 편입 라운드 드랍) — v0W 축 회귀
 * 전용. 넷을 함께 켜는 이유: 계열 안 상호 의존이 실재한다 — v0W 의 rot0 감마 2칸
 * 해소가 v0W2 포즈 다양성에서 왔고(§v0W 약점 2칸의 귀속), v0WY 복호가 형제 포즈
 * 위에서 이뤄지는 프레임이 있다 (`claude-v0t-wy-restore-debug.out.txt`).
 * 개별 격리 대조군은 각 테스트가 스위치를 하나만 뒤집어 잰다.
 */
export const RESTORE_V0W_SERIES_LOCATOR = Object.freeze({
  calibration: {
    csBlockLocator: {
      v0wFamily: true, v0wqFamily: true, v0w2Family: true, v0wyFamily: true,
    },
  },
});
/**
 * ⚠ **복원의 CS 후보는 «드랍 전 라인업» 으로 좁힌다** — `includeDropped…` (전체
 * 와이어 10후보) 가 아니다. 실측 (재실행 2026-08-17): 전체 와이어로 열면 문서에
 * 예고돼 있던 잠재 별칭 **v0wy → v0xq** 가 실물 래스터에서 활성화된다 — v0xq 의
 * 42셀은 v0wy 파인더의 톤까지 같은 부분집합이고 v0xq 후보의 슬롯 배제가 v0wy 의
 * K3 중앙을 채점 밖으로 치워 agreement 1.0 동률이 되며, 동률 타이브레이크(후보
 * 순서)가 v0xq 를 골라 포맷 판독이 죽는다 (`frontend:no-format-candidate`).
 * 드랍 전 세계에는 v0xq 후보가 없었으므로, 원형 재현 = 후보도 그때 그대로다.
 */
export const PRE_V0T_LINEUP_21 = Object.freeze(['v0w', 'v0wq', 'v0w2', 'v0wy']);
// 복호까지 가는 복원은 **드랍 전 세계의 비트 재현**이다 — 후보(위)와 패밀리 구성
// (신설 v0t·v0ty 격리) 둘 다 그때 그대로여야 핀 값이 선다. 실측: v0t 를 켠 채면
// v0t 포즈 다양성이 v0W2 의 rot0 감마 약점 핀을 구제해 뒤집는다 (v0W2 가 v0W 을
// 구제했던 것과 같은 기전 — 그 자체는 개선이지만, 이 회귀들이 재는 것은 «드랍 전
// 동작이 그대로 돌아오는가» 다).
export const RESTORE_V0W_SERIES = Object.freeze({
  cellSurfaceLayouts: [...PRE_V0T_LINEUP_21],
  calibration: {
    csBlockLocator: {
      v0wFamily: true, v0wqFamily: true, v0w2Family: true, v0wyFamily: true,
      // **의도적 갱신 «v0TR 계열 편입» (2026-08-17)** — v0tr·v0trq 도 함께 끔는다.
      // 아래 «격리 복원» 주석이 적은 기전이 **그대로 재현됐다** — 켜 둔 채로 돌리면
      // v0tr 포즈의 다양성이 v0W2 의 rot0 감마 약점 핀을 구제해 gamma0.7 rot0 이
      // 초록이 되고, v0W 의 F6 슬롯 위반이 3 → 4 로 움직인다 (실측).
      // «복원 = 드랩 전 동작 그대로» 를 재려면 신설 패밀리를 전부 꿐야 한다.
      // **의도적 갱신 «v0TRY 편입» (2026-08-18)** — 같은 규약으로 v0try 도 끈다.
      v0tFamily: false, v0tyFamily: false, v0trFamily: false, v0trqFamily: false,
      v0tryFamily: false,
    },
  },
});

/**
 * v0W 계열 복원 + **신설 v0t·v0ty 격리** — 슬롯 QR 확증 계수기처럼 v0wy 축의
 * 수치를 «그 패밀리 몫만» 재야 하는 회귀 전용. v0ty 는 같은 far 슬롯·같은 확증
 * 경로를 쓰므로 켠 채 재면 `slotQr.rejected` 에 v0ty 몫이 섞이고, v0t 포즈는
 * `anchoredCentres` 를 채워 불스아이 구제 경로의 분모를 바꾼다 (격리해서 재려면
 * 스위치도 각각 — v0xq ↔ v0wq 코너 수집 격리와 같은 규약).
 */
export const RESTORE_V0W_SERIES_ISOLATED_LOCATOR = Object.freeze({
  calibration: {
    csBlockLocator: {
      v0wFamily: true, v0wqFamily: true, v0w2Family: true, v0wyFamily: true,
      // **의도적 갱신 «v0TR 계열 편입» (2026-08-17)** — v0tr·v0trq 도 함께 끔는다.
      // 아래 «격리 복원» 주석이 적은 기전이 **그대로 재현됐다** — 켜 둔 채로 돌리면
      // v0tr 포즈의 다양성이 v0W2 의 rot0 감마 약점 핀을 구제해 gamma0.7 rot0 이
      // 초록이 되고, v0W 의 F6 슬롯 위반이 3 → 4 로 움직인다 (실측).
      // «복원 = 드랩 전 동작 그대로» 를 재려면 신설 패밀리를 전부 꿐야 한다.
      // **의도적 갱신 «v0TRY 편입» (2026-08-18)** — 같은 규약으로 v0try 도 끈다.
      v0tFamily: false, v0tyFamily: false, v0trFamily: false, v0trqFamily: false,
      v0tryFamily: false,
    },
  },
});
/**
 * 복호까지 가는 격리 복원 — **드랍 전 세계의 비트 재현**이 필요한 회귀 전용.
 * 실측 (재실행 2026-08-17): v0t 를 켠 채 복원하면 v0W 계열 세계가 **좋아지는
 * 쪽으로도** 변한다 — v0t 포즈 다양성이 v0W2 의 rot0 감마 약점 핀을 구제해
 * 뒤집고 (v0W2 가 v0W 을 구제했던 것과 같은 기전), v0wy rot0 의 운반 포즈 구성을
 * 바꿔 복호를 떨어뜨린다. «복원 = 드랍 전 동작 그대로» 를 재려면 신설 패밀리도
 * 함께 꺼야 한다.
 */
export const RESTORE_V0W_SERIES_ISOLATED = Object.freeze({
  cellSurfaceLayouts: [...PRE_V0T_LINEUP_21],
  ...RESTORE_V0W_SERIES_ISOLATED_LOCATOR,
});

/** v0X 만 되돌리는 최소 스위치 — 검출 전용 경로에서 «무엇이 켜졌나» 를 좁게 적는다. */
export const RESTORE_V0X_LOCATOR = Object.freeze({
  calibration: { csBlockLocator: { v0xFamily: true } },
});

export const PRE_NORMALIZE_V0X_MID = Object.freeze([
  ['0,3', 'L'], ['14,20', 'L'], ['14,20', 'R'], ['19,19', 'R'],
]);

export function renderV0xq(pixelsPerUnit) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0xq', version: 1, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, {
    palette: PALETTE, margin: 4, qrText: TL_READER_URL,
  });
  return rasterize(scene, { pixelsPerUnit, supersample: 2 });
}

export const V0W_TONE_PINS = Object.freeze([
  ['clean', {}, [0, 120, 240], []],
  ['sCurve0.6', { sCurve: 0.6 }, [0, 120, 240], []],
  ['gamma0.7', { gamma: 0.7 }, [0, 120, 240], []],
  ['gamma0.6', { gamma: 0.6 }, [0, 120, 240], []],
]);

/** v0W2 편입 **전**의 v0W 핀 — 아래 대조군 팔이 이 좌표를 그대로 재현해야 한다. */
export const V0W_TONE_PINS_BEFORE_V0W2 = Object.freeze([
  ['gamma0.7', { gamma: 0.7 }, [0]],
  ['gamma0.6', { gamma: 0.6 }, [0]],
]);

export function renderV0wq(pixelsPerUnit) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0wq', version: 1, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, {
    palette: PALETTE, margin: 4, qrText: TL_READER_URL,
  });
  return rasterize(scene, { pixelsPerUnit, supersample: 2 });
}

/**
 * v0WY — **자기 레이아웃으로** 인코드한다 (구 판본은 v0W 인코딩 위에 허공 QR 만
 * 얹었다 — 그때는 그것이 v0WY 의 전부였기 때문이다). 슬롯이 레이아웃 정의라
 * qrText 가 필수다.
 */
export function renderV0wy(pixelsPerUnit) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0wy', version: 1, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, {
    palette: PALETTE, margin: 4, qrText: TL_READER_URL,
  });
  return rasterize(scene, { pixelsPerUnit, supersample: 2 });
}

export const V0W2_TONE_PINS = Object.freeze([
  ['clean', {}, [0, 120, 240], []],
  ['sCurve0.6', { sCurve: 0.6 }, [0, 120, 240], []],
  ['gamma0.7', { gamma: 0.7 }, [120, 240], [0]],
  ['gamma0.6', { gamma: 0.6 }, [120, 240], [0]],
]);

export const SEAL_ALL_OFF = Object.freeze({
  centreQrBullseyeVeto: false,
  centreQrRequireFinderContrast: false,
  centreBullseyeConfirmedPoses: false,
});

export function renderV0ty(pixelsPerUnit) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0ty', version: 1, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, {
    palette: PALETTE, margin: 4, qrText: TL_READER_URL,
  });
  return rasterize(scene, { pixelsPerUnit, supersample: 2 });
}

/** v0TRY — 슬롯이 레이아웃 정의라 qrText 가 필수다 (renderV0ty 와 같은 이유). */
export function renderV0try(pixelsPerUnit) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: 'v0try', version: 1, tones: 2, eccLevel: 'M',
  });
  const scene = buildSceneY(encoded, {
    palette: PALETTE, margin: 4, qrText: TL_READER_URL,
  });
  return rasterize(scene, { pixelsPerUnit, supersample: 2 });
}

