/**
 * size-floor-probe.mjs — **R1 과 R2 의 «크기 하한» 을 나란히 잰다.**
 *
 * 🔴 왜 있나 (2026-09-04 운영자 실기 관측):
 * > 「Y0 은 속도가 문제가 아니라 웬만한 악조건(특히 원거리 — 크기가 작을 때)에서도
 * >  읽히는 게 Y0 이라 그걸 더 줄여서 O/A/K 중앙 파인더로 썼던 거고, 그런데 R2 에서는
 * >  큐브 크기가 어느 정도 크게 들어와야만 인식이 됨 (가이드의 50% 이상)」
 *
 * 통합자의 1차 가설(「R2 는 6프레임을 모아야 해서 느리다」)은 **틀렸을 가능성이 높다.**
 * 이 자는 그 둘을 가른다 — 같은 프레임을 점점 줄여 가며 **어디서 죽는지**를 본다.
 *
 * 재는 것: 축소율마다
 *   · R1(`decodeFrontend`)이 복호에 성공하는가
 *   · R2 의 로케이터(`detectCellSurfaceBlockShapes`)가 포즈를 세우는가
 * ⇒ 두 하한의 **차이**가 「R2 가 R1 을 대체할 수 없는 구간」이다.
 *
 * ⚠ 축소는 실제 촬영 거리와 같지 않다 — 실물은 초점·모아레·조명이 같이 나빠진다.
 * 여기서 재는 것은 **픽셀 수 축 하나**다.
 *
 * 🔴 **`embed` 모드(기본)의 수치를 인용하지 마라** (2026-09-04 폐기, PM/029B §25.4.2).
 * 결과가 단조롭지 않다 — R1 이 0.8 에서 죽고 0.5 에서 되살아난다. 크기 하한이 아니라
 * **최근접 리샘플의 앨리어싱**을 재고 있다. 실제 원거리 촬영은 광학적 **저역통과**를
 * 거치는데 최근접은 정반대로 고주파를 만든다. 이 축은 **거리를 바꿔 찍은 실사진**으로만
 * 잴 수 있다.
 * ✅ `--shrink` 축(프레임 전체 축소 = 해상도)은 유효하다 — 리샘플이 균일하게 걸린다.
 *
 * 쓰기: node tools/size-floor-probe.mjs [시퀀스...] [--frames N] [--shrink]
 */

import { decodeFrontend } from '../src/decoder/frontend.js';
import { detectCellSurfaceBlockShapes } from '../src/decoder/cellsurface-block-detect.js';
import { createR2ScanRuntime } from '../src/r2-scan-runtime.js';
import { listLumaSequences, readLumaDump, lumaToRaster } from './read-luma.mjs';

/*
 * 🔴 **재는 대상이 「해상도」가 아니라 「프레임 대비 코드 비율」이다.**
 * 첫 판은 프레임 전체를 줄였는데, 그러면 코드가 여전히 화면을 꽉 채운다 — 그건
 * 「해상도가 낮다」이지 **「코드가 작다」가 아니다.** 운영자 조건은 「가이드의 50% 이상」,
 * 즉 비율이다. 그래서 **프레임 크기는 고정**하고 코드만 줄여 가운데 놓는다.
 * 배경은 테두리 중앙값으로 채운다 (0 으로 채우면 있지도 않은 강한 경계가 생긴다).
 */
function embed(dump, fraction) {
  const side = dump.width;
  const inner = Math.max(8, Math.round(side * fraction));
  // 테두리 중앙값 — 실제 촬영에서 코드 밖은 배경이지 검정이 아니다.
  const edge = [];
  for (let x = 0; x < dump.width; x += 7) {
    edge.push(dump.data[x], dump.data[(dump.height - 1) * dump.width + x]);
  }
  edge.sort((a2, b2) => a2 - b2);
  const bg = edge[Math.floor(edge.length / 2)] || 0;
  const data = new Float32Array(side * side).fill(bg);
  const offset = Math.floor((side - inner) / 2);
  for (let y = 0; y < inner; y += 1) {
    const sy = Math.min(dump.height - 1, Math.floor((y / inner) * dump.height));
    for (let x = 0; x < inner; x += 1) {
      const sx = Math.min(dump.width - 1, Math.floor((x / inner) * dump.width));
      data[(offset + y) * side + (offset + x)] = dump.data[sy * dump.width + sx];
    }
  }
  return { width: side, height: side, data };
}

/** 최근접 축소 — 보간을 넣으면 「자가 만든 선명함」이 측정에 섞인다. */
function shrink(dump, scale) {
  const width = Math.max(1, Math.round(dump.width * scale));
  const height = Math.max(1, Math.round(dump.height * scale));
  const data = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(dump.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(dump.width - 1, Math.floor(x / scale));
      data[y * width + x] = dump.data[sy * dump.width + sx];
    }
  }
  return { width, height, data };
}

const SCALES = [1, 0.8, 0.65, 0.5, 0.4, 0.32, 0.25, 0.2, 0.16, 0.125];
// 'embed' = 프레임 고정 + 코드만 축소(운영자 조건) · 'shrink' = 프레임 전체 축소(해상도 축)
const MODE = process.argv.includes('--shrink') ? 'shrink' : 'embed';

function main() {
  const argv = process.argv.slice(2);
  let frameCount = 3;
  const names = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--frames') { frameCount = Number(argv[i + 1]); i += 1; continue; }
    names.push(argv[i]);
  }
  const targets = names.length ? names : ['y0', 'y1', 'y2'];

  for (const name of targets) {
    const seq = listLumaSequences().find((s) => s.name.split('/').pop() === name);
    if (!seq || !seq.frames.length) { console.log(`${name} 건너뜀 (덤프 없음)`); continue; }
    const dumps = seq.frames.slice(0, frameCount).map((f) => readLumaDump(f.path));
    console.log(`\n== ${name}  원본 ${dumps[0].width}×${dumps[0].height}  프레임 ${dumps.length}`);
    console.log(MODE === 'embed' ? '  코드비율 코드px | R1 복호   R2 포즈  R2 복호  최대D  R2 n/layout' : '  배율   변 px | R1 복호   R2 포즈  R2 복호  최대D  R2 n/layout');
    for (const scale of SCALES) {
      let r1 = 0;
      let r2 = 0;
      let seen = '';
      // R2 «전체 경로» — 포즈만이 아니라 누적·복호까지. 실기 관측이 가리키는 것은 이쪽이다.
      const runtime = createR2ScanRuntime({ enabled: true });
      let r2Done = 0;
      let r2D = 0;
      for (const dump of dumps) {
        const small = MODE === 'embed' ? embed(dump, scale) : shrink(dump, scale);
        try {
          const res = decodeFrontend(lumaToRaster(small), { enableCellSurfaceY: true });
          if (res && res.ok === true) r1 += 1;
        } catch { /* 실패는 0 이다 */ }
        try {
          const det = detectCellSurfaceBlockShapes(small, { enableCellSurfaceY: true });
          const shape = (det.shapes || []).find((s) => s.blockLocator && s.blockLocator.locatorH);
          if (shape) {
            r2 += 1;
            if (!seen) {
              seen = `n=${shape.estimatedN}/${shape.blockLocator.layoutId || shape.blockLocator.family}`;
            }
          }
        } catch { /* 실패는 0 이다 */ }
        const hit = runtime.pushFrame(small, r2Done * 100 + r2 * 7);
        if (hit) r2Done += 1;
        if (runtime.stats.progressD > r2D) r2D = runtime.stats.progressD;
      }
      console.log(
        `  ${String(scale).padStart(5)} ${String(Math.round(dumps[0].width * scale)).padStart(6)} |`
        + ` ${String(r1).padStart(3)}/${dumps.length}`
        + `   ${String(r2).padStart(5)}/${dumps.length}`
        + `   ${String(r2Done).padStart(3)}/${dumps.length}`
        + `   D=${r2D.toFixed(2)}`
        + `   ${seen || '—'}`,
      );
    }
  }
}

main();
