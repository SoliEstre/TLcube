// 정지사진 코퍼스와 LTC 프레임 시퀀스는 **다른 축**이다. 한 목록에 섞이면
// 코퍼스 지문이 깨지고 전수 시간이 폭증하며, 무엇보다 「정지 통계로 라이브를
// 단정하는」 오독이 자 층에서 시작된다. 그 분리를 여기서 잠근다.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isSequenceFrameName,
  listLumaDumps,
  listLumaSequences,
} from '../tools/read-luma.mjs';

test('분류자: video-probe 가 굽는 이름만 시퀀스 프레임으로 본다', () => {
  // video-probe.html 의 실제 산출 이름 형식 — 바뀌면 여기가 먼저 깨져야 한다.
  for (const name of [
    'clip.f0000.1440.luma',
    'clip.f0123.960.luma',
    'ctlv2-c3-tl.f0099.1920.luma',
  ]) {
    assert.equal(isSequenceFrameName(name), true, name);
  }

  // photo-probe 가 굽는 정지 덤프와, 시퀀스처럼 보이지만 아닌 것들.
  for (const name of [
    'KakaoTalk_20260830_230340323_04.1440.luma',
    '015529194.960.luma',
    'clip.f12.1440.luma', // 프레임 번호는 4자리 고정
    'clip.f0000.luma', // maxSide 가 없다
  ]) {
    assert.equal(isSequenceFrameName(name), false, name);
  }
});

test('두 목록은 서로소다 — 시퀀스 프레임이 정지 코퍼스로 새지 않는다', () => {
  const stills = listLumaDumps();
  assert.equal(
    stills.some((entry) => isSequenceFrameName(entry.name)),
    false,
    '정지 코퍼스에 시퀀스 프레임이 섞이면 지문과 전수 시간이 함께 깨진다',
  );

  const sequenceFrames = new Set(
    listLumaSequences().flatMap((sequence) => sequence.frames.map((frame) => frame.name)),
  );
  for (const still of stills) {
    assert.equal(sequenceFrames.has(still.name), false, still.name);
  }
});

test('시퀀스는 프레임 번호 오름차순이고, 시간축은 없으면 null 이다', () => {
  for (const sequence of listLumaSequences()) {
    const names = sequence.frames.map((frame) => frame.name);
    assert.deepEqual(names, [...names].sort(), `${sequence.name} 프레임 순서`);
    if (sequence.timestampsMs !== null) {
      assert.equal(sequence.timestampsMs.length, sequence.frames.length);
      // 실제 도달 시각이므로 단조 비감소여야 한다 (seek 이 뒤로 가지 않는다).
      for (let i = 1; i < sequence.timestampsMs.length; i += 1) {
        assert.ok(
          sequence.timestampsMs[i] >= sequence.timestampsMs[i - 1],
          `${sequence.name} 시간축 역행 @${i}`,
        );
      }
    }
  }
});
