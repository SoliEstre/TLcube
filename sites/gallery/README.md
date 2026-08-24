# 레퍼런스 갤러리 (로컬 전용) — 1차

파인더·타입·버전 **조합의 레퍼런스 코드 이미지**를 한 화면에서 넘겨 보고, 같은 자리에
실기기 캡처를 붙이는 로컬 페이지다. 스캔 테스트(PM/022 ⑤)의 **표본 공급 파이프라인**
1단계 — 2차에서 시험판 스캐너 WS 자동 수집이 이 자리에 붙는다.

> ⚠ **배포 대상이 아니다.** `sites/tl`·`sites/tlscan` 빌드 표에 없고, 읽는 데이터는
> 전부 gitignore 구역(`test/output/gallery/`)이다. 외부 자원 요청 0 (F-77 허용목록
> 충돌 회피 — 전부-로컬 스택).

## 1. 굽기

```
node tools/gallery-render.mjs            # 조합 순회 → test/output/gallery/refs/*.png + manifest
node tools/gallery-render.mjs --ecc M    # ECC 를 못 박고 굽기 (기본은 H→M→L 사다리)
node tools/gallery-render.mjs --only O-V1   # id 부분일치 필터
node tools/gallery-render.mjs --ppu 24      # 픽셀/단위 (기본 O·A 18 · Y 15)
```

조합 축은 **손 목록이 아니라 유도**다 (`tools/gallery-axes.mjs`) — 명부에서 드랍된
후보(Benzene · Aspirin)는 여기서 자동으로 빠진다. 축 정의와 «왜 이 조합인가» 는 그
모듈 헤더에 있고, `test/gallery-manifest.test.js` 가 live 명부·활성 레이아웃과의 1:1 을
매 회귀에서 다시 잰다.

## 2. 보기

```
node tools/dev-server.mjs        # → http://localhost:8765/sites/gallery/index.html
```

⚠ **`index.html` 까지 적어야 한다** — dev-server 의 디렉터리 index 는 루트와 몇몇
고정 경로에만 있고 (`tools/dev-server.mjs` §라우팅), `/sites/gallery/` 는 404 다
(실측 2026-08-24).

`file://` 로 직접 열어도 된다 — fetch 가 막히면 `manifest.js`·`captures.js`(classic
script)로 폴백하고, 그것도 막히면 머리의 파일 선택기로 `manifest.json` 을 직접 물린다.
데이터 위치를 옮겼으면 `?base=...` 로 준다.

### 키보드

| 키 | 뜻 |
|---|---|
| `←` `→` | 파인더/레이아웃 축 이동 (**같은 타입 안에서만**) |
| `↑` `↓` | 타입 축 이동 (O ↔ A ↔ Y — 축 위치 유지) |
| `g` | 그리드 ↔ 단일 뷰 |
| `Enter` / `Esc` | 단일 뷰 진입 / 그리드 복귀 |
| `j` `k` | 그 조합의 캡처 넘기기 |
| `r` | 매니페스트·캡처 색인 다시 읽기 |

화면 머리에 **축 라벨이 항상 떠 있다** (PM/022 항목 12 «화면 제시 축 라벨 명시»).

## 3. 수동 캡처 투입 규약

1. 갤러리에서 조합을 골라 **레퍼런스 이미지를 화면에 띄우거나 인쇄**한다.
2. 실기기(시험판 스캐너·카메라)로 찍는다.
3. 사진을 `test/output/gallery/captures/<조합id>/` 에 넣는다 — 폴더 이름이 곧
   **조합 id** 다 (`manifest.json` 의 `combos[].id`, 예:
   `O-V1-oak-taegeuk-solo`). 확장자는 `.jpg` `.jpeg` `.png` `.webp`.
4. `node tools/gallery-captures.mjs` — 색인(`captures.json` + `captures.js`)을 새로 쓴다.
5. 갤러리에서 `r`.

### 왜 폴더 이름인가 · 되읽기의 정본

사진 파일에는 조합 정보가 없다. 그래서 **① 폴더 이름**(사람이 넣을 때)과
**② 페이로드**(코드 자체에 실린 조합 id)가 이중으로 표본을 식별한다 — ②는
`manifest.json` 의 `combos[].payload` 다. 용량이 작은 조합은 압축형
(`O1-daehan-k10`)이나 해시 태그(`O1#57dc`)까지 내려가므로, **사진에서 복호한
문자열로 조합을 되찾을 때는 그 필드를 표로 쓴다** (렌더러가 조합 간 유일성을
단언한다). 조합 표에 없는 폴더는 색인이 `unknownFolders` 로 싣는다 — 조용히
버리지 않는다 (F-105 «캡처 매니페스트 의무»).

## 4. 아직 없는 것 (2차)

- 시험판 스캐너 WS 자동 수집 (뷰파인더 프레임 → 조합 id 태깅 → `captures/` 적재).
  설계는 레인 보고서 §WS.
- 캡처의 복호 결과 표시 (지금은 사진을 나열만 한다 — 복호는 스캔 테스트 쪽 트랙).
- 내보내기 옵션(크기·PPI·디더링) 축 — 1차는 생성기 기본값 한 벌로 굽는다.
