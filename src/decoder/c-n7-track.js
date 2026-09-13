/** 격리 C 추적 실험. 현재 n7 관측 후보만 돌려주며 후보 identity/수용을 결정하지 않는다. */
import { detectCentralN7BlockShapes } from './cellsurface-block-detect.js';
import { verifyCentralN7LocatorTones, readCentralN7Payload } from './central-n7-observe.js';

const validH = H => H instanceof Float64Array && H.length === 9 && H.every(Number.isFinite);
const validPose = pose => pose && Number.isFinite(pose.center?.x) && Number.isFinite(pose.center?.y)
  && Number.isFinite(pose.modulePitch) && pose.modulePitch > 0 && Number.isFinite(pose.degrees);

/** 영상 평면의 이전→현재 similarity를 왼쪽에 곱한다. H의 원근 분모는 보존된다. */
export function moveHomographyWithN7(H, previous, current) {
  if (!validH(H) || !validPose(previous) || !validPose(current)) return null;
  const radians = (current.degrees - previous.degrees) * Math.PI / 180;
  const scale = current.modulePitch / previous.modulePitch;
  const a = scale * Math.cos(radians), b = scale * Math.sin(radians);
  const tx = current.center.x - a * previous.center.x + b * previous.center.y;
  const ty = current.center.y - b * previous.center.x - a * previous.center.y;
  const moved = new Float64Array(9);
  for (let col = 0; col < 3; col++) {
    moved[col] = a * H[col] - b * H[3 + col] + tx * H[6 + col];
    moved[3 + col] = b * H[col] + a * H[3 + col] + ty * H[6 + col];
    moved[6 + col] = H[6 + col];
  }
  return moved.every(Number.isFinite) ? moved : null;
}

/**
 * 이전 finder는 국소 seed일 뿐이다. 모든 반환 후보는 현재 픽셀에서 locator와 n7
 * codeword를 다시 읽었다. 같게 읽힌 n7만으로 본문/물체가 같다고 판단하면 안 된다.
 * 노치/표면 포맷/본문의 후속 검증과 복수 후보 정책은 호출자가 책임진다.
 */
export function reobserveCentralN7(field, finder, H, options = {}) {
  const radius = options.searchRadiusCells ?? 1;
  if (!Number.isSafeInteger(radius) || radius < 0 || radius > 2) throw new TypeError('국소 검색 반경은 0..2 셀이에요');
  const previous = { center: finder?.center, modulePitch: finder?.centralN7?.modulePitch,
    degrees: finder?.rotationDegrees };
  if (!validPose(previous) || !validH(H) || finder?.centralN7?.family !== 'hex') return [];
  if (!Number.isSafeInteger(field?.width) || !Number.isSafeInteger(field?.height)
    || field.width <= 0 || field.height <= 0 || !(field.data instanceof Float32Array)
    || field.data.length !== field.width * field.height) return [];
  const detected = detectCentralN7BlockShapes(field, [{ ...previous, center: { ...previous.center },
    searchRadiusCells: radius, outerFamily: finder.centralN7.outerSeedFamily,
    outerK: finder.centralN7.outerSeedK }]);
  const results = [];
  for (const shape of detected.shapes) {
    const current = { center: shape.center, modulePitch: shape.blockLocator.modulePitch,
      degrees: shape.blockLocator.rotationDegrees };
    const tones = verifyCentralN7LocatorTones(field, current.center, current.modulePitch, current.degrees);
    if (!tones.pass) continue;
    const payload = readCentralN7Payload(field, current.center, current.modulePitch, current.degrees, tones);
    if (!payload || payload.family !== finder.centralN7.family
      || !Array.isArray(finder.centralN7.outerFormat)
      || payload.outerFormat.length !== finder.centralN7.outerFormat.length
      || payload.outerFormat.some((digit, i) => digit !== finder.centralN7.outerFormat[i])) continue;
    const movedH = moveHomographyWithN7(H, previous, current);
    const movedSeed = moveHomographyWithN7(finder.H, previous, current);
    if (!movedH || !movedSeed) continue;
    const updated = { ...finder, center: { ...current.center }, rotationDegrees: current.degrees,
      cellSize: finder.cellSize * current.modulePitch / previous.modulePitch,
      orientation: Math.round((((current.degrees % 360) + 360) % 360) / 120) % 3,
      score: shape.score, orientationMargin: tones.agreement,
      H: movedSeed, transform: movedSeed, B: movedSeed,
      centralN7: { ...finder.centralN7, ...payload, modulePitch: current.modulePitch,
        locatorDark: tones.dark, locatorBright: tones.bright } };
    results.push({ H: movedH, finder: updated, tones, current,
      motion: { dx: current.center.x - previous.center.x, dy: current.center.y - previous.center.y,
        scale: current.modulePitch / previous.modulePitch, degrees: current.degrees - previous.degrees } });
  }
  return results;
}
