/**
 * format-read.js — **포맷 워드 읽기 계층.** `bootstrap.js` 에서 그대로 옮겨 왔다.
 *
 * 🔴 왜 분리했나 (2026-09-04, PM/029B §21·§23.3): R2 의 A3 어댑터가 로케이터 포즈에서
 * 포맷을 읽으려면 `readFormatForHypothesis` 가 필요한데, 그것이 `bootstrap.js` 안에
 * 있었다. 그 파일은 **82파일 폐포**라 import 하는 순간 R2 의 의존이 30 → 89 파일이 되고
 * 거기에 **`src/decode.js`(R2 가 대체하려고 존재하는 R1 하드결정 복호기)** 와
 * **`src/encodeY.js`(인코더)** 가 딸려 온다 (통합자 실측).
 * 클린룸의 존재 이유는 export 개수가 아니라 **C++ 이식 범위 봉쇄**다 (§0:10 · §6).
 * 이 파일로 뽑으면 그 증분이 **+9 파일**이고 위 넷이 전부 안 들어온다.
 *
 * ⚠ **순수 이동이다.** 함수 본문·주석을 한 글자도 안 고쳤다. R1 은 `bootstrap.js` 가
 * 이 파일을 import 해서 쓰므로 동작이 같다 — 그 동일성을 지키는 것은 전수 스위트다.
 * 여기에 R2 전용 로직을 **넣지 마라**: 그러면 R1·R2 가 다른 포맷을 읽게 된다.
 *
 * ⚠ `bootstrap.js` 를 import 하지 않는다 (그러면 분리한 의미가 없다).
 * `test/r2-cleanroom.test.js` 의 폐포 단언이 그 규칙을 지킨다.
 */

import {
  VERSIONS,
} from '../capacity.js';
import {
  VERSIONS_A,
} from '../capacityA.js';
import {
  VERSIONS_C,
} from '../capacityC.js';
import {
  VERSIONS_K,
} from '../capacityK.js';
import {
  VERSIONS_Y,
  windowedFormatCellsY,
} from '../capacityY.js';
import {
  CELL_SURFACE_FINAL_FORMAT_WIRE,
  CELL_SURFACE_FINAL_FORMAT_WIRES,
  formatCellsCellSurfaceFinal,
  formatIndexCellSurfaceFinal,
  hasLegacyFormatWire,
  isCellSurfaceFinalId,
} from '../cellSurfaceFinal.js';
import {
  formatCellsCellSurfaceLayout,
  formatIndexCellSurfaceLayout,
} from '../cellSurfaceLayouts.js';
import {
  CELL_SURFACE_FORMAT_INDEX_2T,
  CELL_SURFACE_FORMAT_INDEX_3T,
  formatCellsCellSurface,
  formatIndexCellSurface,
} from '../cellSurfaceY.js';
import {
  enumerateFormatProposals,
  enumerateFormatProposalsV2,
} from '../format-proposals.js';
import {
  C_FORMAT_INDEX,
} from '../formatC.js';
import {
  K_MARKER_FORMAT_INDEX,
  kSpecFromFormatIndex,
} from '../formatK.js';
import {
  DIGIT_COUNT_V2,
} from '../formatinfo.js';
import {
  formatCells,
} from '../layout.js';
import {
  // bootstrap 이 별칭으로 쓰던 이름 그대로 유지한다 (원본: formatCells as formatCellsY).
  formatCells as formatCellsY,
} from '../layoutY.js';
import {
  ranksToDigit,
} from '../lehmer.js';
import {
  markerGSpec,
} from '../markerG.js';
import {
  VERSIONS_KCM,
} from '../markerK.js';
import {
  TURN_A_FORMAT_INDEX,
} from '../turnA.js';
import {
  FRONTEND_FAILURE,
  assertLumaField,
  fail,
  ok,
} from './contracts.js';
import {
  UNVERIFIED_CUBE_DETECTION,
  readCubeDigit,
  sampleCubeCell,
} from './cube-detect.js';
import {
  sampleHexCell,
} from './grid-sample.js';

export function familyProfiles(family) {
  // 내부 타입 G(코너 마커) 인덱스도 이 (family, k) 소유다 — `markerG.js` 표 주도.
  // 여기 넣어야 formatIndexOwners(재배치·재라벨)와 profileForFormatCandidate 가
  // G 인덱스로 읽힌 프레임을 자기 패밀리로 되짚을 수 있다.
  if (family === 'hex') {
    const legacy = VERSIONS.map((spec) => ({
      family,
      dimension: spec.k,
      spec,
      formatIndices: [
        spec.version - 1, spec.version + 3,
        markerGSpec('hex', spec.version).formatIndex,
        // CMQ (C2a) — 자리 예약 + 중앙 QR 조합의 전용 인덱스.
        markerGSpec('hex', spec.version, true).formatIndex,
      ],
    }));
    /*
     * Type C — 일반 hex 기하를 공유하지만 k=14/17/20과 와이어 소유자가 별도다.
     * 평 C/C*D는 같은 k에서 formatIndex(0/1)만 달라 한 profile에 같이 싣는다.
     * 여기서 VERSIONS와 산술로 합치면 C의 version=0이 O의 version 체계로 새므로,
     * C 표가 정한 행만 그대로 더한다.
     */
    const typeC = VERSIONS_C.map((spec) => ({
      family,
      dimension: spec.k,
      spec,
      typeC: true,
      formatIndices: C_FORMAT_INDEX.filter((entry) => entry.k === spec.k)
        .map((entry) => entry.formatIndex),
    }));
    return [...legacy, ...typeC];
  }
  if (family === 'tri') {
    return VERSIONS_A.map((spec) => ({
      family,
      dimension: spec.k,
      spec,
      formatIndices: [
        spec.formatIndex, spec.formatIndex + 2,
        markerGSpec('tri', spec.version).formatIndex,
        markerGSpec('tri', spec.version, true).formatIndex,
        // 내부 타입 V (턴A, 2026-08-24) — 이 (family, k) 소유의 V 표 인덱스 전부.
        // G 와 같은 이유: formatIndexOwners(재배치·재라벨)와 profileForFormatCandidate
        // 가 V 인덱스로 읽힌 프레임을 자기 패밀리로 되짚을 수 있어야 한다.
        ...TURN_A_FORMAT_INDEX.filter((entry) => entry.k === spec.k)
          .map((entry) => entry.formatIndex),
      ],
    }));
  }
  if (family === 'cube') {
    return VERSIONS_Y.map((spec) => ({
      family,
      dimension: spec.n,
      spec,
      formatIndices: [spec.formatIndex],
    }));
  }
  if (family === 'star') {
    // Type K (육각별) — 평 K(7)와 K-CM(8)을 모두 이 (family, k)가 소유한다.
    // 평 K를 먼저 두므로 profileForHypothesis의 기하 차원 선택은 종전과 같고,
    // profileForFormatCandidate는 실제 포맷 값으로 K-CM 행까지 되짚는다.
    return [...VERSIONS_K, ...VERSIONS_KCM].map((spec) => ({
      family,
      dimension: spec.k,
      spec,
      formatIndices: [spec.formatIndex],
    }));
  }
  return [];
}

export function profileForHypothesis(hypothesis) {
  const dimension = hypothesis.family === 'cube' ? hypothesis.n : hypothesis.k;
  return familyProfiles(hypothesis.family).find((entry) => entry.dimension === dimension);
}

export function validVersionIndices(hypothesis) {
  const profile = profileForHypothesis(hypothesis);
  if (!profile) return [];
  // Type C의 version은 O의 `version - 1` 산술축이 아니다. k와 formatIndex를 함께
  // 읽는 표가 와이어 정본이며, C0/C1/C2의 공통 값 0을 여기서 모두 연다.
  if (hypothesis.family === 'hex' && profile.typeC === true) {
    return profile.formatIndices.slice();
  }
  // 내부 타입 G(코너 마커) 인덱스: centerQr 가설은 Q 계열(V*Q + **CMQ** — C2a 개설분)
  // 을, 비-centerQr 가설은 레거시와 CM 을 연다. 어느 쪽인지는 CRC + 본문 RS 가 가른다
  // (다른 값·같은 k 이므로 후보가 겹칠 수 없다 — markerG.js 무경합 자기검증).
  if (hypothesis.family === 'hex') {
    return hypothesis.centerQr
      ? [profile.spec.version - 1 + 4,
        markerGSpec('hex', profile.spec.version, true).formatIndex]
      : [profile.spec.version - 1, markerGSpec('hex', profile.spec.version).formatIndex];
  }
  if (hypothesis.family === 'tri') {
    // 턴A (내부 타입 V) 가설 — 실루엣 방향이 앵커/기하에서 이미 갈렸으므로
    // **V 표 인덱스만** 연다 (centerQr 축은 레거시와 같은 규칙). 정삼각 가설은
    // 종전 그대로 — V 인덱스를 열지 않아 기존 프레임의 후보 집합이 한 칸도 안 는다.
    if (hypothesis.turn === true) {
      return TURN_A_FORMAT_INDEX
        .filter((entry) => entry.version === profile.spec.version
          && entry.centerQr === (hypothesis.centerQr === true))
        .map((entry) => entry.formatIndex);
    }
    return hypothesis.centerQr
      ? [profile.spec.formatIndex + 2,
        markerGSpec('tri', profile.spec.version, true).formatIndex]
      : [profile.spec.formatIndex, markerGSpec('tri', profile.spec.version).formatIndex];
  }
  if (hypothesis.family === 'star') {
    // Type K — 평 K(7) **+ K-CM(8)**. 2026-08-25 배선.
    //
    // ⚠ 여기가 K-CM 이 «생성은 되는데 스캔은 안 되던» 유일한 자리였다. 인코더
    // (encodeK cornerMarker)도 디코더 후단(decode-k 의 VERSIONS_KCM 분기)도 이미
    // 있었는데, 그 사이에서 부트스트랩이 **8 을 후보로 안 내놔** 포맷 단계에서 죽었다
    // (test/typeK-roundtrip.test.js ② 가 그 사실의 자였다). tri 가 G 값을 함께
    // 내놓는 것과 같은 문법이고, 어느 쪽이 맞는지는 여기서 정하지 않는다 — RS/CRC 다.
    // ⚠ 이 패밀리의 치수는 `hypothesis.k` 다 (cube 만 `.n` — 위 519행 관용구).
    //   처음에 `.dimension` 으로 썼다가 undefined 가 되어 조회가 null 을 냈고,
    //   아래 폴백이 그걸 «이 k 에는 K-CM 이 없다» 로 삼켜 **버그가 정상처럼 보였다.**
    const kcm = kSpecFromFormatIndex(K_MARKER_FORMAT_INDEX, hypothesis.k);
    return kcm === null
      ? profile.formatIndices.slice()
      : [...profile.formatIndices, K_MARKER_FORMAT_INDEX];
  }
  if (hypothesis.cellSurface === true) {
    if (isCellSurfaceFinalId(hypothesis.cellSurfaceLayout)) {
      // 최종 라인업 — 한 쌍(2T/3T)뿐, 레이아웃 구분은 n 이 이미 했다.
      if (hypothesis.tones === 2 || hypothesis.tones === 3) {
        return [formatIndexCellSurfaceFinal(hypothesis.tones)];
      }
      return [formatIndexCellSurfaceFinal(2), formatIndexCellSurfaceFinal(3)];
    }
    if (hypothesis.cellSurfaceLayout) {
      if (hypothesis.tones === 2 || hypothesis.tones === 3) {
        return [formatIndexCellSurfaceLayout(hypothesis.cellSurfaceLayout, hypothesis.tones)];
      }
      return [
        formatIndexCellSurfaceLayout(hypothesis.cellSurfaceLayout, 2),
        formatIndexCellSurfaceLayout(hypothesis.cellSurfaceLayout, 3),
      ];
    }
    if (hypothesis.tones === 2 || hypothesis.tones === 3) {
      return [formatIndexCellSurface(hypothesis.tones)];
    }
    return [CELL_SURFACE_FORMAT_INDEX_2T, CELL_SURFACE_FORMAT_INDEX_3T];
  }
  return familyProfiles('cube')
    .filter((entry) => entry.dimension === hypothesis.n
      && (hypothesis.tones === undefined || entry.spec.tones === hypothesis.tones))
    .map((entry) => entry.spec.formatIndex);
}

export function sampleToDigit(sample) {
  const rows = [
    { face: 'T', value: sample.T.median, order: 0 },
    { face: 'L', value: sample.L.median, order: 1 },
    { face: 'R', value: sample.R.median, order: 2 },
  ].sort((left, right) => left.value - right.value || left.order - right.order);
  const ranks = {};
  rows.forEach((row, rank) => {
    ranks[row.face] = rank;
  });
  return ranksToDigit(ranks);
}

/**
 * 한 기하 가설의 ring 3 세 복제를 읽고 enumerateFormatProposals의 전 후보를
 * 반환한다. validVersionIndices는 family+size+finderKind에서 유도한 필수 집합이다.
 */
export function cubeSampleOptions(options) {
  return {
    minSampleCount: UNVERIFIED_CUBE_DETECTION.minimumSampleCount,
    minProjectedMinorDiameter:
      UNVERIFIED_CUBE_DETECTION.minimumProjectedMinorDiameter,
    disc: {
      fraction: UNVERIFIED_CUBE_DETECTION.sampleDiscFraction,
      ...((options.sample && options.sample.disc) || {}),
    },
    ...(options.sample || {}),
  };
}

/**
 * 한 세대(포맷 셀 목록)로 포맷 워드를 실제로 읽는다. 세대 선택은 호출측이 한다.
 */
export function readFormatWithCells(luma, hypothesis, options, valid, cells, formatWireVersion) {
  const cube = hypothesis.family === 'cube';
  const digitCount = formatWireVersion === 2 ? DIGIT_COUNT_V2 : 5;
  if (cells.length !== digitCount * 3) {
    return fail(FRONTEND_FAILURE.NO_FORMAT_CANDIDATE, {
      stage: 'format',
      cause: 'format-cell-count-mismatch',
      hypothesisId: hypothesis.hypothesisId,
      cells: cells.length,
      expected: digitCount * 3,
      formatWireVersion,
    });
  }
  // 포맷 셀은 **세대 무관** 3중 복제다 (v1 5×3 = 15 · v2 6×3 = 18). 한 셀이 프레임
  // 밖으로 잘려도 나머지 두 복제가 살아 있으면 읽을 수 있어야 한다 — 잘린 자리는
  // null(소거)로 표시해 format-proposals 의 다수결 표에서 **빼고**, 0 으로
  // 위장시키지 않는다. 세대 분기는 위의 `digitCount` 하나뿐이고, 소거 규칙은
  // 두 세대가 같은 코드를 탄다.
  const samples = [];
  const observedDigits = [];
  const erasedCells = [];
  for (const cell of cells) {
    const sampled = cube
      ? sampleCubeCell(luma, hypothesis, cell.i, cell.j, cubeSampleOptions(options))
      : sampleHexCell(luma, hypothesis, cell.q, cell.r, options.sample || {});
    samples.push(sampled);
    if (!sampled.ok) {
      observedDigits.push(null);
      erasedCells.push({
        cell,
        reason: sampled.reason,
        cause: 'unsampled-format-cell',
        detail: sampled.detail,
        formatWireVersion,
      });
      continue;
    }
    if (cube) {
      const read = readCubeDigit(sampled, hypothesis.referenceCalibration);
      if (read === null) {
        observedDigits.push(null);
        erasedCells.push({
          cell,
          reason: FRONTEND_FAILURE.NO_FORMAT_CANDIDATE,
          cause: 'illegal-two-tone-triple-or-unreadable-three-tone-rank',
          tones: hypothesis.tones,
          formatWireVersion,
        });
        continue;
      }
      observedDigits.push(read.digit);
    } else {
      observedDigits.push(sampleToDigit(sampled));
    }
  }
  if (erasedCells.length === cells.length) {
    // 포맷 셀 전부(v1 15 · v2 18)가 소거면 포맷을 주장할 근거가 하나도 없다 —
    // 예전처럼 실패한다. 이 실패는 `stage: 'format-sampling'` 이라 세대 폴백을
    // 발동시키지 않는다: 기하가 통째로 프레임 밖이면 세대를 바꿔도 같은 자리에서
    // 다시 깨진다(폴백으로 기하를 구제하지 않는다).
    return fail(erasedCells[0].reason, {
      stage: 'format-sampling',
      hypothesisId: hypothesis.hypothesisId,
      cell: erasedCells[0].cell,
      cause: 'all-format-cells-unsampled',
      erasedFormatCells: erasedCells.length,
      firstFormatCellFailure: erasedCells[0],
      erasedFormatCellDetails: erasedCells,
      formatWireVersion,
    });
  }
  const reads = [0, 1, 2].map((replica) =>
    observedDigits.slice(replica * digitCount, replica * digitCount + digitCount));
  const enumerated = formatWireVersion === 2
    ? enumerateFormatProposalsV2(reads, { validVersionIndices: valid })
    : enumerateFormatProposals(reads, { validVersionIndices: valid });
  const formatCandidates = enumerated.proposals.filter((proposal) => proposal.crcOk);
  if (formatCandidates.length === 0) {
    return fail(FRONTEND_FAILURE.NO_FORMAT_CANDIDATE, {
      stage: 'format',
      cause: 'format-crc-no-candidate',
      hypothesisId: hypothesis.hypothesisId,
      validVersionIndices: valid,
      reads,
      tones: hypothesis.tones,
      erasedFormatCells: erasedCells.length,
      firstFormatCellFailure: erasedCells[0] || null,
      erasedFormatCellDetails: erasedCells,
      diagnostics: enumerated.diagnostics,
      formatWireVersion,
    });
  }
  return ok({
    hypothesis,
    reads,
    samples,
    erasedFormatCells: erasedCells,
    digitCount,
    formatWireVersion,
    proposals: enumerated.proposals,
    formatCandidates,
    diagnostics: enumerated.diagnostics,
    validVersionIndices: valid,
  });
}

export function readFormatForHypothesis(luma, hypothesis, options = {}) {
  try {
    assertLumaField(luma);
  } catch (error) {
    return fail(FRONTEND_FAILURE.EMPTY_INPUT, { stage: 'format', message: error.message });
  }
  const valid = validVersionIndices(hypothesis);
  if (valid.length === 0) {
    return fail(FRONTEND_FAILURE.NO_FORMAT_CANDIDATE, {
      stage: 'format',
      cause: 'no-version-indices-for-geometry',
      hypothesisId: hypothesis && hypothesis.hypothesisId,
    });
  }

  // 중앙 n=7에는 바깥 surface format 복제 셀이 없다. 19셀 codeword가 복원한 기존
  // 5-digit outerFormat을 세 복제의 확정 관측으로 공급한다. 이 경로는 locator
  // verifier + decodeCentralN7을 통과한 가설에만 존재하며, surface fallback을 타지 않는다.
  if (hypothesis.centralN7
    && hypothesis.centralN7.family === hypothesis.family
    && Array.isArray(hypothesis.centralN7.outerFormat)
    && hypothesis.centralN7.outerFormat.length === 5) {
    const reads = [0, 1, 2].map(() => hypothesis.centralN7.outerFormat.slice());
    const enumerated = enumerateFormatProposals(reads, { validVersionIndices: valid });
    const formatCandidates = enumerated.proposals.filter((proposal) => proposal.crcOk);
    if (formatCandidates.length === 0) {
      return fail(FRONTEND_FAILURE.NO_FORMAT_CANDIDATE, {
        stage: 'format',
        cause: 'central-n7-format-owner-mismatch',
        hypothesisId: hypothesis.hypothesisId,
        validVersionIndices: valid,
        reads,
        erasedFormatCells: 0,
        firstFormatCellFailure: null,
        erasedFormatCellDetails: [],
        diagnostics: enumerated.diagnostics,
        formatWireVersion: 1,
      });
    }
    return ok({
      hypothesis,
      reads,
      samples: [],
      erasedFormatCells: [],
      digitCount: 5,
      formatWireVersion: 1,
      proposals: enumerated.proposals,
      formatCandidates,
      diagnostics: { ...enumerated.diagnostics, source: 'central-n7-codeword' },
      validVersionIndices: valid,
    });
  }

  const cube = hypothesis.family === 'cube';
  // ── 신세대 셀 표면 — 두 세대를 다 읽는다 (통합자 결정 A) ────────────────────
  //
  // v2(18셀) 로 먼저 읽고, **포맷 CRC 후보가 전멸했을 때만** v1(15셀)로 한 번 더
  // 읽는다. 두 좌표 집합은 같은 autoplace 를 세대 파라미터만 바꿔 돌린 것이라
  // 손 좌표표가 없다. 폴백은 «순서» 로 안전한 게 아니라 CRC + 버전 필드(패밀리) +
  // 본문 RS 3중으로 안전하다 — v1 워드에는 마스크 필드가 없어 index 0 고정이고,
  // 오독 방어는 실측 스윕(test/format-legacy-fallback.test.js)이 회귀로 고정한다.
  if (cube && hypothesis.cellSurface === true
    && isCellSurfaceFinalId(hypothesis.cellSurfaceLayout)) {
    let firstAttempt = null;
    for (const wire of CELL_SURFACE_FINAL_FORMAT_WIRES) {
      // 레거시 세대가 **없는** 레이아웃(v0xq — 포맷 v2 이후 신설)은 건너뛴다.
      // 건너뛰지 않으면 formatCellsCellSurfaceFinal 이 «없는 조합» RangeError 를
      // 던져 가설 전체가 죽는다 (v0xq 편입 첫 실측에서 실제로 그랬다).
      if (wire !== CELL_SURFACE_FINAL_FORMAT_WIRE
        && !hasLegacyFormatWire(hypothesis.cellSurfaceLayout)) continue;
      const attempt = readFormatWithCells(
        luma, hypothesis, options, valid,
        formatCellsCellSurfaceFinal(hypothesis.n, hypothesis.cellSurfaceLayout, wire),
        wire,
      );
      if (attempt.ok) return attempt;
      if (firstAttempt === null) firstAttempt = attempt;
      // 폴백 조건은 «CRC 전멸» 한 가지다. 샘플링이 깨진 기하는 세대를 바꿔도
      // 같은 셀에서 다시 깨지므로 여기서 멈춘다(폴백으로 기하를 구제하지 않는다).
      if (!attempt.detail || attempt.detail.stage !== 'format') break;
    }
    return firstAttempt;
  }

  const cells = cube
    ? hypothesis.cellSurface === true
      ? (hypothesis.cellSurfaceLayout
        ? formatCellsCellSurfaceLayout(hypothesis.cellSurfaceLayout)
        : formatCellsCellSurface())
      : hypothesis.window === true
        ? windowedFormatCellsY(hypothesis.n)
        : formatCellsY(hypothesis.n)
    // 턴A (내부 타입 V): 배치가 180° 돌았으므로 포맷 셀도 반전 «자리» 에서 읽는다.
    // 목록 순서는 canonical 그대로 — 인코더가 formatDigits 를 canonical 순서로
    // 실었고 그리는 자리만 (−q,−r) 이므로, 반전 자리를 canonical 순서로 읽으면
    // 복제 3벌의 자리 대응이 정확히 유지된다 (scene.js turnA 규약의 쌍대).
    : hypothesis.family === 'tri' && hypothesis.turn === true
      ? formatCells(hypothesis.k).map((cell) => ({ q: -cell.q, r: -cell.r }))
      : formatCells(hypothesis.k);
  return readFormatWithCells(luma, hypothesis, options, valid, cells, 1);
}
