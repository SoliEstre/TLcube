import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

import {
  cameraLiveness,
  gatePresentation,
  resumeAction,
} from '../src/scanner-camera-lifecycle.js';

test('카메라 메타데이터 대기는 취소되고 오래된 시작은 자기 스트림만 정리해요',async()=>{
  const source=readFileSync(new URL('../sites/tlscan/scanner.js',import.meta.url),'utf8');
  const body=source.slice(source.indexOf('function waitForVideoMetadata('),source.indexOf('\n/**',source.indexOf('function waitForVideoMetadata(')));
  const wait=Function(`${body};return waitForVideoMetadata;`)();
  const video=new EventTarget();video.readyState=0;const controller=new AbortController();
  const pending=wait(video,controller.signal);const rejected=assert.rejects(pending,{name:'AbortError'});
  controller.abort();await rejected;video.dispatchEvent(new Event('loadedmetadata'));
  assert.match(source,/await cameraVideo\.play\(\);\s*if \(session !== scanSession \|\| cameraStream !== stream\) \{\s*stopTracks\(stream\);/);
  assert.match(source,/function stopCamera\(\) \{\s*cameraMetadataAbort\?\.abort\(\)/);
});

test('준비 단계는 시작 가능 입력과 무관하게 시작 버튼을 노출하지 않는다', () => {
  for (const requestedCanStart of [undefined, true, false, 0, 1, null]) {
    const presentation = gatePresentation('preparing', requestedCanStart);
    assert.equal(presentation.showStart, false);
    assert.equal(presentation.canStart, false);
  }
});

test('카메라를 가졌던 세션의 non-live 상태는 전수 조합에서 none이 아니다', () => {
  const failures = [];

  for (const liveness of ['dead', 'absent']) {
    for (const stoppedForVisibility of [false, true]) {
      for (const attemptsThisTransition of [0, 1, 2]) {
        for (const secure of [false, true]) {
          for (const hasApi of [false, true]) {
            const state = {
              liveness,
              hadCameraThisSession: true,
              stoppedForVisibility,
              attemptsThisTransition,
              secure,
              hasApi,
            };
            if (resumeAction(state) === 'none') failures.push(state);
          }
        }
      }
    }
  }

  assert.deepEqual(failures, []);
});

test('비디오 트랙이 전부 ended인 스트림은 live가 아니다', () => {
  for (const videoTrackStates of [['ended'], ['ended', 'ended']]) {
    assert.equal(cameraLiveness({
      hasStream: true,
      videoTrackStates,
      srcObjectMatches: true,
      videoEnded: false,
    }), 'dead');
  }
});

test('같은 전환에서 자동 시도 1회 뒤에는 restart를 다시 내지 않는다', () => {
  const base = {
    liveness: 'absent',
    hadCameraThisSession: true,
    stoppedForVisibility: true,
    secure: true,
    hasApi: true,
  };

  assert.equal(resumeAction({ ...base, attemptsThisTransition: 0 }), 'restart');
  assert.equal(resumeAction({ ...base, attemptsThisTransition: 1 }), 'gate');
});
