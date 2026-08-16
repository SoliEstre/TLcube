/**
 * format-erasure-generations.test.js — **소거 인지 포맷 다수결 × 두 세대** 합성 계약.
 *
 * 두 레인이 같은 함수를 서로 모르고 고쳤다:
 *   - finish 레인 — 프레임 밖 포맷 셀을 `null`(소거)로 표시해 다수결 표에서 빼는 길
 *     (`test/output/claude-finish.md` §2.2). 그때는 세대가 하나(5 digit)였다.
 *   - mask 레인 — 포맷 v2(6 digit) 와 **v2 우선 → v1 폴백** 레거시 공존
 *     (`test/output/claude-mask-select.md` §2 · §8.1). 그때는 소거가 없었다.
 *
 * 합성의 요지는 한 줄이다: **잘린 복제는 세대와 무관하게 소거로 빠져야 한다.**
 * 세대별로 소거 규칙이 갈리면 폴백 경로에서 한쪽만 구제되는 비대칭이 생기고,
 * 그 비대칭은 «v2 는 죽고 v1 은 살아난» 프레임에서 곧장 **교차 오독**이 된다.
 *
 * 이 파일이 고정하는 것:
 *   ① v2(6 digit) 프레임에서 복제 하나가 통째로 소거돼도 남은 2복제 합의로 다수결이 선다.
 *   ② 레거시 v1(5 digit) 프레임에서도 **같은 성립** — 세대 비대칭 0.
 *   ③ 소거 상태에서도 **교차 오독 0** — 같은 물리 셀이 소거된 채로 반대 세대 판독기에
 *      먹여도 CRC 를 통과하는 워드가 나오지 않는다 (버전 필터를 끈 최악 가정 포함).
 *   ④ 결정성 — 소거 입력을 두 번 넣으면 진단까지 같다.
 *
 * 층 선택에 대해 정직하게: 여기는 **digit 층**이다. 실제로 잘린 프레임은 RS 는커녕
 * 포맷 읽기에도 못 닿고 기하 가설 생성 단계에서 죽는다(claude-finish.md §3 실측).
 * 그래서 «렌더 → 잘라내기» 로는 이 경로를 칠 수 없고, 소거 패턴을 셀 키로 직접
 * 주입해 잰다. 배선(`bootstrap.js` 가 `null` 을 세대에 맞는 열거기로 넘기는가)은
 * `format-legacy-fallback.test.js` 의 종단 왕복이 별도로 지킨다.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  CELL_SURFACE_FINAL_FORMAT_WIRE,
  CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY,
  formatCellsCellSurfaceFinal,
} from '../src/cellSurfaceFinal.js';
import { encodeY } from '../src/encodeY.js';
import { ECC_LEVEL } from '../src/formatinfo.js';
import { enumerateFormatProposals, enumerateFormatProposalsV2 } from '../src/format-proposals.js';
import { encodeLegacyFormatV1 } from './harness/legacy-format-v1-frame.mjs';

/** format-legacy-fallback.test.js 와 같은 인스턴스 집합 — 두 파일이 같은 프레임을 본다. */
const INSTANCES = [
  ['v0', 0, 13],
  ['v2r2', 1, 21],
  ['v2r2', 2, 25],
  ['v1r2', 1, 21],
  ['v0x', 1, 21],
];
const LEVELS = ['L', 'M', 'H'];
const MASKS = [0, 1, 2];
/** 신세대 셀 표면의 formatIndex 쌍 — 2톤 1 · 3톤 3. */
const VALID_PAIR = Object.freeze([1, 3]);
/** 버전 필터를 **아예 끈** 판독기. 오독 «상한» 을 재는 자다. */
const VALID_ALL = Object.freeze([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);

const key = (cell) => cell.i + ',' + cell.j;

function replicas(digits, per) {
  return [0, 1, 2].map((r) => digits.slice(r * per, r * per + per));
}

/**
 * 셀 목록을 읽되 `erasedKeys` 에 든 셀은 `null` 로 만든다 — «그 자리는 프레임 밖이라
 * 관측이 없다» 를 시뮬레이션하는 유일한 지점이다. 0 으로 메우지 않는 것이 요점이다.
 */
function readWithErasure(cellDigits, cells, erasedKeys) {
  return cells.map((cell) => {
    const cellKey = key(cell);
    if (erasedKeys.has(cellKey)) return null;
    return cellDigits.get(cellKey).digit;
  });
}

/** 세대 `wire` 의 복제 `replicaIndex` 가 차지하는 셀 키 집합. */
function replicaCellKeys(n, id, wire, replicaIndex) {
  const cells = formatCellsCellSurfaceFinal(n, id, wire);
  const per = cells.length / 3;
  return new Set(cells.slice(replicaIndex * per, (replicaIndex + 1) * per).map(key));
}

function majorityOf(result) {
  return result.proposals.find((proposal) => proposal.source === 'majority');
}

function encodeV2Frame(id, version, level, maskIndex) {
  return encodeY('erasure-' + id + '-' + level + '-' + maskIndex, {
    cellSurfaceLayout: id, version, tones: 2, eccLevel: level, maskIndex,
  });
}

// ─────────────────────────────────────────────────────────────────────────
// ① v2 (6 digit) — 복제 하나가 통째로 소거돼도 남은 2복제로 다수결이 선다
// ─────────────────────────────────────────────────────────────────────────

describe('① 포맷 v2 (6 digit) — 복제 1개 통째 소거에서 다수결 성립', () => {
  test('5 인스턴스 × 3 ECC × 3 마스크 × 소거 복제 3 = 전부 원본 워드로 복구', () => {
    let cases = 0;
    for (const [id, version, n] of INSTANCES) {
      const v2Cells = formatCellsCellSurfaceFinal(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE);
      assert.equal(v2Cells.length, 18, id + '@' + n);
      for (const level of LEVELS) {
        for (const maskIndex of MASKS) {
          const encoded = encodeV2Frame(id, version, level, maskIndex);
          const clean = replicas(
            readWithErasure(encoded.cellDigits, v2Cells, new Set()), 6,
          );
          for (let erasedReplica = 0; erasedReplica < 3; erasedReplica += 1) {
            const erasedKeys = replicaCellKeys(
              n, id, CELL_SURFACE_FINAL_FORMAT_WIRE, erasedReplica,
            );
            assert.equal(erasedKeys.size, 6, '복제 하나는 6셀이다');
            const reads = replicas(
              readWithErasure(encoded.cellDigits, v2Cells, erasedKeys), 6,
            );
            assert.ok(reads[erasedReplica].every((digit) => digit === null),
              '소거 대상 복제가 통째로 null 이어야 한다');

            const result = enumerateFormatProposalsV2(reads, {
              validVersionIndices: VALID_PAIR,
            });
            const label = id + '@' + n + ' ' + level + ' m' + maskIndex
              + ' r' + erasedReplica;
            const majority = majorityOf(result);
            assert.ok(majority, label + ': 남은 2복제 합의로 다수결이 서야 한다');
            assert.equal(majority.crcOk, true, label + ': 다수결 워드가 CRC 를 통과해야 한다');
            assert.equal(majority.versionIndex, encoded.formatIndex, label + ' version');
            assert.equal(majority.eccLevel, ECC_LEVEL[level], label + ' ecc');
            assert.equal(majority.maskIndex, maskIndex, label + ' mask');
            assert.equal(majority.reserved, 0, label + ' reserved');
            // 6자리 전부 «남은 2관측 중 최다» 로 결정됐다 — erased 자리는 없다.
            assert.deepEqual(majority.consensus.states,
              ['2/2', '2/2', '2/2', '2/2', '2/2', '2/2'], label + ' states');
            assert.equal(majority.consensus.noConsensus, 0, label);
            assert.equal(majority.consensus.erasedPositions, 0, label);
            assert.equal(majority.consensus.survivorDecided, 6, label);
            // 소거된 복제는 «개별 proposal» 로도 새지 않는다.
            assert.equal(result.diagnostics.generated.erasedReplicas, 1, label);
            assert.equal(result.diagnostics.generated.replicas, 2, label);
            assert.equal(
              result.proposals.some((p) => p.replicaIndices.includes(erasedReplica)),
              false, label + ': 소거 복제가 개별 후보로 샜다',
            );
            // 무손상 판독과 **같은 워드**다 — 소거가 값을 바꾸지 않았다.
            assert.deepEqual(Array.from(majority.maskedDigits),
              Array.from(clean[(erasedReplica + 1) % 3]), label + ': 워드가 달라졌다');
            cases += 1;
          }
        }
      }
    }
    assert.equal(cases, 135, '스윕 규모가 줄었다: ' + cases);
  });

  test('6번째 자리만 소거된 복제도 «불완전» 이다 (digitCount 를 5 로 고정하면 새는 자리)', () => {
    // 합성 전에는 `collectRawProposals` 가 복제 완전성을 **5자리**만 검사했다.
    // v2 의 6번째 자리만 소거된 복제는 그 검사를 통과해 `null` 이 든 채 개별 후보가
    // 되고, `fromDigits6` 이 그 null 을 0 으로 삼켜 **날조된 워드**를 만든다.
    // 이 테스트가 그 구멍을 막는 자다.
    const encoded = encodeV2Frame('v2r2', 1, 'M', 2);
    const v2Cells = formatCellsCellSurfaceFinal(21, 'v2r2', CELL_SURFACE_FINAL_FORMAT_WIRE);
    const digits = readWithErasure(encoded.cellDigits, v2Cells, new Set());
    const reads = replicas(digits, 6);
    reads[1] = reads[1].slice();
    reads[1][5] = null; // 마지막 자리 하나만 소거

    const result = enumerateFormatProposalsV2(reads, { validVersionIndices: VALID_PAIR });
    assert.equal(result.diagnostics.generated.erasedReplicas, 1,
      '6번째 자리 소거가 «복제 불완전» 으로 세어지지 않았다');
    assert.equal(result.diagnostics.generated.replicas, 2);
    assert.equal(result.proposals.some((p) => p.replicaIndices.includes(1)), false,
      '소거가 든 복제가 개별 후보로 샜다 — 0 으로 메운 날조 워드다');
    for (const proposal of result.proposals) {
      assert.ok(proposal.maskedDigits.every((d) => Number.isInteger(d)),
        'proposal 에 null 이 섞였다');
    }
    // 남은 2복제가 그 자리를 덮으므로 다수결은 여전히 원본이다.
    const majority = majorityOf(result);
    assert.ok(majority && majority.crcOk);
    assert.equal(majority.maskIndex, 2);
    assert.equal(majority.consensus.states[5], '2/2');
    assert.equal(majority.consensus.states[0], '3/3');
  });

  test('v2 에서도 세 복제가 같은 자리에서 전부 소거되면 그 자리는 아무것도 주장하지 않는다', () => {
    const encoded = encodeV2Frame('v2r2', 1, 'M', 1);
    const v2Cells = formatCellsCellSurfaceFinal(21, 'v2r2', CELL_SURFACE_FINAL_FORMAT_WIRE);
    const reads = replicas(readWithErasure(encoded.cellDigits, v2Cells, new Set()), 6)
      .map((replica) => {
        const copy = replica.slice();
        copy[3] = null;
        return copy;
      });
    const result = enumerateFormatProposalsV2(reads, { validVersionIndices: VALID_PAIR });
    assert.equal(result.proposals.length, 0, '전부 소거된 자리로 후보를 만들면 안 된다');
    assert.equal(result.diagnostics.generated.majority, 0);
    assert.equal(result.diagnostics.generated.erasedReplicas, 3);
    assert.equal(result.diagnostics.generated.replicas, 0);
  });

  test('v2 생존자 키메라 — 자리별 생존자가 전부 다른 6-digit 도 CRC 하드 게이트를 탄다', () => {
    const encoded = encodeV2Frame('v2r2', 1, 'H', 2);
    const v2Cells = formatCellsCellSurfaceFinal(21, 'v2r2', CELL_SURFACE_FINAL_FORMAT_WIRE);
    const word = replicas(readWithErasure(encoded.cellDigits, v2Cells, new Set()), 6)[0];
    const owner = [0, 0, 1, 1, 2, 2]; // 자리 → 살아남는 복제
    const chimera = [0, 1, 2].map((replicaIndex) => word.map(
      (digit, position) => (owner[position] === replicaIndex ? digit : null),
    ));
    for (const replica of chimera) {
      assert.ok(replica.some((digit) => digit === null), '전제가 깨졌다 — 완전한 복제가 있다');
    }
    const result = enumerateFormatProposalsV2(chimera, { validVersionIndices: VALID_PAIR });
    const majority = majorityOf(result);
    assert.ok(majority, '자리별 생존자가 유일하면 v2 키메라 다수결이 선다 (신규 표면)');
    assert.deepEqual(Array.from(majority.maskedDigits), Array.from(word));
    assert.equal(majority.crcOk, true);
    assert.equal(majority.consensus.survivorDecided, 6);
    assert.deepEqual(majority.consensus.states, ['1/1', '1/1', '1/1', '1/1', '1/1', '1/1']);
    assert.equal(result.proposals.length, 1, '후보 전체가 키메라 하나여야 한다');
    assert.deepEqual(majority.replicaIndices, []);

    // 방어선 — CRC 가 틀린 키메라는 crcOk:false 로만 남고 소비자 게이트를 못 넘는다.
    const bent = chimera.map((replica) => replica.slice());
    bent[0][0] = bent[0][0] === null ? null : (word[0] + 1) % 6;
    const bentResult = enumerateFormatProposalsV2(bent, { validVersionIndices: VALID_PAIR });
    assert.equal(bentResult.proposals.filter((p) => p.crcOk).length, 0,
      'CRC 가 틀린 키메라가 통과했다 — 유일한 관문이 뚫렸다');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ② 레거시 v1 (5 digit) — 같은 성립. 세대 비대칭 0
// ─────────────────────────────────────────────────────────────────────────

describe('② 레거시 포맷 v1 (5 digit) — 같은 소거 다수결이 폴백 경로에서도 선다', () => {
  test('5 인스턴스 × 3 ECC × 소거 복제 3 = 전부 원본 워드로 복구', () => {
    let cases = 0;
    for (const [id, , n] of INSTANCES) {
      const v1Cells = formatCellsCellSurfaceFinal(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY);
      assert.equal(v1Cells.length, 15, id + '@' + n);
      for (const level of LEVELS) {
        const encoded = encodeLegacyFormatV1('legacy-erasure-' + id + '-' + level, {
          cellSurfaceLayout: id, n, tones: 2, eccLevel: level,
        });
        const clean = replicas(readWithErasure(encoded.cellDigits, v1Cells, new Set()), 5);
        for (let erasedReplica = 0; erasedReplica < 3; erasedReplica += 1) {
          const erasedKeys = replicaCellKeys(
            n, id, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY, erasedReplica,
          );
          assert.equal(erasedKeys.size, 5);
          const reads = replicas(
            readWithErasure(encoded.cellDigits, v1Cells, erasedKeys), 5,
          );
          const result = enumerateFormatProposals(reads, { validVersionIndices: VALID_PAIR });
          const label = 'legacy ' + id + '@' + n + ' ' + level + ' r' + erasedReplica;
          const majority = majorityOf(result);
          assert.ok(majority, label + ': 남은 2복제 합의로 다수결이 서야 한다');
          assert.equal(majority.crcOk, true, label);
          assert.equal(majority.versionIndex, encoded.formatIndex, label + ' version');
          assert.equal(majority.eccLevel, ECC_LEVEL[level], label + ' ecc');
          // v1 워드에는 마스크 필드 자체가 없다 — proposal 에 index 가 붙지 않는다.
          assert.equal(majority.maskIndex, undefined, label + ': v1 에 마스크 필드가 생겼다');
          assert.deepEqual(majority.consensus.states, ['2/2', '2/2', '2/2', '2/2', '2/2'], label);
          assert.equal(majority.consensus.survivorDecided, 5, label);
          assert.equal(result.diagnostics.generated.erasedReplicas, 1, label);
          assert.equal(result.diagnostics.generated.replicas, 2, label);
          assert.equal(
            result.proposals.some((p) => p.replicaIndices.includes(erasedReplica)),
            false, label + ': 소거 복제가 개별 후보로 샜다',
          );
          assert.deepEqual(Array.from(majority.maskedDigits),
            Array.from(clean[(erasedReplica + 1) % 3]), label);
          cases += 1;
        }
      }
    }
    assert.equal(cases, 45, '스윕 규모가 줄었다: ' + cases);
  });

  test('세대 비대칭 0 — 같은 소거 모양이면 두 세대의 합의 회계가 같다', () => {
    // 같은 프레임·같은 «복제 r 통째 소거» 에서 두 세대가 내는 합의 요약은
    // 자릿수만 다르고 판정은 동일해야 한다. 한쪽만 구제되면 폴백이 비대칭이 된다.
    for (const [id, version, n] of INSTANCES) {
      for (let erasedReplica = 0; erasedReplica < 3; erasedReplica += 1) {
        const v2Cells = formatCellsCellSurfaceFinal(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE);
        const v1Cells = formatCellsCellSurfaceFinal(
          n, id, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY,
        );
        const v2 = enumerateFormatProposalsV2(
          replicas(readWithErasure(
            encodeV2Frame(id, version, 'M', 0).cellDigits, v2Cells,
            replicaCellKeys(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE, erasedReplica),
          ), 6),
          { validVersionIndices: VALID_PAIR },
        );
        const v1 = enumerateFormatProposals(
          replicas(readWithErasure(
            encodeLegacyFormatV1('sym', { cellSurfaceLayout: id, n, tones: 2, eccLevel: 'M' })
              .cellDigits,
            v1Cells,
            replicaCellKeys(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY, erasedReplica),
          ), 5),
          { validVersionIndices: VALID_PAIR },
        );
        const label = id + '@' + n + ' r' + erasedReplica;
        const m2 = majorityOf(v2);
        const m1 = majorityOf(v1);
        assert.ok(m2 && m1, label + ': 한쪽 세대만 다수결이 섰다 — 비대칭');
        assert.equal(m2.crcOk, m1.crcOk, label);
        assert.equal(m2.consensus.survivorDecided, 6, label);
        assert.equal(m1.consensus.survivorDecided, 5, label);
        assert.equal(m2.consensus.erasedPositions, m1.consensus.erasedPositions, label);
        assert.equal(m2.consensus.noConsensus, m1.consensus.noConsensus, label);
        assert.equal(v2.diagnostics.generated.erasedReplicas,
          v1.diagnostics.generated.erasedReplicas, label);
        assert.equal(v2.diagnostics.generated.replicas,
          v1.diagnostics.generated.replicas, label);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ③ 소거 상태의 교차 오독 0 — 폴백이 가로채지 않는다
// ─────────────────────────────────────────────────────────────────────────

describe('③ 소거 상태에서 폴백이 가로채지 않는다 — 교차 오독 0', () => {
  test('v2 프레임(복제 1개 소거)을 v1 폴백 판독기가 읽으면 CRC 통과 0', () => {
    // 이 스윕이 새로 필요한 이유: 합성 **전에는** 미표본 포맷 셀이
    // `stage:'format-sampling'` 실패였고, 폴백 루프가 거기서 멈춰 v1 이 아예 안 돌았다.
    // 소거를 넣으면 같은 상황이 `stage:'format'`(CRC 전멸) 이 되어 **폴백이 실제로 돈다.**
    // 즉 이 교차 판독 경로는 합성이 새로 연 표면이다 — 그래서 여기서 잰다.
    let frames = 0;
    let crcChecked = 0;
    let candidateWords = 0;
    let passedPair = 0;
    let passedAll = 0;
    let v2Succeeded = 0;
    for (const [id, version, n] of INSTANCES) {
      const v1Cells = formatCellsCellSurfaceFinal(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY);
      const v2Cells = formatCellsCellSurfaceFinal(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE);
      for (const level of LEVELS) {
        for (const maskIndex of MASKS) {
          const encoded = encodeV2Frame(id, version, level, maskIndex);
          for (let erasedReplica = 0; erasedReplica < 3; erasedReplica += 1) {
            // **같은 물리 셀**이 안 보이는 상황이다 — 두 세대 판독이 같은 소거 집합을 본다.
            const erasedKeys = replicaCellKeys(
              n, id, CELL_SURFACE_FINAL_FORMAT_WIRE, erasedReplica,
            );
            frames += 1;

            // (a) 세대 우선순위 — v2 가 먼저 성공하므로 폴백은 실행되지도 않는다.
            const v2Read = enumerateFormatProposalsV2(
              replicas(readWithErasure(encoded.cellDigits, v2Cells, erasedKeys), 6),
              { validVersionIndices: VALID_PAIR },
            );
            if (v2Read.proposals.some((p) => p.crcOk)) v2Succeeded += 1;

            // (b) 최악 가정 — 폴백이 **그래도 돌았다** 치고 v1 판독을 강제한다.
            const v1Reads = replicas(
              readWithErasure(encoded.cellDigits, v1Cells, erasedKeys), 5,
            );
            const pair = enumerateFormatProposals(v1Reads, {
              validVersionIndices: VALID_PAIR,
            });
            const all = enumerateFormatProposals(v1Reads, { validVersionIndices: VALID_ALL });
            candidateWords += all.diagnostics.generated.unique;
            crcChecked += all.diagnostics.crcChecked;
            passedPair += pair.proposals.filter((p) => p.crcOk).length;
            passedAll += all.proposals.filter((p) => p.crcOk).length;
          }
        }
      }
    }
    assert.equal(frames, 135);
    assert.equal(v2Succeeded, 135, 'v2 우선 판독이 소거에도 전부 성공해야 폴백이 안 돈다');
    assert.ok(candidateWords >= 100, '검사 워드가 줄었다: ' + candidateWords);
    assert.ok(crcChecked > 0, 'CRC 검사에 도달한 워드가 없다 — 스윕이 헛돌았다');
    assert.equal(passedPair, 0, '소거된 v2 프레임이 v1 폴백에서 CRC 를 통과했다 (교차 오독)');
    assert.equal(passedAll, 0, '버전 필터 없이도 0 이어야 한다 (오독 상한)');
  });

  test('v1 프레임(복제 1개 소거)을 v2 우선 판독기가 읽으면 CRC 통과 0', () => {
    let frames = 0;
    let candidateWords = 0;
    let passedPair = 0;
    let passedAll = 0;
    let v1Succeeded = 0;
    for (const [id, , n] of INSTANCES) {
      const v1Cells = formatCellsCellSurfaceFinal(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY);
      const v2Cells = formatCellsCellSurfaceFinal(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE);
      for (const level of LEVELS) {
        const encoded = encodeLegacyFormatV1('legacy-cross-' + id + '-' + level, {
          cellSurfaceLayout: id, n, tones: 2, eccLevel: level,
        });
        for (let erasedReplica = 0; erasedReplica < 3; erasedReplica += 1) {
          const erasedKeys = replicaCellKeys(
            n, id, CELL_SURFACE_FINAL_FORMAT_WIRE, erasedReplica,
          );
          frames += 1;
          const v2Reads = replicas(
            readWithErasure(encoded.cellDigits, v2Cells, erasedKeys), 6,
          );
          const pair = enumerateFormatProposalsV2(v2Reads, {
            validVersionIndices: VALID_PAIR,
          });
          const all = enumerateFormatProposalsV2(v2Reads, { validVersionIndices: VALID_ALL });
          candidateWords += all.diagnostics.generated.unique;
          passedPair += pair.proposals.filter((p) => p.crcOk).length;
          passedAll += all.proposals.filter((p) => p.crcOk).length;

          // 그리고 폴백은 실제로 값을 한다 — 같은 소거에서 v1 판독은 성공한다.
          const v1 = enumerateFormatProposals(
            replicas(readWithErasure(
              encoded.cellDigits, v1Cells,
              replicaCellKeys(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY, erasedReplica),
            ), 5),
            { validVersionIndices: VALID_PAIR },
          );
          if (v1.proposals.some((p) => p.crcOk)) v1Succeeded += 1;
        }
      }
    }
    assert.equal(frames, 45);
    assert.equal(v1Succeeded, 45, '소거된 레거시 프레임이 폴백에서 읽혀야 한다 (폴백의 값)');
    assert.ok(candidateWords >= 40, '검사 워드가 줄었다: ' + candidateWords);
    assert.equal(passedPair, 0, '소거된 v1 프레임이 v2 우선 경로에서 CRC 를 통과했다 (교차 오독)');
    assert.equal(passedAll, 0, '버전 필터 없이도 0 이어야 한다 (오독 상한)');
  });

  test('키메라까지 동원해도 교차 오독 0 — 자리별 생존자가 갈린 최악의 소거', () => {
    // 「복제 통째 소거」보다 나쁜 입력: 자리마다 다른 복제만 살아남아 **어느 복제도
    // 통째로 관측되지 않은** 워드를 만든다. 이 키메라가 반대 세대에서 CRC 를 통과하면
    // 폴백은 진짜로 위험해진다. 두 방향 다 잰다.
    let crossPass = 0;
    let selfPass = 0;
    let cases = 0;
    const v1Owner = [0, 0, 1, 1, 2];
    const v2Owner = [0, 0, 1, 1, 2, 2];
    const chimeraOf = (word, owner) => [0, 1, 2].map((replicaIndex) => word.map(
      (digit, position) => (owner[position] === replicaIndex ? digit : null),
    ));
    for (const [id, version, n] of INSTANCES) {
      const v1Cells = formatCellsCellSurfaceFinal(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY);
      const v2Cells = formatCellsCellSurfaceFinal(n, id, CELL_SURFACE_FINAL_FORMAT_WIRE);
      for (const level of LEVELS) {
        for (const maskIndex of MASKS) {
          const v2Frame = encodeV2Frame(id, version, level, maskIndex);
          // v2 프레임을 v1 좌표로 읽고, 그 15 digit 을 키메라로 흩뿌린다.
          const crossWord = replicas(
            readWithErasure(v2Frame.cellDigits, v1Cells, new Set()), 5,
          )[0];
          const cross = enumerateFormatProposals(chimeraOf(crossWord, v1Owner), {
            validVersionIndices: VALID_ALL,
          });
          crossPass += cross.proposals.filter((p) => p.crcOk).length;

          // 대조군 — 같은 방식으로 흩뿌린 **자기 세대** 워드는 통과해야 한다.
          const selfWord = replicas(
            readWithErasure(v2Frame.cellDigits, v2Cells, new Set()), 6,
          )[0];
          const self = enumerateFormatProposalsV2(chimeraOf(selfWord, v2Owner), {
            validVersionIndices: VALID_PAIR,
          });
          selfPass += self.proposals.filter((p) => p.crcOk).length;
          cases += 1;
        }
      }
    }
    assert.equal(cases, 45);
    assert.equal(selfPass, 45, '대조군이 죽었다 — 스윕이 헛돌았다 (자기 세대 키메라는 통과해야 한다)');
    assert.equal(crossPass, 0, '교차 세대 키메라가 CRC 를 통과했다 (오독)');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ④ 결정성
// ─────────────────────────────────────────────────────────────────────────

describe('④ 결정성 — 소거 입력을 두 번 넣으면 진단까지 같다', () => {
  test('v2 · v1 두 세대 모두 2회 호출 deepEqual (복제 소거 · 키메라 · 무합의)', () => {
    const encoded = encodeV2Frame('v2r2', 1, 'M', 2);
    const v2Cells = formatCellsCellSurfaceFinal(21, 'v2r2', CELL_SURFACE_FINAL_FORMAT_WIRE);
    const v1Cells = formatCellsCellSurfaceFinal(
      21, 'v2r2', CELL_SURFACE_FINAL_FORMAT_WIRE_LEGACY,
    );
    const v2Word = replicas(readWithErasure(encoded.cellDigits, v2Cells, new Set()), 6)[0];
    const legacy = encodeLegacyFormatV1('determinism', {
      cellSurfaceLayout: 'v2r2', n: 21, tones: 2, eccLevel: 'M',
    });
    const v1Word = replicas(readWithErasure(legacy.cellDigits, v1Cells, new Set()), 5)[0];

    const v2Inputs = [
      // 복제 1개 통째 소거
      [v2Word.slice(), [null, null, null, null, null, null], v2Word.slice()],
      // 키메라 — 자리별 생존자가 전부 다르다
      [0, 1, 2].map((r) => v2Word.map((d, p) => ([0, 0, 1, 1, 2, 2][p] === r ? d : null))),
      // 무합의 — 세 복제가 전부 다르고 소거까지 섞였다
      [0, 1, 2].map((r) => v2Word.map((d, p) => (p === r ? null : (d + r) % 6))),
    ];
    for (const reads of v2Inputs) {
      assert.deepEqual(
        enumerateFormatProposalsV2(reads, { validVersionIndices: VALID_PAIR }),
        enumerateFormatProposalsV2(reads, { validVersionIndices: VALID_PAIR }),
      );
    }

    const v1Inputs = [
      [v1Word.slice(), [null, null, null, null, null], v1Word.slice()],
      [0, 1, 2].map((r) => v1Word.map((d, p) => ([0, 0, 1, 1, 2][p] === r ? d : null))),
      [0, 1, 2].map((r) => v1Word.map((d, p) => (p === r ? null : (d + r) % 6))),
    ];
    for (const reads of v1Inputs) {
      assert.deepEqual(
        enumerateFormatProposals(reads, { validVersionIndices: VALID_PAIR }),
        enumerateFormatProposals(reads, { validVersionIndices: VALID_PAIR }),
      );
    }
  });

  test('소거가 섞여도 digit 범위 검사는 두 세대 모두 그대로다', () => {
    const good = [0, 1, 2, 3, 4, 5];
    const bad = [0, 1, 9, null, 4, 5];
    assert.throws(
      () => enumerateFormatProposalsV2([good.slice(), bad.slice(), good.slice()],
        { validVersionIndices: VALID_PAIR }), RangeError,
    );
    assert.throws(
      () => enumerateFormatProposals([[0, 1, 2, 3, 4], [0, null, 7, 3, 4], [0, 1, 2, 3, 4]],
        { validVersionIndices: VALID_PAIR }), RangeError,
    );
    // 자릿수가 틀리면 조용히 자르지 않는다 — 세대 혼선의 1차 방벽.
    assert.throws(
      () => enumerateFormatProposalsV2([good.slice(), good.slice(), [0, 1, 2, 3, 4]],
        { validVersionIndices: VALID_PAIR }), TypeError,
    );
    assert.throws(
      () => enumerateFormatProposals([good.slice(), good.slice(), good.slice()],
        { validVersionIndices: VALID_PAIR }), TypeError,
    );
  });
});
