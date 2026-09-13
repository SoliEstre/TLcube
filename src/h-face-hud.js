/** 검출 면의 화면 전용 전개도·사영 라벨. 본문 수용이나 검출 입력을 바꾸지 않아요. */
import { H_FACE_IDS,hModeFaces } from './h-profile.js';
import { hProgressModel } from './h-scanner-ui.js';
export { H_FACE_IDS };

// 수평 지그재그: ZM—XP / YM—ZP / XM—YP. 접힘 basis는 테스트에서 검증해요.
export const H_FACE_NET = Object.freeze({
  ZM: Object.freeze({ x: 0, y: 0 }), XP: Object.freeze({ x: 1, y: 0 }),
  YM: Object.freeze({ x: 1, y: 1 }), ZP: Object.freeze({ x: 2, y: 1 }),
  XM: Object.freeze({ x: 2, y: 2 }), YP: Object.freeze({ x: 3, y: 2 }),
});
export const H_FACE_NET_EDGES = Object.freeze([
  ['ZM','XP'], ['XP','YM'], ['YM','ZP'], ['ZP','XM'], ['XM','YP'],
].map(Object.freeze));

export const H_LIVE_FACE_MAX_AGE_MS = 500;

function finite(value) { return Number.isFinite(value); }
function freshAt(at, now, maxAgeMs = H_LIVE_FACE_MAX_AGE_MS) {
  return finite(at) && finite(now) && now >= at && now - at <= maxAgeMs;
}

/** TTL·수집 상태는 기존 문구 모델과 한 판정을 공유해요. */
export function hFaceNetModel(stats, now) {
  const progress = hProgressModel(stats, 'en', { now });
  const needed=progress.required?hModeFaces(progress.required):[];
  const live = freshAt(stats?.observedAt, now);
  const observed = new Set(live ? (stats?.observedFaces ?? []).map(row => row?.face) : []);
  return { required: progress.required, present: progress.present, live,
    cells: H_FACE_IDS.map(face => ({ face, ...H_FACE_NET[face],
      needed: needed.includes(face),
      state: !needed.includes(face) ? 'NOT_REQUIRED'
        : observed.has(face) ? 'CURRENT' : progress.present.includes(face) ? 'PRESENT' : 'MISSING',
    })),
  };
}

function project(H, x, y) {
  const d = H[6] * x + H[7] * y + H[8];
  if (!finite(d) || Math.abs(d) < 1e-9) return null;
  const px = (H[0] * x + H[1] * y + H[2]) / d;
  const py = (H[3] * x + H[4] * y + H[5]) / d;
  return finite(px) && finite(py) ? { x: px, y: py } : null;
}

/**
 * detector crop과 preview source window에서 frame -> stage affine을 유도해요.
 * H는 현재 R2보다 넓은 crop일 수 있어 `side / frameWidth` 추정은 허용하지 않아요.
 */
export function hFrameToStageMapping({ frameCrop, stageCrop, side, mirrorX = false } = {}) {
  if (!finite(side) || side <= 0 || mirrorX !== false
    || !finite(frameCrop?.sourceX) || !finite(frameCrop?.sourceY) || !finite(frameCrop?.sourceSide) || !finite(frameCrop?.target)
    || !finite(stageCrop?.x) || !finite(stageCrop?.y) || !finite(stageCrop?.width) || !finite(stageCrop?.height)
    || frameCrop.sourceSide <= 0 || frameCrop.target <= 0 || stageCrop.width <= 0 || stageCrop.height <= 0) return null;
  return Object.freeze({ verified: true, mirrorX: false, frameToStage: Object.freeze({
    xScale: (frameCrop.sourceSide / frameCrop.target) * (side / stageCrop.width),
    xOffset: (frameCrop.sourceX - stageCrop.x) * (side / stageCrop.width),
    yScale: (frameCrop.sourceSide / frameCrop.target) * (side / stageCrop.height),
    yOffset: (frameCrop.sourceY - stageCrop.y) * (side / stageCrop.height),
  }) });
}

function stageHomography(H, n, mapping) {
  const map = mapping?.frameToStage;
  if (!H || H.length !== 9 || !finite(n) || n <= 0 || !finite(map?.xScale) || !finite(map?.xOffset)
    || !finite(map?.yScale) || !finite(map?.yOffset) || map.xScale <= 0 || map.yScale <= 0) return null;
  const sx = map.xScale; const sy = map.yScale; const ox = map.xOffset; const oy = map.yOffset;
  const raw = [
    sx * H[0] * n + ox * H[6] * n, sx * H[1] * n + ox * H[7] * n, sx * H[2] + ox * H[8],
    sy * H[3] * n + oy * H[6] * n, sy * H[4] * n + oy * H[7] * n, sy * H[5] + oy * H[8],
    H[6] * n, H[7] * n, H[8],
  ];
  if (!raw.every(finite) || Math.abs(raw[8]) < 1e-9) return null;
  return raw.map((value) => value / raw[8]);
}

/** CSS matrix3d는 (x,y,0,1)을 H의 projective denominator까지 보존해 사영해요. */
export function cssMatrix3dForHomography(H, sourceSide = 100) {
  if (!H || H.length !== 9 || !H.every(finite) || !finite(sourceSide) || sourceSide <= 0 || Math.abs(H[8]) < 1e-9) return null;
  const h = H.map((value) => value / H[8]);
  const values = [
    h[0] / sourceSide, h[3] / sourceSide, 0, h[6] / sourceSide,
    h[1] / sourceSide, h[4] / sourceSide, 0, h[7] / sourceSide,
    0, 0, 1, 0,
    h[2], h[5], 0, 1,
  ];
  return values.every(finite) ? `matrix3d(${values.map((value) => Number(value.toFixed(12))).join(',')})` : null;
}

function labelObservation(row, mapping) {
  const H = stageHomography(row?.H, row?.n, mapping);
  const matrix3d = cssMatrix3dForHomography(H);
  if (!H || !matrix3d) return null;
  // 면 내부에서 사영 분모가 0을 지나면 무한대/뒤집힌 라벨이 될 수 있어요.
  if ([H[8], H[6]+H[8], H[6]+H[7]+H[8], H[7]+H[8]].some(d => d <= 1e-9)) return null;
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([x, y]) => project(H, x, y));
  if (corners.some((point) => point === null)) return null;
  return Object.freeze({ face: row.face, H: Object.freeze(H), matrix3d, corners: Object.freeze(corners) });
}

/**
 * `mapping.verified`는 detector crop과 preview crop에서 만든 hFrameToStageMapping일 때만 true예요.
 * 사진·미러·수동 크롭 실패·카메라 종료에는 숨김으로 귀결시켜 잔상을 허용하지 않아요.
 */
export function hLiveFaceLabelsModel({ stats, now, source = 'camera', cameraActive = false, runtimeEnabled = false, mapping } = {}) {
  const validMapping = mapping?.verified === true && mapping?.mirrorX === false;
  if (source !== 'camera' || !cameraActive || !runtimeEnabled || !validMapping
    || !freshAt(stats?.observedAt, now)) return Object.freeze([]);
  const required=hFaceNetModel(stats, now).required;
  const needed = required?hModeFaces(required):[];
  const unique = new Map();
  for (const row of stats?.observedFaces ?? []) {
    if (!needed.includes(row?.face)) continue;
    const prior = unique.get(row.face);
    if (!prior || (row?.quality?.score ?? -Infinity) > (prior?.quality?.score ?? -Infinity)) unique.set(row.face, row);
  }
  return Object.freeze([...unique.values()].map((row) => labelObservation(row, mapping)).filter(Boolean));
}
