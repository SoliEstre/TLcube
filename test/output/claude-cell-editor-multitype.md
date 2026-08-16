# 셀 편집기 — 개명 · 다중 타입 (Y/O/A) · undo/redo · 단축키

레인 `wt-celledit` · 2026-08-16 · 대상 = 생성기 정본 `index.html` 의 g521 섹션
(+ `tools/build-lab.mjs` 파생 번들). 커밋·푸시 안 함.

---

## 0. 요약

| 항목 | 결과 |
|---|---|
| ① 개명 g521 | ko «셀 편집기» · en «Cell editor» · ja «セル編集» |
| ② 다중 타입 | **Y · O · A** 편집 지원 + 타입 선택 카드. **K 제외** (§6) |
| ③ 되돌리기/다시하기 | 유한 스택 **상한 50** · **드래그 스트로크 코얼레싱** · (타입,크기) 별 분리 |
| ④ 단축키 | 섹션 포커스 스코프 · Ctrl/Cmd+Z · Ctrl+Shift+Z · Ctrl+Y · 글상자 비가로채기 |
| ⑤ i18n 대역 | **g550–g562** 한 대역 (13키 × 3언어) — 다른 레인(600번대)과 안 겹침 |
| ⑥ 테스트 | 신설 17 (`test/cell-editor-history.test.js`) + 기존 lab 스위트 갱신·증강 |
| ⑦ 번들·스위트 | 4개 빌더 재실행 · SCANNER_BUILD 무접촉 (lab-scan 바이트 동일) |
| 정본 스위트 | **기준 1736/1730 pass/6 skip → 1755/1749 pass/6 skip · fail 0** |

---

## 1. 사전 조사 — 편집기가 두 개다 (혼동 지점)

| | 위치 | 상태 엔진 | 기존 기능 |
|---|---|---|---|
| **생성기 섹션 (이번 대상)** | `index.html` `#yCellEditorSection` (g521) | `src/type-y-cell-editor.js` | Y 전용 · 톤/마스크 · 줌 · 복사 · ref/format autoplace 표시. **undo/redo 없음** |
| 독립 `/celleditor/` | `tools/cell-editor-app.js` + `cell-editor-template.html` | `src/cell-editor-core.js` | Y/O/A/K · 붓·통·지우개 · undo/redo · **이름·붙여넣기** · autoplace 힌트 |

브리프의 «기존 편집기 계약 무회귀» 세 항목은 두 편집기에 나뉘어 있었다 —
붙여넣기·이름 필드는 독립 편집기(3bcd2b4), autoplace 표시는 양쪽(c0e7321),
컴팩트 튜플 팩은 **아직 어느 쪽에도 없었다**(정본화 때 사람이 손으로 하던 재압축).
공유 코어를 건드리므로 **양쪽 모두** 무회귀 대상으로 잡았고, 컴팩트 팩은 §5 처럼 구현했다.

**`cell-editor-core.js` 는 이미 다중 타입 지향이었다** (확인 완료):
`CELL_TYPES=['Y','O','A','K']` · `enumerateCells` · `roleOfCoord` · `getCellTone/setCellToneDirect`
· `serializeUniversalEditor` 가 전부 타입 분기를 갖는다. 그래서 O/A 는 **새 기하를 쓰지 않고**
코어를 통해 `placement.roleOf` / `placementA.roleOfA` 와 `hexgrid.facePolygon` 을 그대로 읽는다.

---

## 2. 무엇을 바꿨나

### 신설
- **`src/cell-editor-history.js`** (순수 ESM, 의존 0) — 되돌리기 스택 규칙의 유일한 소유자.
  버킷 API(`recordOnBucket` / `beginStrokeOnBucket` / …)와 스토어 API(`historyKey(type,size)` 로
  버킷을 가름), 그리고 단축키 분류기(`classifyHistoryShortcut` · `isTextEntryTarget`).
  스냅샷은 **불투명**하다 — 모듈은 내용을 모르고 호출자가 복제·복원한다. 그래서 서로 다른
  상태 모양을 가진 두 편집기가 같은 스택을 쓴다.
- **`test/cell-editor-history.test.js`** — 17 테스트 (§7).

### 수정
- `src/cell-editor-core.js` — 히스토리 구현을 새 모듈에 **위임**(`pushUndoSnapshot`/`undo`/`redo`
  시그니처·의미 그대로) + `beginEditStroke`/`endEditStroke`/`canUndo`/`canRedo` 추가 +
  컴팩트 튜플 팩(`packUniversalEditorTuples` · `stringifyCompactJson` ·
  `stringifyUniversalEditorCompact`).
- `index.html` — 섹션 개명·타입 카드·O/A 렌더·undo/redo·스트로크·단축키·i18n 13키 (§3, §4).
- `tools/cell-editor-app.js` — 독립 편집기도 같은 규칙을 쓰도록 배선 (§8).
- `tools/build-single.mjs` · `tools/build-cell-editor.mjs` — 모듈 순서에 신규 모듈 등록.
- `test/type-y-cell-editor-lab.test.js` — 갱신 + 증강 (§7.2).

### 변경 파일 (커밋 대상)
```
신규  src/cell-editor-history.js
신규  test/cell-editor-history.test.js
수정  index.html                            (+644 hunk 합계 · §11 픽스 포함)
수정  src/cell-editor-core.js
수정  tools/cell-editor-app.js
수정  tools/build-single.mjs · tools/build-cell-editor.mjs
수정  test/type-y-cell-editor-lab.test.js · test/cell-editor-core.test.js
번들  dist/trilume.html · sites/_shared/{gen-finder,lab-gen,cell-editor}.html
무변  sites/_shared/lab-scan.html · sites/_shared/gen-finder-editor.html
```

> 정정 (§11 픽스 레인): 처음 적힌 «index.html (+582/-23)» 는 틀렸다. 검증 렌즈가 센
> 실제 값은 그 시점 기준 **+583/-37** 이었고, 픽스까지 반영한 현재 `git diff --stat` 은
> index.html 한 파일에서 **644줄 변경**이다.

---

## 3. ② 다중 타입 — 설계와 근거

### 3.1 무엇을 재사용했나

O/A 는 편집기 전용 기하·역할표를 **하나도 만들지 않았다**.

| 필요 | 출처 |
|---|---|
| 셀 열거 | `cell-editor-core.enumerateCells` (O: `hexDistance<=k`, A: `placementA.isInRegionA`) |
| 면 다각형 | `hexgrid.facePolygon(q, r, face, layout)` |
| 역할 (data/detector/fixed) | `cell-editor-core.roleOfCoord` → `placement.roleOf` / `placementA.roleOfA` |
| 격자 반경 k | `capacity.VERSIONS` / `capacityA.VERSIONS_A` (버전 표에서 읽는다) |
| 직렬화 | `cell-editor-core.serializeUniversalEditor` (스키마 `tlcube-cell-editor/v2`) |

**viewBox 는 반경이 아니라 실제 꼭짓점 범위에서 뽑는다.** Type A 의 코너 패치가 육각 반경
바깥으로 나가므로 반경 기반 bbox 는 패치를 잘라 먹는다 (실기 확인: A k=6 viewBox
`-16.90 -19.45 33.81 29.90`, 190셀 × 3면 = 570 노드).

### 3.2 «autoplaceHex/markerO 계열» 에 대한 정정 — 읽어 주세요

브리프는 O 를 «autoplaceHex/markerO 계열» 로 지시했지만, **지금 생성기는 O·A 를
`cornerMarker` 없이 인코딩한다** (`index.html` `encodeOptsFor()` 가 `{centerQr, version}` 만
넘기고, `encode.js`/`encodeA.js` 의 `cornerMarker` 기본값은 `false`). 즉 O-CM/A-CM 의
정본 역할표(`markerO.roleOfOMarker` · `markerA`)는 **UI 에 아직 연결돼 있지 않다.**

c0e7321 이 세운 계약은 «편집기가 **표시하는** 배치 == 인코더가 **실제 쓰는** 배치» 다.
그 계약을 따르면 지금 표시해야 할 역할표는 레거시(`placement.roleOf` / `placementA.roleOfA`)이므로
그쪽으로 붙였다. **O-CM/A-CM 이 UI 에 붙는 날 `cellEditorContext` 한 곳만 같이 바꾸면 된다**
(index.html 의 «다중 타입 (O·A)» 주석 블록에 그 지점을 명시해 뒀다).
markerO 를 지금 붙였다면 편집기만 코너 마커 12셀을 fixed 로 그리고 실제 코드에는 없는 —
표시와 실물이 갈리는 — 상태가 됐을 것이다.

### 3.3 타입 선택 UI 와 섹션 노출

- 카드 3장 (`data-ycell-type="Y|O|A"`). 섹션 게이트는
  `isLabPath() && CELL_EDITOR_TYPES.includes(generatorState.type)`.
- 편집 타입은 **생성기 타입이 바뀐 순간에만** 끌어온다(`cellEditorFollowedType`). 그 뒤엔
  카드 선택이 이긴다 — Y 코드를 만들면서 O 파인더를 설계하는 흐름을 막지 않는다.
- O/A 의 k 는 버전 선택이 `auto` 면 **마지막으로 인코딩된 k** 를 쓰고(`lastEncodedKO/KA`,
  Y 의 `lastEncodedYn` 과 같은 배선), 없으면 표의 최소 버전 k.

### 3.4 O/A 편집 규칙 (Y 와 다른 점)

- **중앙 파인더 19셀은 잠근다.** 파인더 패턴 설계는 독립 `/celleditor/` 의 몫이다 — 반쪽 UI 로
  건드리면 두 편집기의 파인더 상태가 갈라진다.
- 그 밖의 고정 역할(앵커·ref/format)은 **톤만** 바뀌고 데이터 제외(`userNonData`)는 안 된다.
  마스크 모드 토글은 코어(`applyMaskToggle`)가 그대로 막는다.
- 범례 셋째 항목은 타입별로 갈린다: Y 는 g529 «고정 reference/format», O/A 는 g558
  «고정 파인더/앵커/ref/format» (O/A 는 앵커·파인더도 고정이라 옛 문구가 거짓이 된다).
- **데이터 경계선(빨간 변)은 Y 전용으로 남겼다.** `dataBoundaryEdges` 가 Y 격자 전용이고,
  육각/삼각 경계 추출은 이번 범위 밖이다 (의도적 미구현 — 필요하면 별도 태스크).

---

## 4. ③④ 되돌리기 · 스트로크 코얼레싱 · 단축키

### 4.1 상한과 분리
- **상한 50 스텝** (`CELL_EDITOR_HISTORY_LIMIT`). 넘으면 가장 오래된 것부터 버린다.
  스냅샷이 Set·Map 복제라 무한 스택은 큰 격자에서 메모리를 먹는다.
- 버킷 키는 **(타입, 크기)** 다 — 브리프의 «타입별 분리» 를 한 칸 더 좁혔다. 근거: Y n=21
  스냅샷을 n=13 상태에 되붙이면 좌표계부터 달라 «되돌리기» 가 아니라 파괴다. 생성기의 Y 상태가
  이미 n 별로 사는 구조(`editorStateForN`)와도 정확히 맞는다.
- 타입 전환은 히스토리를 **비우지 않고 갈아탄다**. Y→A→Y 하면 Y 스택이 그대로 있다 (실기 확인).

### 4.2 코얼레싱 — 단위는 스트로크지 셀이 아니다
`pointerdown` 에서 스냅샷을 **예약**하고, **첫 실제 편집**에서 스택에 올리며 스트로크를 잠근다.
잠긴 동안의 기록 요청은 전부 무시된다. `pointerup`/`pointercancel` 에서 푼다.

> **실기에서 잡은 결함**: 처음엔 `pointerdown` 에서 곧바로 스냅샷을 쌓았다. 그러면 **잠긴
> 중앙 파인더 셀을 눌러도 스텝이 생겨서** Ctrl+Z 가 아무 일도 안 하는 것처럼 보였다.
> 브라우저로 눌러 보고 발견했다(테스트는 초록이었다). 그래서 «예약 → 첫 편집에서 확정» 으로
> 바꿨다. 지금은 잠긴 셀 클릭 후에도 undo 버튼이 비활성으로 남는다.

같은 스트로크 안에서 한 면은 **한 번만** 바뀐다(`cellEditorStrokePainted`) — 톤이 순환이라
드래그가 같은 면 위를 스치면 톤이 계속 돌아버린다.
드래그 중 다시 그리기는 **rAF 로 프레임당 1회** (한 번에 면 노드 수백\~수천 개를 만든다).

### 4.3 단축키 스코프
- 리스너는 **섹션 엘리먼트**에 건다(`#yCellEditorSection`, `tabindex="-1"`). window 전역 청취
  금지 — 생성기에는 다른 컨트롤이 가득하다. 포인터로 칠하면 섹션에 포커스를 준다.
- Ctrl/Cmd+Z = undo · Ctrl+Shift+Z / Ctrl+Y = redo. Alt 조합·수식키 없는 z/y 는 무시.
- **글상자(input/textarea/select/contenteditable) 안에서는 null 을 돌려준다** → 브라우저 기본
  동작 보존. 독립 편집기의 이름·붙여넣기 칸이 이 규칙의 실제 수요처다.
- **추가 단축키는 넣지 않았다.** 근거: 이 섹션의 톤 편집은 «순환»(좌클릭 어둡게 / 우클릭 밝게)
  이지 팔레트 선택이 아니라, 숫자키 0/1/2 를 붙이면 «선택된 톤» 이라는 없는 개념을 UI 에
  들여야 한다. 독립 편집기에는 팔레트가 있어 그쪽 숫자키는 그대로 둔다.
- 안내는 UI 에 노출(g557, 3언어) + 불가 시 버튼 비활성.

---

## 5. 컴팩트 튜플 팩 (export JSON)

`stringifyUniversalEditorCompact(state)` — `{q,r}` → `[q, r]`, `{face,q,r,tone}` →
`["T", q, r, 2]`, 원시값 배열만 한 줄로 붙이는 결정적 JSON 출력.
`parseUniversalEditor` 가 원래부터 튜플을 받으므로 **왕복이 보장**되고 테스트로 고정했다.
생성기 섹션의 O/A JSON·복사 버튼이 이 팩을 쓴다 (Y 는 기존 `stringifyCellEditor` 유지 — 무회귀).

---

## 6. K 제외 사유 (브리프 지시대로 명기)

**타입 K 는 편집 대상에서 뺐다.** `cell-editor-core.js` 는 K 를 알지만
(`isInRegionK`/`patchOfK`) 생성기 렌더러·인코더에는 K 경로가 없고, 무엇보다 **K 의 꼭짓점
회계(앵커 vs 마커)가 아직 미결**이다 — 태스크 #11 «K 꼭짓점 회계 실험» 이 그걸 정한다.
정해지기 전에 편집기를 열면 표시할 정본 역할표가 없어서 «편집기만의 K» 를 만들게 되고,
그건 c0e7321 계약(표시 == 실물) 위반이다.
UI 에도 사유를 한 줄로 노출한다(g554). 테스트가 `data-ycell-type="K"` 부재를 단언한다.

---

## 7. 테스트

### 7.1 신설 — `test/cell-editor-history.test.js` (17)
스택 의미(스텝 = 되돌리기 1, redo 는 정확한 역, 새 편집이 redo 가지를 버림) ·
**상한 50 · 스트로크 코얼레싱**(40셀 드래그 = 1스텝 / 스트로크 2회 = 2스텝 / 중첩 시작이
스텝을 안 늘림 / 코얼레싱이 스트로크를 안 넘음) · **타입·크기별 버킷 분리와 복귀** ·
**단축키 분류와 글상자 비가로채기**(INPUT/TEXTAREA/SELECT/contenteditable) ·
코어 통합(`beginEditStroke` 로 3셀 드래그 = 1스텝, 스트로크 밖은 셀마다 스텝) ·
컴팩트 팩 왕복(O·Y).

### 7.2 갱신 — `test/type-y-cell-editor-lab.test.js`
기존 단언은 전부 유지. 바꾼 것은 **한 줄**이고, 그 이유를 파일 헤더에 적었다:

- 옛 단언 `assert.match(INDEX, /isLabPath\(\) && generatorState\.type === 'Y'/)` 는 섹션이
  다중 타입이 되면서 **주어가 사라졌다**. 그런데 지우지 않고 두면 **통과는 하는데 아무것도
  안 지킨다** — 같은 문자열이 `syncYLocatorUi()`(진짜 Y 전용인 Y 로케이터 옵션)에도 있어서
  그쪽을 대신 문다. 실제로 그렇게 통과하는 것을 확인하고 갈랐다:
  - 편집기 게이트 → `const show = isLabPath() && CELL_EDITOR_TYPES.includes(generatorState.type);`
    + 타입 목록 리터럴까지 고정
  - 로케이터 게이트 → `function syncYLocatorUi()` 에 앵커해서 옛 단언을 **그대로 보존**
- 증강: 타입 카드 3종·K 부재·기하 재사용 경로·컴팩트 팩 · undo/redo 버튼·상한 상수 사용·
  스트로크 열고 닫는 지점·섹션 스코프 단축키(window 전역 청취 금지 단언)·안내 노출·
  번들 임베드(`cell-editor-history`/`cell-editor-core`/`finder-editor-pattern`).
- i18n 키 목록에 신규 13키 추가 → ko/en/ja 3언어 존재를 기존 루프가 강제.

### 7.3 실기 확인 (로컬 dev 서버 + 브라우저, 워크트리 루트)
테스트가 초록이어도 클릭 경로는 다르다. `/lab/` 을 열어 DOM 으로 확인:

| 확인 | 결과 |
|---|---|
| 개명·타입 카드·버튼 초기 비활성 | 「셀 편집기」 · Y/O/A · undo·redo disabled |
| Y 클릭 → 톤 변경 → Ctrl+Z / Ctrl+Shift+Z | mid→dark→mid→dark, 상태문구 g561/g562 |
| 설정 JSON 글상자 안 Ctrl+Z | **가로채지 않음** (셀 톤 그대로) |
| 타입 O 전환 | k=6 · 127셀 × 3면 = 381 노드 · 스키마 v2 · 범례/힌트 O/A 문구 |
| O 드래그 3면 → undo 1회 | 33 → 30 dark, 오버라이드 3 → 0 (**1스텝**), redo 로 복귀 |
| 타입 A 전환 | k=6 · 190셀 × 3면 = 570 노드 · 코너 패치 포함 viewBox |
| A 잠긴 중앙 파인더 클릭 | 톤 불변 + **undo 여전히 비활성** (빈 스텝 없음) |
| A 드래그 4면 → undo 1회 | 34 → 30 dark (**1스텝**) |
| Y↔A 왕복 | 각 타입 히스토리가 따로 보존 |
| O 마스크 모드 | 데이터 셀 토글 → detector 1 · **고정(format) 셀 토글은 차단** |
| 언어 ko/en/ja | 신규 13키 + aria 라벨 전부 전환 |
| 검출기 빗금(`#yCellHatch`) | Y·O 양쪽에서 defs 1개 · 칠한 셀 3면에 적용 (정의를 한 곳으로 합친 뒤 재확인) |
| 콘솔 | 오류 없음 (lab 텔레메트리 WS 실패만 — 로컬엔 릴레이가 없다) |

---

## 8. 독립 `/celleditor/` 에 딸려 온 수정 (무회귀 + 부수 수정)

공유 코어를 건드리므로 같이 배선했다.
- 드래그를 `beginEditStroke`/`endEditStroke` 로 감쌌다. **부수 효과로 기존 결함 하나가 닫혔다** —
  마스크·페인트통·우클릭은 `pointerdown` 과 `applyToolAt` 이 **각각** 스냅샷을 쌓아서 클릭 한 번에
  Ctrl+Z 를 두 번 눌러야 했다. 이제 스트로크 안에서 코얼레싱된다.
- 키보드 처리를 공유 분류기로 교체 — 이제 `contenteditable`·`select` 도 보호된다
  (기존엔 INPUT/TEXTAREA 만).
- `importEditorJson` 의 상태 교체에 `strokeOpen` 승계 추가.
- 이름 필드·붙여넣기·autoplace 힌트·PNG/SVG/JSON 내보내기는 **손대지 않았다**.

---

## 9. 번들 · 스위트

재빌드: `build-single` · `build-gen-variants` · `build-lab` · `build-cell-editor`
→ `dist/trilume.html` · `sites/_shared/gen-finder.html` · `sites/_shared/lab-gen.html` ·
`sites/_shared/cell-editor.html`.
`sites/_shared/lab-scan.html` 과 `gen-finder-editor.html` 은 **바이트 동일** (변경 없음) —
**SCANNER_BUILD 무접촉**.

모듈 순서 등록: `build-single.MODULE_ORDER` 끝에
`finder-editor-pattern` → `cell-editor-history` → `cell-editor-core`,
`build-cell-editor.CELL_EDITOR_MODULE_ORDER` 에 `cell-editor-history`
(양쪽 빌더의 위상 정렬 검사가 통과).

정본 스위트 `node --test "test/*.test.js" "test/harness/*.test.js" "relay/*.test.js"`:

| | tests | pass | fail | skip |
|---|---|---|---|---|
| 기준 (작업 전) | 1736 | 1730 | 0 | 6 |
| 작업 후 | 1755 | 1749 | 0 | 6 |

+19 = 신설 17 + lab 스위트 증강 2. skip 6 은 pristine 트리의 실사진 스위트(변화 없음).
로그: `test/output/_baseline-suite.txt` · `test/output/_final-suite.txt` (test/output 은 gitignore).

---

## 10. 남긴 것 · 후속

- **O/A 데이터 경계선(빨간 변)** 미구현 — Y 전용 `dataBoundaryEdges` 만 있다.
- **O-CM/A-CM 역할 표시** — §3.2. UI 에 코너 마커가 붙는 날 `cellEditorContext` 를 같이 바꾼다.
- **타입 K** — 태스크 #11 결론 이후.
- 편집 결과는 여전히 **현재 코드 출력에 적용되지 않는다**(설계 그대로, g522/g559 에 명시).

### 교훈 후보 (트리 밖이라 기록만 남긴다 — `.agent/_lessons/` 승격은 통합자 몫)

1. **«되돌리기 있음» 은 «되돌리기 동작함» 이 아니다.** 스텝 수를 세는 단언이 없으면
   셀마다 스택을 쌓는 구현도 초록으로 통과한다. 이번엔 순수 모듈로 빼서 스텝 수를 셌다.
2. **빈 스텝은 브라우저에서만 보인다.** 잠긴 셀 클릭이 스텝을 만들던 결함은 전 테스트가
   초록인 상태에서 실기 클릭으로 잡혔다. UI 기능은 클릭 경로를 한 번 타 봐야 한다.
3. **«주어가 바뀐 단언» 은 조용히 다른 것을 문다.** 옛 게이트 단언은 삭제 없이도 통과했는데,
   같은 문자열이 다른 함수에 있었기 때문이다. 정규식 단언은 **함수 이름에 앵커**해야 한다.
4. **위임 레인의 dev 서버는 워크트리 루트로 띄워야 한다.** `preview_start` 는 세션 cwd 의
   `.claude/launch.json` 을 읽어 **정본 repo** 를 서빙했고, 그 화면은 옛 UI 라 «내 변경이
   반영 안 된다» 로 보였다. 워크트리의 `tools/dev-server.mjs` 를 직접 띄워 해결.

---

## 11. 픽스 레인 (2026-08-16, 검증 두 렌즈 지적 반영)

두 적대 검증 렌즈(«편집 의미·정합» · «UX·i18n·회귀»)가 `concerns` 로 낸 F1–F8 과
부수 관찰을 처리한 기록이다. 스캐너 표면·인코딩·게이트는 건드리지 않았다.

### 11.1 결함별 처리

| # | 결함 | 처리 | 회귀 테스트 |
|---|---|---|---|
| F1 | Y 마스크 모드에서 `changed:false`(fixed·occupied) 인데 스텝이 쌓임 | 규칙을 히스토리 모듈로 올렸다 — `commitEdit(snapshot → apply → **바뀐 경우에만** 기록)` + `armStroke`(예약). Y·O/A·초기화 버튼·독립 편집기 도구 경로가 **전부** 같은 함수를 지난다 | history: 무동작 3종 · 잠긴 셀 5회 클릭 후 `canUndo false` · 상한 초과 후에도 실편집 복구 / lab: 배선 소스 단언 (`cellEditorNoteEdit`·`cellEditorRecord` 이름 금지) |
| F2 | 드래그 중복 방지 키가 `face:coord` 라 마스크 토글이 상쇄 | 편집 단위를 모듈이 정한다 — `editUnitKey(cell, mode)` (마스크=좌표, 톤=면), 스트로크 시작 시 모드를 굳혀 쓴다 | history: 두 면 히트 → 토글 1회 (O·Y) · 톤은 두 면 각각 · 단위키 대칭 / lab: `const mark = editUnitKey(cell, cellEditorStrokeMode)` |
| F3 | 번들 테스트의 편집기 게이트 단언이 `syncYLocatorUi()` 를 물어 아무것도 안 지킴 | 두 게이트를 **함수 이름에 앵커**해 갈랐다 (`syncTypeYCellEditorUi` / `syncYLocatorUi`), 첫 테스트도 같은 방식으로 고침 | lab 스위트 (게이트를 지우면 빨개진다) |
| F4 | `isTextEntryTarget` 이 SELECT 를 포함해 독립 편집기 `<select>` 에서 Ctrl+Z 사망 | SELECT 를 글상자 목록에서 뺐다 (`<select>` 에는 되돌릴 브라우저 기본 동작이 없다). 겸사겸사 되돌리기가 크기 드롭다운 표시까지 되돌리도록 `updateUI` 동기화 | history: SELECT 는 글상자 아님 + Ctrl+Z 가 undo 로 분류 / 실기: size 21→11 & 드롭다운 추종 |
| F5 | 스트로크가 열린 채 남으면 이후 편집이 삼켜짐 (self-heal 한쪽만) | ① `undoOnBucket`/`redoOnBucket` 이 열린 스트로크를 닫는다 ② 두 UI 모두 되돌리기 전에 붓질을 끝낸다 ③ 독립 편집기 `pointermove` 에 `buttons === 0` 자가 치유 ④ 드래그 도색도 `commitCellEdit` 를 지나 예약이 확정된다 | history: `beginStroke → undo → record === true` / core: 앱 배선 소스 단언 4종 / 실기: 드래그 중 Ctrl+Z |
| F6 | 정본 JSON(면 키 `toneOverrides`) 을 파서가 못 읽어 붙여넣기 시 톤 전부 소실 | `parseUniversalEditor` 가 두 방언을 모두 받는다 (`normalizeToneOverrideList`). **붙여넣기 경로가 쓰는 파서**라 사용자 손실은 닫혔다 | core: 면 키 방언 → 톤 4개 보존 · 두 방언 수렴 |
| F7 | `stringifyCompactJson` 이 `undefined` 를 만나면 무효 JSON | `JSON.stringify` 와 같은 규칙 (객체 키 제외 · 배열 원소 `null`) | core: 세 형태를 `JSON.parse` + `JSON.stringify` 대조 |
| F8 | §2 줄 수 오기 | 위 §2 정정 블록 | — |

부수 관찰: **모드 카드 `aria-pressed`** 를 두 편집기에 붙였고(타입 카드만 있던 것),
**«window 전역 keydown 금지» 단언**을 서식 결합에서 «리스너 자체 금지» 로 바꿨으며,
**독립 편집기 도구 단축키에 수식키 가드**를 넣었다 (Ctrl+B·Ctrl+E·Cmd+I 가 도구를
바꾸던 기존 결함). **g521 개명은 값까지** 테스트에 못 박았다 (키 존재만 보면 조용히
되돌아가도 초록이었다).

### 11.2 고치지 않고 남긴 것 (사유 있음)

- **`type-y-cell-editor.parseCellEditor` 의 면 키 방언** — 같은 F6 이지만 그 모듈은
  `lab-scan.html`(스캐너 번들)에 들어간다. 고치면 스캐너 산출물 바이트가 바뀌는데,
  스캐너 표면은 `SCANNER_BUILD` 스탬프와 함께 움직여야 하는 별도 게이트라 이 레인에서
  건드리지 않았다. **현재 UI 붙여넣기 경로는 `parseUniversalEditor` 만 쓴다**(생성기
  섹션의 JSON 칸은 readonly). 테스트가 «아직 배열 방언만 받는다» 를 명시적으로 고정해
  두었으니, 스탬프를 올리는 다음 작업에서 같이 처리하면 된다.
- **독립 편집기의 `Ctrl+Alt+Z` · `Ctrl+Shift+Y`** — 공용 분류기로 좁혀지며 사라진 옛
  바인딩이다(의도적). Alt 조합을 되살리면 «가로채지 않는다» 정책이 다시 갈라진다.
- **크로스 레인 병합** — `wt-genui` 도 `index.html` 을 크게 고친다. 이 레인이 만진 구간이
  늘어났으므로(편집 경로 함수들) retire 전 3-way 리허설이 더 필요해졌다.

### 11.3 실기 재확인 (워크트리 dev 서버 8797 + 브라우저 DOM)

`/lab/` (번들 `lab-gen.html`):
- Y 마스크 모드, 잠긴 format/reference 셀 6회 클릭 → **undo 비활성 유지 · JSON 불변**
- Y + 셀 표면 v1r2(점유 80좌표), 파인더 점유 셀 8회 클릭 → **undo 비활성 유지**
- 같은 상태에서 데이터 셀 1회 → undo 활성 · `userNonData` 1
- 마스크 드래그 T→L (한 셀 두 면) → **토글 1회** (옛 배선이면 0), 되돌리기 1회로 원복
- 톤 드래그 T→L → 두 면 각각 칠해짐, 되돌리기 1회로 전체 원복
- 드래그 도중 Ctrl+Z → 첫 셀이 되돌아가고 붓질 종료, 남은 이동은 무동작 (삼킴 없음)
- 타입 O: 중앙 파인더 5회 클릭 → 무변·스텝 0, 데이터 좌표 두 면 드래그 → 토글 1회,
  counts 127/82/45 (정본 용량표 그대로)
- 모드 카드 `aria-pressed` true/false 전환 확인 · 콘솔 오류 없음(로컬 릴레이 부재 WS 만)

`/celleditor/` (번들 `cell-editor.html`):
- 크기 `<select>` 변경 후 **select 에 포커스가 남은 채** Ctrl+Z → 11 로 복귀 + 드롭다운 추종
- 스포이드로 캔버스 5회 클릭 → **undo 비활성 유지** (빈 스텝 사라짐)
- 붓 1회 → 스텝 1 · 같은 톤으로 한 번 더 → 스텝 추가 없음 · 되돌리기 1회로 처녀 상태
- 지우개 활성 상태에서 Ctrl+B → 도구 그대로 (맨 `e` 는 정상 동작)

### 11.4 스위트·번들

| | tests | pass | fail | skip |
|---|---|---|---|---|
| 픽스 전 | 1755 | 1749 | 0 | 6 |
| 픽스 후 | **1773** | **1767** | **0** | **6** |

+18 = history +12 · core +3 · lab +3. 4개 빌더 재실행.
`sites/_shared/lab-scan.html` = `70bf18ab…` · `gen-finder-editor.html` = `e7bccc8a…`
**둘 다 HEAD 와 바이트 동일** → SCANNER_BUILD 무접촉 유지.

### 11.5 교훈 후보 (추가)

5. **«고쳤다» 는 두 경로 중 하나에서만 참일 수 있다.** 같은 결함 클래스를 O/A 에서 막고
   Y 에서 안 막았는데, 실기 표에 «A 잠긴 셀 클릭» 만 있어 스스로를 못 잡았다. 실기 표는
   **결함 클래스 × 경로** 로 쳐야 한다(타입 × 모드), 항목 나열이 아니라.
6. **중복 방지 키는 편집 단위와 같아야 한다.** 단위가 다르면 «막았다» 가 «상쇄했다» 가
   된다 — 그리고 세 면을 다 스치면 결과가 우연히 같아져(홀수 회) 재현이 숨는다.
   두 면으로 재현해야 보인다.
