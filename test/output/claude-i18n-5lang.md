# i18n 5언어 확장 (fr·it·de·es·pt) — 과업 1 보고서

> 레인: i18n · 워크트리 `wt-i18n` (HEAD 3b5916d) · 2026-08-17
> 최종 지원 = ko/en/ja/fr/it/de/es/pt **8언어**
> 용어집 정본 = `test/output/claude-i18n-glossary.md` (같은 레인 산출물)

## 0. 결과 요약

| 항목 | 값 |
|---|---|
| 정본 스위트 | `node --test "test/*.test.js" "test/harness/*.test.js" "relay/*.test.js"` |
| tests / suites | **2004 / 255** |
| pass / fail / skipped | **1998 / 0 / 6** |
| 기준선(작업 전) | 2004 / 255 · 1998 / 0 / 6 — **동일** |
| skip 6건 | 전부 실사진 휘도 덤프 부재 핀 (브리프가 예고한 skip) |
| 언어별 키 수 | ko·en·ja·fr·it·de·es·pt = **각 315키, 집합 완전 동일, 중복 0** |
| 리터럴 `**` | 8언어 전부 **0** |
| 번들 | 9종 재빌드 · `SCANNER_BUILD='2026-08-17.01'` **무변경** |

## 1. 무엇을 했나

### 1.1 용어집 정본 (과업 ①)

`test/output/claude-i18n-glossary.md` 신설. ko 원문에서 프로젝트 고유 용어를 전수 추출해 8언어 대응표로 정리했다. 절 구성:

- §0 **번역하지 않는 것** — 레이아웃 id(`v0`·`v0X`·`v0XQ`·`v0W`·`v0WQ`·`v1r2`·`v2r2`·`K3`), 버전 라벨(`Y0`·`Y1`·`Y2` 등), 면 부호(`T`·`L`·`R`), 고유명(`TL`·`TLcube`·`Trilume`·`Slate`·`Ember`·`Mono`), 수치·단위(`B`·`Δmin`·`β`·`8×8`), 규격 참조(`SPEC §4.4`), 와이어 필드명(`reference/format`)
- §1.1 구조·기하 / §1.2 검출 기구 / §1.3 렌더·색 / §1.4 배치·여백 / §1.5 용량·부호화 / §1.6 판정·검증 / §1.7 파인더 점수 축 / §1.8 셀 편집기 / §1.9 조작 안내 / §1.10 **테스트가 파싱하는 단위 낱말**
- §2 존대·문체 규약 (fr vous · de Sie · es usted · it/pt 표준 UI 체)
- §3 금지 사항 (리터럴 `**` · 토큰 보존 · 태그 보존 · 줄 수 보존 · 앞뒤 공백 보존 · 내부 명칭 금지 · g907 «Auto =» 금지 · g459==g515)

번역 중 판정이 갈렸던 두 자리를 표에 못 박아 뒀다:

- **파인더 ≠ 로케이터** — 이 UI 에서 사실상 같은 물건이지만 (O/A 섹션은 «파인더», Y 섹션은 «로케이터») 역어를 합치지 않았다. 합치면 두 섹션 문구가 같아져 «어느 섹션 얘기인가» 를 화면이 대답 못 한다.
- **핀치 어휘** — fr `pincement` · it `pizzico` · de `Pinch` · es `pellizco` · pt `pinça`. 이 낱말은 `test/generator-preview-ui.test.js` 의 `pinch` 표에 그대로 박혀 있어, 역어를 바꾸면 테스트도 같은 커밋에서 바꿔야 한다.

### 1.2 생성기 사전 5언어 (과업 ②)

`index.html` 의 `GENERATOR_STRINGS` 에 `fr`·`it`·`de`·`es`·`pt` 5블록 삽입 (ko/en/ja 뒤).

| 블록 | 줄 범위 (작업 후) |
|---|---|
| `ko` | 1864\~2181 |
| `en` | 2182\~2499 |
| `ja` | 2500\~2817 |
| `fr` | **2818\~3134** |
| `it` | **3135\~3451** |
| `de` | **3452\~3768** |
| `es` | **3769\~4085** |
| `pt` | **4086\~4402** |

- ko 를 저작 원본으로 번역, en 참조 병행. **기존 ko/en/ja 문구는 한 글자도 안 건드렸다** (git diff 상 index.html 은 **1593줄 순수 추가**, 삭제 0).
- 치환 토큰(`{sep}` `{tight}` `{message}` 등 40종)·`<b>`/`<span>` 태그 구조·여러 줄 도움말의 `\n` 개수·연결용 앞뒤 공백을 ko 와 1:1로 맞췄다.
  - 유일한 예외 g070: ko 값에 소스 들여쓰기 artefact 인 `\n` + 공백 10칸이 들어 있는데 **en 이 이미 한 줄로 합쳐 놓았다**. 새 5언어는 en 을 따랐다 (§4 관찰 ① 참조).

### 1.3 언어 선택 UI (과업 ③)

`index.html` 헤더의 `#langSwitch` 에 `FR`·`IT`·`DE`·`ES`·`PT` 버튼 5개 추가. 기존 `한국어`·`EN`·`日本語` 라벨은 그대로 두고 뒤에 붙였다 (`EN` 과 같은 두 글자 코드 표기로 통일).

**⚠ 이 버튼들은 아직 «눌러도 안 바뀐다».** `createI18n().setLanguage()` 가 `src/i18n.js` 의 `SUPPORTED_LANGUAGES` 로 걸러내는데, 그 상수는 **과업 2 소관**이라 이 레인에서 손대지 않았다 (브리프의 명시적 배제). 자세한 것은 §3.

### 1.4 테스트 확장 «의도적 갱신» (과업 ④)

9개 파일. 전부 «재는 것은 그대로, 대상 언어만 8로» 이고 각 자리에 `⚠ **의도적 갱신** (2026-08-17, i18n 5언어 확장)` 주석을 달았다.

| 파일 | 무엇을 바꿨나 |
|---|---|
| `test/generator-help-ui.test.js` | `LANGS` 3 → 8. g907 «Auto =» 금지 패턴이 새 5언어를 함께 덮는 근거를 주석에 명시 |
| `test/generator-help-capacity.test.js` | `LANGS` 3 → 8. 언어별 «단위 낱말» 을 상수 4개(`CELL_WORDS`·`FINDER_WORDS`·`SLOT_WORDS`·`DATA_WORDS`)로 뽑아 정규식에 주입. 테스트 제목 3건도 «세 언어» → «여덟 언어» |
| `test/generator-preview-ui.test.js` | `LANGS` 3 → 8. `seen.size` 상수 3 → **`LANGS.length`** (상수를 박으면 «3 을 8 로 고쳤다» 로 끝나고 두 언어가 같아도 초록이 된다). 핀치 표에 5언어 추가 + `assert.ok(pinch[lang])` 가드. 번들 사전 값 목록에 5언어 g962 머리 추가 |
| `test/i18n-coverage.test.js` | `dictRanges` 정규식 3 → 8언어 (안 늘리면 새 블록이 «사전 밖» 으로 잡혀 번역 누락이 다른 결함으로 위장된다). 키 집합 동일성 순회 `['en','ja']` → 7개 언어. 제목 2건 갱신 |
| `test/locatorY-lab.test.js` | 로케이터 문구 키 존재 순회 3 → 8언어 |
| `test/type-y-cell-editor-lab.test.js` | 셀 편집기 키 순회 3 → 8언어 + `RENAMED` 값 핀에 5언어 역어 추가 |
| `test/y-cell-editor-refformat.test.js` | g549(`{message}` 토큰 포함) 순회 3 → 8언어 |
| `test/quiet-auto.test.js` | g904·g935·g991 언어 수 핀 3 → 8 |
| `test/shading.test.js` | g992 핀 3 → 8, 음영 문구 11키 핀 3 → 8, 제목 갱신 |

### 1.5 번들 재빌드 (과업 ⑤)

9종 전부 실행: `build-single` · `build-gen-variants` · `build-lab` · `build-scanner` · `build-scan-variants` · `build-hub` · `build-cell-editor` · `build-finder-editor` · `build-print-poster`.

산출물 변화:

| 파일 | 결과 |
|---|---|
| `dist/trilume.html` | 변경 (1,541,431 B) — 새 사전 5언어 실림 |
| `sites/_shared/gen-finder.html` | 변경 (1,541,453 B) — 실림 |
| `sites/_shared/lab-gen.html` | 변경 (1,541,453 B) — 실림 |
| `dist/tlscan.html` · `sites/_shared/lab-scan.html` · `sites/_shared/scan-*.html` | **바이트 동일** (스캐너 사전은 이 과업 범위 밖) |
| `sites/_shared/gen-finder-editor.html` · `sites/_shared/cell-editor.html` | **바이트 동일** (독립 사전을 쓴다 — §3 참조) |
| `sites/tl/**` (허브) | **바이트 동일** (허브는 언어별 HTML 3벌 생성 방식) |
| `print/tlcube-poster*.html` | **바이트 동일** |

`sites/tlscan/scanner.js` 의 `SCANNER_BUILD = '2026-08-17.01'` — **값 무변경** (grep 으로 확인). 스캐너 번들은 재빌드했고 결과가 바이트 동일하다.

## 2. 자 검증 (테스트 밖에서 따로 잰 것)

### 2.1 자체 스크립트 검증

`index.html` 을 직접 파싱해 잰 결과 (테스트와 독립 경로):

```
langs: ko,en,ja,fr,it,de,es,pt
  ko: raw=315 unique=315 dup=0 keys=315 sameAsKo=true stars=0 empty=0
  en: raw=315 unique=315 dup=0 keys=315 sameAsKo=true stars=0 empty=0
  ja: raw=315 unique=315 dup=0 keys=315 sameAsKo=true stars=0 empty=0
  fr: raw=315 unique=315 dup=0 keys=315 sameAsKo=true stars=0 empty=0
  it: raw=315 unique=315 dup=0 keys=315 sameAsKo=true stars=0 empty=0
  de: raw=315 unique=315 dup=0 keys=315 sameAsKo=true stars=0 empty=0
  es: raw=315 unique=315 dup=0 keys=315 sameAsKo=true stars=0 empty=0
  pt: raw=315 unique=315 dup=0 keys=315 sameAsKo=true stars=0 empty=0
  public help keys: g900,g901,g971,g982,g902,g903,g904,g905,g907 | lab: g906
  dist/trilume.html: 새 사전 값 5/5
  sites/_shared/gen-finder.html: 새 사전 값 5/5
  sites/_shared/lab-gen.html: 새 사전 값 5/5
SELFCHECK OK
```

`raw` 는 원문 텍스트에서 `"gNNN":` 을 그대로 센 값이라, 객체로 만든 뒤 세는 방식이 놓치는 **중복 키(뒤 값이 앞 값을 덮는 사고)** 까지 잡는다. 8언어 전부 `raw == unique`.

추가로 잰 것: g459 == g515 (8언어) · 정식 화면 도움말 9키에 내부 명칭(`v0X`·`v0x`·`v1r2`·`v2r2`·`cellSurfaceFinal`·`cell-surface-`·`hex-frame`·`locatorProfileY`)과 `*.js` 부재 (8언어) · g953 의 `{tight}%` 인접 (8언어).

### 2.2 «자를 제대로 댔는가» — 돌연변이 검증

초록 스위트가 **새 언어를 실제로 재고 있는지** 확인하려고, 일부러 세 곳을 깨뜨리고 해당 테스트만 돌렸다.

| 돌연변이 | 잡혔나 | 잡은 테스트 / 메시지 |
|---|---|---|
| fr g906 의 `· v0X — 65 cellules` → `64 cellules` | ✅ | `generator-help-capacity` — «fr/g906 v0X: 셀 수가 실측(65)과 다르다» |
| de g962 에서 `Pinch-Geste` 제거 | ✅ | `generator-preview-ui` — «de/g962 가 핀치를 말하지 않는다» |
| es 사전에서 `g953` 키 삭제 | ✅ | `generator-help-ui` — «es 에 g953 가 없다» / `i18n-coverage` — «es 사전에 빠진 키: g953» |

세 돌연변이 모두 **정확히 그 언어를 지목해** 실패했다. 확장한 정규식이 «아무것도 안 재는 패턴» 이 아님을 이걸로 확인했다. 검증 후 `index.html` 원상 복구.

## 3. 막힌 지점 · 다른 레인 의존

**막혀서 중단한 것은 없다.** 다만 이 레인 단독으로는 닫을 수 없는 이음매가 하나 있다.

### 3.1 `SUPPORTED_LANGUAGES` — 과업 2 없이는 새 버튼이 안 먹는다 🔴

- `src/i18n.js` 의 `export const SUPPORTED_LANGUAGES = ['ko', 'en', 'ja'];` 가 그대로다 (브리프: «src/i18n.js 는 과업 2 몫 — 여기선 건드리지 말 것»).
- `createI18n().setLanguage(next)` 는 `if (!SUPPORTED_LANGUAGES.includes(next) ... ) return;` 로 조기 반환한다. 따라서 §1.3 에서 추가한 **FR/IT/DE/ES/PT 버튼은 클릭해도 아무 일이 없다.**
- 사전은 이미 8언어라, 과업 2 가 상수만 넓히면 그 순간 전부 살아난다. 추가 배선은 필요 없다.
- **통합자 유의**: 이 레인만 단독 머지하면 «버튼은 있는데 안 눌린다» 상태로 출고된다. 두 레인은 **같은 릴리스에 함께** 들어가야 한다. 그 뜻을 `index.html` 버튼 블록 위 주석에도 남겨 뒀다.

### 3.2 `test/i18n-fallback.test.js` 와 충돌할 수 있는 단언 (과업 2 쪽 숙제)

현행 테스트가 이렇게 못 박고 있다:

```js
assert.equal(detectLanguage(['fr-FR', 'de-DE']), 'en');
```

과업 2 가 `SUPPORTED_LANGUAGES` 에 fr·de 를 넣는 순간 이 단언이 깨진다. **이 레인에서는 안 건드렸다** — 상수를 넓히는 레인이 «의도적 갱신» 을 달아 같이 고치는 게 맞다. 지금 상태에서는 초록이다. 같은 파일의 주석 「지원 밖 언어(예: fr·de)」 문구도 함께 갱신 대상이다.

### 3.3 범위 밖으로 남긴 사전 3종 (보고만)

같은 «다국어» 로 보이지만 이번 과업(생성기 사전)에 포함되지 않은 사전들:

| 사전 | 위치 | 현재 |
|---|---|---|
| 스캐너 | `sites/tlscan/strings.js` (`SCANNER_STRINGS`) | ko/en/ja 3언어. `test/scanner-i18n.test.js` 가 `assert.deepEqual(LANGS.sort(), ['en','ja','ko'])` 로 3언어를 **못 박고 있다** — 확장 시 이 단언도 같이 열어야 한다 |
| 셀 편집기 (독립본) | `tools/cell-editor-template.html` + `tools/cell-editor-app.js` | 자체 `data-lang` 버튼 KO/EN/JA |
| 파인더 에디터 | `tools/finder-editor-template.html` + `tools/finder-editor-app.js` | 자체 `data-lang` 버튼 KO/EN/JA |
| 허브 | `tools/build-hub.mjs` | 언어별 HTML 3벌 생성 (ko/en/ja) + 첫 방문 리다이렉트 규약 |

생성기(index.html)만 8언어가 되면, 사용자가 생성기에서 FR 을 고른 뒤 스캐너·허브로 넘어갔을 때 **영어로 떨어진다**(각 표면의 폴백). 기능 결함은 아니지만 «반쪽 다국어» 로 보인다 — 후속 과업의 스코프 판단 재료로 남긴다.

## 4. ko/en 원문 관찰 (기록만 — 수정하지 않음)

브리프대로 기존 ko/en/ja 문구는 손대지 않았다. 번역하며 눈에 걸린 것을 남긴다.

1. **g070 ko 값에 소스 들여쓰기가 섞여 있다.**
   `"… (면 조명 셰이딩 적용).\n          렌더 전용이라 …"` — `\n` 뒤 공백 10칸은 HTML 소스의 들여쓰기가 문자열 안으로 들어간 artefact 로 보인다. 이 값은 `data-i18n` 힌트로 나가므로 렌더 결과에 여분 공백이 실린다. **en·ja 는 이미 한 줄로 합쳐 놓았고**, 새 5언어도 en 을 따랐다. 즉 현재 ko 만 다르다.
2. **en 의 `center` / `centre` 혼용.** g407·g604·g605 는 `center`, 나머지(g471·g608·g609·g905·g907 등)는 `centre`. 한 사전 안에서 US/UK 철자가 섞여 있다. (새 5언어는 각 언어의 단일 철자를 쓴다.)
3. **g445\~g448 의 구분자만 다르다.** 이 네 개만 `자체검증 ✓ - {state} ·` 처럼 하이픈을 쓰고, 사전의 나머지 연결자는 전부 `·` 다. en·ja 도 그대로 하이픈이라 «의도된 형태» 일 수 있어 5언어도 하이픈을 유지했다.
4. **키 순서 역전 2쌍.** ko 사전에서 `g542` 가 `g541` 보다, `g514` 가 `g513` 보다 먼저 온다. 동작에는 영향이 없다 (새 5언어도 ko 순서를 그대로 따랐다 — 순서까지 동일).
5. **값이 겹치는 키 14쌍** (g036/g983, g043/g403, g061/g419, g067/g420, g068/g421, g073/g427, g078/g422, g079/g423, g080/g424, g202/g415, g203/g416, g920/g924, g459/g515, g461/g475). 대부분 «정적 DOM 라벨 ↔ JS 생성 문구» 의 짝이라 의도된 중복으로 보이고, en 은 그중 일부를 대소문자로 갈라 쓴다(`Capacity` / `capacity`). 5언어도 en 의 갈라 쓰기를 따랐다.

## 5. 변경 파일 목록

```
 dist/trilume.html                    |   10 +-   (재빌드)
 index.html                           | 1593 +++   (5언어 사전 + 언어 버튼 5개, 삭제 0)
 sites/_shared/gen-finder.html        |   10 +-   (재빌드)
 sites/_shared/lab-gen.html           |   10 +-   (재빌드)
 test/generator-help-capacity.test.js |   34 +-
 test/generator-help-ui.test.js       |    7 +-
 test/generator-preview-ui.test.js    |   29 +-
 test/i18n-coverage.test.js           |   17 +-
 test/locatorY-lab.test.js            |    7 +-
 test/quiet-auto.test.js              |    5 +-
 test/shading.test.js                 |    9 +-
 test/type-y-cell-editor-lab.test.js  |   13 +-
 test/y-cell-editor-refformat.test.js |    6 +-
 13 files changed, 1715 insertions(+), 35 deletions(-)
```

신설 산출물 (추적 밖, `test/output/`):

- `test/output/claude-i18n-glossary.md` — 8언어 용어집 정본
- `test/output/claude-i18n-5lang.md` — 이 문서

---

# 과업 2 — 스캐너·허브 사전 + 8언어 드롭다운 + i18n.js

> 같은 레인·같은 워크트리(`wt-i18n`, HEAD 3b5916d) · 2026-08-17
> 과업 1 이 남긴 이음매(«버튼은 있는데 안 눌린다»)를 닫는 것이 이 과업의 첫 항목이다.

## 6. 결과 요약

| 항목 | 값 |
|---|---|
| 정본 스위트 | `node --test "test/*.test.js" "test/harness/*.test.js" "relay/*.test.js"` |
| tests / suites | **2019 / 255** (과업 1 종료 시 2004 / 255) |
| pass / fail / skipped | **2013 / 0 / 6** — pristine |
| skip 6건 | 과업 1 과 동일 (실사진 휘도 덤프 부재 핀) |
| `SUPPORTED_LANGUAGES` | `['ko','en','ja','fr','it','de','es','pt']` |
| 스캐너 사전 | 8언어 × **111키** (집합 완전 동일, 중복 0, 빈 값 0) |
| 허브 사전 | 8언어 × **81키** · 언어판 HTML **8벌** 생성 |
| 생성기 사전 | 8언어 × **316키** (신규 `g563` = 드롭다운 aria-label) |
| 언어 선택 UI | 생성기·스캐너 **네이티브 `<select>`** · 허브는 기존 disclosure 링크판 유지 |
| 번들 | 9종 재빌드 · 2회 연속 **바이트 동일** · `SCANNER_BUILD='2026-08-17.01'` 무변경 |

## 7. 무엇을 했나

### 7.1 `src/i18n.js` — 상수 확장 + 드롭다운 분기 (과업 ①)

- `SUPPORTED_LANGUAGES` 3 → **8**. `DEFAULT_LANGUAGE='ko'`(사전 미스키 폴백)·`FALLBACK_LANGUAGE='en'`(지원 밖 브라우저) 규약은 그대로다. 두 상수의 역할 구분이 이 확장의 요점이라 주석에도 다시 못 박았다.
- `LANGUAGE_LABELS` 신설 — 8언어의 **자기 표기**(`한국어`·`English`·`日本語`·`Français`·`Italiano`·`Deutsch`·`Español`·`Português`). 언어를 바꾸려는 사람은 지금 화면 언어를 못 읽는 사람이라, 현재 언어로 번역한 언어명은 정작 그 사람이 못 읽는다.
- `wireLanguageSwitch` 가 **두 모양**을 받는다. `select[data-lang-select]` 가 있으면 그것을 잡고(`change` → `setLanguage` → `sync()`), 없으면 기존 버튼 나열 경로를 쓴다. 버튼 경로를 남긴 이유는 `tools/` 의 독립 에디터 2종이 아직 그 모양이기 때문이다 (§9.1).
  - `sync()` 로 되돌리는 것이 중요하다. `setLanguage` 는 지원 밖 코드를 **조용히 무시**하므로, 되돌리지 않으면 «드롭다운은 FR 인데 화면은 한국어» 인 거짓 표시가 남는다.

### 7.2 스캐너 사전 5언어 (과업 ②)

`sites/tlscan/strings.js` — `fr`·`it`·`de`·`es`·`pt` 5블록 추가 (**+605줄, 삭제 2줄**; 삭제 2줄은 파일 머리말의 «(ko · en · ja)» / «세 언어 모두» 라는 이제 틀린 주장이다).

- 용어집(`test/output/claude-i18n-glossary.md`) 정본 준수. 그 과정에서 정한 세 가지를 용어집 §4 로 증보했다 — **pt = pt-PT 로 통일** · **«스캐너» 역어** · **`copy.*Suffix` 성 중립**.
- `SCANNER_BUILD = '2026-08-17.01'` **값 무변경** (스탬프는 통합자 몫).

세 결정의 근거:

1. **pt-PT 통일** — 과업 1 의 생성기 사전이 이미 pt-PT 어휘로 나갔다 (`Ecrã`·`Repor`·`descodificação`·`definições`). 스캐너를 pt-BR 로 쓰면 같은 사용자가 화면마다 다른 낱말을 본다. 그래서 `câmara`·`ecrã`·`palavra-passe`·`separador`·`ficheiro` 계열로 맞췄고, 허브 `og:locale` 도 `pt_PT` 로 선언했다.
2. **`copy.*Suffix` 성 중립** — 이 세 접미사는 `label + suffix` 로 붙는데 앞 라벨의 성이 갈린다 (fr `Adresse` 여성 / `Contenu` 남성). 분사를 일치시키면 **절반이 틀린 문장**이 된다. 그래서 「— copie effectuée.」 「— copia eseguita.」 처럼 명사구로 끊었다. de 는 분사 일치가 없어 자연스러운 문장형(`Adresse wurde kopiert.`)을 그대로 쓴다.
3. **«스캐너» 역어** — fr/it/de/pt 는 `Scanner`, es 는 `Escáner`. pt 는 «Leitor» 도 자연스럽지만 제품명 인지 일관성을 위해 명사는 `Scanner` 로 두고 **동사만** «ler / leitura» 를 쓴다 (`Ler a partir de uma foto`).

### 7.3 허브 — «i18n 표면 맞음» 판정 후 5언어 추가 (과업 ③)

**판정: 허브는 i18n 표면이다.** 실측 근거 —

- `tools/hub-content.mjs` 에 언어별 문구 사전이 **81키 × 3언어**로 실재했다.
- `tools/build-hub.mjs` 가 그것으로 **언어별 정적 HTML 을 생성**하고 있었고(`sites/tl/`, `/en/`, `/ja/`), 각 문서가 서로를 `hreflang` 으로 가리켰다.
- 상단 바에 이미 **접힌 드롭다운**(`lang-drop` disclosure)이 있었다.

따라서 «없으면 보고» 가지가 아니라 «있으면 5언어 추가» 가지로 갔다.

| 무엇 | 결과 |
|---|---|
| `hub-content.mjs` `languages` | 3 → **8** (`fr`·`it`·`de`·`es`·`pt`, `ogLocale` 포함. pt 는 `pt_PT`) |
| `hub-content.mjs` `strings` | 81키 × 5언어 추가 (**+396줄**) |
| 언어판 HTML | `sites/tl/{fr,it,de,es,pt}/index.html` **신설** — 각 20 kB 내외 |
| `hreflang` | 문서마다 8 + `x-default` = **9개** (전 문서 실측 확인) |
| 언어 드롭다운 | 문서마다 언어 링크 **8개** |
| 첫 방문 리다이렉트 | 지원 목록을 `languages` 배열에서 **찍어 낸다** — 손으로 적힌 3언어 하드코딩 제거 |
| 복호 시간 표기 | `ms`/`msEn`/`msJa` 세 필드 → **언어별 맵**. 삼항 사슬(`ko ? : en ? : ja`)이 새 언어에 **일본어 표기를 물려주고 있었다** |
| `sitemap.xml` | **build-hub 가 생성**하도록 전환 (8 URL × 9 hreflang) |
| `sites/tl/llms.txt` | 언어판 목록 3 → 8 |

허브 리다이렉트가 `languages` 를 쓰게 만든 것이 브리프 ①의 «허브 리다이렉트 규약이 이 목록을 쓰면 함께 8언어» 에 대한 답이다 — 쓰고 있지 **않았고**(하드코딩), 그래서 쓰도록 바꿨다. 안 바꿨다면 «새 /fr/ 이 있는데 불어 브라우저는 계속 /en/ 으로 튕긴다» 가 된다.

**sitemap 을 생성물로 돌린 이유**: 언어판 3개일 때는 3 × 4 = 12줄이라 손으로 버텼는데 8개면 8 × 9 = 72줄이다. 손에 남기면 언어를 늘린 날 sitemap 만 옛 목록으로 남고, 그건 **조용하다** — 페이지는 살아 있는데 색인에는 없는 상태가 된다. `LASTMOD` 는 상수로 두어 재실행이 결정적이다.

### 7.4 언어 선택 = 드롭다운 (과업 ④)

운영자 지시(«8언어는 드롭다운») 대로 생성기·스캐너 양쪽을 **네이티브 `<select>`** 로 교체했다.

| 표면 | 전 | 후 |
|---|---|---|
| 생성기 `#langSwitch` | `button[data-lang]` × 8 (과업 1 이 5개 추가) | `<select id="langSelect" data-lang-select>` + `<option>` × 8 |
| 스캐너 `#lang-switch` | `button[data-lang]` × 3 | `<select id="lang-select" data-lang-select>` + `<option>` × 8 |
| 허브 | disclosure 링크판 | **그대로** (§7.5) |

- **왜 네이티브 select 인가**: 키보드 조작·스크린리더·모바일 시스템 휠 피커를 공짜로 얻는다. 직접 만든 팝업은 그 셋을 전부 다시 구현해야 하고, 스캐너는 카메라 위에 얹히는 오버레이라 자리도 특히 귀하다. 생성기는 이미 «4번째 토글이 붙어 폰 폭에서 상단 바가 접힌다» 는 사용자 보고(2026-08-11)가 있었다 — 8개를 펼치면 모드·테마 토글까지 밀려난다.
- 접근 이름은 사전을 거친다. 생성기는 신규 키 **`g563`**(`언어`/`Language`/`言語`/`Langue`/`Lingua`/`Sprache`/`Idioma`/`Idioma`), 스캐너는 기존 `lang.label`. 안 거치면 언어를 바꿔도 영영 첫 언어로 읽힌다.
- 어두운 카메라 화면 위라 스캐너 쪽은 `option` 색까지 명시했다 — 펼친 목록은 OS 위젯이라 컨테이너 규칙이 닿지 않는다.
- 옛 버튼은 **남기지 않고 걷어냈다.** 둘 다 있으면 현재 언어 표시가 두 곳으로 갈려 «어느 쪽이 진짜인가» 를 화면이 대답 못 한다. 테스트가 잔존 버튼을 실패로 잰다.

### 7.5 허브만 링크판을 유지한 이유 (판정)

허브는 **언어별 URL 을 실제로 갖는다**. 링크여야 크롤러가 언어판을 따라가고 `hreflang` 이 의미를 갖는다. 생성기·스캐너는 단일 HTML 런타임 전환이라(SPEC §8 — 생성기는 `file://` 로도 열려야 한다) **따라갈 URL 자체가 없다**. 세 표면의 UI 를 억지로 같은 위젯으로 맞추면 허브의 SEO 를 깨뜨린다. 그 판단 근거를 `build-hub.mjs` 주석에 남겼다.

### 7.6 테스트 (과업 ⑤)

| 파일 | 무엇을 |
|---|---|
| `test/i18n-language-switch.test.js` | **신설**. 지원 목록 8종 핀 · 자기표기 라벨표 · 허브 `languages` 와의 집합/라벨 일치 · 생성기·스캐너 드롭다운 존재와 **항목 8 핀(순서 포함)** · 3언어 시절 버튼 잔존 금지 · aria-label 의 사전 경유 · `wireLanguageSwitch` 의 select 분기와 `sync()` 되돌림 · 번들 5언어 적재 |
| `test/i18n-fallback.test.js` | **의도적 갱신**. 지원 밖 예시 `fr·de` → `nl·pl` (그 둘이 지원 언어가 됐다). 새 5언어가 자기 언어로 가는지 추가. 목록 8종 핀 추가. 허브 리다이렉트가 **`languages` 에서 찍어 내는지** + 옛 하드코딩 부재 |
| `test/scanner-i18n.test.js` | **의도적 갱신**. 언어 배열 핀 3 → 8 · `guide.tlcubeOnly` 값 핀 3 → 8 · **사전 언어 목록 == `SUPPORTED_LANGUAGES`** 교차 검증 신설 |
| `test/hub-build.test.js` | **의도적 갱신**. 제목·주석의 «3언어» → 8 (전부 `languages` 순회라 로직은 자동 확장). **sitemap 전 언어판 핀** 신설 · **복호 시간 맵이 언어 수만큼 있고 표에 실렸는지** 신설 |

과업 1 이 남긴 «부수 숙제»(`assert.equal(detectLanguage(['fr-FR','de-DE']), 'en')`)를 **의도적 갱신**으로 처리한 자리가 두 번째 줄이다. 그냥 지우지 않고 뒤집었다 — 이제 fr 브라우저는 fr 로 가야 하고, 그것 자체가 이 과업의 핵심 산출이기 때문이다.

### 7.7 번들 (과업 ⑥)

9종 전부 재실행: `build-single` · `build-gen-variants` · `build-lab` · `build-scanner` · `build-scan-variants` · `build-hub` · `build-cell-editor` · `build-finder-editor` · `build-print-poster`.

| 파일 | 결과 |
|---|---|
| `dist/trilume.html` | 변경 1,545,163 B — 새 사전 + 드롭다운 |
| `dist/tlscan.html` | 변경 1,732,363 B — **스캐너 새 사전 5언어 실림** |
| `sites/_shared/gen-finder.html` · `lab-gen.html` | 변경 1,545,185 B |
| `sites/_shared/lab-scan.html` · `scan-new.html` | 변경 1,732,363 / 1,733,257 B |
| `sites/tl/**` | 8언어 HTML + sitemap 갱신 |
| `sites/_shared/scan-old.html` · `cell-editor.html` · `gen-finder-editor.html` | **바이트 동일** (§9.1) |
| `print/tlcube-poster*.html` | **바이트 동일** |

**결정성**: 9종을 한 번 더 돌려 sha256 을 대조했다 — 14개 산출물 전부 바이트 동일. `SCANNER_BUILD` 는 소스·번들 양쪽에서 `2026-08-17.01` 로 확인했다.

## 8. 자 검증 (테스트 밖에서 따로 잰 것)

### 8.1 독립 경로 실측 — `test/output/claude-i18n-selfcheck.mjs`

```
생성기 사전:  ko/en/ja/fr/it/de/es/pt = raw 316 · unique 316 · sameAsKo true · stars 0 · empty 0
g563:        ko=언어 en=Language ja=言語 fr=Langue it=Lingua de=Sprache es=Idioma pt=Idioma
드롭다운:     index.html · sites/tlscan/index.html · dist/trilume.html · dist/tlscan.html
             · lab-scan · lab-gen · gen-finder · scan-new  = 전부 8항목 · 자기표기 true · 잔존버튼 false
스캐너 번들:  dist/tlscan.html 5/5 · lab-scan.html 5/5 · scan-new.html 5/5
허브 언어판:  ko en ja fr it de es pt = hreflang 9 · 언어링크 8 · lang/canonical/자기문구 전부 true
키 수:       스캐너 111 × 8언어 · 허브 81 × 8언어
SCANNER_BUILD: 2026-08-17.01
SELFCHECK OK
```

`raw` 는 원문 텍스트에서 키를 그대로 센 값이라, 객체로 만든 뒤 세는 방식이 놓치는 **중복 키(뒤 값이 앞 값을 덮는 사고)** 까지 잡는다.

이 자를 대다가 한 번 헛짚었다 — 번들은 소스를 그대로 인라인하므로 값 안의 `'` 가 `\'` 로 이스케이프된 채 들어간다. it 의 `un'altra` 를 찾다가 «5언어 중 4언어만 실렸다» 는 오탐이 났다. 홑따옴표 없는 값으로 바꿔 다시 쟀다.

### 8.2 «기존 문구를 정말 안 건드렸나» — `test/output/claude-i18n-nochange.mjs`

diff 를 눈으로 읽는 것은 주장이라, HEAD 판을 꺼내 **값 단위로** 대조했다.

```
생성기 ko: 기존 315키 유지 · 신규 g563
생성기 en: 기존 315키 유지 · 신규 g563
생성기 ja: 기존 315키 유지 · 신규 g563
NOCHANGE OK — 기존 ko/en/ja 사전 값 전부 동일 (신규 키만 추가)
```

스캐너 111키 × ko/en/ja, 허브 81키 × ko/en/ja, `stats.types.*.decoded`, 그리고 **필드에서 맵으로 옮긴 `ms` 값 3종**까지 전부 동일했다.

### 8.3 «자를 제대로 댔는가» — 돌연변이 5건

새 테스트가 «아무것도 안 재는 패턴» 이 아님을 확인하려고 일부러 깨뜨렸다.

| 돌연변이 | 잡혔나 | 어디서 |
|---|---|---|
| `SUPPORTED_LANGUAGES` 를 3언어로 되돌림 | 잡힘 | `i18n-fallback` + `scanner-i18n` + `i18n-language-switch` **7건 실패** |
| 스캐너 드롭다운에서 `de` 항목 제거 | 잡힘 | `i18n-language-switch` 1건 |
| 허브 fr 라벨을 자기표기 아닌 `French` 로 | 잡힘 | `i18n-language-switch` 1건 |
| 허브 리다이렉트를 옛 3언어 하드코딩으로 | 잡힘 | `i18n-fallback` 1건 |
| 스캐너 pt 사전에서 키 1개 삭제 | 잡힘 | `scanner-i18n` 1건 |

첫 번째가 특히 중요하다 — **과업 1 종료 시점의 실제 상태**가 그것이었고, 그때 사전 커버리지 테스트는 전부 초록이었다. «고를 수 있는가» 를 아무도 안 재고 있었다는 뜻이다. 이제 그 상태는 7건 실패로 즉시 드러난다. 검증 후 전부 원상 복구하고 selfcheck·정본 스위트를 재실행했다 (OK / 2019 · 0 fail).

## 9. 남는 것 · 통합자 유의

**막혀서 중단한 것은 없다.** 과업 1 §3.1 의 이음매(«버튼은 있는데 안 눌린다»)는 이 과업에서 닫혔다 — 두 과업은 같은 워크트리·같은 커밋 계열이라 함께 나간다.

### 9.1 아직 3언어인 표면 2종 (범위 밖 · 보고)

| 표면 | 위치 | 현재 |
|---|---|---|
| 셀 편집기 (독립본) | `tools/cell-editor-template.html` + `cell-editor-app.js` | 자체 사전 · `KO/EN/JA` 버튼 3개 |
| 파인더 에디터 | `tools/finder-editor-template.html` + `finder-editor-app.js` | 자체 사전 · `KO/EN/JA` 버튼 3개 |

둘 다 `src/i18n.js` 를 **쓰지 않고** 자체 사전·자체 `data-lang` 배선을 갖는다. 그래서 이번 확장의 영향도 안 받았고(번들 바이트 동일), 이번 브리프의 «생성기·스캐너 양쪽» 범위 밖이다. `wireLanguageSwitch` 의 버튼 분기를 남겨 둔 것은 이 둘을 나중에 옮길 때를 위한 것이다. 후속 과업 재료로 남긴다.

### 9.2 배포 쪽 확인 (실측)

- `deploy/estre-so/projects/tlcube/static-hub.conf` — 허브는 **디렉터리 마운트**(`sites/tl`)라 `/fr/` … `/pt/` 가 nginx 변경 없이 그대로 서빙된다. `location = ...` 정확일치 블록이 없어 새 디렉터리가 가려지지도 않는다. **conf 수정 불필요.**
- `sites/tl/sitemap.xml` 이 바뀌었으므로 배포 후 검색엔진 재제출은 운영 절차 쪽 일이다.

### 9.3 통합자 체크

- `SCANNER_BUILD` 는 `2026-08-17.01` 그대로다. 배포 스탬프를 올릴 때 **스캐너 번들을 다시 찍어야** 번들 안 값도 같이 올라간다.
- `sites/tl/{fr,it,de,es,pt}/` 는 **새 디렉터리**다 — `git add` 대상에서 빠지기 쉽다.
- `test/i18n-language-switch.test.js` 도 신규 파일이다.

## 10. 변경 파일 목록 (과업 1 + 2 누적)

```
 dist/tlscan.html                     |   53 +-   (재빌드)
 dist/trilume.html                    |   35 +-   (재빌드)
 index.html                           | 1630 +++   (5언어 사전 + g563 + 드롭다운, 삭제 7)
 sites/_shared/gen-finder.html        |   35 +-   (재빌드)
 sites/_shared/lab-gen.html           |   35 +-   (재빌드)
 sites/_shared/lab-scan.html          |   53 +-   (재빌드)
 sites/_shared/scan-new.html          |   53 +-   (재빌드)
 sites/tl/index.html                  |   29 +-   (재생성)
 sites/tl/en/index.html               |   29 +-   (재생성)
 sites/tl/ja/index.html               |   29 +-   (재생성)
 sites/tl/llms.txt                    |    7 +-
 sites/tl/sitemap.xml                 |   86 +-   (생성물로 전환)
 sites/tlscan/index.html              |   49 +-   (드롭다운 + CSS)
 sites/tlscan/strings.js              |  607 +++   (5언어, 삭제 2 = 낡은 머리말)
 src/i18n.js                          |   60 +-   (8언어 + LANGUAGE_LABELS + select 분기)
 tools/build-hub.mjs                  |   79 +-   (ms 맵 · 리다이렉트 · sitemap 생성)
 tools/hub-content.mjs                |  399 +++   (5언어 + languages 8)
 test/*.test.js                       | 과업 1 의 9개 + hub-build · i18n-fallback · scanner-i18n
 총계                                 | 29 files · 3313 insertions · 194 deletions
```

신규 (추적 대상):

- `sites/tl/fr/index.html` · `it/` · `de/` · `es/` · `pt/`
- `test/i18n-language-switch.test.js`

신규 (추적 밖, `test/output/`):

- `test/output/claude-i18n-selfcheck.mjs` — 독립 경로 실측
- `test/output/claude-i18n-nochange.mjs` — 기존 ko/en/ja 무변경 실측
- `test/output/claude-i18n-glossary.md` §4 증보 — pt-PT 통일 · 스캐너 역어 · `copy.*Suffix` 성 중립 · 자기표기 · 수치 표기

---

## §11 retire 통합 정정 (2026-08-17 — 렌즈 2종 판독 + 병합 봉합)

두 렌즈 모두 기능·배선·기계 계약은 독립 재현으로 전부 확인 (돌연변이 배터리 11건 전부 적중). 봉합 내역:

1. **병합 갭** — 레인 베이스 (3b5916d) 이후 main 에 들어온 스캐너 fps 배지의 `fps.title` 키를 신규 5언어에 보충. 같은 이유로 base 이후 축약된 g412·g514 를 5언어도 신판 (1줄) 로 재번역, g907 에 이관된 회전 문장을 5언어에 추가.
2. **렌즈 2 봉합 (우선순위 1\~8)**: pt 제품명 `Leitor`→`Scanner` (g025·g064·g065·g905·g906·g907·g971 — 동사 ler/leitura 유지, hub statusNote3 의 «리더 링크» 는 일반명사라 유지) · pt g520 `cubo central`→`núcleo central` · it/es g904 `Nessuna/Ninguna`→`Nessuno/Ninguno` · pt g079/g423 `Padrão`→`Normal` · de g024/footer.intro `Über/Übersicht`→`Info` 통일 · hub why2 인용부호 (it/es/pt «…» 밀착, de „…“) · g961 TL 문두 이동 (it Posizionamento TL · es Colocación TL · pt Posicionamento TL) · update.ready 표면 간 통일 (it/de/es/pt) · it result.card.email `Email`→`E-mail` · pt g511 `Não legíveis`→`Impossíveis de ler` (leitura difícil 3단과 분리) · de g510 `Latte`→`Messlatte` · it g984 `Piatto`→`Piatta`.
3. **렌즈 1 F1/F2** — «3언어/세 언어» 현재형 주석·제목 11곳 정정 (hub-content 머리말·index.html 2곳·tlscan/index.html·locatorY-lab 2곳·scanner-i18n 인용·quiet-auto 제목·generator-help-ui 3곳·generator-preview-ui 머리말).
4. **F3 정정 사실화** — §3.3 의 «다른 표면 폴백 = 영어» 는 독립 에디터 2종 (cell-editor·finder-editor) 에는 틀림: 둘 다 자체 사전으로 **ko 폴백** (cell-editor 는 navigator.language 를 읽지도 않음) 이고 `/celleditor/` 는 라이브 라우트다. FALLBACK_LANGUAGE='en' 규약과 충돌 — 후속 스코프 (에디터 2종 i18n 통합) 재료.
5. **F4 기록** — 드랍 후보 사전 키의 5언어 신규 번역 30건은 보존 정책대로 유지 (되살릴 때 재번역 방지).
6. **미봉합 (저강도 등재)**: fr 기예메 안쪽 공백의 NBSP 화 (D-4 — 14곳, 줄바꿈 시 « 고아 가능) · en center/centre·en-dash 혼용의 5언어 전파 (F5) · g953 뱃지 축약 호칭 (D-2 후반).
