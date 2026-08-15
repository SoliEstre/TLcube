# 스캔 가이드 12점 재설계 + 기본 확대 1× 복귀 — 작업 보고서

- 작업 워크트리: `scratchpad/wt-guide` (TLcube, f2dbb2b detached)
- 브리프: `brief-guide-12dot.md` (운영자 설계 지시 2026-08-15)
- 상태: **완료** — 스위트 1479 중 1473 통과 · 실패 0 · 스킵 6 (전부 실사진 luma 덤프 부재, 하단 §스위트 참조)

## 진행 로그

- [착수] 보고서 파일 생성. 워크트리 구조·정본 방향 코드 확인부터 시작.
- [조사 1] 방향 정본 확인 (추측 아님, 코드 근거):
  - `src/hexgrid.js` `CORNER_UNIT_OFFSETS`: C0=(0,−1) 상단, 이후 화면상 시계방향 (pointy-top). 꼭짓점 각도 = −90°+60°·i (화면 좌표, +y 아래).
  - `src/decoder/cube-detect.js` `simplifyHullToHex()` (761-775행): 실루엣 꼭짓점 0 을 «상단(C0, y 최소)» 으로 정렬 — 디코더 정본과 렌더러 방향 일치 확인.
  - `src/ygrid.js` 헤더: «큐브 실루엣 = pointy-top 정육각형. CORNER_UNIT_OFFSETS 재사용» — Y 실루엣 꼭짓점 = C0\~C5 방향, 반지름 n·size.
  - `src/placementA.js` 헤더: Type A = 정삼각형 «△, 위 꼭짓점». 패치 방향 top/BL/BR → 꼭짓점 방향 = C0·C2·C4 (상·우하·좌하). 꼭짓점 셀 (k,−2k) 중심 = (0,−3ks) 로 정확히 수직 상단임을 좌표로 검산.
  - `src/cell-editor-core.js` `isInRegionK`/`patchOfK`: K = A ∪ 반전A → 별꼭짓점 6개 = top/TR/BR/bottom/BL/TL = C0\~C5 전부. TR 패치 극단 셀 (2k,−k) 중심 = (3√3/2, −1.5)·ks → 방향 (√3/2,−0.5) = C1 검산.
  - 결론: **12점 가이드의 두 육각형 다 pointy-top(꼭짓점 0 = 상단), 각도 −90°+60°·i** — Y 육각·K 육망성 꼭짓점 6방향과 일치하고, A 정삼각은 그중 C0·C2·C4 에 걸린다. Type O 외곽(셀 복합 실루엣)은 flat-top 방향이라 바깥 점과 안 만나는데, 브리프도 바깥 점 목표를 Y/A/K 로만 명시했다. O 는 안쪽 6점(중앙 파인더)이 목표.
- [조사 2] 분석 프레임 경로 확인: `src/scanner-zoom.js` `cropWindow()` — 분석 = 원본의 **중앙 정사각**(짧은 변/cropZoom), target ≤ 960. `sites/tlscan/scanner.js` `grabVideoFrame()` 이 매 프레임 호출. 프리뷰는 `#camera-preview` object-fit: cover + (크롭 폴백 시) `syncPreviewTransform()` 의 CSS scale(cropApplied).
- [조사 3] 크기 산정 근거 확정:
  - 중앙 파인더: `src/finder-patterns.js` `central-cube-3tone` — `radiusCells: 3.5` (렌더 큐브 반경), `slotRadiusCells: 4` (슬롯). `src/scene.js` 가 `radiusCells·cellSize` 로 그린다.
  - 대표 버전: O V3 k=10 (기존 가이드 상수 `GUIDE_CELLS_V3=21` 과 동일 선택). O 복합 실루엣 단순화 육각 꼭짓점 반경 = `√3(k+2/3)s` (k=2 전수 좌표로 검산: 8√3/3 일치).
  - 버전표: O V1/V2/V3 = k 6/8/10 (`capacity.js`), A0/A1/A2 = k 6/8/10 (`capacityA.js`).
  - 잘림 판정 재사용: `src/lab-telemetry.js` `extractGeometry()` → `clipSide ∈ {none,left,…,multi}` — 순수 함수라 안정판에서 로컬 호출해도 텔레메트리 0바이트 불변식 유지.
- [조사 4] 번들 3종 식별: ① `dist/tlscan.html` (`tools/build-scanner.mjs`, `bundle-scanner.test.js` 가 바이트 동기 강제) ② `sites/_shared/lab-scan.html` (`tools/build-lab.mjs`) ③ `sites/_shared/scan-new.html` (`tools/build-scan-variants.mjs` 의 new 변형 + 버전 선택 바). `scan-old.html` 은 고정 커밋 09596a3 빌드라 재빌드 대상 아님 (전체 variants 빌더는 git worktree 를 트리 밖 tmp 에 만들므로 이번 레인 제약상 돌리지 않고, new 만 선택 재빌드).

## 설계 (구현 전 확정)

### 1) 12점 기하

- 좌표계: 화면 좌표(+x 우, +y 아래), 원점 = 분석 정사각 중심(= 프리뷰 중심). 두 동심 **pointy-top 육각형** 꼭짓점 = `hexgrid.js` `CORNER_UNIT_OFFSETS[i]` (각도 −90°+60°·i, C0=상단). 디코더 정본(cube-detect `simplifyHullToHex`)·렌더러(ygrid/hexgrid) 방향과 동일.
- 반지름: 분석 정사각 화면 투영 한 변 S 에 대해 R = fraction·S/2.
  - `GUIDE_OUTER_FRACTION = 0.54` (아래 3) 산정)
  - `GUIDE_INNER_FRACTION = 0.54 · 3.5/(√3·(10+2/3)) ≈ 0.1023` — «바깥 점까지 채운 O V3 코드의 중앙 파인더 큐브» 비율.
- 목표 의미: 바깥 6점 = Y 육각 꼭짓점·K 육망성 6첨두(전부 C0\~C5 방향), A 정삼각 꼭짓점(C0·C2·C4 3점에 걸림). 안쪽 6점 = O·A·K 중앙 파인더 큐브(pointy-top) 꼭짓점 목표.
- 한계(가이드 성격): A2(k=10)는 «중앙 큐브↔안쪽 점» 과 «꼭짓점↔바깥 점» 을 동시에 만족 못 한다 (비율 31/3.5=8.86 vs 가이드 5.28). A0(k=6)는 5.43 으로 거의 일치. 게이트가 아니라 목표 표식이므로 허용 — 보고서 하단 «못 한 것» 참조.

### 2) 1× 프리뷰 ↔ 분석 정합 (증명 스케치 — 코드 근거)

1. 분석 영역(비디오 픽셀): `cropWindow(w,h,crop)` → 중앙 정사각, 변 `min(w,h)/crop` (`sourceX=(w−side)/2` 중심 대칭).
2. 프리뷰: `#camera-preview` 는 `.camera-backdrop`(inset:0, 뷰포트 전체)을 100%×100% 채우고 `object-fit: cover`(기본 object-position 50%) → 표시 배율 `cover = max(eW/vW, eH/vH)`, 중심 정렬.
3. 크롭 폴백 시 `syncPreviewTransform()` 이 CSS `scale(cropApplied)`(원점 center) 추가 → 총 배율 `cover·crop`, 여전히 중심 정렬.
4. 따라서 분석 정사각의 화면 투영 = 중심 동일 정사각, 변 `S = (min(vW,vH)/crop)·cover·crop = min(vW,vH)·cover` — **crop 이 정확히 상쇄**되고, 1×(crop=1)에서도 같은 식. 트랙 zoom 경로는 소스 자체가 확대되므로(crop=1) 역시 같은 식.
5. 960 축소는 영역이 아니라 해상도만 바꿈 — 점유율 불변.
   → 가이드는 `S = min(vW,vH)·max(eW/vW, eH/vH)` 로 매 갱신 계산해 **뷰포트 중심**에 그린다. cover 가 잘라낸 방향(letterbox 아닌 pillarbox 초과)도 이 식이 그대로 담는다 — 극단 화면비(예: 390×844 뷰포트 × 가로 센서)에서는 분석 정사각이 화면 밖까지 이어져 좌우 2점이 화면 밖에 갈 수 있는데, 그것이 사실이므로 clamp 하지 않는다.

### 3) 바깥 점 크기 산정 (보고 항목 3)

- 점유율 정의(실측과 동일): 검출 bbox 넓이 / 분석 프레임 넓이. 분석 프레임 변 = S(화면) ⇔ 960(분석 px) — 비율이라 어느 단위로 계산해도 같다.
- 코드가 바깥 점(반지름 R = f·S/2)에 채워졌을 때:
  - Y 육각·K 육망성(첨두 R, pointy-top): bbox = √3R × 2R → 점유율 = (√3/2)·f² ≈ 0.866·f²
  - A 정삼각(꼭짓점 R): bbox = √3R × 1.5R → 점유율 = (3√3/8)·f² ≈ 0.6495·f²
- 성공 지대 [0.15, 0.3] 요구 → f 허용 구간: Y/K [0.416, 0.589], A [0.481, 0.680]. 교집합 [0.481, 0.589].
- **f = 0.54 채택**: Y/K 점유율 0.253, A 점유율 0.189 — 둘 다 지대 안쪽, 상한 0.3 에서 손떨림 여유 확보.
- cell_px 검산(분석 960px, 코드를 바깥 점까지 채운 경우): R = 259.2px.
  - Y1 n=21: m = 12.3px ✓ · Y2 n=25: 10.4px ✓ (지대 8.8-20)
  - O V3 k=10 (실루엣 R≈R 기준): s = 14.0px ✓
  - A0 k=6: 13.6px ✓ · A1 k=8: 10.4px ✓ · **A2 k=10: 8.36px** — 하한 9 아래. 단 연속 실패 5프레임마다 1440px 승격(`FRAME_ESCALATED_SIDE`)이 12.5px 로 받친다. f 를 0.58+ 로 올리면 Y/K 점유율이 0.29 로 상한에 붙어 트레이드오프 — 0.54 유지.
- 안쪽 점: f_in = 0.54·(3.5/18.4752) = 0.10231. O V3 를 안쪽 점에 맞추면 s = 14.0px, 실루엣 점유율 ≈ 0.25 — 자기일관 ✓.

### 4) 기본 1× 복귀 + 잘림 안내

- `DEFAULT_USER_ZOOM` 2 → 1 (주석에 «기본값 변경이 의뢰 목적» 명시). 줌 컨트롤 유지.
- 잘림 안내: `decodeFrame()` 이 `extractGeometry(result, w, h).clipSide` 를 실패 반환에 동봉(로컬 값 — 전송 없음) → 카메라 경로에서 `clipSide === 'multi'` 연속 3프레임(≈1초)이면 `status.clipped` 표시, 해소되면 `status.aim` 복귀. 잘림 중에는 «더 가까이» 힌트 억제(반대 방향 지시 충돌 방지).
- i18n: `guide.message`·`guide.dots`(구 guide.fill 대체)·`status.aim`·`status.clipped` ko/en/ja.

## 구현 내역 (파일별)

| 파일 | 변경 |
|---|---|
| `src/scanner-zoom.js` | `DEFAULT_USER_ZOOM` 2 → 1 (주석에 «기본값 변경이 의뢰 목적» + 실측 근거 명시). 12점 가이드 기하 신설: `GUIDE_OUTER_FRACTION=0.54` · `GUIDE_FINDER_RADIUS_CELLS=3.5` · `GUIDE_REFERENCE_K=10` · `GUIDE_SILHOUETTE_RADIUS_CELLS=√3(k+2/3)` · `GUIDE_INNER_FRACTION≈0.10231` · `guideDotPositions()` (CORNER_UNIT_OFFSETS 재사용 — 삼각함수 재계산 없음) · `guideOccupancyEstimates()` · `analysisSquareOnScreen()` (정합 증명 주석 포함). 구 `aimGuideFractions()` → 검산 전용 `aimGuideMinFractions()` 로 축소, `AIM_RECOMMEND*` 3상수 제거 (소비자였던 사각 가이드가 폐기됨). |
| `sites/tlscan/scanner.js` | `renderGuideDots()` — 분석 정사각의 화면 투영(S = min(vW,vH)·cover)을 계산해 SVG `<circle>` 12개를 뷰포트 중심 기준으로 갱신. 트리거: loadedmetadata · video resize(회전 시 vW/vH 스왑) · window resize · orientationchange · 카메라 시작/정지. 요소 크기는 `getBoundingClientRect()` (SVG clientWidth 의 브라우저별 이력 회피). 잘림 안내: `decodeFrame()` 실패 반환에 `extractGeometry().clipSide` 동봉 → `clipSide==='multi'` 연속 3프레임(≈1초)에 `status.clipped`, 해소 시 `status.aim` 복귀, 잘림 중 «더 가까이» 힌트 억제. `clippedFrames` 는 시도 단위 리셋. `SCANNER_BUILD` 2026-08-15.03 → .04. |
| `sites/tlscan/index.html` | 사각 프레임(`.scan-guide`+코너 4개+`.scan-aim-fill`) 제거 → `#scan-dot-layer`(SVG, inset:0, pointer-events:none, aria-hidden) + 점 스타일(`.dot-outer`/`.dot-inner`). `.scan-center` 를 하단 정렬로 바꿔 문구가 조준 지점을 덮지 않게. 가로모드의 `.scan-guide` 크기 규칙 제거. 문구를 12점 안내로 교체. |
| `sites/tlscan/strings.js` | `guide.message`·`status.aim` 문구 갱신, `guide.fill` → `guide.dots` 대체, `status.clipped` 신설 — **ko/en/ja 3언어 모두**. |
| `test/scanner-zoom.test.js` | 의도적 갱신 2건 + 신규 3건 (아래 §갱신한 테스트). |
| `dist/tlscan.html` · `sites/_shared/lab-scan.html` · `sites/_shared/scan-new.html` | 스캐너 번들 3종 재빌드 (scan-new 은 기존 버전 선택 바를 태그만 갱신해 보존). `scan-old.html` 은 고정 커밋(09596a3) 빌드라 건드리지 않음. |

## 갱신한 테스트 (몰래 약화 아님 — 전부 주석으로 명시)

1. `기본 확대는 한 상수이고 2 이며…` → `…1 이며…` — 2→1 복귀가 의뢰 목적임을 테스트 주석에 기록. 수동 확대 유지(상한 8×) 검증 추가.
2. `조준 가이드 수치는 셀당 9px · 21셀 기준으로 다시 계산한다` (구 사각 가이드 HTML 검증) → 3건으로 대체:
   - `12점 가이드 — 방향은 정본(꼭짓점 0 = 상단 C0)이고 크기는 파인더 비율에서 유도된다` — CORNER_UNIT_OFFSETS 일치, `GUIDE_FINDER_RADIUS_CELLS === getFinderPattern('central-cube-3tone').radiusCells` 동기화 가드, 구 마크업 부재.
   - `바깥 점 크기 — 채우면 점유율이 실측 성공 지대(0.15-0.3)에 들고 복호 하한을 지킨다` — 점유율 수식 + f ≥ 2·(n·9/960) 하한.
   - `1× 프리뷰(cover) ↔ 분석 정사각 정합 — 크롭 배율은 화면 투영에서 상쇄된다` — 수치 3케이스 + crop∈{1,2,3.5} 상쇄 검증.
3. 신규: `잘림 안내 — multi-clip 연속이면 «조금 뒤로» 를 띄우고 새 전송 경로는 만들지 않는다`.

## 스위트 (전체, `node --test`, 파일: `test/output/claude-guide-12dot-suite.txt`)

- **tests 1479 · suites 227 · pass 1473 · fail 0 · cancelled 0 · skipped 6 · todo 0**
- 스킵 6은 전부 «실사진 luma 덤프 부재» 가드 스킵이다 — 덤프는 통합 머신의 비추적 로컬 파일이라 이 워크트리에 없다. **브리프의 기준 실패 1건(`Type Y 3톤 실사진 성공분은 960/1440 모두 Y1T로 복호`)도 여기서는 실패가 아니라 스킵으로 나타난다** (덤프 없음 → t.skip 경로). 그 테스트는 건드리지 않았다.
- 기준 «1416 중 1415» 와 총수가 다른 이유: 기준 수치는 메인 트리 계측이고, 이 워크트리(f2dbb2b) 시점의 테스트 수 + 이번 의뢰의 테스트 순증(+3)이 반영된 값이다. 이 트리에서 실패는 0.
- 실행 주의: 첫 실행에서 `finder-score.test.js` 가 ENOENT 로 죽었는데, 원인은 코드가 아니라 **레인 샌드박스가 OS 임시폴더(`%TEMP%\tlcube-finder-score-test`) 쓰기를 차단**한 것. 하네스 자체 산출물 경로라 샌드박스 해제 후 재실행에서 통과(22초). 최종 수치는 해제 상태 실행이다.

## 부수 발견 — 번들 재현성 균열 (통합자 주의)

- 커밋된 번들(dist/trilume.html·tlscan.html, _shared 산출물)에는 정확히 3개 모듈이 **CRLF** 로 박혀 있다: `src/vendor/jcodd.js` · `src/capacityA.js` · `src/capacityY.js`. 그런데 `.gitattributes` 는 `* text=auto eol=lf` 라 **깨끗한 체크아웃은 LF** 다 → 새 체크아웃에서 빌드하면 커밋본과 바이트가 갈리고, 동기화 테스트 3건(trilume·cell-editor·gen-variants)이 깨진다. 즉 커밋된 번들은 통합 머신의 로컬 CRLF 사본 상태를 품고 있어 **체크아웃만으로는 재현되지 않는다.**
- 이 레인의 처리: 스캐너 번들 3종만이 스코프라, 위 3파일의 워킹카피를 CRLF 로 되돌려(내용 diff 0 — git 이 커밋 시 정규화) 통합 머신과 동일한 입력으로 빌드했다. 생성기·에디터 번들은 손대지 않았고 동기화 테스트도 통과한다.
- 권고(별도 패스): 3파일을 LF 로 재정규화하고 **모든 번들을 한 번에 재빌드**하는 정리 커밋. 그 전까지는, 다른 머신에서 dist 동기 테스트가 어긋나면 이 3파일의 로컬 줄바꿈부터 볼 것.

## 브라우저 확인 (dev-server 8791, 워크트리 서빙)

- 모듈 로드·실행 정상 (build-tag `2026-08-15.04` 표시, i18n 적용, 구 가이드 DOM 부재, 슬라이더 기본 1×).
- 페이지 컨텍스트에서 `scanner-zoom.js` 직접 호출 검증: S(1080×1920 → 390×844) = 474.75 · 바깥 상단점 (195, 293.8) · NE 점 (306, 357.9) = C1 방향 · 점유율 {0.2525, 0.1894}.
- 카메라는 이 환경에서 열 수 없어 점 레이어 활성 상태(실스트림)는 실기기 확인 필요 (§못 한 것).

## 못 한 것 · 한계 (명시)

1. **실기기 확인 없음** — 카메라가 없는 환경이라 점 12개가 실스트림 위에 그려지는 화면, 회전/URL바 접힘 시 재정렬, 잘림 안내 발화는 실기기에서 확인해야 한다. (기하·배선은 단위 테스트 + 페이지 컨텍스트 수치로 검증)
2. **A2(k=10) 바깥 점 채움 시 셀 8.36px** — 기본 960 프레임에서 하한 9px 아래. 5연속 실패마다의 1440 승격이 12.5px 로 받치고, 점유율 기준(0.15-0.3)은 만족. f 를 올리면 Y/K 점유율이 상한(0.3)에 붙는 트레이드오프라 0.54 를 택했다.
3. **안쪽·바깥 점의 동시 정합은 대표 버전(O V3) 기준** — A2 는 두 목표를 동시에 만족 못 하고(비율 8.86 vs 5.28), V1·A0 등은 근사. 운영자 지시대로 «가이드지 게이트가 아니다».
4. **극단 화면비**(예: 세로 뷰포트 × 가로 센서 cover) 에서는 분석 정사각이 뷰포트 밖까지 이어져 좌우 2점이 화면 밖에 갈 수 있다 — 사실을 그대로 그린 것이라 clamp 하지 않았다.
5. **`Type Y 3톤 실사진` 기준 실패 1건은 이 트리에서 재현 불가(스킵)** — 덤프 파일이 통합 머신에만 있다. 숫자 대조는 통합 머신 재실행이 정본이다.
6. 잘림 안내 임계(연속 3프레임)는 실측 320ms 간격 기준 추정 — 실기기에서 과민/둔감하면 `CLIP_HINT_AFTER_FRAMES` 한 상수만 조정.

---

## Retire 부기 (통합자, 2026-08-16)

- 적대 검증 2렌즈 판정 concerns 2건을 retire 시 반영: ① `scanner-zoom.js` A2 승격 주석을
  기기 조건부 수치(1080p → 9.41px, 여유 4.5%)로 정정 ② crop-failed 폴백에
  `syncPreviewTransform()` 재동기화 추가 (가이드=분석 불변식의 병적 경로 구멍).
- 스위트 총수 차이 규명(검증 렌즈): 본 보고서의 1479 는 relay/·harness 포함 상위집합 실행,
  정본 글롭 재실행은 1422/1416/fail 0. 실질 주장(실패 0·스킵=덤프 가드)은 양쪽 일치.
- 본 레인의 CRLF 워킹카피 회피책은 `281de30`(빌더 LF 정규화 + 가드)로 대체됨 — 메인 트리
  재빌드는 정규화 경로를 탄다.
