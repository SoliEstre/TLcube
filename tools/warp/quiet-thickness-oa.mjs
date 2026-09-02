#!/usr/bin/env node
// 안전영역(판) **두께 사다리 — Type O / A 의 흰·검 판** (2026-09-02). Type Y 는 자 보정용 대조군.
//
// ## 무엇을 묻는가
//
// Type Y 통제 실험(PM/031 §18.9)은 「판은 «없음» 보다 언제나 나쁘다」를 냈다:
//   없음 65.2% ≫ 표면색 최선(1.09배) 58.7% > 자동 목표(1.5배) 39.1% > 최저(1.23배) 15.2%.
// 그래서 Y auto 는 판을 안 깐다. 그런데 `src/quiet-extent.js` 의 `AUTO_TARGET_MULTIPLE = 1.5`
// 는 **값을 안 바꿨다** — 그 상수가 지금 닿는 곳은 (a) 사용자가 판을 직접 고른 경로
// (b) **O/A 의 흰·검 판** 인데, 둘 다 안 잰 축이라 잰 축(Y-표면색)의 수로 흔들 수 없기
// 때문이다 (§18.10). 이 하네스는 그 (b) 축을 잰다:
//   ① 「판은 없음보다 나쁜가」 ② 「나쁘다면 얇을수록 나은가」 ③ 「1.5배가 사다리 어디에 앉는가」.
//
// 위 세 줄은 **가설**이다 — Y 에서 참이었다는 것이 O/A 에서 참이라는 뜻이 아니다. Y 는
// **큐브 전경 실루엣**으로 후보를 잡고(cube-detect), O/A 는 **불스아이 파인더 + 앵커**
// (+ outline 시드)로 잡는다. 판이 해로운 기전(전경 덩어리 경쟁)이 O/A 에 그대로 있다는
// 보장이 없다. 이 파일은 확인하거나 반박한다.
//
// ## 46점 × 21행 × 4벌 결과 (2026-09-02, harm-dark 바닥 — 이 자가 가르는 유일한 축)
//
//   O · 흰(auto): 없음 18/46 39.1% (no-anchors · 점유율 ≥63%) · 판 1\~20셀 **전 행 46/46** (0.95\~2.24배)
//   O · 검정   : 없음 18/46 39.1% · 판 전 행 46/46 — 색도 무축
//   A · 흰(auto): 없음 46/46 100.0% · 판 20행 **전부 46/46** (0.95~1.82배)
//   A · 검정   : 없음 46/46 100.0% · 판 20행 **전부 46/46** (0.95~1.82배)
//   ⇒ O 에서 판은 «생존 조건»이고 **1셀에서 포화** — AUTO_TARGET_MULTIPLE 1.5 는 해롭지 않고 필요 이상.
//   ⚠ 이 결론은 «이 합성 규약에서» 다 — 같은 자가 Y §18.9 의 층을 못 봤다(위 §자 보정 결과). PM/031 §18.13.
//
// ## 구조 — Type Y 판(`quiet-thickness.mjs`)을 그대로 옮겼다
//
//   렌더 → 판(addQuietZone) → 바닥에 합성 → 스캐너 규약(정사각 크롭 + 960px)
//   → decodeFrontend → **점유율 스윕의 성공률** (PM/031 §18.8 규약: 45~90% 1% 눈금 46점).
//
// 🔴 Y 판은 자를 두 번 고쳤다. 같은 함정을 여기서 미리 막는다:
//   ① PPU 6 → 셀당 6px 로 하한(9px, `CELL_PX_FLOOR`) 아래라 60/60 **전패** → 「여백 무용」
//      으로 오독할 뻔. ⇒ 여기서는 PPU 를 **코드 폭에서 역산**해 스윕의 모든 점에서 960 으로
//      «축소» 가 일어나게 잡고(§PPU 주석 — 첫 스모크가 그 반대 함정을 밟았다), 행마다
//      **프레임 기준 셀 px 최소값**을 표에 찍고 하한 아래면 🔴 로 표시한다 (해석 금지).
//      셀 px 의 정의는 스캐너 하한과 같다 — O/A 는 육각 평면간 폭(√3·size), Y 는 코드 폭/n.
//      🔴 그런데 «하한 9» 는 scanner-zoom 상수를 **인용**한 것이지 이 자의 실측이 아니다 (자 검증 리뷰
//      2026-09-02): 점유율 스윕 안에서 셀 px 는 규약이 고정한다(960·occ/셀수 — O V2 45% 에서 25.4px)
//      라 하한 9 는 점유율 < 16% 에서만 닿고, 46점 사다리에서 셀 px 축은 애초에 흔들리지 않는다.
//      PPU 를 내려 하한을 실제로 밟는 실험(O V2 · 54% · ppu 15→3)은 **14\~17px 에서 이미 죽는데**
//      그때 프레임이 437\~545px 로 «축소가 없는 작은 프레임» 이라 셀 px 와 절대 프레임 크기가 얽혀
//      어느 쪽이 죽이는지 못 가른다. ⇒ 셀 px 열은 **기록용**이지 이 자의 축이 아니다.
//   ② 배경을 잔결 노이즈로 만드니 60/60 **전승**. 실물의 경쟁자는 노이즈가 아니라
//      밝은 바닥 위의 **큰 어두운 판** 이었다. ⇒ 바닥은 Y 판의 `groundPixel`(34px 블록
//      무늬 + 잔결)을 그대로 재사용하고, 어두운 판을 위한 **반전판**(dark)을 한 벌 더 둔다.
//   ③ 그리고 자 자체의 감도를 먼저 증명한다 — «기준선»(균일 바닥 · 판 없음)이 0/N 이면
//      표를 만들지 않고 죽고, «무코드 프레임»(바닥만)이 ✓ 면 판정기가 거짓 양성이라 죽는다.
//
// ## 「없음」이 첫 행, 최대(20)가 마지막 행 — 강제
//
// 사다리의 범위가 결론을 정한다 (하루에 세 번 뒤집혔다 — memory
// `ladder-range-decides-the-conclusion`). `--margins` 에 none / 20 이 빠져 있으면 **자동으로
// 끼워 넣고** 그 사실을 찍는다. 20 이 «최대» 인 이유: 생성기가 O/A 캔버스 여백을 20 으로
// 굽고(`generator-render-config.js` §sceneOptionsForOA) 안전영역 폴리곤은 캔버스로 클립되므로
// 20 을 넘겨도 그림이 안 변한다 (`quiet-extent.js` §QUIET_MARGIN_MAX).
//
// ## ⚠ 「바닥이 해롭다」의 뜻 — Y 와 O/A 에서 같은 축인가
//
// Y 통제 표본은 「지면 분리 0.000」 조건이었다 — 배치 사진의 코드 주변 평균 휘도가 셀
// 레벨 하나와 **겹친** 상태(§7.1 배경 분리 계약 < 0.05). Y 에서 그 축이 해로운 기전은
// «실루엣 검출이 프레임 테두리 띠에서 배경을 배우는데 판 색이 그 띠에 없으면 전경
// 덩어리가 된다» (quiet-auto.js §근거 정정) 였다.
// O/A 에서 **같은 축인지는 모른다.** O/A 검출의 1단계는 불스아이 파인더(절대 흑/백 링)라
// 지면 휘도에 둔감할 수 있고, outline 시드(frontend.js §무시드 재시도)는 실루엣을 보므로
// 민감할 수 있다. 그래서 여기서는 **바닥을 CLI 축**으로 열고(light / dark / plain /
// plain-dark), 행마다 바닥의 평균 휘도와 §7.1 분리를 함께 찍는다 — 해석은 표를 보고 한다.
// 밝은 모래 바닥(168~242)은 slate levels[2](Y 0.77)와, 어두운 반전판은 levels[0](Y 0.06)와
// 국소적으로 겹친다 — 둘 다 §7.1 기준 «해로운» 바닥이다.
//
// ## 이 하네스가 못 재는 것
//
// 카메라가 없다 — 자세·초점·노이즈·모션 축이 통째로 없다(§18.8 의 브라우저 스크린샷 조건과
// 같다). 여기서 나온 성공률은 «배율 앨리어싱에 대한 강건성» 이지 실물 사진의 성공률이
// 아니다. 층(없음 vs 판)의 순서를 묻는 데 쓰고, 절대값을 공표하지 마라.
//
// ## 🔴 자 보정 결과 (2026-09-02 스모크) — **밝은 바닥에선 눈이 멀고, 어두운 바닥에선 층이 «거꾸로» 보인다**
//
// (아래 첫 단락은 오전 스모크의 기록이고, 그 뒤 「§harm-dark」 단락이 그날 정오의 결과다.
//  둘을 합친 결론은 §harm-dark 끝에 있다.)
//
// 스모크에서 O V2 · O V4 · A0 가 모든 행 100% 로 몰렸다 (밝은 바닥, 흰 판, 없음/2/10/20 + 검정
// 대조). 「O/A 가 강건해서」인지 「이 합성 규약이 아무 타입도 못 가르는」 것인지 가르려고
// **알려진 실패**를 같은 자로 다시 쟀다 (`--type=Y --plate=surface` — 이 파일의 Y 지원은
// 그 대조군용이다):
//   Y2·v0T·3톤 + 표면 색 판 (= §18.9 의 표본 구성) · 밝은 바닥 · 45~90% 10점
//     없음 10/10 · 2셀(1.09배) 10/10 · 10셀(1.46배) 10/10 · 20셀(1.92배) 10/10
//   §18.9 는 같은 구성에서 없음 65.2% ≫ 1.46배 39.1% 였다. ⇒ **이 규약은 그 층을 못 본다.**
//   바닥을 §7.1 분리 ≈ 0 (`--ground=harm`, 실측 분리 0.001 — 첫 판 0.079 는 감마 탓, 중심을
//   212 로 올려 맞췄다) 으로 옮겨도
//     없음 9/10 · 2셀 9/10 · 10셀 9/10 · 20셀 9/10 — 전부 **90%** 한 프레임(no-grid-hypothesis), 층이 아니다.
//     (처음엔 「60%」로 적었다 — JSON perOcc 를 다시 읽으니 90 이다. 세 바닥 모두 같은 프레임. 자 검증 리뷰가 잡았다.)
//   어두운 쪽(`--ground=harm-dark`, levels[0] 에 겹침, 분리 0.000)도 없음/10/20 전부 9/10 — 같다.
//   A2 (31셀, 이 규약의 가장 작은 셀 13.9px) 도 없음/auto 17셀/20셀/검정 10셀 전부 22/23
//     (앞 셋은 49% 한 프레임, 대조는 45% 한 프레임 — 같은 층).
//
// 해석 규칙: **O/A 행이 전부 100% 인 것은 「판 무해」의 증거가 아니다** — 자가 Y 의 알려진
// 손해도 못 봤다. §18.9 의 표본이 가졌고 여기 없는 것: 실제 사진 바닥(포스터) · 브라우저
// 미리보기 축소 → OS 스크린샷(재샘플링 한 겹 더) · 「지면 분리 0.000」의 정확한 조건.
// 어느 것이 층을 만드는지는 **모른다.** 확인하는 길은 둘 —
//   ① 운영자 스크린샷/사진 사다리를 O/A 로 찍어 `scan-photo.mjs --occ` 에 물린다 (§18.9 와
//      같은 자 · 같은 규약). 이게 정공법이다.
//   ② 이 하네스에 빠진 재료를 하나씩 넣어 Y 가 §18.9 처럼 갈리는 지점을 **먼저** 찾고,
//      그 규약으로 O/A 를 잰다. 그 전까지 전체 사다리(46점 × 20행)는 CPU 만 쓴다.
//
// 그래도 이 스모크가 **확인한 것**: 파이프라인이 O/A/Y 끝까지 간다 · 셀 px ≥ 9 · 기준선 통과 ·
// 무코드 프레임 ✗ · auto(사진 없음 · slate) 는 O/A 에서 **흰 판**이고 O V2 의 자동 두께는
// **10셀 = 1.56배** (§18.10.1 「대조군 Type O = 흰 판 10셀」과 일치) · 사진(바닥 Y 0.53)이
// 있으면 auto 는 **검정**으로 뒤집힌다(surface-separation) · **A2 는 1.5배에 못 닿는다** —
// 2셀에서 0.956배(<1), auto 17셀 = 1.28배 clip, 20셀 = 1.34배 clip. 삼각형은 폭보다 낮아
// quietCoverage 의 «정사각 구속(min(w,h)/폭)» 이 1 아래에서 시작한다. 즉 Type A 에서
// AUTO_TARGET_MULTIPLE 은 목표가 아니라 «캔버스 끝까지» 와 같은 말이다.
//
// ### §harm-dark — 어두운 바닥에서 O 는 **판이 없으면 죽고, 판이 있으면(색·두께 무관) 산다**
//
// 바닥을 levels[0](Y 0.06, 가장 어두운 면) 에 겹치게 옮기니(`--ground=harm-dark`, 실측 평균 Y 0.061
// · §7.1 분리 0.000) 처음으로 행이 갈렸다 — 그런데 §18.9 와 **반대 방향**이다:
//
//   O V2 · 흰 판(auto) · 45~90% 3% 눈금 16점          O V2 · 같은 조건 · 5% 눈금 10점 (재현)
//     없음        **6/16 37.5%**  (no-anchors 9)         없음        **4/10 40.0%**  (no-anchors 5)
//     2셀(1.02배)   16/16 100%                            2셀          10/10 100%
//     auto 10셀(1.56배) 16/16                             auto 10셀    10/10
//     20셀(2.24배 clip) 16/16                             20셀         10/10
//     대조 검정 10셀  16/16                               대조 검정 10셀 10/10
//   실패는 점유율 **63% 이상에서만** 난다 (45~60% 는 통과) — 앨리어싱의 번갈이가 아니라 문턱 모양이다.
//   왜 63% 인지는 **모른다** (판 행은 같은 점유율에서 전부 통과하므로 불스아이 크기 단독은 아니다).
//   O V2 · 검정 판 · 4점 (없음 2/4 · 10셀 4/4 · 20셀 4/4) 도 같은 방향.
//   A2 · 흰 판 · 16점: 없음 16/16 · 2셀 15/16 · auto 17셀 15/16 · 20셀 15/16 · 대조 검정 10셀 16/16
//     → **A 는 이 바닥에 안 다친다** (판 행의 1 실패는 전부 45% 한 프레임 — 같은 층).
//   Y2T · 표면 색 판 · 10점: 없음 9/10 · 10셀 9/10 · 20셀 9/10 → Y 는 여전히 평평하다.
//
//   실패 프레임을 열었다 (`--dump --dump-occ=72`, `*-row0-none-none-occ70-FAIL.png`): 육각 가장자리의
//   가장 어두운 셀들이 바닥과 같은 휘도라 **실루엣이 그 자리에서 끊겨 있고**, 불스아이(흑/백 링)는
//   멀쩡히 보인다. 판 2셀 프레임은 흰 띠가 가장자리를 통째로 복원한다. 즉 죽는 단계는 파인더가
//   아니라 그 뒤 **앵커 3점(anchor-detect) + 실루엣 폴백(bootstrap silhouetteHypotheses)** 이고,
//   둘 다 «코드의 바깥 경계» 를 필요로 한다 — 바닥이 그 경계를 지운 것이다. (여기까지는 실패 코드와
//   이미지에서 읽은 것이고, 앵커 표본 원판이 실제로 바닥을 밟는지는 계측하지 않았다.)
//
// **합친 결론 (이 자 안에서):**
//   · «판은 없음보다 나쁜가» — O/A 에선 **아니다**. 밝은 바닥·밝은 해로운 바닥에선 판 유무가 안 갈리고
//     (자가 못 보는 것일 수 있다 — Y 대조군이 §18.9 를 재현 못 했다), 어두운 해로운 바닥에선 O 에게
//     판이 **유일한 생존 조건**이다. Y §18.9 의 「없음이 최고」는 O 에 옮겨지지 않는다.
//   · «나쁘다면 얇을수록 나은가» — 질문 자체가 성립하지 않는다. 2셀(1.02배) = 10셀 = 20셀 = 100%.
//     이 자에서 두께는 **아무 축도 아니고 색도 아니다**(검정 판도 100%). 판이 «있다» 가 전부다.
//   · «1.5배가 사다리 어디에 앉는가» — 1.02 와 2.24 사이 어디에 앉아도 결과가 같다. 이 데이터로
//     AUTO_TARGET_MULTIPLE 을 올리거나 내릴 근거는 **없다**. 다만 「판을 깐다」는 O 에서 실측 근거가 섰다.
//   · 이 자가 **못 본 것**은 그대로다: Y 의 §18.9 손해. 그러니 O/A 의 «판 = 없음» 행들을 「판 무해」로
//     읽지 마라 — 「이 자에서 안 갈린다」까지만이다.
//
// ## 사용
//   node tools/warp/quiet-thickness-oa.mjs --type=O|A|Y --plate=auto|white|black|none|surface
//        --margins=none,2,auto,10,20 [--occ=45:90:1]
//        [--ground=light|dark|plain|plain-dark|harm|harm-dark] [--ppu=N] [--control=<margin|auto>]
//        [--version=N] [--ecc=L|M|H] [--ylayout=v0t|v0] [--tones=2|3] [--tag=<접미>] [--dump [--dump-occ=N]]
//   · margins 토큰: none · 정수(1~20) · auto(= autoQuietMargin 이 1.5배로 역산한 두께) · max(=20)
//   · --control : 반대 색 판을 그 두께로 한 행 (대조군). plate=none 이면 무시. **표의 마지막 행**
//                 이 된다 — 「20 이 마지막」은 판 사다리 안에서의 말이고 대조 행은 그 뒤에 붙는다.
//   · --plate=surface 는 Y 전용(§18.9 조건 = 바닥 평균색 판). Y 의 auto 는 제품대로 «없음».
//   · --dump    : 행마다 한 프레임을 PNG 로 남긴다 (실패는 이미지를 열어라). 기본 점유율은 조준
//                 54% 에 가장 가까운 점, `--dump-occ=72` 처럼 골라 실패 구간을 찍는다 (`-FAIL` 접미).
//   · --tag     : 같은 (type·plate·ground) 를 다른 ppu/버전으로 나란히 돌릴 때 산출 파일 덮어쓰기 방지.
//   산출: stdout 표 + test/output/quiet-oa/<type>-<plate>-<ground>[-tag].json (gitignore).
//   결정적 — 난수 없음, 바닥은 해시. 소요: 960 프레임 복호 1건 ≈ 2~4 s (O 2 · A2 2.4 · Y2 3).
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { encode } from '../../src/encode.js';
import { encodeA } from '../../src/encodeA.js';
import { encodeY } from '../../src/encodeY.js';
import { buildScene } from '../../src/scene.js';
import { buildSceneY } from '../../src/sceneY.js';
import { CELL_SURFACE_FINAL_V0T, CELL_SURFACE_FINAL_V0 } from '../../src/cellSurfaceFinal.js';
import { addQuietZone } from '../../src/quietzone.js';
import {
  quietCoverage, autoQuietMargin, AUTO_TARGET_MULTIPLE, QUIET_MARGIN_MAX, QUIET_MARGIN_MIN,
} from '../../src/quiet-extent.js';
import { resolveQuietZoneChoice } from '../../src/quiet-auto.js';
import {
  getPreset, DEFAULT_PRESET, BULLSEYE_DARK, BULLSEYE_LIGHT, relativeLuminance,
  PRESET_BG_SEPARATION_MIN,
} from '../../src/luminance.js';
import { rasterize } from '../../src/raster.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import { GUIDE_OUTER_FRACTION, FRAME_MAX_SIDE, CELL_PX_FLOOR } from '../../src/scanner-zoom.js';
import { rasterToPng } from '../../src/png.js';

// ── CLI ─────────────────────────────────────────────────────────────────
function arg(name, def) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a === undefined ? def : a.slice(name.length + 3);
}
const flag = (name) => process.argv.includes(`--${name}`);

const TYPE = arg('type', 'O').toUpperCase();
if (TYPE !== 'O' && TYPE !== 'A' && TYPE !== 'Y') throw new RangeError(`--type=O|A|Y 여야 한다: ${TYPE}`);
const PLATE_ARG = arg('plate', 'auto');
if (!['auto', 'white', 'black', 'none', 'surface'].includes(PLATE_ARG)) {
  throw new RangeError(`--plate=auto|white|black|none|surface 여야 한다: ${PLATE_ARG}`);
}
/*
 * `--type=Y` 는 **자 보정용 대조군**이다 (2026-09-02). O/A 첫 스모크가 모든 행 100% 로
 * 몰렸고, 그게 «O/A 가 강건해서» 인지 «이 합성 규약이 아무 타입도 못 가르는» 것인지
 * 이 하네스 혼자서는 모른다. 알려진 실패(PM/031 §18.9 — Y2·v0T·3톤, 표면 색 판:
 * 없음 65.2% ≫ 1.5배 39.1%)를 **같은 자**로 다시 재서 그 층이 보이면 자가 산 것이고,
 * 안 보이면 O/A 의 100% 도 해석하면 안 된다. plate=surface 는 Y 전용(§18.9 조건 =
 * 바닥 평균색 판). Y 의 흰/검은 제품 카드에서 내려갔지만 참고 행으로 허용한다.
 */
if (PLATE_ARG === 'surface' && TYPE !== 'Y') {
  throw new RangeError('--plate=surface 는 Type Y 대조군 전용이다 (O/A 제품 카드에 표면 색 판은 없다)');
}
const Y_LAYOUT = arg('ylayout', 'v0t');
if (Y_LAYOUT !== CELL_SURFACE_FINAL_V0T && Y_LAYOUT !== CELL_SURFACE_FINAL_V0) {
  throw new RangeError(`--ylayout=${CELL_SURFACE_FINAL_V0T}|${CELL_SURFACE_FINAL_V0} 여야 한다: ${Y_LAYOUT}`);
}
const Y_TONES = Number(arg('tones', '3'));
const GROUND = arg('ground', 'light');
if (!['light', 'dark', 'plain', 'plain-dark', 'harm', 'harm-dark'].includes(GROUND)) {
  throw new RangeError(`--ground=light|dark|plain|plain-dark|harm|harm-dark 여야 한다: ${GROUND}`);
}
const ECC = arg('ecc', 'M');
const VERSION_ARG = arg('version', null);
const PAYLOAD = arg('payload', 'https://tl.estre.so');
const DUMP = flag('dump');
const CONTROL_ARG = arg('control', null);

/*
 * 점유율 스윕 — `tools/warp/scan-photo.mjs` 의 `parseOccSpec` 을 **옮겼다** (그 파일은
 * 최상위에서 바로 실행되는 스크립트라 import 하면 돈다 — export 가 없다). 규약은 같다:
 * --occ=<시작>:<끝>:<간격> 백분율, 기본 45:90:1 (PM/031 §18.8 의 46점).
 */
function parseOccSpec(spec) {
  const [lo, hi, step] = spec.split(':').map(Number);
  if (![lo, hi, step].every(Number.isFinite) || step <= 0 || hi < lo) {
    throw new RangeError(`--occ=<시작>:<끝>:<간격> 형식이어야 한다: ${spec}`);
  }
  const out = [];
  for (let v = lo; v <= hi + 1e-9; v += step) out.push(v / 100);
  return out;
}
const OCC_SPEC = arg('occ', '45:90:1');
const OCCUPANCIES = parseOccSpec(OCC_SPEC);
const OCC_MIN = Math.min(...OCCUPANCIES);
/*
 * --dump 가 남기는 점유율 — 기본은 스윕에서 조준 가이드(54%)에 가장 가까운 점 (정확히 54% 가
 * 없을 수 있다). `--dump-occ=<백분율>` 로 다른 점을 고른다: 실패가 **63% 부터** 시작하는 행
 * (2026-09-02 O V2 · harm-dark · 없음) 을 54% 로 찍으면 통과 프레임만 남아 «실패는 이미지를
 * 열어라» 가 성립하지 않는다. 스윕에 없는 값이면 가장 가까운 점.
 */
const DUMP_TARGET = arg('dump-occ', null) === null ? GUIDE_OUTER_FRACTION : Number(arg('dump-occ', null)) / 100;
if (!Number.isFinite(DUMP_TARGET) || DUMP_TARGET <= 0) throw new RangeError(`--dump-occ=<백분율> 이어야 한다: ${arg('dump-occ', null)}`);
const DUMP_OCC = OCCUPANCIES.reduce((best, o) => (Math.abs(o - DUMP_TARGET) < Math.abs(best - DUMP_TARGET) ? o : best));

// ── 인코딩 · 씬 ────────────────────────────────────────────────────────
const P = getPreset(DEFAULT_PRESET);
/** 씬 배경 자리표지. 래스터는 background:null(투명) 로 굽는다 — 이 색이 픽셀에 새면 결함. */
const KEY = { r: 1, g: 254, b: 2 };
const PALETTE = {
  background: KEY, levels: P.levels, bullseyeDark: BULLSEYE_DARK, bullseyeLight: BULLSEYE_LIGHT,
};
/** 생성기와 같은 배제 목록 (index.html withQuietZone / syncQuietGaugeReadout). */
const SELF_QUIET = [BULLSEYE_LIGHT, BULLSEYE_DARK];
const QUIET_WHITE = { r: 255, g: 255, b: 255 };
const QUIET_BLACK = { r: 0, g: 0, b: 0 };
/** 생성기 O/A 캔버스 여백 — generator-render-config.js §sceneOptionsForOA (코너 QR 과 같은 20). */
const CANVAS_MARGIN = 20;

const encOpts = { eccLevel: ECC };
if (VERSION_ARG !== null) encOpts.version = Number(VERSION_ARG);
let encoded;
let baseScene;
if (TYPE === 'Y') {
  // §18.8 의 표본 = 생성기 v0T 카드 (generator-render-config.js §encodeOptionsForY): Y2·3톤.
  encoded = encodeY(PAYLOAD, {
    ...encOpts, version: VERSION_ARG === null ? 2 : Number(VERSION_ARG),
    tones: Y_TONES, cellSurface: true, cellSurfaceLayout: Y_LAYOUT,
  });
  // sceneY 의 캔버스 여백 기본도 20 (sceneY.js DEFAULT_MARGIN_FACTOR) — 명시해서 O/A 와 같은 축에 둔다.
  baseScene = { ...buildSceneY(encoded, { palette: PALETTE, margin: CANVAS_MARGIN }), background: null };
} else {
  encoded = TYPE === 'O' ? encode(PAYLOAD, encOpts) : encodeA(PAYLOAD, encOpts);
  baseScene = { ...buildScene(encoded, { palette: PALETTE, margin: CANVAS_MARGIN }), background: null };
}

/** 코드(판 없음) 의 bbox — 씬 단위. 스캐너 사용자가 조준하는 «코드 중심·폭» 이 이것이다. */
function bboxOfShapes(shapes) {
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const s of shapes) {
    for (const p of s.points || []) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY };
}
const CODE_BOX = bboxOfShapes(baseScene.shapes);
const SQRT3 = Math.sqrt(3);
/**
 * 셀 하나의 폭(씬 단위) — 스캐너 하한(9px) 이 세는 «셀» 과 같은 정의로.
 *   O/A: 육각 평면간 폭 = √3·size.   Y: 코드 폭 / n (scanner-zoom.js GUIDE_CELLS_Y2 = 25 의 정의).
 */
const CELL_FLAT_UNITS = TYPE === 'Y' ? CODE_BOX.width / encoded.n : SQRT3 * baseScene.layout.size;
const CELLS_ACROSS = CODE_BOX.width / CELL_FLAT_UNITS;

/*
 * PPU — **스윕의 모든 점에서 축소가 일어나는** 배율로 역산한다: 최고 점유율에서도
 * 분석창 side = codePx/occ ≥ 960 이어야 하므로 codePx ≥ max(occ)·960.
 *
 * 🔴 첫 스모크(2026-09-02)는 Y 판을 따라 «조준 54% 에서 520px» 로 잡았는데, 그러면
 *    점유율 > 54% 구간은 side < 960 이라 `resample` 이 **항등 복사**가 된다 — 스윕의
 *    절반이 같은 픽셀을 다시 읽는 것이고, Y 의 15~65% 폭을 만든 재샘플링 앨리어싱
 *    (§18.8 — 833px 큐브 스크린샷을 960 으로 줄였다)이 자에서 빠진다. 25/25 전승이
 *    그 신호였다. 이제 §18.8 과 같은 «전 구간 축소» 조건이 기본이다 (--ppu 로 덮는다).
 */
const OCC_MAX = Math.max(...OCCUPANCIES);
const PPU = Number(arg('ppu', String(Math.max(1, Math.ceil((OCC_MAX * FRAME_MAX_SIDE) / CODE_BOX.width)))));
const CODE_PX = CODE_BOX.width * PPU;
const CODE_CENTER_PX = { x: (CODE_BOX.minX + CODE_BOX.maxX) / 2 * PPU, y: (CODE_BOX.minY + CODE_BOX.maxY) / 2 * PPU };
/** 합성 캔버스 — 최저 점유율의 분석창이 통째로 들어가야 한다 (여유 16px). */
const CANVAS = Math.ceil(CODE_PX / OCC_MIN) + 16;

// ── 바닥 ───────────────────────────────────────────────────────────────
/** 밝은 바닥 (모래빛, 블록 무늬 + 잔결) — Y 판 `groundPixel` 그대로. 결정적. */
function groundLight(x, y) {
  let s = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
  const t = s / 4294967296;
  const blocky = ((Math.floor(x / 34) * 31 + Math.floor(y / 34) * 17) % 5) / 5;
  const v = 168 + Math.round(74 * (0.65 * blocky + 0.35 * t));
  return { r: v, g: Math.round(v * 0.96), b: Math.round(v * 0.74) };
}
/** 어두운 반전판 — 같은 블록 무늬를 뒤집어 아스팔트/슬레이트 톤 (13~87). 어두운 판의 경쟁자. */
function groundDark(x, y) {
  const v = 255 - groundLight(x, y).r;
  return { r: Math.round(v * 0.80), g: Math.round(v * 0.84), b: v };
}
/**
 * «해로운» 바닥 — 같은 블록 무늬를 셀 레벨 하나의 휘도에 **겹치게** 옮긴 것 (§7.1 분리 ≈ 0).
 * §18.9 의 표본이 「지면 분리 0.000」 이었다 — light(0.24)·dark 로는 그 조건이 아니다.
 * harm = levels[2](Y 0.77, 밝은 면) 에 겹침 · harm-dark = levels[0](Y 0.06, 어두운 면) 에 겹침.
 * 값은 실측으로 맞췄다 (아래 groundStats 가 찍는 분리를 보고 중심을 옮겼다).
 */
function groundHarm(x, y) {
  // 212~255 — 평균 Y 0.771, levels[2](0.7699) 와의 분리 0.001 (base 196 은 0.079 였다 — 감마).
  const v = Math.min(255, 212 + Math.round((groundLight(x, y).r - 168) * (43 / 74)));
  return { r: v, g: Math.round(v * 0.985), b: Math.round(v * 0.93) };
}
function groundHarmDark(x, y) {
  // 64~92 — 평균 Y ≈ 0.061 = levels[0]. (base 52 는 분리 0.018 이었다.)
  const v = 64 + Math.round((groundLight(x, y).r - 168) * (28 / 74));
  return { r: Math.round(v * 0.86), g: Math.round(v * 0.92), b: v };
}
const GROUNDS = {
  light: groundLight,
  dark: groundDark,
  harm: groundHarm,
  'harm-dark': groundHarmDark,
  plain: () => ({ r: 244, g: 244, b: 244 }),
  'plain-dark': () => ({ r: 24, g: 24, b: 24 }),
};
const PLAIN = GROUNDS.plain;

/** 바닥의 평균 상대휘도와 §7.1 분리(셀 레벨과의 최소 거리) — «해로운가» 의 축을 숫자로 남긴다. */
function groundStats(ground) {
  let sum = 0; let n = 0; let r = 0; let g = 0; let b = 0;
  for (let y = 0; y < CANVAS; y += 7) {
    for (let x = 0; x < CANVAS; x += 7) {
      const c = ground(x, y);
      sum += relativeLuminance(c); r += c.r; g += c.g; b += c.b; n += 1;
    }
  }
  const mean = sum / n;
  const sep = Math.min(...P.levels.map((l) => Math.abs(relativeLuminance(l) - mean)));
  // 표면 색 = 생성기 measureBackdrop 상당 (코드 주변 평균 RGB). Y 대조군의 판 색.
  const meanColor = { r: Math.round(r / n), g: Math.round(g / n), b: Math.round(b / n) };
  return { meanLuminance: mean, separation: sep, harmful: sep < PRESET_BG_SEPARATION_MIN, meanColor };
}

// ── 판 색 결정 — 제품 규칙 그대로 ─────────────────────────────────────
function separationFromLevels(color) {
  const y = relativeLuminance(color);
  return Math.min(...P.levels.map((l) => Math.abs(relativeLuminance(l) - y)));
}
const SEP_W = separationFromLevels(QUIET_WHITE);
const SEP_B = separationFromLevels(QUIET_BLACK);
/** 사진 없음 = 생성기 기본 상태의 auto. (사진이 있으면 표면에서 먼 색을 고른다 — 정보로만 찍는다.) */
function autoChoice(surfaceLuminance) {
  return resolveQuietZoneChoice({
    quietMode: 'auto', bgMode: 'transparent', type: TYPE,
    sepWhite: SEP_W, sepBlack: SEP_B, surfaceLuminance,
    surfaceSeparation: NaN, separationFloor: PRESET_BG_SEPARATION_MIN,
  });
}
const AUTO_NO_PHOTO = autoChoice(null);
const GROUND_STATS = groundStats(GROUNDS[GROUND]);
const AUTO_WITH_PHOTO = autoChoice(GROUND_STATS.meanLuminance);

const PLATE_NAME = PLATE_ARG === 'auto' ? AUTO_NO_PHOTO.color : PLATE_ARG;
if (!['white', 'black', 'none', 'surface'].includes(PLATE_NAME)) {
  throw new Error(`auto 가 모르는 색을 냈다: ${PLATE_NAME} (${AUTO_NO_PHOTO.reason})`);
}
const colorOf = (name) => (name === 'white' ? QUIET_WHITE : name === 'black' ? QUIET_BLACK
  : name === 'surface' ? GROUND_STATS.meanColor : null);
/** 대조 행의 색 — 흰↔검. 표면 색의 대조는 바닥에서 먼 쪽(contrast 규칙이 고를 색). */
const opposite = (name) => (name === 'white' ? 'black' : name === 'black' ? 'white'
  : GROUND_STATS.meanLuminance > 0.5 ? 'black' : 'white');

// ── 자동 두께 (1.5배) ───────────────────────────────────────────────────
function plated(margin, color) {
  return addQuietZone(baseScene, { color, margin, selfQuietColors: SELF_QUIET });
}
const covAt2 = quietCoverage(plated(2, QUIET_WHITE), SELF_QUIET);
const AUTO_MARGIN = autoQuietMargin(covAt2, 2);

// ── 사다리 행 조립 ─────────────────────────────────────────────────────
function resolveMarginToken(tok) {
  if (tok === 'none') return 'none';
  if (tok === 'auto') return AUTO_MARGIN;
  if (tok === 'max') return QUIET_MARGIN_MAX;
  const n = Number(tok);
  if (!Number.isInteger(n) || n < QUIET_MARGIN_MIN || n > QUIET_MARGIN_MAX) {
    throw new RangeError(`margin 토큰은 none|auto|max|${QUIET_MARGIN_MIN}~${QUIET_MARGIN_MAX} 여야 한다: ${tok}`);
  }
  return n;
}
const rawTokens = arg('margins', 'none,auto,max').split(',').map((s) => s.trim()).filter(Boolean);
const added = [];
const numeric = new Set();
let hasNone = false;
for (const t of rawTokens) {
  const v = resolveMarginToken(t);
  if (v === 'none') hasNone = true; else numeric.add(v);
}
if (!hasNone) added.push('none');
if (PLATE_NAME !== 'none' && !numeric.has(QUIET_MARGIN_MAX)) { numeric.add(QUIET_MARGIN_MAX); added.push(`max(${QUIET_MARGIN_MAX})`); }
const rows = [{ label: '없음', plate: 'none', margin: null }];
if (PLATE_NAME !== 'none') {
  for (const m of [...numeric].sort((a, b) => a - b)) {
    rows.push({ label: m === AUTO_MARGIN ? `auto(${m})` : String(m), plate: PLATE_NAME, margin: m });
  }
  if (CONTROL_ARG !== null) {
    const m = resolveMarginToken(CONTROL_ARG);
    if (m !== 'none') rows.push({ label: `대조 ${opposite(PLATE_NAME)} ${m}`, plate: opposite(PLATE_NAME), margin: m, control: true });
  }
}

// ── 합성 · 크롭 · 판정 ────────────────────────────────────────────────
/** 래스터(알파)를 바닥 위에 알파 합성한다. 코드 중심이 캔버스 중심에 오게 놓는다. */
function composite(raster, ground) {
  const S = CANVAS;
  const px = new Uint8ClampedArray(S * S * 4);
  const ox = Math.round(S / 2 - CODE_CENTER_PX.x);
  const oy = Math.round(S / 2 - CODE_CENTER_PX.y);
  let keyLeak = 0;
  for (let y = 0; y < S; y += 1) {
    const ry = y - oy;
    for (let x = 0; x < S; x += 1) {
      const g = ground(x, y);
      let r = g.r; let gg = g.g; let b = g.b;
      const rx = x - ox;
      if (rx >= 0 && ry >= 0 && rx < raster.width && ry < raster.height) {
        const i = (ry * raster.width + rx) * 4;
        const a = raster.pixels[i + 3] / 255;
        if (a > 0) {
          const sr = raster.pixels[i]; const sg = raster.pixels[i + 1]; const sb = raster.pixels[i + 2];
          if (Math.abs(sr - KEY.r) < 3 && Math.abs(sg - KEY.g) < 3 && Math.abs(sb - KEY.b) < 3) keyLeak += 1;
          r = sr * a + r * (1 - a); gg = sg * a + gg * (1 - a); b = sb * a + b * (1 - a);
        }
      }
      const o = (y * S + x) * 4;
      px[o] = r; px[o + 1] = gg; px[o + 2] = b; px[o + 3] = 255;
    }
  }
  return { img: { width: S, height: S, pixels: px }, keyLeak };
}

/** 쌍선형 축소 — scan-photo.mjs 의 `resample` 을 옮겼다 (스캐너의 canvas drawImage 상당). */
function resample(src, sx, sy, sSide, target) {
  const out = new Uint8ClampedArray(target * target * 4);
  const scale = sSide / target;
  for (let y = 0; y < target; y += 1) {
    const fy = sy + (y + 0.5) * scale - 0.5;
    const y0 = Math.max(0, Math.min(src.height - 1, Math.floor(fy)));
    const y1 = Math.min(src.height - 1, y0 + 1);
    const wy = fy - y0;
    for (let x = 0; x < target; x += 1) {
      const fx = sx + (x + 0.5) * scale - 0.5;
      const x0 = Math.max(0, Math.min(src.width - 1, Math.floor(fx)));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const wx = fx - x0;
      const o = (y * target + x) * 4;
      for (let c = 0; c < 4; c += 1) {
        const a = src.pixels[(y0 * src.width + x0) * 4 + c];
        const b = src.pixels[(y0 * src.width + x1) * 4 + c];
        const d = src.pixels[(y1 * src.width + x0) * 4 + c];
        const e = src.pixels[(y1 * src.width + x1) * 4 + c];
        out[o + c] = (a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy;
      }
    }
  }
  return { width: target, height: target, pixels: out };
}

/** 점유율 하나의 프레임 — 캔버스 중심(=코드 중심)에서 side 정사각을 잘라 ≤960 으로 줄인다. */
function frameAt(img, occ) {
  const side = Math.round(CODE_PX / occ);
  if (side > img.width) throw new Error(`점유율 ${occ} 의 분석창(${side}) 이 캔버스(${img.width}) 보다 크다 — CANVAS 산정 결함`);
  const s0 = Math.round((img.width - side) / 2);
  const target = Math.min(FRAME_MAX_SIDE, side);
  return { side, target, frame: resample(img, s0, s0, side, target) };
}

function judge(frame) {
  try {
    const d = decodeFrontend(frame, {});
    if (d && d.ok) {
      return String(d.text) === PAYLOAD ? { ok: true, reason: 'ok' } : { ok: false, reason: 'payload-mismatch' };
    }
    return { ok: false, reason: String(d && d.reason || 'fail').replace('frontend:', '') };
  } catch (e) { return { ok: false, reason: 'throw:' + String(e && e.message || e).slice(0, 40) }; }
}

function topReasons(counts, n = 2) {
  return Object.entries(counts).filter(([k]) => k !== 'ok').sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([k, v]) => `${k} ${v}`).join(' · ') || '—';
}

const OUT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'test', 'output', 'quiet-oa');
mkdirSync(OUT_DIR, { recursive: true });
/** 산출 파일 이름. `--tag=` 는 같은 (type·plate·ground) 를 다른 ppu/버전으로 나란히 돌릴 때 덮어쓰기를 막는다. */
const TAG = `${TYPE}-${PLATE_ARG}-${GROUND}` + (arg('tag', null) ? `-${arg('tag', null)}` : '');

/** 한 행 = 한 씬(판 유무·두께) × 점유율 스윕. */
function runRow(row, ground, dumpName) {
  const t0 = Date.now();
  const color = colorOf(row.plate);
  const scene = color ? plated(row.margin, color) : baseScene;
  const cov = quietCoverage(scene, SELF_QUIET);
  const raster = rasterize(scene, { pixelsPerUnit: PPU, supersample: 2 });
  const { img, keyLeak } = composite(raster, ground);
  // 판(링)이 프레임 기준 몇 px 인가 — 분석창을 «덮는가» 판정에 쓴다 (Y 판의 «닫힌 도형 / 넘침» 축).
  const ringMinPx = color ? Math.min(cov.quietWidth, cov.quietHeight) * PPU : CODE_PX;
  const counts = {};
  const perOcc = [];
  let hits = 0; let cellPxMin = Infinity; let coversFrom = null;
  for (const occ of OCCUPANCIES) {
    const { side, target, frame } = frameAt(img, occ);
    const v = judge(frame);
    const cellPx = CELL_FLAT_UNITS * PPU * (target / side);
    const covers = ringMinPx >= side;
    if (covers && (coversFrom === null || occ < coversFrom)) coversFrom = occ;
    if (cellPx < cellPxMin) cellPxMin = cellPx;
    counts[v.reason] = (counts[v.reason] || 0) + 1;
    if (v.ok) hits += 1;
    perOcc.push({ occ: +occ.toFixed(4), side, target, cellPx: +cellPx.toFixed(2), coversWindow: covers, ok: v.ok, reason: v.reason });
    if (DUMP && dumpName && occ === DUMP_OCC) {
      writeFileSync(path.join(OUT_DIR, `${TAG}-${dumpName}-occ${Math.round(occ * 100)}${v.ok ? '' : '-FAIL'}.png`), rasterToPng(frame));
    }
  }
  return {
    ...row, multiple: cov ? +cov.multiple.toFixed(3) : null, clipped: cov ? cov.clipped : null,
    coversWindowFrom: coversFrom, cellPxMin: +cellPxMin.toFixed(2), hits, tried: OCCUPANCIES.length,
    rate: hits / OCCUPANCIES.length, reasons: counts, keyLeak, perOcc, ms: Date.now() - t0,
  };
}

// ── 머리말 ─────────────────────────────────────────────────────────────
const versionLabel = TYPE === 'O' ? `V${encoded.version}` : TYPE === 'A' ? `A${encoded.version}`
  : `Y${encoded.version}${encoded.tones === 3 ? 'T' : ''}·${Y_LAYOUT}`;
console.log(`Type ${TYPE} ${versionLabel} (${TYPE === 'Y' ? `n=${encoded.n}` : `k=${encoded.k}`}, ECC-${encoded.eccLevel}) · "${PAYLOAD}" · preset ${P.name}`);
if (TYPE === 'Y' && PLATE_NAME === 'none' && PLATE_ARG === 'auto') {
  console.log('ℹ Type Y auto 는 판을 안 깐다 (quiet-auto.js §auto-y-silhouette) — 사다리를 보려면 --plate=surface');
}
console.log(`코드 폭 ${CODE_BOX.width.toFixed(2)}u = ${CELLS_ACROSS.toFixed(1)}셀 · ppu ${PPU} → ${CODE_PX.toFixed(0)}px · 캔버스 여백 ${CANVAS_MARGIN}u · 합성 캔버스 ${CANVAS}px`);
console.log(`스캐너 규약: 조준 ${(GUIDE_OUTER_FRACTION * 100).toFixed(0)}% · 프레임 ≤${FRAME_MAX_SIDE}px · 셀 px 하한 ${CELL_PX_FLOOR} · 점유율 ${OCC_SPEC} (${OCCUPANCIES.length}점)`);
console.log(`판 색: auto(사진 없음) → ${AUTO_NO_PHOTO.color} [${AUTO_NO_PHOTO.reason}; sepW ${SEP_W.toFixed(4)} sepB ${SEP_B.toFixed(4)}]`
  + ` · auto(바닥 사진 Y=${GROUND_STATS.meanLuminance.toFixed(3)}) 라면 → ${AUTO_WITH_PHOTO.color} [${AUTO_WITH_PHOTO.reason}]`
  + ` · 이 실행의 판 = ${PLATE_NAME}`);
console.log(`바닥 ${GROUND}: 평균 Y ${GROUND_STATS.meanLuminance.toFixed(3)} · §7.1 분리 ${GROUND_STATS.separation.toFixed(3)} (${GROUND_STATS.harmful ? '해로움 < 0.05' : '무해 ≥ 0.05'})`);
console.log(`자동 두께(목표 ${AUTO_TARGET_MULTIPLE}배) = ${AUTO_MARGIN}셀 (2셀 실측 ${covAt2.multiple.toFixed(3)}배에서 역산)`);
if (added.length) console.log(`⚠ 사다리 양끝 자동 추가: ${added.join(', ')} — 「없음」과 「최대」는 언제나 한 칸이다`);
console.log('');

// ── 자 검증 ① 기준선 게이트 — 균일 바닥 · 판 없음 ─────────────────────
const baseline = runRow({ label: '기준선', plate: 'none', margin: null }, PLAIN, null);
console.log(`기준선 (균일 바닥 244 · 판 없음): ${baseline.hits}/${baseline.tried} = ${(baseline.rate * 100).toFixed(1)}% · 셀px최소 ${baseline.cellPxMin} · ${topReasons(baseline.reasons)} · ${(baseline.ms / 1000).toFixed(1)}s`);
if (baseline.hits === 0) {
  console.log('❌ 기준선이 0/N — 대상이 아니라 자를 의심한다. 표를 만들지 않는다.');
  process.exit(1);
}
if (baseline.cellPxMin < CELL_PX_FLOOR) {
  console.log(`❌ 셀 px 최소 ${baseline.cellPxMin} < 하한 ${CELL_PX_FLOOR} — Y 판의 함정 ①. --ppu 를 올려라.`);
  process.exit(1);
}
// ── 자 검증 ② 무코드 프레임 — 판정기가 거짓 양성을 내지 않는가 ─────────
{
  const S = CANVAS; const px = new Uint8ClampedArray(S * S * 4); const g = GROUNDS[GROUND];
  for (let y = 0; y < S; y += 1) for (let x = 0; x < S; x += 1) { const c = g(x, y); const o = (y * S + x) * 4; px[o] = c.r; px[o + 1] = c.g; px[o + 2] = c.b; px[o + 3] = 255; }
  const v = judge(frameAt({ width: S, height: S, pixels: px }, GUIDE_OUTER_FRACTION).frame);
  console.log(`무코드 프레임 (바닥 ${GROUND} 만): ${v.ok ? '✓ ← 거짓 양성' : `✗ ${v.reason}`}`);
  if (v.ok) { console.log('❌ 코드 없는 프레임이 복호됐다 — 판정기 결함. 표를 만들지 않는다.'); process.exit(2); }
}
console.log('');

// ── 사다리 ─────────────────────────────────────────────────────────────
console.log(`── 사다리: 바닥 ${GROUND} · 판 ${PLATE_NAME} ──`);
console.log('행   판           margin  배수    clip  창덮임≥   셀px최소  성공률              실패 사유 상위 2                    초');
const results = [];
for (let i = 0; i < rows.length; i += 1) {
  const r = runRow(rows[i], GROUNDS[GROUND], `row${i}-${rows[i].plate}-${rows[i].margin ?? 'none'}`);
  results.push(r);
  const floorMark = r.cellPxMin < CELL_PX_FLOOR ? '🔴' : '  ';
  console.log(
    `${String(i + 1).padStart(2)}   ${r.label.padEnd(12)} ${String(r.margin ?? '—').padStart(6)}  ${r.multiple === null ? '  —  ' : r.multiple.toFixed(2).padStart(5)}`
    + `  ${r.clipped ? 'clip' : '    '}  ${r.coversWindowFrom === null ? '  없음 ' : `${(r.coversWindowFrom * 100).toFixed(0).padStart(4)}% `}`
    + `  ${floorMark}${r.cellPxMin.toFixed(1).padStart(5)}  ${`${r.hits}/${r.tried}`.padStart(6)} ${(r.rate * 100).toFixed(1).padStart(5)}%`
    + `   ${topReasons(r.reasons).padEnd(36)} ${(r.ms / 1000).toFixed(1).padStart(5)}`
    + (r.keyLeak ? `  ⚠ KEY 누출 ${r.keyLeak}px` : ''),
  );
}

// ── 몰림 경고 — Y 판이 자를 고친 두 신호 ────────────────────────────────
const rates = new Set(results.map((r) => r.hits));
if (results.length >= 3 && rates.size === 1) {
  console.log(`\n⚠ 모든 행이 ${[...rates][0]}/${OCCUPANCIES.length} 로 한 값이다 — 대상이 아니라 자를 의심하라 (Y 판 함정 ①②).`);
}

// ── JSON ───────────────────────────────────────────────────────────────
const out = {
  type: TYPE, version: versionLabel, k: encoded.k, n: encoded.n, ecc: encoded.eccLevel, payload: PAYLOAD, preset: P.name,
  plateArg: PLATE_ARG, plate: PLATE_NAME, autoNoPhoto: AUTO_NO_PHOTO, autoWithPhoto: AUTO_WITH_PHOTO,
  ground: GROUND, groundStats: GROUND_STATS, ppu: PPU, codePx: +CODE_PX.toFixed(1), cellsAcross: +CELLS_ACROSS.toFixed(2),
  canvasMarginUnits: CANVAS_MARGIN, compositeCanvasPx: CANVAS, occSpec: OCC_SPEC, occupancies: OCCUPANCIES,
  cellPxFloor: CELL_PX_FLOOR, autoTargetMultiple: AUTO_TARGET_MULTIPLE, autoMargin: AUTO_MARGIN,
  addedEnds: added, baseline, rows: results,
};
const outPath = path.join(OUT_DIR, `${TAG}.json`);
writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(`\nJSON → ${outPath}`);
