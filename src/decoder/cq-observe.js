import { TYPE_C_RADII } from '../formatC.js';
import { qrCenterHomographies } from './qr-center-geometry.js';
import { detectQrFinderTriples } from './qr-finder-observe.js';

function snapshotPoint(point) {
  return Object.freeze({
    x: point.x,
    y: point.y,
    module: point.module,
    count: point.count,
  });
}

function snapshotQrCandidate(candidate) {
  return Object.freeze({
    kind: candidate.kind,
    kindMargin: candidate.kindMargin,
    kindAmbiguous: candidate.kindAmbiguous === true,
    score: candidate.score,
    cosine: candidate.cosine,
    module: candidate.module,
    legA: candidate.legA,
    legB: candidate.legB,
    center: Object.freeze({ x: candidate.center.x, y: candidate.center.y }),
    shared: snapshotPoint(candidate.shared),
    axisA: snapshotPoint(candidate.axisA),
    axisB: snapshotPoint(candidate.axisB),
  });
}

/**
 * 중앙 QR finder에서 Type C 기하 관측을 지연 생성한다.
 *
 * 이 모듈은 포즈 후보만 만든다. 노치·포맷·바인딩·표본·본문 판단은 소비자가 맡으며,
 * 그 경계를 넘는 adapter-c import는 순환 의존과 조기 정책 주입을 만들므로 금지한다.
 */
export function* observeCqQrGeometry(luma, options = {}) {
  const detected = detectQrFinderTriples(luma, options.qrFinder);
  if (!detected.ok) return;

  for (let qrCandidateIndex = 0;
    qrCandidateIndex < detected.candidates.length;
    qrCandidateIndex += 1) {
    const qrCandidate = detected.candidates[qrCandidateIndex];
    if (qrCandidate.kind !== 'center' && qrCandidate.kindAmbiguous !== true) continue;

    const homographies = qrCenterHomographies(qrCandidate);
    const qrCandidateSnapshot = snapshotQrCandidate(qrCandidate);
    for (let axisIndex = 0; axisIndex < homographies.length; axisIndex += 1) {
      const H = homographies[axisIndex];
      for (const k of TYPE_C_RADII) {
        yield Object.freeze({
          sourceKind: 'c-cq',
          // 소비자는 H를 소유한다. 한 후보의 fill/보정이 다음 반경 후보로 새지 않는다.
          H: H.slice(),
          k,
          orientation: axisIndex,
          qrCandidateIndex,
          axisIndex,
          qrKind: qrCandidateSnapshot.kind,
          qrKindAmbiguous: qrCandidateSnapshot.kindAmbiguous,
          qrCandidate: qrCandidateSnapshot,
        });
      }
    }
  }
}
