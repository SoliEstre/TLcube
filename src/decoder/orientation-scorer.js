/**
 * orientation-scorer.js — 레이아웃 주도·타입 비종속 방향 채점기 (O/A/K 대비).
 *
 * `cellSurfaceY-detect.js` 는 face-only 다 — 가설이 «면 순환 3상» 뿐이고 좌표는
 * 항등이라 Type Y(큐브) 전용이다. O/A/K 의 물리 120° 회전은 **좌표 회전 ∘ 면 순환**
 * 합성 사상이므로(`claude-rotation-kat.md` §2·§3 전 구간 실측: rotate120(q,r)=(−q−r,q)
 * ∘ σ_cw T→R→L), 이 모듈은 사상 자체를 가설로 받는다:
 *
 *   가설 = { id, mapKey: key → key|null, faceMap: {T,L,R} }
 *
 * 레이아웃은 [{ key, tones:{T,L,R} }] — key 는 불투명 문자열이라 hex(q,r)·tri·별
 * 어떤 격자든 같은 코드로 채점한다 (타입 비종속). 두 모드:
 *
 *   · idealAgreement / scoreLayoutOrientation — 무노이즈 설계 지표 (margin 산출).
 *     자 검증: 이 모드는 Y 정본 4종(v0w 0.0952 · v0w2 0.1512 · v0wq 0.0889 ·
 *     v0wy 0.0796)의 margin 을 `cellSurfaceY-detect` ideal 채점과 **동일하게**
 *     재현한다 — `test/orientation-scorer.test.js` 가 두 채점기를 나란히 돌려
 *     고정한다. oak 7후보 정본 margin 재현은 `test/output/lanes/claude-oak-margins.mjs`.
 *   · scoreSampledOrientation — 표본(면별 median 상대휘도) 채점. 분류 파이프라인은
 *     cellSurfaceY-detect 와 같은 구조(가설별 기대 0/2 슬롯 median 앵커 →
 *     classifyTone)이고 문턱도 같은 값이다 (agreement 0.78 · margin 0.035 ·
 *     midFraction 0.28 · 면별 톤당 표본 8). **완화 금지 목록의 값과 동일 — 이
 *     모듈은 어떤 게이트도 내리지 않는다.**
 *
 * 이 모듈은 아직 어떤 파이프라인에도 배선되지 않았고(MODULE_ORDER 미등재 —
 * corner-marker-detect 전례), 번들 바이트에 영향이 없다. 배선은 통합자 몫이다.
 */

export const FACES3 = Object.freeze(['T', 'L', 'R']);

/** 물리 120° CW 회전의 면 내용 이동 (T 의 내용이 R 로). rotation-kat 실측 고정. */
export const FACE_CYCLE_CW = Object.freeze({ T: 'R', R: 'L', L: 'T' });
/** 240° CW = σ². */
export const FACE_CYCLE_CW2 = Object.freeze({ T: 'L', L: 'R', R: 'T' });
export const FACE_IDENTITY = Object.freeze({ T: 'T', L: 'L', R: 'R' });

/** cellSurfaceY-detect(UNVERIFIED_CELL_SURFACE_Y)와 같은 값 — 완화 아님, 동일 계승. */
export const UNVERIFIED_ORIENTATION_SCORER = Object.freeze({
  minimumAgreement: 0.78,
  minimumOrientationMargin: 0.035,
  minimumSamplesPerTone: 8,
  classifyMidFraction: 0.28,
});

function cfgFor(options) {
  const supplied = options && options.calibration && typeof options.calibration === 'object'
    ? options.calibration
    : {};
  const overlay = supplied.orientationScorer && typeof supplied.orientationScorer === 'object'
    ? supplied.orientationScorer
    : {};
  return { ...UNVERIFIED_ORIENTATION_SCORER, ...overlay };
}

function assertLayout(layout) {
  if (!Array.isArray(layout) || layout.length === 0) {
    throw new TypeError('layout 은 비어 있지 않은 배열이어야 한다');
  }
  for (const entry of layout) {
    if (!entry || typeof entry.key !== 'string' || !entry.tones) {
      throw new TypeError('layout 항목은 { key: string, tones: {T,L,R} } 여야 한다');
    }
    for (const face of FACES3) {
      const tone = entry.tones[face];
      if (tone !== 0 && tone !== 1 && tone !== 2) {
        throw new RangeError('톤은 0/1/2 여야 한다: ' + entry.key + '.' + face + ' = ' + tone);
      }
    }
  }
}

function assertHypothesis(h) {
  if (!h || typeof h.id !== 'string' || typeof h.mapKey !== 'function' || !h.faceMap) {
    throw new TypeError('가설은 { id, mapKey: fn, faceMap: {T,L,R} } 여야 한다');
  }
  for (const face of FACES3) {
    if (!FACES3.includes(h.faceMap[face])) {
      throw new RangeError('faceMap.' + face + ' 이 T/L/R 이 아니다: ' + h.faceMap[face]);
    }
  }
}

/**
 * 무노이즈 agreement — 가설 사상으로 옮긴 기대 톤이 원 톤과 일치하는 슬롯 비율.
 * 사상이 집합 밖으로 보내는 슬롯은 «불일치» 로 센다 (분모 유지 — 슬롯 수 고정).
 */
export function idealAgreement(layout, hypothesis) {
  assertLayout(layout);
  assertHypothesis(hypothesis);
  const byKey = new Map(layout.map((entry) => [entry.key, entry]));
  let matches = 0;
  let total = 0;
  let outside = 0;
  for (const entry of layout) {
    const mappedKey = hypothesis.mapKey(entry.key);
    const mapped = mappedKey === null || mappedKey === undefined ? null : byKey.get(mappedKey);
    for (const face of FACES3) {
      total += 1;
      if (!mapped) { outside += 1; continue; }
      if (mapped.tones[hypothesis.faceMap[face]] === entry.tones[face]) matches += 1;
    }
  }
  return { agreement: total > 0 ? matches / total : 0, matches, total, outside };
}

/**
 * 무노이즈 방향 채점 — hypotheses[0] = 항등(정본) 가설. margin = 항등 agreement −
 * 최고 라이벌 agreement (cellSurfaceY-detect 의 orientationMargin 과 같은 정의).
 */
export function scoreLayoutOrientation(layout, hypotheses, options) {
  if (!Array.isArray(hypotheses) || hypotheses.length < 2) {
    throw new TypeError('가설은 항등 포함 2개 이상이어야 한다');
  }
  const cfg = cfgFor(options);
  const phases = hypotheses.map((h) => ({ id: h.id, ...idealAgreement(layout, h) }));
  const claimed = phases[0];
  let rival = null;
  for (let i = 1; i < phases.length; i += 1) {
    if (!rival || phases[i].agreement > rival.agreement) rival = phases[i];
  }
  const orientationMargin = claimed.agreement - (rival ? rival.agreement : 0);
  return {
    phases,
    claimed,
    rival,
    orientationMargin,
    orientationOk: orientationMargin >= cfg.minimumOrientationMargin,
  };
}

function median(values) {
  if (!values.length) return NaN;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function classifyTone(value, dark, bright, midFraction) {
  if (!(bright > dark)) return -1;
  const span = bright - dark;
  const midLow = dark + span * (0.5 - midFraction / 2);
  const midHigh = dark + span * (0.5 + midFraction / 2);
  if (value <= midLow) return 0;
  if (value >= midHigh) return 2;
  return 1;
}

/**
 * 표본 채점 — sampleByKey: key → { T: number|null, L, R } (면별 median 상대휘도).
 * 가설별로 기대 톤 0/2 슬롯에서 dark/bright 앵커(median)를 세우고 classifyTone 으로
 * 관측 톤을 분류해 agreement 를 잰다. cellSurfaceY-detect.scoreMappedSamples 와
 * 같은 구조 — 관측이 없는 슬롯은 분모에서 빠진다 (소거 규약 승계).
 */
export function scoreSampledOrientation(layout, hypotheses, sampleByKey, options) {
  assertLayout(layout);
  if (!Array.isArray(hypotheses) || hypotheses.length < 2) {
    throw new TypeError('가설은 항등 포함 2개 이상이어야 한다');
  }
  const cfg = cfgFor(options);
  const byKey = new Map(layout.map((entry) => [entry.key, entry]));

  const phases = hypotheses.map((h) => {
    assertHypothesis(h);
    // 가설 사상으로 옮긴 기대 톤 표: 관측 슬롯 (key,face) ← 기대 tones[mapKey][faceMap]
    const expectations = [];
    for (const entry of layout) {
      const mappedKey = h.mapKey(entry.key);
      const mapped = mappedKey === null || mappedKey === undefined ? null : byKey.get(mappedKey);
      for (const face of FACES3) {
        expectations.push({
          key: entry.key,
          face,
          expected: mapped ? mapped.tones[h.faceMap[face]] : null,
        });
      }
    }
    const darkByFace = { T: [], L: [], R: [] };
    const brightByFace = { T: [], L: [], R: [] };
    for (const slot of expectations) {
      const sample = sampleByKey(slot.key);
      const value = sample && Number.isFinite(sample[slot.face]) ? sample[slot.face] : null;
      if (value === null || slot.expected === null) continue;
      if (slot.expected === 0) darkByFace[slot.face].push(value);
      else if (slot.expected === 2) brightByFace[slot.face].push(value);
    }
    // ⭐ **앵커 주입 (2026-08-25, F-111)** — `options.toneAnchors` 가 있으면 그것을
    // 쓴다. 없으면 종전과 **한 비트도 다르지 않게** 이 layout 에서 유도한다.
    //
    // 왜 필요한가: 절대 톤 분류의 dark/bright 앵커는 «이 프레임에서 무엇이 어둡고
    // 무엇이 밝은가» 라는 **프레임 수준 성질**인데, 호출자가 layout 을 작게 쪼개
    // 부르면 (면,톤) 조합당 표본이 1\~2개로 떨어져 중앙값이 잡음이 된다.
    // 실측(코너 마커 × CO2): 묶음당 톤 셀 2개(6슬롯)면 49/63, 마커 전체 6셀
    // (18슬롯)로 풀링하면 **18/18 → 63/63**. 게이트 값은 아무것도 안 바꾼다 —
    // 바뀌는 것은 «무엇을 표본으로 삼아 앵커를 세우는가» 뿐이다.
    const injected = options && options.toneAnchors;
    const anchors = {};
    const sampleCounts = {};
    for (const face of FACES3) {
      anchors[face] = injected && injected[face]
        ? { dark: injected[face].dark, bright: injected[face].bright }
        : { dark: median(darkByFace[face]), bright: median(brightByFace[face]) };
      // ⚠ sampleCounts 는 언제나 **이 layout 이 직접 본 것**을 센다 — 앵커를 주입받아도
      // 그대로다. 주입 시엔 앵커의 출처가 여기가 아니므로, 이 수를 «앵커가 굶었다» 의
      // 근거로 읽으면 오진이다. 그래서 anchorsInjected 를 함께 낸다.
      sampleCounts[face] = { dark: darkByFace[face].length, bright: brightByFace[face].length };
    }
    let matches = 0;
    let total = 0;
    for (const slot of expectations) {
      if (slot.expected === null) { total += 1; continue; } // 집합 밖 사상 = 불일치
      const sample = sampleByKey(slot.key);
      const value = sample && Number.isFinite(sample[slot.face]) ? sample[slot.face] : null;
      if (value === null) continue; // 관측 없음 — 분모 제외 (소거)
      const observed = classifyTone(
        value, anchors[slot.face].dark, anchors[slot.face].bright, cfg.classifyMidFraction,
      );
      total += 1;
      if (observed === slot.expected) matches += 1;
    }
    const enoughSamples = FACES3.every((face) =>
      sampleCounts[face].dark >= cfg.minimumSamplesPerTone
      && sampleCounts[face].bright >= cfg.minimumSamplesPerTone);
    return {
      id: h.id,
      agreement: total > 0 ? matches / total : 0,
      matches,
      total,
      anchors,
      anchorsInjected: Boolean(injected),
      sampleCounts,
      enoughSamples,
    };
  });

  const ranked = phases.slice().sort((a, b) => b.agreement - a.agreement);
  const claimed = ranked[0];
  const rival = ranked[1] || null;
  const orientationMargin = claimed.agreement - (rival ? rival.agreement : 0);
  const accepted = claimed.enoughSamples
    && claimed.agreement >= cfg.minimumAgreement
    && orientationMargin >= cfg.minimumOrientationMargin;
  let rejectReason = null;
  if (!accepted) {
    if (!claimed.enoughSamples) rejectReason = 'sample-count';
    else if (claimed.agreement < cfg.minimumAgreement) rejectReason = 'below-agreement';
    else rejectReason = 'orientation-margin';
  }
  return { phases, claimed, rival, orientationMargin, accepted, rejectReason };
}

// ─────────────────────────────────────────────────────────────────────────────
// hex(q,r) 레이아웃 헬퍼 — O/A/K 공용. key = "q,r".
// ─────────────────────────────────────────────────────────────────────────────

export function hexKey(q, r) {
  return q + ',' + r;
}

function parseHexKey(key) {
  const comma = key.indexOf(',');
  return { q: Number(key.slice(0, comma)), r: Number(key.slice(comma + 1)) };
}

function hexMapKey(coordMap) {
  return (key) => {
    const { q, r } = parseHexKey(key);
    const m = coordMap(q, r);
    return hexKey(m.q, m.r);
  };
}

/**
 * hex 격자의 정규 회전 가설 3상 — 항등 · 120°(rotate120∘σ) · 240°(rotate240∘σ²).
 * 좌표 사상과 면 순환의 짝은 rotation-kat 실측으로 고정된 물리 합성이다.
 */
export function hexRotationHypotheses() {
  const rot120 = (q, r) => ({ q: -q - r, r: q });
  const rot240 = (q, r) => ({ q: r, r: -q - r });
  return [
    { id: 'identity', mapKey: (key) => key, faceMap: FACE_IDENTITY },
    { id: 'rot120', mapKey: hexMapKey(rot120), faceMap: FACE_CYCLE_CW },
    { id: 'rot240', mapKey: hexMapKey(rot240), faceMap: FACE_CYCLE_CW2 },
  ];
}

/**
 * 60°급·거울 오가설 사상 (margin 이 커버하지 않는 클래스 — oak 검토 §4-8).
 * 60° CW 좌표: (q,r) → (−r, q+r) — rot60∘rot60 = rotate120 으로 방향을 고정했다.
 * 거울(수평 반전, det<0): (q,r) → (−q−r, r) — axialToPixel 이 x ∝ q + r/2 ·
 * y ∝ r 이므로 x 반전은 q → −q−r, r 불변이다. 면 사상은 «가설» 이므로 세 순환을
 * 전부 시험하는 쪽이 스윕 하네스 몫이다 (이 모듈은 사상 부품만 제공).
 */
export function hexAuxCoordMaps() {
  return {
    rot60: (q, r) => ({ q: -r, r: q + r }),
    rot180: (q, r) => ({ q: -q, r: -r }),
    rot300: (q, r) => ({ q: q + r, r: -q }),
    mirror: (q, r) => ({ q: -q - r, r }),
  };
}

/** hex 셀 목록 [{q,r,tones}] → 이 모듈의 레이아웃 형식. */
export function hexLayoutFrom(cells) {
  return cells.map((cell) => ({ key: hexKey(cell.q, cell.r), tones: cell.tones }));
}

/** hexAuxCoordMaps 의 좌표 사상 하나를 가설로 감싼다. */
export function hexHypothesis(id, coordMap, faceMap) {
  return { id, mapKey: hexMapKey(coordMap), faceMap };
}
