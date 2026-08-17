/**
 * claude-v0t-funnel.mjs — 「v0T 가 거리에서 v0(n=13)로 분류되며 실패한다」 의 기전 규명.
 *
 * 운영자 실기기 관측 (2026-08-17):
 *   «v0T는 가이드에 맞추면야 잘 인식하지만 좀만 뒤로 빼면 파인더 다 잡고 v0T로
 *    분류하고도 인식을 못하거나 v0TY로 새거나 그리고 다수는 파인더 다 잡고도 v0으로
 *    분류하면서 인식을 못 하네.»
 *
 * 재는 것 — «파인더는 잡혔는데 어디서 v0 이 이기는가» 의 깔때기 회계다. 거리 축은
 * `pixelsPerUnit` 으로 대신한다 (프레임은 960 고정, 코드만 작아진다 = 뒤로 물러남).
 * 각 칸에서 다음을 **한 줄로** 남긴다:
 *
 *   k3      검증된 v0-center 코어 수      (= «중앙 불스아이를 봤다»)
 *   k5      엄격 코너 (verifyV2r2Cluster)  (= 앵커드 경로의 입력)
 *   loose   느슨한 코너 (verifyV0xqCornerCluster) (= 구제 경로의 입력)
 *   anch    앵커드로 분기한 중앙 수
 *   conf    불스아이 확증으로 구제된 중앙 수 / 삼중점 수
 *   poses   패밀리별 포즈 수 (v0t · v0ty · v0)
 *   shapes  세워진 셰이프의 estimatedN 분포
 *   decode  최종 판정 (ok / 실패사유 · 채택 layout · n)
 *
 * 가설: 거리에서 **엄격 코너(k5)가 먼저 죽고**, 구제 경로도 코너 3개를 못 채워
 * v0T 포즈가 아예 안 선다. 중앙 K3 는 마지막까지 살아 있으므로 그 중앙이
 * `assembleV0Poses` 360° 스윕으로 내려가 **n=13 v0 포즈**를 세우고, 그러면 CS 평가는
 * n=13 후보(=v0)만 채점한다 — 그래서 «파인더 다 잡고도 v0 으로 분류».
 * 이 스크립트는 그 가설을 **확증하거나 반증한다**. 반증이면 그대로 보고한다.
 */

import { encodeY } from '../../../src/encodeY.js';
import { buildSceneY, DEFAULT_FACE_GAINS } from '../../../src/sceneY.js';
import { rasterize } from '../../../src/raster.js';
import { detectCellSurfaceBlockShapes } from '../../../src/decoder/cellsurface-block-detect.js';
import { decodeFrontend } from '../../../src/decoder/frontend.js';
import { toRelativeLuminance } from '../../../src/decoder/luma.js';
import { TL_READER_URL } from '../../../src/qr.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../../src/luminance.js';
import { embed960 } from './claude-v0w2-leak.mjs';

const PRESET = getPreset(DEFAULT_PRESET);
const PALETTE = Object.freeze({
  background: PRESET.background,
  levels: PRESET.levels,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
  faceGains: DEFAULT_FACE_GAINS,
});
const PAYLOAD = 'https://tl.estre.so';
const NEEDS_QR = new Set(['v0wq', 'v0wy', 'v0ty']);

// 거리 사다리 — 960 프레임에 심는 코드 크기를 줄인다. 15 는 기존 회귀가 쓰는 값.
const RUNGS = [15, 13, 11, 9, 8, 7, 6, 5, 4];
// v0 는 n=13 이라 같은 pixelsPerUnit 에서 셀이 더 크다. «같은 물리 거리» 대조군이
// 아니라 «같은 렌더 파라미터» 대조군이다 — 표에서 그렇게 읽는다.
const LAYOUTS = [
  { id: 'v0t', version: 1, n: 21 },
  { id: 'v0ty', version: 1, n: 21 },
  { id: 'v0', version: 0, n: 13 },
];

function render(layout, version, pixelsPerUnit) {
  const encoded = encodeY(PAYLOAD, {
    cellSurfaceLayout: layout, version, tones: 2, eccLevel: 'M',
  });
  const opts = { palette: PALETTE, margin: 4 };
  if (NEEDS_QR.has(layout)) opts.qrText = TL_READER_URL;
  const scene = buildSceneY(encoded, opts);
  return embed960(rasterize(scene, { pixelsPerUnit, supersample: 2 }));
}

const LAB = {
  bootstrap: { family: { cube: { enableLocatorY: true, enableCellSurfaceY: true } } },
};

function funnelRow(layout, version, ppu) {
  const raster = render(layout, version, ppu);
  const luma = toRelativeLuminance(raster, {});
  // 로케이터를 프론트엔드와 **같은 옵션**으로 직접 호출해 진단을 받는다.
  const located = detectCellSurfaceBlockShapes(luma, {
    enableCellSurfaceY: true,
  });
  const d = located.diagnostics;
  const k3 = d.verified.filter((h) => h.kind === 'v0-center').length;
  const k5 = d.verified.filter((h) => h.kind === 'v2r2-corner').length;
  const nHist = {};
  for (const s of located.shapes) {
    const key = s.estimatedN + (s.blockLocator.layoutId ? ':' + s.blockLocator.layoutId : '');
    nHist[key] = (nHist[key] || 0) + 1;
  }
  const decoded = decodeFrontend(raster, LAB);
  return {
    ppu,
    layout,
    cores: d.coreCandidates,
    clusters: d.clusterCount,
    k3,
    k5,
    loose: d.centerQr.corners,
    anchored: d.earlyBranch.anchored,
    swept: d.earlyBranch.swept,
    confTriples: d.bullseyeConfirmed.triples,
    confCentres: d.bullseyeConfirmed.centres,
    confPoses: d.bullseyeConfirmed.poses,
    pv0t: d.poseCount.v0t,
    pv0ty: d.poseCount.v0ty,
    pv0: d.poseCount.v0,
    shapes: located.shapes.length,
    nHist,
    ok: decoded.ok === true,
    textOk: decoded.ok === true && decoded.text === PAYLOAD,
    gotLayout: decoded.ok === true
      ? (decoded.hypothesis && decoded.hypothesis.cellSurfaceLayout) || '?'
      : null,
    gotN: decoded.ok === true ? (decoded.hypothesis && decoded.hypothesis.n) : null,
    reason: decoded.ok === true ? null : decoded.reason,
  };
}

const rows = [];
for (const { id, version } of LAYOUTS) {
  for (const ppu of RUNGS) {
    const started = Date.now();
    let row;
    try {
      row = funnelRow(id, version, ppu);
    } catch (error) {
      row = { ppu, layout: id, error: error instanceof Error ? error.message : String(error) };
    }
    row.ms = Date.now() - started;
    rows.push(row);
    // 진행이 보이게 한 줄씩 흘린다 (긴 실행이라 중간에 끊겨도 관측은 남는다).
    if (row.error) {
      console.log(`${id}\tppu=${ppu}\t★ERROR ${row.error}`);
    } else {
      console.log(
        `${id}\tppu=${String(ppu).padStart(2)}`
        + `\tk3=${row.k3} k5=${row.k5} loose=${row.loose}`
        + `\tanch=${row.anchored} swept=${row.swept}`
        + `\tconf=${row.confCentres}/${row.confTriples}`
        + `\tpose v0t=${row.pv0t} v0ty=${row.pv0ty} v0=${row.pv0}`
        + `\tshapes=${row.shapes} ${JSON.stringify(row.nHist)}`
        + `\t→ ${row.ok ? (row.textOk ? 'OK' : 'OK/텍스트틀림') + ' ' + row.gotLayout + '/n' + row.gotN : '실패 ' + row.reason}`
        + `\t${row.ms}ms`,
      );
    }
  }
}

console.log('\n=== 요약 ===');
for (const { id } of LAYOUTS) {
  const mine = rows.filter((r) => r.layout === id && !r.error);
  const lastOk = [...mine].reverse().find((r) => r.textOk);
  const firstFail = mine.find((r) => !r.textOk);
  console.log(`${id}: 마지막 성공 ppu=${lastOk ? lastOk.ppu : '없음'}`
    + ` · 첫 실패 ppu=${firstFail ? firstFail.ppu : '없음'}`);
  // «파인더는 잡혔는데 v0 이 이긴» 칸을 콕 집는다.
  const hijacked = mine.filter((r) => !r.textOk && r.k3 > 0 && r.pv0 > 0 && r.pv0t === 0);
  if (hijacked.length) {
    console.log(`  ★ 중앙만 살아 v0 스윕으로 내려간 칸: ppu=${hijacked.map((r) => r.ppu).join(',')}`);
  }
  const posedButFailed = mine.filter((r) => !r.textOk && r.pv0t > 0);
  if (posedButFailed.length) {
    console.log(`  ★ v0T 포즈는 섰는데 하류에서 죽은 칸: ppu=${posedButFailed.map((r) => r.ppu).join(',')}`);
  }
}
