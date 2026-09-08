const EPSILON = 1e-12;

/*
 * scene.js가 19셀 슬롯의 최대 보호 정사각을 48회 이분탐색하고 0.995 여유를
 * 적용해 얻는 QR 모듈 피치/cellSize. 중앙 QR 세 파인더를 셀 좌표로 옮기는 와이어 값이다.
 */
const CENTER_QR_MODULE_TO_CELL = 0.2247900722;

function affineHomographyFromThree(canonical, observed) {
  const ux = canonical[1].x - canonical[0].x;
  const uy = canonical[1].y - canonical[0].y;
  const vx = canonical[2].x - canonical[0].x;
  const vy = canonical[2].y - canonical[0].y;
  const det = ux * vy - uy * vx;
  if (Math.abs(det) <= EPSILON) return null;
  const imageU = {
    x: observed[1].x - observed[0].x,
    y: observed[1].y - observed[0].y,
  };
  const imageV = {
    x: observed[2].x - observed[0].x,
    y: observed[2].y - observed[0].y,
  };
  const a = (imageU.x * vy - imageV.x * uy) / det;
  const b = (-imageU.x * vx + imageV.x * ux) / det;
  const d = (imageU.y * vy - imageV.y * uy) / det;
  const e = (-imageU.y * vx + imageV.y * ux) / det;
  return new Float64Array([
    a, b, observed[0].x - a * canonical[0].x - b * canonical[0].y,
    d, e, observed[0].y - d * canonical[0].x - e * canonical[0].y,
    0, 0, 1,
  ]);
}

function qrCenterHomographies(candidate) {
  const offset = 7 * CENTER_QR_MODULE_TO_CELL;
  const canonical = [
    { x: -offset, y: -offset },
    { x: offset, y: -offset },
    { x: -offset, y: offset },
  ];
  return [
    [candidate.shared, candidate.axisA, candidate.axisB],
    [candidate.shared, candidate.axisB, candidate.axisA],
  ].map((observed) => affineHomographyFromThree(canonical, observed))
    .filter(Boolean);
}

export { CENTER_QR_MODULE_TO_CELL, affineHomographyFromThree, qrCenterHomographies };
