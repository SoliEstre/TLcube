# expected_tones 계측 배선 구멍 — 조사 보고 (lane: expected-tones)

- 작업 루트: `C:/Users/excte/AppData/Local/Temp/claude/C--Dev-TrilLuminanceCube/cbab68e1-189d-4694-a57c-e4d261155daf/scratchpad/wt-tones` (3616deb detached)
- 날짜: 2026-08-15

## 결론 요약

- 판정 **(a) 프론트 미탑재** — 정확히는 기대 구성 패널에 톤 입력 UI 자체가 없었다. relay·ClickHouse 는 처음부터 수신 준비 완료 (ALTER 불필요).
- 수정: `expected_layout` 과 동형 배선으로 기대 톤 카드(모름/2톤/3톤) 추가 → `expected.tones` 탑재. 소스 4파일 + 스캐너 번들 3종 재빌드. `SCANNER_BUILD` 2026-08-15.03.
- 회귀 테스트 2건 추가, 스위트 1410 · pass 1401 · fail 3 (전부 기준선부터 있던 기존 실패 — dirty 트리 산 번들 동기화 계열, §2·§5).
- 커밋·push·배포 없음. 트리 밖 쓰기 없음.

## 진행 로그

- [시작] 산출물 파일 생성. 재현·추적 착수.

## 1. 판정 — 값이 떨어지는 결정 지점 (수정 전 기록)

**판정: (a) 프론트가 아예 안 넣는다.** 더 정확히는 — **넣을 입력 자체가 UI 에 없다.**
값은 「전송 중 유실」이 아니라 **수집 단계에서 시작조차 안 된다.**

근거 (3616deb 기준 실측):

1. **다운스트림은 전부 준비돼 있다.**
   - `relay/protocol.mjs:271` — `expected_tones: configSideNum(expected, 'tones')` 로 `body.expected.tones` 를 이미 추출한다 (`expected_layout` 계열과 같은 행 블록).
   - `relay/schema.sql:48` — `expected_tones Nullable(UInt8)` 컬럼 존재.
   - `deploy/estre-so/clickhouse/002_tl_lab_p0_instrumentation.sql:25` — `ADD COLUMN IF NOT EXISTS expected_tones Nullable(UInt8) AFTER expected_ecc` 로 실DB에도 반영됨. **(c) 컬럼명 어긋남 아님 — 새 ALTER 불필요.**
   - `src/lab-telemetry.js:214-236` — `normalizeConfigSide` 가 `tones` 키를 숫자로 정규화해 통과시킨다 (`CONFIG_SIDE_KEYS` 에 포함). **(b) relay 가 버리는 것 아님.**
2. **프론트가 안 넣는다.**
   - `sites/tlscan/scanner.js:382-383` — `const expected = emptyConfigSide();` 후 `locatorLayout` 만 채운다. `tones` 는 어디서도 안 채움.
   - `sites/tlscan/scanner.js` 전체에 `tone` 문자열 0회 (grep 실측).
3. **입력 UI 자체가 없다.**
   - 기대 구성 패널 `#lab-expected-arm` (`sites/tlscan/index.html:882-889`, `sites/_shared/lab-scan.html`, `sites/_shared/scan-new.html` 동일 블록) — 버튼은 `data-expected-layout` (모름/v0/v2r2) 뿐. `data-expected-tone` 류 요소 없음.
   - `dist/tlscan.html` · `dist/trilume.html` 에도 `expected_tones|expectedTones|data-expected-tone` 0회 (grep -c 실측 0).

**브리프 증상 서술과의 차이 (추측 아님, 실측):** 브리프는 「기대 구성 패널에서 사용자가 2톤/3톤을 고르는데 그 값이 안 실린다」고 했으나, 이 트리(3616deb)에는 2톤/3톤 선택 UI 가 존재하지 않는다. 따라서 전 행 NULL 의 원인은 「고른 값이 유실」이 아니라 「고를 수단이 없어 항상 null 전송」이다. 수정 방향은 동일하다 — `expected_layout` 과 같은 배선 형태로 톤 선택 버튼을 패널에 추가하고 `expected.tones` 에 싣는다.

## 수정 계획 (기존 배선과 같은 형태)

`expected_layout` 배선의 4개 지점을 그대로 미러링한다:

1. `sites/tlscan/index.html` — `#lab-notice` 안, 레이아웃 카드 아래에 `#lab-expected-tones` 카드 그룹 (모름/2톤/3톤, `data-expected-tones` 속성). 스타일은 기존 `.lab-expected-arm` 클래스 재사용 (신규 CSS 없음).
2. `sites/tlscan/strings.js` — `lab.expectedTones.*` 4키 × ko/en/ja (scanner-i18n.test.js 가 3언어 동일 키 집합·비어있지 않음을 강제).
3. `sites/tlscan/scanner.js` — `expectedLocatorLayout` 핸들러(1500-1513행)와 같은 형태의 `expectedTonesChoice` 핸들러 + `reportLabFrame` 의 `expected` 조립(382-383행)에서 `expected.tones` 채움. `isLabPath()` 게이트 동일 적용. `SCANNER_BUILD` 를 2026-08-15.02 → 2026-08-15.03 으로 상향 (배포본 식별 규약).
4. 회귀 테스트 — `test/lab-p0-instrumentation.test.js` 에 (i) `normalizeFrameBody` 가 `expected.tones` 를 보존, (ii) `eventRow` 가 `expected_tones` 로 실음, (iii) 스캐너 소스에 톤 선택 배선이 실재(텍스트 단언 — 이 파일 331행대 기존 패턴과 동일 기법)를 단언.

**ClickHouse ALTER 불필요 판정:** `expected_tones` 컬럼은 `relay/schema.sql:48` + `deploy/estre-so/clickhouse/002_...sql:25` 에 이미 존재. 새 마이그레이션 파일 작성 안 함 (배제 목록의 「컬럼이 정말 없으면」 조건 미충족).

**재빌드 대상:** 스캐너 소스만 변경 → `dist/tlscan.html`(build-scanner.mjs) · `sites/_shared/scan-new.html` · `sites/_shared/lab-scan.html`(build-scan-variants.mjs). `scan-old.html` 은 고정 ref 09596a3 빌드라 불변, 생성기 3종(trilume/gen-finder/lab-gen)은 소스 무변경이라 결정적 빌드상 불변 — 재빌드 후 git status 로 실측 확인한다.

**코디네이션 관찰:** 같은 워크트리 `test/output/` 에 다른 lane 산출물(`grok-finder-first-*.json`, 22:02 갱신)이 실시간으로 생기고 있다 — 동시 작업 lane 존재. 소스 편집 파일이 겹치면 위험하나, 현재 grok lane 산출물은 측정 JSON 뿐이라 충돌 없음. 통합자 참고.

## 2. 기준선 실측 — 브리프 수치와 다르다 (수정 전, pristine 3616deb)

`node --test test/*.test.js` → `test/output/suite-baseline.txt` (exit 1):

- **tests 1408 · pass 1398 · fail 4 · skipped 6** (브리프 기준선 1403/1404 · fail 1 과 불일치)
- 브리프의 기지 실패 「Type Y 3톤 실사진 …」 은 이 워크트리에서 **fail 이 아니라 skip** — 휘도 덤프 실물 자산이 이 트리에 없어서 스스로 건너뛴다 (`decoder-cube.test.js:459`). 실사진 가드 계열 skip 이 총 6건.
- fail 4 건 중 3건은 격리 재실행에서도 재현되는 **기존 실패** (내 수정 전):
  1. `동기화: buildScannerHtml() 결과가 dist/tlscan.html과 바이트 동일하다` (bundle-scanner.test.js)
  2. `동기화: buildSingleHtml() 결과가 dist/trilume.html 과 바이트 동일하다` (bundle.test.js)
  3. `정식/시험판 산출물이 같은 소스 빌더의 현재 결과와 바이트 동일하다` (gen-variants.test.js)
  4번째 `에디터는 캔버스에서만 우클릭 메뉴를 막고 현재 소스에서 다시 생성된다` 는 격리 재실행에서 통과 — 최종 스위트에서 재관찰한다.
- **원인 판정 (실측):** 줄바꿈 아님 (전 파일 CR 0바이트, `.gitattributes` `eol=lf` 정상 작동 — 초기 od 측정은 자 오류였다). 진짜 원인: **통합자 본트리가 dirty 상태** — `C:/Dev/TrilLuminanceCube/TLcube` 에 미커밋 변경 (`src/decoder/cube-detect.js` 수정, `cellsurface-block-detect.js` 신규 등) 이 있고, 3616deb 에 커밋된 번들들은 그 dirty 소스로 구워졌다. 그래서 **커밋된 소스만으로 빌드하면 커밋된 번들과 바이트가 다르다.** 브리프의 1403/1404 기준선은 통합자 dirty 트리에서 잰 수치로 추정된다.
- **통합자 주의 (중요):** 이 lane 이 재빌드한 스캐너 번들 3종은 3616deb 소스 + 본 수정만 반영한다. HEAD 커밋 번들에 구워져 있던 **미커밋 cube-detect 변경분이 빠진다.** retire 시 내 번들 파일을 그대로 쓰지 말고 **통합자 트리에서 반드시 재빌드**할 것.

## 3. 수정 내용 (diff 요약)

소스 4파일 87줄 삽입 / 1줄 치환, 번들 3종 재생성. 총 7파일.

| 파일 | 변경 |
|---|---|
| `sites/tlscan/index.html` | `#lab-notice` 안에 `#lab-expected-tones` 카드 그룹 추가 (모름/2톤/3톤, `data-expected-tones` 속성). 기존 `.lab-expected-arm` 스타일 재사용 — 신규 CSS 0줄 |
| `sites/tlscan/scanner.js` | ① `expectedTones` 상태 + 클릭 핸들러 (레이아웃 핸들러와 동형, `isLabPath()` 게이트 동일) ② `reportLabFrame` 의 expected 조립에 `if (expectedTones != null) expected.tones = expectedTones;` ③ `SCANNER_BUILD` 2026-08-15.02 → **2026-08-15.03** (배포본 식별 규약 준수) |
| `sites/tlscan/strings.js` | `lab.expectedTones.{label,unknown,two,three}` × ko/en/ja (12줄) |
| `test/lab-p0-instrumentation.test.js` | 회귀 테스트 2건 (아래 §4) |
| `dist/tlscan.html` | `node tools/build-scanner.mjs` 재생성 (1,203,275 B) |
| `sites/_shared/lab-scan.html` | 재생성 — `dist/tlscan.html` 과 **바이트 동일 확인**(cmp), 커밋본과 같은 관계 유지 |
| `sites/_shared/scan-new.html` | 재생성 — 새 빌드 + 기존 피커 바(태그만 .03 으로 갱신). **old-ref(09596a3) git worktree 를 만들지 않기 위해** `build-scan-variants.mjs` 의 main() 대신 exported `buildScannerLabHtml()` + 현행 바 재사용으로 조립 (브리프의 「트리 밖에 쓰지 마라」 준수 — main() 은 tmpdir 에 worktree 를 만든다). 바이트 관계 실측: scan-new = lab-scan + 894 B (커밋본도 정확히 +894 B 관계) |

`scan-old.html` 불변(고정 ref 빌드), 생성기 번들 3종(trilume/gen-finder/lab-gen) 불변 — `src/` 를 안 건드렸으므로 브리프 조건(「src/ 를 건드렸다면」) 미발동. relay·ClickHouse SQL 무변경 (컬럼 기존재).

## 4. 회귀 테스트

`test/lab-p0-instrumentation.test.js` 에 2건 추가:

1. **`기대 톤 선택이 expected_tones 로 실린다`** — 페이로드 조립 단위: `normalizeFrameBody({expected:{tones:'2',locatorLayout:'v0'}})` → `expected.tones === 2` (문자열도 숫자 정규화), envelope 왕복 후 `eventRow` 가 `expected_tones === 2` / `3`, 미선택은 `null` 유지 (0/'' 로 안 뭉갬).
2. **`스캐너 lab 패널에 기대 톤 선택 배선이 실재한다`** — 소스 텍스트 단언: html 에 `#lab-expected-tones`·`data-expected-tones="2"/"3"`, scanner.js 에 `getElementById('lab-expected-tones')`·`expected.tones = expectedTones`·`expectedTonesRoot && isLabPath()` (정식 `/` 게이트). 한계 명시: «적혀 있다» 까지 보증 — 실기기 확인은 /lab/ 배포 후 ClickHouse 로 잰다.

안정판 불변식: 새 UI 는 `#lab-notice`(lab 에서만 표시) 안, 핸들러는 `isLabPath()` 게이트 뒤 — 정식 `/` 텔레메트리 0바이트 불변. 기존 테스트 약화 없음 (삭제·수정 0건, 추가만).

## 5. 스위트 숫자 그대로 (수정 후)

`node --test test/*.test.js` → `test/output/suite-after.txt` (node exit 1):

- **tests 1410 · pass 1401 · fail 3 · cancelled 0 · skipped 6**
- 기준선 대비: tests +2 (신규 회귀 테스트 2건, 둘 다 ✔) · fail 4→3
- 초록 전환: `동기화: buildScannerHtml() 결과가 dist/tlscan.html과 바이트 동일하다` — 내 재빌드로 기존 실패가 해소됨 (✔ 실측)
- 잔존 실패 3건, **전부 기준선에도 있던 것** (내 수정과 무관, §2 원인 판정 참조):
  1. `동기화: buildSingleHtml() 결과가 dist/trilume.html 과 바이트 동일하다` — 생성기 번들, dirty 트리 원인
  2. `정식/시험판 산출물이 같은 소스 빌더의 현재 결과와 바이트 동일하다` — 생성기 변형본, 동일 원인
  3. `에디터는 캔버스에서만 우클릭 메뉴를 막고 현재 소스에서 다시 생성된다` — 전체 스위트에서만 실패하고 격리 실행에서는 통과 (기준선·수정후 동일 패턴). 원인 미규명 — 추측을 결론으로 적지 않는다. 통합자 트리에서 재확인 요망
- 신규 실패 0건. 기존 테스트 약화 0건.
- 재빌드 여부: 스캐너 번들 3종 재빌드함 (§3). 생성기 번들 재빌드 안 함 (src/ 무변경).

## 6. 못 한 것 · 범위 밖 관찰

1. **실기기/실DB 검증 불가** — ClickHouse `tl_lab.events` 에 접근 수단이 이 lane 에 없다. 「배포 후 신규 행에서 expected_tones 가 non-NULL」 은 통합자 배포 후 실측해야 닫힌다. 본 수정은 합성 단위(정규화→envelope→relay 행)까지만 실증했다.
2. **기존 NULL 행 소급 불가** — 과거 이벤트에는 기대 톤 정보 자체가 수집된 적이 없어 복구할 원본이 없다. 「2톤 인식률 상대 우위」 정량 검증은 이 배선 배포 이후 새 표본으로만 가능하다.
3. **브리프 기준선(1403/1404 · fail 1)과 이 워크트리 기준선(1408 · fail 4 · skip 6)의 불일치** — §2 에 원인 실측 (실사진 덤프 자산 부재 → 기지 실패가 skip 으로, 통합자 dirty 트리 → 번들 동기화 3건 기존 실패). 내가 만든 실패가 아님을 baseline 파일(`test/output/suite-baseline.txt`)로 증빙.
4. **생성기 번들 3종 재빌드 안 함** — src/ 무변경이므로 브리프 조건 미발동. 단 그쪽 동기화 테스트 2건은 기존 실패로 남는다 (dirty 트리 원인, 위 §2).
5. **`.agent/_lessons` 기록 못 함** — private repo 는 이 lane 에 읽기 전용. 교훈 후보: 「번들 커밋은 clean 트리에서 — dirty 트리에서 구운 번들은 커밋 소스로 재현이 안 된다」. 통합자가 기록해 주면 좋겠다.
