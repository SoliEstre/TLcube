/**
 * corner-qr-seed.js — 코드 바깥 코너 QR의 정면 조대 포즈 역산.
 *
 * QR matrix는 코너에 놓여도 회전하지 않는다. 따라서 1:1:3:1:1 세 개가 이루는
 * 직각의 꼭짓점은 항상 QR-TL이고, 비어 있는 파인더 자리(QR-BR)는 matrix 기준으로
 *만 고정이다. 그것이 코드 쪽이라는 가정은 TL 배치에서만 성립한다. 이 모듈은 그
 * 가정을 쓰지 않고, QR의 두 축 위에서 네 외부 배치를 모두 전개한다.
 *
 * 이 파일은 기하만 만든다. 소비자는 반드시 자체 refine를 통과시킨 뒤에만 결과를
 * 포즈 후보로 승격해야 한다. 정면 모델이므로 projective/기울기 보정도 하지 않는다.
 */

export const CORNER_QR_PLACEMENTS = Object.freeze(['TL', 'TR', 'BL', 'BR']);

/** QR-v1에서 TL 파인더 중심은 (3,3), 중심은 (10,10)이다. */
export const QR_FINDER_CENTER_TO_MATRIX_CENTER_MODULES = 7;
export const QR_FINDER_CENTER_SPAN_MODULES = 14;

const EPSILON = 1e-9;

function point(value, name) {
  if (!value || !Number.isFinite(value.x) || !Number.isFinite(value.y)) {
    throw new TypeError(`${name}는 유한한 x/y 점이어야 한다`);
  }
  return value;
}

function positive(value, name) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${name}는 양수여야 한다`);
  return value;
}

function offsets(value) {
  if (Number.isFinite(value)) {
    const scalar = positive(value, 'centerOffsetModules');
    return { x: scalar, y: scalar };
  }
  if (!value || typeof value !== 'object') throw new TypeError('centerOffsetModules가 필요하다');
  return { x: positive(value.x, 'centerOffsetModules.x'), y: positive(value.y, 'centerOffsetModules.y') };
}

/**
 * QR 삼중점의 직각 꼭짓점(TL)에서 두 다른 파인더로 향하는 축을 돌려 준다.
 * detectQrFinderTriples가 `shared`로 이미 직각 꼭짓점을 보존하므로, 빈 파인더를
 * 코드 방향 표식으로 재해석하지 않는다.
 */
export function qrRightAngleAxes(candidate) {
  if (!candidate || typeof candidate !== 'object') throw new TypeError('QR 삼중점 후보가 필요하다');
  const shared = point(candidate.shared, 'shared');
  const axisA = point(candidate.axisA, 'axisA');
  const axisB = point(candidate.axisB, 'axisB');
  const ux = axisA.x - shared.x;
  const uy = axisA.y - shared.y;
  const vx = axisB.x - shared.x;
  const vy = axisB.y - shared.y;
  const uLength = Math.hypot(ux, uy);
  const vLength = Math.hypot(vx, vy);
  if (!(uLength > EPSILON) || !(vLength > EPSILON)) throw new RangeError('QR 축 길이가 0이다');
  if (Math.abs(ux * vy - uy * vx) <= EPSILON * uLength * vLength) {
    throw new RangeError('QR 세 파인더가 공선이다');
  }
  return Object.freeze({
    origin: { x: shared.x, y: shared.y },
    u: { x: ux / QR_FINDER_CENTER_SPAN_MODULES, y: uy / QR_FINDER_CENTER_SPAN_MODULES },
    v: { x: vx / QR_FINDER_CENTER_SPAN_MODULES, y: vy / QR_FINDER_CENTER_SPAN_MODULES },
    module: (uLength + vLength) / (2 * QR_FINDER_CENTER_SPAN_MODULES),
  });
}

function cornerSigns(placement) {
  switch (placement) {
    case 'TL': return [1, 1];
    case 'TR': return [-1, 1];
    case 'BL': return [1, -1];
    case 'BR': return [-1, -1];
    default: throw new RangeError(`알 수 없는 QR 코너: ${placement}`);
  }
}

/**
 * QR matrix 중심에서 코드 중심까지의 정면 거리(각 축 모듈 수)를 이용해 한 배치를
 * 역산한다. `centerOffsetModules`는 실루엣별 렌더 기하에서 유도한 양수 값이다.
 */
export function invertCornerQrPlacement(candidate, placement, centerOffsetModules, cellSizePerQrModule) {
  const axes = qrRightAngleAxes(candidate);
  const distance = offsets(centerOffsetModules);
  const scale = positive(cellSizePerQrModule, 'cellSizePerQrModule');
  const [sx, sy] = cornerSigns(placement);
  const matrixCenter = {
    x: axes.origin.x + QR_FINDER_CENTER_TO_MATRIX_CENTER_MODULES * (axes.u.x + axes.v.x),
    y: axes.origin.y + QR_FINDER_CENTER_TO_MATRIX_CENTER_MODULES * (axes.u.y + axes.v.y),
  };
  return Object.freeze({
    placement,
    center: {
      x: matrixCenter.x + sx * distance.x * axes.u.x + sy * distance.y * axes.v.x,
      y: matrixCenter.y + sx * distance.x * axes.u.y + sy * distance.y * axes.v.y,
    },
    cellSize: axes.module * scale,
    qr: Object.freeze({ rightAngle: axes.origin, matrixCenter, module: axes.module }),
  });
}

/**
 * F-76 후보 전개. silhouette은 `{id, centerOffsetModules, cellSizePerQrModule}`
 * 세 개(또는 그 이상)의 렌더 기하 프로필이다. 반환 수는 후보×4×실루엣 수이며,
 * 어느 배치도 QR-BR 단독 방향으로 제거하지 않는다.
 */
export function enumerateCornerQrSeeds(candidates, silhouettes) {
  if (!Array.isArray(candidates)) throw new TypeError('QR 후보 배열이 필요하다');
  if (!Array.isArray(silhouettes) || silhouettes.length === 0) {
    throw new TypeError('실루엣 기하 프로필 배열이 필요하다');
  }
  const seeds = [];
  candidates.forEach((candidate, candidateIndex) => {
    silhouettes.forEach((silhouette, silhouetteIndex) => {
      if (!silhouette || typeof silhouette.id !== 'string' || silhouette.id === '') {
        throw new TypeError('실루엣 id가 필요하다');
      }
      for (const placement of CORNER_QR_PLACEMENTS) {
        const pose = invertCornerQrPlacement(
          candidate,
          placement,
          silhouette.centerOffsetModules,
          silhouette.cellSizePerQrModule,
        );
        seeds.push(Object.freeze({
          ...pose,
          source: 'corner-qr-seed',
          candidateIndex,
          silhouette: silhouette.id,
          silhouetteIndex,
          // 정제 전임을 명시한다. 이 값 자체는 완성 포즈로 소비하면 안 된다.
          coarseOnly: true,
        }));
      }
    });
  });
  return Object.freeze(seeds);
}
