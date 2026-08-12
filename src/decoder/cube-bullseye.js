/**
 * cube-bullseye.js — 하이브리드 파인더의 «큐브 쪽» 읽기 (방향).
 *
 * 왜 별도 모듈인가: `bullseye-detect.js` 는 동심원만 안다. 하이브리드에서 그 검출기가
 * 주는 것은 **중심·스케일**뿐이고 — 그것도 원리적으로 그 이상은 줄 수 없다. 정제가
 * 최적화하는 파라미터가 SPD 행렬 S=[[a,b],[b,c]] 라서 **회전 성분이 아예 없기 때문**이다.
 * 동심원은 회전 대칭이니 당연한 설계지만, 결과적으로 파인더가 각도를 모른다.
 *
 * 안쪽 3톤 큐브는 그 빈 자리를 메운다. 밝기가 다른 마름모 3개가 120° 간격으로 놓여
 * 있으므로, 큐브 안쪽 고리를 각도로 훑으면 **3계단 파형**이 나오고 그 위상이 곧 코드의
 * 절대 회전각이다. 3택일(0°/120°/240°)이 아니라 연속 각도가 나온다 — 순수 불스아이가
 * 원리적으로 못 주던 정보다.
 *
 * ⚠ 정규화는 **큐브 원판 안의 표본만** 쓴다. 화면 촬영처럼 프레임에 베젤·UI 가 있으면
 *   전역 span 이 부풀어 선명한 신호가 0.005 로 찌그러진다 — cube-detect 의 seamEvidence
 *   가 정확히 그 함정에 빠져 있었다(2026-08-12).
 */

import { FACES, faceCentroidOffset } from '../hexgrid.js';
import { HYBRID_INNER_CUBE_BANDS, hybridCubeRadius } from '../bullseye.js';
import { FINDER_CUBE_FACE_RANKS } from '../finder-patterns.js';

/** 각도 표본 수 — 120° 마다 24점이면 위상 분해능이 5° 다. */
const ANGULAR_SAMPLES = 72;

/**
 * 표본 고리의 반지름 (큐브 외접 반지름 대비).
 *
 * 0.62 는 양끝을 피한 값이다: 안쪽은 세 면이 만나는 Y 접합(보간이 세 톤을 섞는다),
 * 바깥은 육각형 변(내접/외접 비가 0.866 이라 각도에 따라 원판이 면 밖으로 샌다).
 * 0.62 < 0.866 × 0.75 이므로 어느 각도에서도 면 안쪽에 머문다.
 */
const SAMPLE_RING_FRACTION = 0.62;

/** 조각 중앙값을 낼 때 경계에서 버리는 각도 (도) — 보간으로 두 면이 섞이는 구간. */
const BOUNDARY_GUARD_DEGREES = 12;

function projectPoint(H, x, y) {
  const w = H[6] * x + H[7] * y + H[8];
  if (!Number.isFinite(w) || Math.abs(w) < 1e-12) return null;
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
}

function sampleBilinear(luma, x, y) {
  const { width, height, data } = luma;
  if (!(x >= 0 && y >= 0 && x <= width - 1 && y <= height - 1)) return null;
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, width - 1);
  const y1 = Math.min(y0 + 1, height - 1);
  const fx = x - x0;
  const fy = y - y0;
  const top = data[y0 * width + x0] * (1 - fx) + data[y0 * width + x1] * fx;
  const bottom = data[y1 * width + x0] * (1 - fx) + data[y1 * width + x1] * fx;
  return top * (1 - fy) + bottom * fy;
}

function median(values) {
  if (values.length === 0) return Number.NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

/**
 * canonical 좌표계에서 각 면의 중심 방향(라디안). 렌더가 쓰는 `faceCentroidOffset` 을
 * 그대로 쓴다 — 여기서 각도를 새로 상수화하면 렌더와 갈라질 수 있다.
 */
function faceAngles() {
  return FACES.map((face) => {
    const offset = faceCentroidOffset(face, 1);
    return { face, angle: Math.atan2(offset.y, offset.x) };
  });
}

/**
 * 하이브리드 후보의 큐브에서 회전각과 면 배치를 읽는다.
 *
 * @param {{width:number,height:number,data:Float32Array}} luma
 * @param {{transform:number[]|Float64Array, innerBandsReplaced?:number}} candidate
 * @returns {null | {
 *   rotationDegrees:number, orientation:number, orientationMargin:number,
 *   faceMedians:Record<string, number>, separation:number, localSpan:number,
 * }}
 */
export function readCubeOrientation(luma, candidate, options = {}) {
  const H = candidate && (candidate.transform || candidate.H || candidate.B);
  if (!H || H.length !== 9) return null;
  const bands = candidate.innerBandsReplaced === undefined
    ? HYBRID_INNER_CUBE_BANDS
    : candidate.innerBandsReplaced;
  if (!(bands > 0)) return null;

  const angularSamples = options.angularSamples === undefined
    ? ANGULAR_SAMPLES
    : options.angularSamples;
  if (!Number.isInteger(angularSamples) || angularSamples < 12 || angularSamples % 3 !== 0) {
    return null;
  }

  const radius = hybridCubeRadius(1) * SAMPLE_RING_FRACTION;
  const ring = new Array(angularSamples);
  for (let index = 0; index < angularSamples; index += 1) {
    const angle = (2 * Math.PI * index) / angularSamples;
    const point = projectPoint(H, radius * Math.cos(angle), radius * Math.sin(angle));
    if (point === null) return null;
    const value = sampleBilinear(luma, point.x, point.y);
    if (value === null) return null;
    ring[index] = value;
  }

  /*
   * 위상 = 면 **경계**의 각도. 조각의 중앙값 분리 폭을 최대화하는 방식은 쓰지 않는다 —
   * 조각(120°)과 면(120°)이 같은 폭이라 «각 조각이 한 면 안에 들어가는» 정렬이 넓은
   * 구간에 걸쳐 똑같은 값을 주고, 목적함수가 평탄해져 argmax 가 그 구간의 아무 데나
   * 찍힌다. 실측으로 회전각 오차 중앙값 30°(= 평탄 구간의 반)가 나왔다.
   *
   * 대신 **차분의 3차 조화파**를 쓴다. 경계는 세 점뿐이고 120° 간격이므로, 차분
   * |v[k+1]−v[k]| 는 그 세 점에서만 크다. 임펄스 셋의 k=3 성분은 Σδ(θ−b−j·120°)·e^{-i3θ}
   * = 3·e^{-i3b} 이라 arg(Z) = −3b — 평탄부 없이 위상이 하나로 떨어진다.
   */
  let realPart = 0;
  let imaginaryPart = 0;
  for (let index = 0; index < angularSamples; index += 1) {
    const delta = Math.abs(ring[(index + 1) % angularSamples] - ring[index]);
    const midAngle = (2 * Math.PI * (index + 0.5)) / angularSamples;
    realPart += delta * Math.cos(3 * midAngle);
    imaginaryPart -= delta * Math.sin(3 * midAngle);
  }
  if (realPart === 0 && imaginaryPart === 0) return null;
  const boundaryAngle = -Math.atan2(imaginaryPart, realPart) / 3;

  const guard = (BOUNDARY_GUARD_DEGREES * Math.PI) / 180;
  const arcs = [[], [], []];
  const arcCenters = [0, 1, 2].map(
    (arc) => boundaryAngle + (Math.PI / 3) + (2 * Math.PI * arc) / 3,
  );
  for (let index = 0; index < angularSamples; index += 1) {
    const angle = (2 * Math.PI * index) / angularSamples;
    for (let arc = 0; arc < 3; arc += 1) {
      let offset = (angle - arcCenters[arc]) % (2 * Math.PI);
      if (offset > Math.PI) offset -= 2 * Math.PI;
      if (offset < -Math.PI) offset += 2 * Math.PI;
      if (Math.abs(offset) <= Math.PI / 3 - guard) {
        arcs[arc].push(ring[index]);
        break;
      }
    }
  }
  if (arcs.some((arc) => arc.length === 0)) return null;
  const medians = arcs.map(median);
  const best = { medians, separation: Math.max(...medians) - Math.min(...medians) };
  /*
   * 면은 **평평**하다. 이 값이 왜 필요한가: 순수 불스아이를 하이브리드로 오독하면
   * 표본 고리가 균일한 밴드 안에 있어 세 중앙값이 붙는 게 정상인데, 후보 중심이 어긋나
   * 고리가 밴드 경계를 스치면 «세 조각이 서로 다른» 모양이 우연히 나온다(실측 최대
   * margin 0.284, 진짜 큐브 최소 0.376 — 순위 간격만으로는 여유가 얇다).
   * 그때는 조각 **안**이 기울어 있어 MAD 가 크다. 진짜 면은 MAD 가 0 에 붙는다.
   */
  const arcMads = arcs.map((arc, index) => median(arc.map((v) => Math.abs(v - medians[index]))));
  const maximumArcMad = Math.max(...arcMads);

  const localSpan = Math.max(...ring) - Math.min(...ring);
  const arcCenterAngle = arcCenters[0];

  /*
   * 관측된 밝기 순위 → 면 배치. FINDER_CUBE_FACE_RANKS 는 canonical 배치에서 각 면이
   * 몇 번째로 밝은지를 준다(2 = 가장 밝음). 관측 조각 셋의 순위를 같은 규약으로 매기고,
   * 「가장 밝은 조각」이 canonical 에서 그 순위를 가진 면이라고 읽는다.
   */
  const order = best.medians
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value);
  const arcRank = new Array(3);
  for (let rank = 0; rank < 3; rank += 1) arcRank[order[rank].index] = rank;

  const canonicalFaceAngles = faceAngles();
  const brightestFace = canonicalFaceAngles.find(
    (entry) => FINDER_CUBE_FACE_RANKS[entry.face] === 2,
  );
  const brightestArc = arcRank.indexOf(2);
  const observedAngle = arcCenterAngle + (2 * Math.PI * brightestArc) / 3;
  let rotation = observedAngle - brightestFace.angle;
  rotation = ((rotation * 180) / Math.PI) % 360;
  if (rotation < 0) rotation += 360;

  const sorted = best.medians.slice().sort((a, b) => a - b);
  const minimumGap = Math.min(sorted[1] - sorted[0], sorted[2] - sorted[1]);
  const faceMedians = {};
  for (const entry of canonicalFaceAngles) {
    const rank = FINDER_CUBE_FACE_RANKS[entry.face];
    faceMedians[entry.face] = best.medians[arcRank.indexOf(rank)];
  }

  return {
    rotationDegrees: rotation,
    orientation: Math.round(rotation / 120) % 3,
    // 순위가 «간신히» 갈린 것과 확실히 갈린 것을 구분한다. 국소 span 으로만 나눈다.
    orientationMargin: localSpan > 0 ? minimumGap / localSpan : 0,
    // 면 간 간격이 면 **안**의 흔들림보다 얼마나 큰가. 평평한 세 면이면 1 에 붙는다.
    faceFlatness: minimumGap + maximumArcMad > 0
      ? minimumGap / (minimumGap + maximumArcMad)
      : 0,
    separation: best.separation,
    localSpan,
    faceMedians,
  };
}
