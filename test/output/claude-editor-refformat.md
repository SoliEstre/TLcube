# claude-editor-refformat — 완료 보고

- 레인: Claude (Fable 5) 위임 레인 · 2026-08-16
- 브리프: brief-editor-refformat.md (작업 1 카드 순서 / 작업 2 ref./format 파인더 종속 유도)
- 워크트리: wt-editor (acaeb0c detached) — 트리 안에서만 수정, 커밋 없음

## 1. 카드 순서 변경 + 테스트

- `index.html` §yLocatorSection 카드를 **끔 → v0 → v1r2 → v2r2** 로 재배열 (운영자 지시 주석 포함).
- `GENERATOR_STATE_SCHEMA.locatorProfileY` options 배열은 **건드리지 않음** — 기존
  `locatorY-lab.test.js` 의 hex-frame-v1 차단·비삭제 단언 그대로 초록.
- 카드 순서를 단언하는 테스트는 **기존에 없어서 신설**: `test/y-cell-editor-refformat.test.js`
  「Y 검출기 옵션 카드 순서는 끔 → v0 → v1r2 → v2r2 다」 — 소스와 번들(lab·정식) 양쪽에서
  data-locator 나열 순서를 배열 비교로 단언.
- 라이브 확인: /lab/ 실페이지에서 cardOrder `["off","cell-surface-v0","cell-surface-v1r2","cell-surface-v2r2"]`.

## 2. ref./format 유도 배선 (표면별) + 정합 단언

### 표면 A — 생성기 내장 Y 셀 편집기 (§yCellEditorSection, index.html)

수정 전: `placementY.buildRoleSets(n)`(레거시 고정 배치)로 표시 — 선택 검출기 옵션과 무관,
n 도 locator 강제를 안 따름 (브리프가 지적한 바로 그 버그).

수정 후 (`yCellEditorContext()` 신설):
- **n·레이아웃 강제 = 인코더와 같은 `encodeOptionsForY` 배선 재사용** (표시용 별도 규칙 금지):
  v0→Y0(n13) · v1r2→Y1(n21) · v2r2→Y1 기본/Y2 명시 시 n25 · 윈도→Y2(n25).
- 셀 표면 옵션 선택 시 `cellSurfaceFinal(n, layout)` **정본에서 런타임 유도** —
  `paintedCells`(점유) · `formatCells`/`referenceCells`(정본 내부에서
  `autoplaceY.placeReservedCells(n, painted)` 로 유도·캐시된 값) · `locatorCells`(점유 셀 정본
  톤 표시). **손 좌표표 사본 0** — v2r2 중앙 디자인이 개정되면 자동 추종.
- 「끔」·hex-frame-v1(셀 비점유) = `placeReservedCells(n, [])` 빈 점유 유도 (n별 메모이즈).
- `type-y-cell-editor.js` roleSets 계약 확장: `{reference, format, occupied?}` —
  occupied 는 detector 로 분류·데이터 합집합과 경계에서 제외·마스크 토글 차단(reason
  'occupied')·회계 분리(counts `{data, userNonData, occupied}`). occupied 생략 시 기존 동작
  바이트 동일 (기존 테스트 전부 초록).
- 즉시 재계산(규칙 ③): locator 카드 클릭 → syncTypeUi 경유, 버전 select change 에
  `syncTypeYCellEditorUi()` 직접 추가 (렌더 대기 없이 재유도).
- 배치 불가(규칙 ④): 유도 throw 시 SVG·JSON 비우고 `yCellEditorStatus` 에 **g549 명시 안내**
  (ko/en/ja 신설, {message} 포함) — 조용한 빈 표시 없음.

라이브 클릭 경로 실측 (dev-server /lab/, 실제 카드 클릭):

| 옵션 | n | detector(점유) | counts.data | fixed 좌표 27개 == cellSurfaceFinal 유도 |
|---|---|---|---|---|
| v0 | 13 | 30 | 112 | **일치** |
| v1r2 | 21 | 80 | 334 | **일치** |
| v2r2 + Y2 명시 | 25 | 65 | 533 | **일치** (select 변경 즉시 반영) |
| 끔 | 25 | 0 | 598 (=25²−27) | 27셀 (레거시 동일) |

### 표면 B — 독립 `/celleditor/` (cell-editor-core.js · cell-editor-app.js)

**코드 수정 불요 (이미 계약 준수)**: 검출기 옵션 선택 UI 자체가 없고(파인더 = 편집 대상 그
자체), R/F 마커는 `previewAutoplaceY`(사용자 painted 셀 → `placeReservedCells`)로 이미 런타임
유도하며, 실패 시 `autoplaceFail` 안내 문구가 이미 있다. 라이브 스모크: 상태줄
「ref/format 자동 배치 · 점유 0 · D_ref 36 · S_fmt 65」 확인.

### 정합 단언 (신설 테스트, 표시 계산이 미래에 갈라지는 것 차단)

`test/y-cell-editor-refformat.test.js` 8개:
1. 카드 순서 (소스 + lab·정식 번들).
2. index.html 배선 — `yCellEditorContext`/`encodeOptionsForY`/`cellSurfaceFinal(n, encOpts.cellSurfaceLayout)`/`surface.paintedCells`/`placeReservedCells(n, [])` 존재 + **`buildRoleSets(` 및 placementY import 부재**(레거시 직접 참조 금지) + `ctx.error`→`tf('g549'` 경로.
3. g549 ko/en/ja 3언어 + {message} 자리표시자.
4. **정합**: 최종 라인업 전 조합(v0@13·v2r2@21·v2r2@25·v1r2@21 — 레지스트리에서 유도)에서
   `cellSurfaceFinal` 의 format/reference == `placeReservedCells(n, painted)` 직접 유도 (deepEqual).
5. **끔=레거시 불변식**: `placeReservedCells(n, [])` == `placementY.buildRoleSets(n)` (n=13/21/25)
   — 기존 `autoplaceY.test.js` 의 바이트 동일 단언(n=11 포함)에 편집기 계약 측 재단언 추가.
6. occupied roleSets 의미론 — detector 분류·경계 제외·마스크 차단·회계
   (counts.data == `declaredDataCells` == 인코더 회계).
7. 독립 편집기 정합 — 정본 painted 입력의 `previewAutoplaceY` == `cellSurfaceFinal` (전 조합).
8. 번들 임베드 — 카드 순서·`yCellEditorContext`·g549 가 lab/정식에, `previewAutoplaceY` 가
   cell-editor 번들에 존재.

## 3. 끔=레거시 불변식 단언

위 5번 (+ 기존 `autoplaceY.test.js` 「빈 점유는 n=11·13·21·25 에서 placementY 레거시와 바이트
동일하다」 유지). 라이브에서도 끔 상태 fixed 27셀 · data 598(=25²−27) 실측 일치.

## 4. 스위트 숫자 + 재빌드 목록

- **pristine(acaeb0c, 수정 전 실측)**: tests 1491 · pass 1485 · fail 0 · skip 6.
- **수정 후**: tests **1499** · pass **1493** · **fail 0** · skip 6 (+8 = 신설 테스트 전부).
- skip 6 은 전부 실사진 휘도 덤프 가드이고, 그중 하나가 브리프의 기존 실패분
  `Type Y 3톤 실사진 …` — **브리프 예상대로 pristine 워크트리에서 skip 으로 나타남**.
  그 외 실패 0 → 합격 조건 충족.
- 브리프의 기준 「1434 중 1433」 은 이 워크트리 HEAD 실측(1491)과 다르다 — 기준 수치가 더
  이전 스냅샷으로 보이나 **추측이므로 결론으로 적지 않음**. 판정은 위 실측으로 했다.
- 결정성: 신설 테스트 단독 2회 + 전체 스위트 재실행에서 동일 결과.
- 재빌드 (`tools/embed-source.mjs` readSourceLf 경로의 표준 빌더로):
  - `node tools/build-gen-variants.mjs` → dist/trilume.html · sites/_shared/gen-finder.html ·
    gen-finder-editor.html(바이트 동일, 변경 없음) · lab-gen.html
  - `node tools/build-cell-editor.mjs` → sites/_shared/cell-editor.html
  - `node tools/build-scanner.mjs` → dist/tlscan.html (스캐너 그래프가 type-y-cell-editor.js 를
    임베드하고 있어 동기화 테스트가 요구 — pristine 대조로 확인 후 재빌드)
  - `node tools/build-scan-variants.mjs` → sites/_shared/scan-new.html · lab-scan.html
    (scan-old.html 변경 없음)
- 변경 파일: `index.html` · `src/type-y-cell-editor.js` · 신설 `test/y-cell-editor-refformat.test.js`
  - 재빌드 산출물 8종 (위). 디코더·레이아웃 정의(placementY/autoplaceY/cellSurfaceFinal 등)
  수정 없음, 기존 테스트 약화 없음.

## 5. 못 한 것

- 없음 (브리프 범위 내 전부 수행). 참고 사항 2건:
  - 브리프 기준 스위트 수치(1434)와 이 워크트리 실측(1491)의 차이는 위에 기록 — 원인 확정은
    이 레인 범위 밖이라 하지 않음.
  - 점유 셀에 사용자가 톤을 덧칠하는 경우의 세부 의미론(덧칠 시 userNonData 에 함께 기록되는
    레거시 동작)은 기존 동작을 그대로 유지 — 계약상 표시·회계에는 영향 없음.
