/**
 * centralBeaconWire.js — 중앙 비컨의 **와이어 계약**(표식 + 기하)만 담는 얇은 모듈.
 * 의존은 finder-patterns 하나 — 기하 축소비를 3톤 큐브 패턴 표에서 유도하기 위해서다.
 *
 * 왜 분리했나: 매직의 소비자가 둘이다 — 인코더 쪽(centralBeacon.js, encodeY 체인을
 * 끈다)과 **스캐너 표시 경로**(sites/tlscan/scanner.js). 스캐너가 표식 2바이트를
 * 보려고 인코더 체인 전체를 번들에 끌고 오는 것은 잘못이라 표식만 여기로 내렸다.
 * centralBeacon.js 가 re-export 하므로 정본은 여전히 하나다.
 *
 * **「나는 페이로드가 아니다」 구분자** (계약 `central-v0-beacon.md` §4.1).
 *
 * 중앙 비컨은 **문법적으로 완전한 Type Y v0 코드**다. 그래서 스캐너가 중앙 블록만
 * 잡으면 그것을 독립 코드로 복호해 **성공하고**, 사용자에게 메타데이터 바이트를
 * 「내용」으로 보여준다 — 매직이 제어문자라 **빈 텍스트**로 보인다
 * (실기기 재현 2026-08-22, 운영자 보고). 실패가 조용한 종류다.
 *
 * 왜 제어문자인가 — 이 페이로드 경로는 `packBeaconText` 가 `String.fromCharCode` 로
 * 만들고 `unpackBeaconText` 가 **ASCII 7bit 밖을 거부**한다. 그래서 「UTF-8 선두로
 * 불가능한 바이트(0xF5\~0xFF)」 같은 **구조적** 보장은 쓸 수 없다. 대신 생성기의
 * 페이로드 경로(URL · 텍스트 · Wi-Fi · vCard)가 만들어 낼 수 없는 제어문자를 쓴다.
 *
 * 매직만 믿지 않는다 — `unpackBeaconBytes` 의 복합 검사(길이 == 순 페이로드 ·
 * 예약 바이트 전부 0 · 계열/파인더 인덱스 유효 · 포맷 digit < 6)가 2차 방어다.
 * 매직 2바이트는 그 앞에 두는 **싼 1차 관문**이고, 예산에서 2 B 는 예약분으로 낸다.
 */
import {
  THREE_TONE_CUBE_FINDER_PATTERN_ID, getFinderPattern,
} from './finder-patterns.js';

export const BEACON_MAGIC = Object.freeze([0x01, 0x0f]); // SOH · SI

/**
 * 비컨 기하 — 렌더러(scene.js)와 역산기(decoder/central-beacon-adapt.js)가 **같은
 * 값**을 물어야 하는 축소비. 2026-08-22 실기기 판정에서 «꽉 채움» 이 기각되고
 * (운영자: 기존 3톤 큐브처럼 크기 맞춰 거리를 띄워라) 3톤 큐브 규약으로 갔다:
 *
 *   비컨 지지 반지름 = 슬롯 지지 반지름 × (radiusCells / slotRadiusCells)
 *
 * 값 0.875 를 손으로 적지 않는다 — 큐브 패턴 표가 바뀌면 렌더와 역산이 **함께**
 * 따라가야 하고, 한쪽만 따라가면 포즈가 그 비율만큼 어긋난다. 실제로 렌더에만
 * 축소비가 들어가고 역산이 «꽉 채움» 전제로 남아 1.143배 어긋난 적이 있다
 * (같은 날, 레인 병행 작업 중 — 이 함수가 그 재발 방지다).
 */
export function centralBeaconGeometry() {
  const cube = getFinderPattern(THREE_TONE_CUBE_FINDER_PATTERN_ID);
  const shrink = cube.radiusCells / cube.slotRadiusCells;
  if (!(shrink > 0 && shrink < 1)) {
    throw new Error(`비컨 축소비가 (0,1) 밖이다: ${shrink} — 큐브 패턴 표를 확인하라`);
  }
  return Object.freeze({
    shrink,
    radiusCells: cube.radiusCells,
    slotRadiusCells: cube.slotRadiusCells,
  });
}

/**
 * 복호된 텍스트가 비컨인가 — 스캐너 표시 경로의 1차 관문. 여기서 true 면 그
 * 텍스트를 사용자에게 보여주면 안 된다 (내용이 아니라 바깥 코드의 신호다).
 */
export function textStartsWithBeaconMagic(text) {
  if (typeof text !== 'string' || text.length < BEACON_MAGIC.length) return false;
  for (let i = 0; i < BEACON_MAGIC.length; i += 1) {
    if (text.charCodeAt(i) !== BEACON_MAGIC[i]) return false;
  }
  return true;
}
