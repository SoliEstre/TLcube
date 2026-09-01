// 파인더 상대배치 기반 Type Y 역왜곡 설계 연구 하네스.
//
// 이 파일은 프로덕션 구현이 아니다. 합성 영상에서
//   1) 중앙 Y 서브패치 ↔ 외곽 코너 패치의 반경비로 perspective를 추정하고
//   2) 추정값으로 세 면을 각각 평면 호모그래피 역샘플링한 뒤
//   3) 기존 decodeFrontend에 그대로 넣어 한계선을 잰다.
//
// 중요 한계: 파인더 중심은 렌더 기하에서 얻은 oracle 좌표를 0.25px로 양자화한다.
// 따라서 이 실험은 «관측량과 복원 변환이 성립하는가»의 상한이며, 실영상 검출기
// 자체의 성공을 증명하지 않는다.

import { mkdirSync, writeFileSync } from 'node:fs';
import { encodeY } from '../../src/encodeY.js';
import {
  buildOrbitMesh,
  cubeCenter,
  cubePoint,
  projectPoint,
  perspectiveInvDist,
} from '../../src/y3d-viewer.js';
import { layoutForCube } from '../../src/ygrid.js';
import { getPreset, DEFAULT_PRESET } from '../../src/luminance.js';
import { rasterize } from '../../src/raster.js';
import { rasterToPng } from '../../src/png.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';

const OUT = 'test/output/inverse-warp-study';
const PAYLOAD = 'https://tl.estre.so';
const PPU = 17;
const MARGIN = 4;
const TARGET_MAX = 0.5;
const FINDER_QUANTUM_PX = 0.25;
const INNER_ANCHOR_CELLS = 1.5;
const OUTER_ANCHOR_CELLS = 11.5;
const FACES = Object.freeze(['T', 'L', 'R']);
const STEPS = Object.freeze([
  0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.6, 0.7, 0.8, 0.9,
]);

const preset = getPreset(DEFAULT_PRESET);
const encoded = encodeY(PAYLOAD, {
  cellSurfaceLayout: 'v0', tones: 3, eccLevel: 'M',
});
const n = encoded.n;
if (n !== 13) throw new Error(`v0 연구 자의 n이 달라졌다: ${n} !== 13`);
const layout = layoutForCube(n, { size: 1, margin: MARGIN });
const center3d = cubeCenter(n);
const radius3d = (n / 2) * Math.sqrt(3);
const digitAt = (i, j) => encoded.cellDigits.get(`${i},${j}`)?.digit ?? null;
const levelAt = (i, j, face) => {
  const value = encoded.cellDigits.get(`${i},${j}`)?.tones?.[face];
  return Number.isInteger(value) ? value : null;
};

function meshToScene(mesh) {
  return {
    width: layout.width,
    height: layout.height,
    background: preset.background,
    shapes: mesh.quads.map((quad) => ({
      kind: 'polygon', points: quad.points2d, color: quad.color,
    })),
  };
}

function render(perspective) {
  const mesh = buildOrbitMesh({
    n,
    tones: encoded.tones,
    levels: preset.levels,
    layout,
    digitAt,
    levelAt,
    perspective,
    yaw: 0,
    pitch: 0,
    roll: 0,
    faces: 3,
  });
  const raster = rasterize(meshToScene(mesh), { pixelsPerUnit: PPU, supersample: 2 });
  return { mesh, raster };
}

function judge(raster) {
  try {
    const decoded = decodeFrontend(raster, {});
    if (decoded?.ok) {
      return {
        ok: String(decoded.text) === PAYLOAD,
        verdict: String(decoded.text) === PAYLOAD ? 'ok' : `wrong(${String(decoded.text).length})`,
        text: String(decoded.text),
      };
    }
    return {
      ok: false,
      verdict: String(decoded?.reason || decoded?.code || 'fail'),
      text: null,
    };
  } catch (error) {
    return { ok: false, verdict: `throw:${error.message.slice(0, 60)}`, text: null };
  }
}

function projectAt(point, perspective) {
  const invDist = perspectiveInvDist(perspective, radius3d);
  return projectPoint(point, layout, center3d, invDist);
}

function quantizePoint(point, quantumPx) {
  if (!(quantumPx > 0)) return point;
  return {
    x: Math.round(point.x * PPU / quantumPx) * quantumPx / PPU,
    y: Math.round(point.y * PPU / quantumPx) * quantumPx / PPU,
  };
}

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function finderRadii(perspective, quantumPx = 0) {
  const centre = quantizePoint(projectAt(center3d, perspective), quantumPx);
  const radii = (at) => FACES.map((face) => {
    const p = quantizePoint(projectAt(cubePoint(face, at, at), perspective), quantumPx);
    return Math.hypot(p.x - centre.x, p.y - centre.y);
  });
  const inner = radii(INNER_ANCHOR_CELLS);
  const outer = radii(OUTER_ANCHOR_CELLS);
  return {
    inner,
    outer,
    innerMean: mean(inner),
    outerMean: mean(outer),
  };
}

const canonicalRadii = finderRadii(0, 0);
const canonicalRatio = canonicalRadii.innerMean / canonicalRadii.outerMean;
const inner3d = cubePoint('T', INNER_ANCHOR_CELLS, INNER_ANCHOR_CELLS);
const outer3d = cubePoint('T', OUTER_ANCHOR_CELLS, OUTER_ANCHOR_CELLS);
const depthOf = (point) => (
  (point.x - center3d.x) + (point.y - center3d.y) + (point.z - center3d.z)
) / Math.sqrt(3);
const innerDepthMagnitude = -depthOf(inner3d);
const outerDepth = depthOf(outer3d);
if (!(innerDepthMagnitude > 0) || !(outerDepth > 0)) {
  throw new Error('파인더 깊이 부호가 예상과 다르다');
}

function perspectiveFromRadii(radii) {
  const observedRatio = radii.innerMean / radii.outerMean;
  const lambda = observedRatio / canonicalRatio;
  // lambda = s_near / s_far = (1 + e*d_far) / (1 - e*d_near)
  const invDist = (lambda - 1) / (lambda * innerDepthMagnitude + outerDepth);
  const beta = Math.max(0, Math.min(1, invDist * radius3d));
  return {
    observedRatio,
    lambda,
    invDist,
    beta,
    perspective: Math.asin(beta) / (Math.PI / 3),
  };
}

function solveLinear(matrix, values) {
  const nRows = values.length;
  const a = matrix.map((row, index) => [...row, values[index]]);
  for (let col = 0; col < nRows; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < nRows; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) pivot = row;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) throw new Error('호모그래피 선형계가 특이하다');
    [a[col], a[pivot]] = [a[pivot], a[col]];
    const divisor = a[col][col];
    for (let j = col; j <= nRows; j += 1) a[col][j] /= divisor;
    for (let row = 0; row < nRows; row += 1) {
      if (row === col) continue;
      const factor = a[row][col];
      for (let j = col; j <= nRows; j += 1) a[row][j] -= factor * a[col][j];
    }
  }
  return a.map((row) => row[nRows]);
}

function homographyFromFour(source, target) {
  const matrix = [];
  const values = [];
  for (let i = 0; i < 4; i += 1) {
    const { x, y } = source[i];
    const { x: u, y: v } = target[i];
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y]);
    values.push(u);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y]);
    values.push(v);
  }
  const h = solveLinear(matrix, values);
  return [...h, 1];
}

function applyHomography(h, point) {
  const denominator = h[6] * point.x + h[7] * point.y + h[8];
  return {
    x: (h[0] * point.x + h[1] * point.y + h[2]) / denominator,
    y: (h[3] * point.x + h[4] * point.y + h[5]) / denominator,
  };
}

function faceCorners(face, perspective) {
  return [
    cubePoint(face, 0, 0),
    cubePoint(face, n, 0),
    cubePoint(face, n, n),
    cubePoint(face, 0, n),
  ].map((point) => {
    const projected = projectAt(point, perspective);
    return { x: projected.x * PPU, y: projected.y * PPU };
  });
}

function pointInConvexQuad(point, quad) {
  let sign = 0;
  for (let i = 0; i < quad.length; i += 1) {
    const a = quad[i];
    const b = quad[(i + 1) % quad.length];
    const cross = (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);
    if (Math.abs(cross) < 1e-7) continue;
    const next = Math.sign(cross);
    if (sign !== 0 && next !== sign) return false;
    sign = next;
  }
  return true;
}

function bilinearSample(raster, boundaryPoint, channel) {
  // faceCorners는 픽셀 경계 좌표다. 배열 인덱스는 픽셀 중심이므로 0.5를 뺀다.
  const x = boundaryPoint.x - 0.5;
  const y = boundaryPoint.y - 0.5;
  if (x < 0 || y < 0 || x > raster.width - 1 || y > raster.height - 1) return null;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(raster.width - 1, x0 + 1);
  const y1 = Math.min(raster.height - 1, y0 + 1);
  const wx = x - x0;
  const wy = y - y0;
  const at = (xx, yy) => raster.pixels[(yy * raster.width + xx) * 4 + channel];
  const top = at(x0, y0) * (1 - wx) + at(x1, y0) * wx;
  const bottom = at(x0, y1) * (1 - wx) + at(x1, y1) * wx;
  return top * (1 - wy) + bottom * wy;
}

function rectifyThreeFaces(source, estimatedPerspective) {
  // 기준선은 리샘플링조차 끼우지 않는다. 중립값 픽셀 동일 게이트다.
  if (!(estimatedPerspective > 1e-12)) {
    return {
      width: source.width,
      height: source.height,
      pixels: new Uint8ClampedArray(source.pixels),
    };
  }
  const pixels = new Uint8ClampedArray(source.width * source.height * 4);
  for (let i = 0; i < source.width * source.height; i += 1) {
    pixels[i * 4] = preset.background.r;
    pixels[i * 4 + 1] = preset.background.g;
    pixels[i * 4 + 2] = preset.background.b;
    pixels[i * 4 + 3] = 255;
  }
  for (const face of FACES) {
    const destination = faceCorners(face, 0);
    const projected = faceCorners(face, estimatedPerspective);
    const H = homographyFromFour(destination, projected);
    const minX = Math.max(0, Math.floor(Math.min(...destination.map((p) => p.x))));
    const maxX = Math.min(source.width - 1, Math.ceil(Math.max(...destination.map((p) => p.x))));
    const minY = Math.max(0, Math.floor(Math.min(...destination.map((p) => p.y))));
    const maxY = Math.min(source.height - 1, Math.ceil(Math.max(...destination.map((p) => p.y))));
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const destinationPoint = { x: x + 0.5, y: y + 0.5 };
        if (!pointInConvexQuad(destinationPoint, destination)) continue;
        const sourcePoint = applyHomography(H, destinationPoint);
        const out = (y * source.width + x) * 4;
        for (let channel = 0; channel < 4; channel += 1) {
          const value = bilinearSample(source, sourcePoint, channel);
          if (value !== null) pixels[out + channel] = value;
        }
      }
    }
  }
  return { width: source.width, height: source.height, pixels };
}

function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

function meshResolution(mesh) {
  const modules = mesh.quads.filter((quad) => quad.kind === 'module' && quad.facing < 0);
  const areaPitchPx = modules.map((quad) => Math.sqrt(polygonArea(quad.points2d)) * PPU);
  const visibleFaces = [...new Set(modules.map((quad) => quad.face))].sort();
  return {
    visibleFaces,
    minAreaEquivalentCellPx: Math.min(...areaPitchPx),
    medianAreaEquivalentCellPx: areaPitchPx.sort((a, b) => a - b)[Math.floor(areaPitchPx.length / 2)],
  };
}

mkdirSync(OUT, { recursive: true });

// 🔴 기준선 게이트: 원본과 identity 역왜곡 둘 다 읽혀야만 사다리를 돈다.
const baseline = render(0);
const baselineRaw = judge(baseline.raster);
const baselineRestoredRaster = rectifyThreeFaces(baseline.raster, 0);
const baselineRestored = judge(baselineRestoredRaster);
console.log(`기준선 raw=${baselineRaw.verdict} · restored=${baselineRestored.verdict}`);
if (!baselineRaw.ok || !baselineRestored.ok) {
  console.error('기준선 실패 — 사다리를 만들지 않는다.');
  process.exit(1);
}

const rows = [];
for (const perspective of STEPS) {
  const rendered = render(perspective);
  const raw = judge(rendered.raster);
  const exact = perspectiveFromRadii(finderRadii(perspective, 0));
  const measuredRadii = finderRadii(perspective, FINDER_QUANTUM_PX);
  const estimate = perspectiveFromRadii(measuredRadii);
  const restoredRaster = rectifyThreeFaces(rendered.raster, estimate.perspective);
  const restored = judge(restoredRaster);
  const resolution = meshResolution(rendered.mesh);
  const tag = `t${String(perspective).replace('.', '_')}`;
  writeFileSync(`${OUT}/${tag}-raw.png`, Buffer.from(rasterToPng(rendered.raster)));
  writeFileSync(`${OUT}/${tag}-restored.png`, Buffer.from(rasterToPng(restoredRaster)));
  const row = {
    perspective,
    alphaDeg: perspective * 60,
    inScope: perspective <= TARGET_MAX,
    finder: {
      innerRadiusPx: measuredRadii.innerMean * PPU,
      outerRadiusPx: measuredRadii.outerMean * PPU,
      rawRatio: estimate.observedRatio,
      normalizedRatio: estimate.lambda,
      exactEstimatedPerspective: exact.perspective,
      quantizedEstimatedPerspective: estimate.perspective,
      estimateError: estimate.perspective - perspective,
    },
    resolution,
    raw: raw.verdict,
    restored: restored.verdict,
  };
  rows.push(row);
  console.log(
    `t=${perspective.toFixed(2)} λ=${estimate.lambda.toFixed(6)} `
    + `t̂=${estimate.perspective.toFixed(6)} err=${row.finder.estimateError.toExponential(2)} `
    + `min=${resolution.minAreaEquivalentCellPx.toFixed(2)}px `
    + `raw=${raw.verdict} → restored=${restored.verdict}`,
  );
}

const scoped = rows.filter((row) => row.inScope && row.resolution.visibleFaces.length === 3);
const rawOk = scoped.filter((row) => row.raw === 'ok');
const restoredOk = scoped.filter((row) => row.restored === 'ok');
const rawLast = rawOk.at(-1)?.perspective ?? null;
const restoredLast = restoredOk.at(-1)?.perspective ?? null;
const maxEstimateError = Math.max(...rows.map((row) => Math.abs(row.finder.estimateError)));
const relation = {
  canonicalInnerRadiusCells: canonicalRadii.innerMean,
  canonicalOuterRadiusCells: canonicalRadii.outerMean,
  canonicalRatio,
  innerDepthMagnitude,
  outerDepth,
  radius3d,
  formula: 'lambda=(rInner/rOuter)/(1.5/11.5); e=(lambda-1)/(lambda*dNear+dFar); t=asin(e*R)/(pi/3)',
};
const manifest = {
  note: 'Type Y 파인더 상대배치 기반 역왜곡 설계 연구. 프로덕션 구현 아님.',
  payload: PAYLOAD,
  material: { cellSurfaceLayout: 'v0', tones: 3, eccLevel: 'M', n, ppu: PPU },
  locatorMeasurement: {
    mode: '렌더 기하 oracle 중심좌표를 0.25px로 양자화',
    limitation: '픽셀에서 파인더 중심을 찾는 검출기는 이 실험 범위 밖',
  },
  relation,
  baseline: { raw: baselineRaw.verdict, restored: baselineRestored.verdict },
  targetMax: TARGET_MAX,
  summary: {
    rawLastSuccessInScope: rawLast,
    restoredLastSuccessInScope: restoredLast,
    rawSuccessesInScope: rawOk.length,
    restoredSuccessesInScope: restoredOk.length,
    scopedCount: scoped.length,
    maxPerspectiveEstimateError: maxEstimateError,
  },
  rows,
};
writeFileSync(`${OUT}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync(
  `${OUT}/relation.csv`,
  [
    't,alpha_deg,lambda,t_hat,error,min_cell_px,raw,restored',
    ...rows.map((row) => [
      row.perspective,
      row.alphaDeg,
      row.finder.normalizedRatio,
      row.finder.quantizedEstimatedPerspective,
      row.finder.estimateError,
      row.resolution.minAreaEquivalentCellPx,
      row.raw,
      row.restored,
    ].join(',')),
  ].join('\n') + '\n',
);
console.log(`설계 범위 t<=${TARGET_MAX}: raw 마지막 성공=${rawLast}, restored 마지막 성공=${restoredLast}`);
console.log(`파인더 t 추정 최대오차=${maxEstimateError}`);
