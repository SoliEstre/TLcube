/**
 * locator-h-contract.test.js — **P1**: 로케이터가 세운 호모그래피의 공개 계약.
 *
 * 왜 있나 (PM/029 §6.5.4 항목 3 · PM/029B §18.4, 2026-09-04): R2 의 누적 이득 측정이
 * 세션 격자를 「라벨로 주어진」 n·layoutId 로 고정해 왔다. 그래서 `y2-p9rot` 에서
 * 검출기가 109프레임 중 108프레임을 n=13/v0 로 골랐는데도(참값 n=25/v0tr) 실험은
 * **검출을 고정해 놓고 검출을 지목하는** 구조였고, P3 은 「판정 불가」로 끝났다.
 *
 * `locatorH` 는 그 축을 여는 손잡이다 — 「검출이 옳았던 프레임의 H」를 참값 라벨로
 * 뽑아 두면, 검출을 **옳게** 고정한 채 누적만 흔들 수 있다. 대체 오라클(라벨 중심·반경
 * 으로 만든 닮은 육각형)은 자기 대조군에 죽었다: 최대 F 19.0 vs 실제 검출기 413.5.
 *
 * 그래서 이 파일이 잠그는 것은 「필드가 있나」가 **아니라** 「그 H 가 이 도형을 실제로
 * 만든 그 H 인가」다. 존재만 재면 어느 리팩터링이 엉뚱한 H 를 꽂아도 초록이고,
 * 참값 라벨로 쓰는 쪽은 **조용히 틀린 라벨**을 받는다.
 *
 * ⚠ 이 파일이 못 재는 축: 「그 H 가 **참값에 가까운가**」. 그건 코퍼스에 참 호모그래피
 * 라벨이 있어야 재는 것이고, 지금 0건이다 (PM/029B §18.4 (b)). 여기서 재는 것은
 * 자기일관성뿐이다 — 검출기가 틀린 프레임에서는 이 H 도 같이 틀리다.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { detectCellSurfaceBlockShapes } from '../src/decoder/cellsurface-block-detect.js';
import { projectPoint } from '../src/decoder/homography.js';
import { CORNER_UNIT_OFFSETS } from '../src/hexgrid.js';
import { listLumaSequences, readLumaDump } from '../tools/read-luma.mjs';

function firstFrameWithShapes() {
  for (const name of ['y0', 'y1', 'y2']) {
    const seq = listLumaSequences().find((s) => s.name.split('/').pop() === name);
    if (!seq || !seq.frames.length) continue;
    for (const frame of seq.frames.slice(0, 8)) {
      const detected = detectCellSurfaceBlockShapes(readLumaDump(frame.path), {
        enableCellSurfaceY: true,
      });
      if (detected.shapes.length > 0) return { name, path: frame.path, detected };
    }
  }
  return null;
}

test('블록 로케이터 도형은 자기를 만든 H 를 `blockLocator.locatorH` 로 공개한다', (t) => {
  const found = firstFrameWithShapes();
  if (found === null) {
    t.skip('휘도 덤프 없음 (test/output 은 gitignore) — 통합자 기기에서만 돈다');
    return;
  }
  const { name, detected } = found;
  // 공허 방지: 도형이 0개면 아래 루프가 통째로 안 돌고도 초록이다.
  assert.ok(detected.shapes.length > 0, `${name} 에서 도형이 0개다 — 이 테스트는 아무것도 안 쟀다`);

  for (const shape of detected.shapes) {
    const H = shape.blockLocator.locatorH;
    assert.ok(H instanceof Float64Array && H.length === 9,
      `locatorH 가 9칸 Float64Array 가 아니다 (${name}) — R2 의 projectInto 가 이 배치를 가정한다`);
    for (const v of H) {
      assert.ok(Number.isFinite(v), `locatorH 에 비유한 값이 있다 (${name})`);
    }

    // ── 이 H 가 **이 도형을** 만든 그 H 인가 ──────────────────────────────
    // 중심: 정준 원점의 상.
    const centre = projectPoint(H, { x: 0, y: 0 });
    assert.ok(centre !== null, `locatorH 로 중심을 못 투영했다 (${name})`);
    assert.ok(Math.hypot(centre.x - shape.center.x, centre.y - shape.center.y) < 1e-6,
      `locatorH 가 shape.center 를 안 낸다 (${name}) — 다른 포즈의 H 가 꽂혔다는 뜻이다`);

    // 정점 6개: 정준 코너 × n 의 상. 중심만 맞고 스케일·회전이 다른 H 를 걸러낸다.
    shape.vertices.forEach((vertex, i) => {
      const corner = CORNER_UNIT_OFFSETS[i];
      const projected = projectPoint(H, {
        x: corner.x * shape.estimatedN,
        y: corner.y * shape.estimatedN,
      });
      assert.ok(projected !== null, `locatorH 로 코너 ${i} 를 못 투영했다 (${name})`);
      assert.ok(Math.hypot(projected.x - vertex.x, projected.y - vertex.y) < 1e-6,
        `locatorH 가 정점 ${i} 를 안 낸다 (${name}) — H 와 estimatedN 이 서로 다른 포즈에서 왔다`);
    });
  }
});
