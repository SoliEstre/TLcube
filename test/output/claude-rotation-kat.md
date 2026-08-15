# 회전 KAT 실측 — 타입 O 렌더→120° 회전→복호 전 구간 (rotation-kat lane)

- 작업 루트: `wt-kat` (TLcube 워크트리, `3616deb` detached)
- 브리프: oak 검토 §4-2 — σ 짝(T→R, R→L, L→T)의 렌더→디코드 전 구간 실측
- 상태: **완료** — 판정: σ 정(正)방향 확정, oak §1.2 합성 사상 margin 열이 정본

## 로그

- [시작] 산출물 파일 생성. oak 검토 §1·§5 정독 및 하네스 파악부터 시작.
- [파악] 렌더 경로 `encode → buildScene → rasterize` (decode-render-roundtrip.test.js 와 동일 결선), 전 구간 복호는 `src/decoder/frontend.js` `decodeFrontend`. 회전은 `test/harness/distort.mjs` `rotateImage(image, degrees)` — **화면 기준 시계(CW) 방향**, 회전 중심 = 이미지 중심 `((W−1)/2,(H−1)/2)`. `layoutForRegion` 이 셀 (0,0) 중심을 캔버스 정중앙에 두므로 회전 중심 정렬 오차는 `Math.round(scene.width·ppu)` 반올림분 ≤ 0.5px — 면 표본 디스크(수 px 반경) 대비 무시 가능.
- [프로브] `test/output/probe-rotation.mjs` (1회용, 트리 내부) 실행 — 아래 §1·§2 결과.

---

## 1. 자 검증 — 무회전 복호 (브리프 작업 1)

- 페이로드 `"rotation-kat"` · Type O V1(k=6) · ECC M · ppu 12 · supersample 2 · 기본 margin · 불투명 배경.
- `decodeFrontend(raster)` → **ok=true, text="rotation-kat", hypothesis.orientation=0**. 자는 선다.

## 2. σ 실측 — 120° CW 회전본 (브리프 작업 2·3)

- `rotateImage(raster, 120, { fill: {…배경, a:255} })` — fill 에 `a:255` 명시 (누락 시 throw 하는 하네스 계약 확인).
- 전 구간 복호: `decodeFrontend(회전본)` → **ok=true, text="rotation-kat", hypothesis.orientation=1** (= 120° 가설 채택).
- 면 재배열 실측 — digit 0\~5 각 1셀(= 순위 순열 6종 전부), 세 면 전부. 원본 (q,r) 를 scene 기하로 측정, 회전본은 (q',r') = `rotate120(q,r)` = (−q−r, q) 위치를 같은 기하로 측정. ranks 는 median 오름차순 순위 (0=최저).

| 원본 (q,r) | digit | 원본 ranks T/L/R | 회전본 (q',r') | 회전본 ranks T/L/R | 면 대응 f→f' |
|---|---|---|---|---|---|
| (3,1) | 0 | 2/1/0 | (−4,3) | 1/0/2 | T→R, L→T, R→L |
| (0,4) | 1 | 2/0/1 | (−4,0) | 0/1/2 | T→R, L→T, R→L |
| (−1,4) | 2 | 1/2/0 | (−3,−1) | 2/0/1 | T→R, L→T, R→L |
| (0,−4) | 3 | 0/2/1 | (4,0) | 2/1/0 | T→R, L→T, R→L |
| (−3,2) | 4 | 1/0/2 | (1,−3) | 0/2/1 | T→R, L→T, R→L |
| (−3,4) | 5 | 0/1/2 | (−1,−3) | 1/2/0 | T→R, L→T, R→L |

- 6셀 × 3면 = 18 면 대응 전부 동일한 순열. 원시 median 대응(순위가 아닌 값 기준 최근접)도 동일 결론 — 최근접 대 차선 격차 ≈ 0.2 (상대 휘도 0..1 스케일, 톤 3계층 간격급).

## 3. 판정 (브리프 작업 4)

**σ = T→R, R→L, L→T — 정(正)방향.** oak 검토 §1.1 의 기하 코드 검증과 일치하고, 이번엔 렌더→래스터 회전→복호 전 구간 실측으로 확인됐다.

따라서 **oak §1.2 표의 합성 사상 margin 열이 그대로 정본이다** (Benzene 0.3860 · Aspirin 0.3333 · Xylene 0.1754 · Nitrogen 0.0351). §5 의 대체 수치 열(Nitrogen 0.5614 · Benzene 0.4561 · Aspirin 0.4035 · Xylene 0.2807)은 **기각** — 발동 조건(σ 반전)이 실측으로 부정됐다. margin 재계산은 브리프 배제 목록에 따라 하지 않았다.

보강 실측 (동일 프로브, 240° CW): 좌표 `rotate240(q,r)=(r,−q−r)` · 면 순환 σ² = **T→L, L→R, R→T** · `decodeFrontend` ok, orientation=2 — σ 의 제곱과 정확히 일치. 두 비항등 회전 모두 합성 사상이 실측으로 닫혔다.

## 4. KAT 테스트 (브리프 작업 5)

- 신규 파일: `test/rotation-kat.test.js` (기존 테스트 파일 수정 없음, src/ 수정 없음).
- 고정 내용: ① 무회전 자 검증(복호 성공 + orientation=0 + 표본 6셀 digit 기지답 대조), ② 120° CW — 전 구간 복호(orientation=1) + 표본 6셀 × 3면에서 σ=T→R,R→L,L→T 재측정, ③ 240° CW — 전 구간 복호(orientation=2) + σ²=T→L,L→R,R→T. 셀 내 면 median 분리폭 ≥ 0.05 가드로 순위 측정 무의미화를 차단.
- 결정성: 고정 페이로드 `"rotation-kat"` · V1/M · ppu 12 · supersample 2 · RNG 없음.
- `node --test test/rotation-kat.test.js` → **3 pass / 0 fail** (1.3s).

## 5. 전체 스위트 (브리프 작업 6)

- 실행: `node --test test/*.test.js` → `test/output/claude-rotation-kat-suite.log` (110.4s)
- 숫자 그대로: **tests 1411 · suites 221 · pass 1401 · fail 4 · skipped 6 · cancelled 0** (KAT 3건 포함).
- **기준선(1403/1404, 실패 1 = Type Y 실사진)과 다르다. 원인은 워크트리 상태이지 이번 변경이 아니다:**
  - 기준선의 실패 1건 `Type Y 3톤 실사진 성공분은 960/1440 모두 Y1T로 복호` 는 여기선 **skip** 으로 나온다 — skip 사유가 로그에 명시돼 있다: «Type Y 3톤 성공 사진 휘도 덤프 없음». 휘도 덤프는 비추적 로컬 파일이라 fresh 워크트리에 없다.
  - 실패 4건은 전부 «생성 산출물 ↔ 커밋된 dist 바이트 동일» 계열이다: ① `bundle-scanner.test.js` `buildScannerHtml() ↔ dist/tlscan.html`, ② `buildSingleHtml() ↔ dist/trilume.html`, ③ `에디터는 캔버스에서만 우클릭 메뉴를 막고 현재 소스에서 다시 생성된다`, ④ `정식/시험판 산출물이 같은 소스 빌더의 현재 결과와 바이트 동일하다`. 단언 메시지 자체가 «dist/tlscan.html이 최신이 아니에요 … node tools/build-scanner.mjs를 다시 실행하세요» — 즉 **커밋 3616deb 시점의 dist 가 같은 커밋의 src 빌더 출력과 어긋나 있다.** 본 체크아웃(`C:/Dev/TrilLuminanceCube/TLcube`, 같은 3616deb)은 `git status` 에 `M dist/tlscan.html` 등 **미커밋 로컬 수정**이 있어 기준선에선 이 4건이 통과했던 것.
  - 격리 검증: `node --test test/bundle-scanner.test.js` 단독 실행에서도 같은 실패(4 pass / 1 fail) — 내 KAT 파일 유무와 무관하다. dist 재빌드는 기존(추적) 파일 수정이라 브리프 금지 사항이므로 하지 않았다.
- KAT 3건은 이 안에서 **전부 pass**.

## 6. 트리 상태·못 한 것

- `git status --short` = `?? test/rotation-kat.test.js` 뿐 — 기존 파일 수정 0, src/ 수정 0, 커밋·push 없음 (`test/output/` 은 gitignore 대상이라 산출물 md·프로브·로그는 상태에 안 잡힌다).
- 프로브 스크립트 `test/output/probe-rotation.mjs` 는 1회용 실측 재현 스크립트로 트리 내부(비추적 영역)에 남겨 뒀다.
- margin 재계산·A/K/Y 재검증·`rotate120` 재유도는 브리프 배제 목록대로 하지 않았다.
