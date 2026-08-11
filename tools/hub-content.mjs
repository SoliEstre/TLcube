/**
 * content.mjs — 소개 허브(tl.estre.so)의 **언어별 문구 단일 원본**.
 *
 * 왜 파일 하나로 모으나: 한국어·영어·일본어 HTML 을 각각 손으로 들고 있으면 반드시
 * 어긋난다. 특히 스캐너 현황 표는 실측이 바뀔 때마다 갱신되는데, 세 벌을 따로 고치면
 * 한 언어만 옛 숫자를 남긴다 (AGENTS.md §9 인덱스 동기화 · §7 N-way sync 와 같은 위험).
 * 여기만 고치고 `node tools/build-hub.mjs` 를 돌리면 세 언어가 함께 간다.
 *
 * ⚠ **숫자는 여기서만 바꾼다.** 문구에 숫자를 하드코딩하지 말고 `stats` 를 참조하라.
 */

/** 실측 수치 — 세 언어가 공유한다. 값이 바뀌면 여기만 고친다. */
export const stats = {
  measuredOn: '2026-08-11',
  sampleCount: 9,
  shortSidePx: 1440,
  cellFloorPx: 9,
  ultraWideFailPx: 7.6,
  wideOkPx: 9.1,
  types: {
    Y: { decoded: '3 / 3', ms: '약 0.9초', msEn: '~0.9 s', msJa: '約 0.9 秒' },
    O: { decoded: '3 / 3', ms: '약 2.2초', msEn: '~2.2 s', msJa: '約 2.2 秒' },
    A: { decoded: '2 / 3', ms: '약 2.1초', msEn: '~2.1 s', msJa: '約 2.1 秒' },
  },
  centerQr: { decoded: '8 / 9' },
};

export const languages = [
  { code: 'ko', dir: '', label: '한국어', ogLocale: 'ko_KR', htmlLang: 'ko' },
  { code: 'en', dir: 'en/', label: 'English', ogLocale: 'en_US', htmlLang: 'en' },
  { code: 'ja', dir: 'ja/', label: '日本語', ogLocale: 'ja_JP', htmlLang: 'ja' },
];

export const strings = {
  ko: {
    title: 'TLcube — 휘도 순위로 데이터를 싣는 2.5D 시각 코드',
    description: '육각 셀을 마름모 3면으로 나누고, 세 면의 상대 휘도 순서에 데이터를 싣는 오픈 시각 코드. 스펙과 레퍼런스 구현은 Apache-2.0 으로 공개돼 있습니다.',
    ogTitle: 'TLcube — 휘도 순위로 데이터를 싣는 2.5D 시각 코드',
    ogDescription: '절대 밝기가 아니라 세 면의 순서에 데이터를 싣습니다. 조명이 흔들려도 순서만 지켜지면 살아남아요.',
    jsonHeadline: 'TLcube — 절대 밝기가 아니라 순서에 데이터를 싣는 2.5D 시각 코드',
    jsonDescription: '육각 셀을 마름모 3면으로 나누고 세 면의 상대 휘도 순서(3! = 6가지)를 base-6 심볼로 쓰는 오픈 시각 코드. 단조 톤 변형에 불변합니다.',

    navWhat: '무엇인가', navTypes: '타입', navStatus: '스캐너 현황', navSpec: '스펙',
    navGenerator: '생성기', navScanner: '스캐너',
    themeLabel: '테마', themeAuto: '자동', themeLight: '라이트', themeDark: '다크',
    langLabel: '언어',

    heroTitle: '절대 밝기가 아니라<br><strong>순서</strong>에 데이터를 싣습니다',
    heroLead: '육각 셀 하나를 마름모 3면으로 나누고, 세 면의 <strong>상대 휘도 순서</strong>(3! = 6가지)를 심볼 하나로 씁니다. 절대값이 아니라 순서라서 인쇄 톤 커브나 조명이 흔들려도 순서만 지켜지면 값이 살아남고 — 그렇게 그리면 아이소메트릭 큐브가 됩니다.',
    ctaMake: '코드 만들어보기',

    typesTitle: '타입 3종',
    typesLead: '같은 데이터 계약을 공유하고 실루엣만 다릅니다. 아래 코드에는 전부 <code>https://tl.estre.so</code> 가 들어 있어요.',
    typeYName: 'Type Y — 단일 큐브',
    typeYDesc: '세 면이 각각 n×n 격자. 한 덩어리라 간판·굿즈에 어울립니다.',
    typeYMeta: 'n = 13 / 21 / 25 · 순 페이로드 31 / 98 / 141 B',
    typeOName: 'Type O — 육각 필드',
    typeODesc: '가장 기본형. 중앙 파인더를 중심으로 마름모 셀이 깔립니다.',
    typeOMeta: 'k = 6 / 8 / 10 · 순 페이로드 18 / 39 / 65 B',
    typeAName: 'Type A — 삼각 실루엣',
    typeADesc: '육각 코어에 코너 패치를 더해 정삼각형이 됩니다.',
    typeAMeta: 'k = 6 / 8 / 10 · 순 페이로드 31 / 62 / 101 B',
    typesFoot: '순 페이로드는 ECC-M 기준이에요. 세 타입 모두 <strong>폴백 QR</strong> 을 함께 인쇄할 수 있어서, TL 코드를 못 읽는 환경에서도 최소한의 경로가 남습니다.',

    howTitle: '어떻게 동작하나',
    how1Title: '1. 셀 = 마름모 3면', how1Desc: '육각 셀을 rhombille 타일링으로 T·L·R 세 면으로 나눕니다.',
    how2Title: '2. 순서 = 심볼', how2Desc: '세 면의 휘도에 순위를 매기면 3! = 6가지 — base-6 digit 하나입니다.',
    how3Title: '3. 3 digit = 1 심볼', how3Desc: 'GF(211) 소수체 위의 Reed–Solomon 으로 오류를 정정합니다.',
    whyTitle: '왜 이렇게 만들었나',
    why1: '<strong>단조 변환에 불변합니다.</strong> 전역 조명 변화·감마·프린터 톤 매핑처럼 단조 증가하는 톤 변형은 순서를 바꾸지 못합니다. 순서만 보존되면 값이 삽니다.',
    why2: '<strong>렌더러가 자유롭습니다.</strong> 데이터 계약이 "면 사이의 순서 + 최소 분리폭" 뿐이라, 그 안에서 색·질감·면 그라데이션·애니메이션이 전부 열려 있습니다. 그 자유도가 이 포맷의 핵심이에요.',
    why3: '<strong>대신 밀도는 포기했습니다.</strong> 마름모 셀은 정사각 모듈보다 면적 효율이 불리합니다. 이 포맷은 밀도 경쟁을 하지 않아요. QR 을 대체하려는 게 아니라 옆자리를 하나 만드는 겁니다.',

    statusTitle: '스캐너 개발 현황',
    statusLead: '디코더는 개발 중입니다. 아래는 <strong>실기기 촬영 사진</strong>으로 잰 현재 상태예요 — 합성 테스트가 아니라 실제 스마트폰 카메라 결과입니다.',
    thType: '타입', thDecoded: '실사진 복호', thTime: '복호 시간', thRealtime: '실시간 스캔',
    rowYName: '<strong>Type Y</strong> — 단일 큐브',
    rowOName: '<strong>Type O</strong> — 육각 필드',
    rowAName: '<strong>Type A</strong> — 삼각 실루엣',
    rowCenterQr: '<strong>중앙 QR 변형</strong> (세 타입 공통)',
    badgeUsable: '쓸 만함', badgeSlow: '느림',
    statusNote1: '복호 시간이 실시간 스캔 체감을 지배합니다. 스캐너는 프레임을 약 0.3초 간격으로 보는데 한 번 읽는 데 몇 초가 걸리면 그동안 프레임이 버려져서, 정확도와 무관하게 <strong>“어쩌다 한 번 읽히는”</strong> 느낌이 됩니다. 그래서 지금은 속도가 최우선 과제예요.',
    statusNote2: `촬영 조건도 크게 작용합니다. 실측에서 <strong>셀당 ${stats.cellFloorPx}픽셀</strong>이 복호 하한이었고, 같은 거리라도 <strong>초광각 렌즈</strong>로 찍으면 코드가 작게 담겨 이 선 아래로 내려갔어요 (초광각 ${stats.ultraWideFailPx}px 실패 / 광각 ${stats.wideOkPx}px 성공). 스캐너에 렌즈 선택을 넣어 둔 이유입니다.`,
    statusNote3: '<strong>중앙 QR 변형</strong>은 QR 블록이 중앙 파인더 자리를 대신하는 형태예요. 진입점이 없어 한동안 못 읽었는데, QR 자신의 파인더를 기준점으로 삼는 경로를 넣어 이제 읽힙니다.',
    statusFoot: `측정 ${stats.measuredOn} · 표본은 스마트폰 3개 센서(초광각·광각·망원)로 찍은 사진 ${stats.sampleCount}장 · 짧은 변 ${stats.shortSidePx}px 기준. 표본이 작아 성공률이 아니라 <em>현재 상태</em>로 읽어 주세요.`,

    specTitle: '스펙과 구현',
    spec1: '포맷 스펙과 레퍼런스 구현은 <strong>Apache License 2.0</strong> 으로 공개돼 있습니다. 바닐라 JavaScript, 빌드 툴체인 없음, 런타임 의존성 0 — 단일 HTML 파일로 동작합니다.',
    spec2: '<strong>디코더만 구현해도 적합 구현</strong>입니다. 확산은 읽는 쪽부터 시작하니까요.',
    ctaSpec: '포맷 스펙 읽기', ctaImpl: '레퍼런스 구현',
    thSite: '사이트', thRole: '역할', thState: '상태',
    roleGenerator: '생성기', roleScanner: '스캐너', roleHub: '소개 허브',
    stateWorking: '동작', stateHere: '여기', stateDev: '개발 중 — 현황 ›',
    footerTrademark: 'QR Code is a registered trademark of DENSO WAVE INCORPORATED.',
    footerCopyright: '© 2026 SoliEstre — TrilLuminance (cube) · 코드네임 Trilume',
  },

  en: {
    title: 'TLcube — a 2.5D visual code that carries data in luminance rank',
    description: 'An open visual code that splits a hexagonal cell into three rhombic faces and carries data in the relative luminance order of those faces. Spec and reference implementation are published under Apache-2.0.',
    ogTitle: 'TLcube — a 2.5D visual code that carries data in luminance rank',
    ogDescription: 'Data rides on the order of three faces, not on absolute brightness. As long as the order survives, so does the value.',
    jsonHeadline: 'TLcube — a 2.5D visual code carrying data in rank, not absolute brightness',
    jsonDescription: 'An open visual code that splits a hexagonal cell into three rhombic faces and uses their relative luminance order (3! = 6) as one base-6 symbol. Invariant under monotonic tone transforms.',

    navWhat: 'How it works', navTypes: 'Types', navStatus: 'Scanner status', navSpec: 'Spec',
    navGenerator: 'Generator', navScanner: 'Scanner',
    themeLabel: 'Theme', themeAuto: 'Auto', themeLight: 'Light', themeDark: 'Dark',
    langLabel: 'Language',

    heroTitle: 'Data rides on <strong>order</strong>,<br>not on absolute brightness',
    heroLead: 'One hexagonal cell splits into three rhombic faces, and the <strong>relative luminance order</strong> of those faces (3! = 6) becomes a single symbol. Because it is order rather than absolute value, a print tone curve or shifting light cannot break it as long as the ordering holds — and drawn that way, it looks like an isometric cube.',
    ctaMake: 'Make a code',

    typesTitle: 'Three types',
    typesLead: 'They share one data contract and differ only in silhouette. Every code below encodes <code>https://tl.estre.so</code>.',
    typeYName: 'Type Y — single cube',
    typeYDesc: 'Three n×n faces. A single solid mark, good for signage and merch.',
    typeYMeta: 'n = 13 / 21 / 25 · net payload 31 / 98 / 141 B',
    typeOName: 'Type O — hex field',
    typeODesc: 'The base form. Rhombic cells tile outward from a central finder.',
    typeOMeta: 'k = 6 / 8 / 10 · net payload 18 / 39 / 65 B',
    typeAName: 'Type A — triangular silhouette',
    typeADesc: 'A hexagonal core plus corner patches, forming an equilateral triangle.',
    typeAMeta: 'k = 6 / 8 / 10 · net payload 31 / 62 / 101 B',
    typesFoot: 'Net payload is at ECC-M. All three types can carry a <strong>fallback QR</strong> alongside, so there is still a path where a TL code cannot be read.',

    howTitle: 'How it works',
    how1Title: '1. Cell = three rhombi', how1Desc: 'A rhombille tiling splits each hexagonal cell into T, L and R faces.',
    how2Title: '2. Order = symbol', how2Desc: 'Ranking the three luminances gives 3! = 6 outcomes — one base-6 digit.',
    how3Title: '3. 3 digits = 1 symbol', how3Desc: 'Reed–Solomon over the prime field GF(211) corrects errors.',
    whyTitle: 'Why build it this way',
    why1: '<strong>Invariant under monotonic transforms.</strong> Global lighting shifts, gamma, and printer tone mapping are monotonic — they cannot change an ordering. If the order survives, the value survives.',
    why2: '<strong>The renderer stays free.</strong> The data contract is only "the order between faces, plus a minimum separation". Inside that, colour, texture, per-face gradients and animation are all open. That freedom is the point of the format.',
    why3: '<strong>Density was the trade.</strong> Rhombic cells are less area-efficient than square modules. This format does not compete on density. It is not trying to replace QR — it is trying to sit next to it.',

    statusTitle: 'Scanner status',
    statusLead: 'The decoder is under development. The numbers below come from <strong>photos taken on real phones</strong> — not synthetic test renders.',
    thType: 'Type', thDecoded: 'Real photos decoded', thTime: 'Decode time', thRealtime: 'Live scanning',
    rowYName: '<strong>Type Y</strong> — single cube',
    rowOName: '<strong>Type O</strong> — hex field',
    rowAName: '<strong>Type A</strong> — triangular silhouette',
    rowCenterQr: '<strong>Centre-QR variant</strong> (all three types)',
    badgeUsable: 'usable', badgeSlow: 'slow',
    statusNote1: 'Decode time dominates how live scanning feels. The scanner looks at a frame roughly every 0.3 s, so when one read takes several seconds the frames in between are dropped — and regardless of accuracy it feels like it <strong>“only reads once in a while”</strong>. Speed is the top priority right now.',
    statusNote2: `Shooting conditions matter too. Measured, <strong>${stats.cellFloorPx} pixels per cell</strong> was the decode floor, and at the same distance an <strong>ultra-wide lens</strong> frames the code smaller and drops below that line (ultra-wide ${stats.ultraWideFailPx} px failed / wide ${stats.wideOkPx} px succeeded). That is why the scanner offers a lens picker.`,
    statusNote3: 'In the <strong>centre-QR variant</strong> a QR block takes the place of the central finder. It was unreadable for a while because there was no entry point; a path that uses the QR’s own finder patterns as reference now handles it.',
    statusFoot: `Measured ${stats.measuredOn} · sample of ${stats.sampleCount} photos across three phone sensors (ultra-wide, wide, telephoto) · short side ${stats.shortSidePx} px. The sample is small — read this as a <em>current state</em>, not a success rate.`,

    specTitle: 'Spec and implementation',
    spec1: 'The format spec and reference implementation are published under the <strong>Apache License 2.0</strong>. Vanilla JavaScript, no build toolchain, zero runtime dependencies — it runs as a single HTML file.',
    spec2: '<strong>Implementing only the decoder counts as a conforming implementation.</strong> Adoption starts with the reading side.',
    ctaSpec: 'Read the spec', ctaImpl: 'Reference implementation',
    thSite: 'Site', thRole: 'Role', thState: 'State',
    roleGenerator: 'Generator', roleScanner: 'Scanner', roleHub: 'Overview hub',
    stateWorking: 'live', stateHere: 'you are here', stateDev: 'in development — status ›',
    footerTrademark: 'QR Code is a registered trademark of DENSO WAVE INCORPORATED.',
    footerCopyright: '© 2026 SoliEstre — TrilLuminance (cube) · codename Trilume',
  },

  ja: {
    title: 'TLcube — 輝度の順序でデータを載せる 2.5D ビジュアルコード',
    description: '六角形のセルを 3 つの菱形の面に分け、面どうしの相対輝度の順序にデータを載せるオープンなビジュアルコード。仕様とリファレンス実装は Apache-2.0 で公開しています。',
    ogTitle: 'TLcube — 輝度の順序でデータを載せる 2.5D ビジュアルコード',
    ogDescription: '絶対的な明るさではなく、3 面の順序にデータを載せます。順序さえ保たれれば値は生き残ります。',
    jsonHeadline: 'TLcube — 絶対輝度ではなく順序にデータを載せる 2.5D ビジュアルコード',
    jsonDescription: '六角形のセルを 3 つの菱形の面に分け、その相対輝度の順序（3! = 6 通り）を base-6 シンボル 1 つとして使うオープンなビジュアルコード。単調なトーン変換に対して不変です。',

    navWhat: '仕組み', navTypes: 'タイプ', navStatus: 'スキャナ状況', navSpec: '仕様',
    navGenerator: 'ジェネレータ', navScanner: 'スキャナ',
    themeLabel: 'テーマ', themeAuto: '自動', themeLight: 'ライト', themeDark: 'ダーク',
    langLabel: '言語',

    heroTitle: '絶対的な明るさではなく<br><strong>順序</strong>にデータを載せます',
    heroLead: '六角形のセル 1 つを 3 つの菱形の面に分け、面どうしの<strong>相対輝度の順序</strong>（3! = 6 通り）をシンボル 1 つとして使います。絶対値ではなく順序なので、印刷のトーンカーブや照明が揺らいでも順序さえ保たれれば値は生き残り — そう描くとアイソメトリックな立方体になります。',
    ctaMake: 'コードを作ってみる',

    typesTitle: '3 つのタイプ',
    typesLead: '同じデータ契約を共有し、シルエットだけが異なります。以下のコードにはすべて <code>https://tl.estre.so</code> が入っています。',
    typeYName: 'Type Y — 単一キューブ',
    typeYDesc: '3 面がそれぞれ n×n の格子。ひと塊なので看板やグッズに向きます。',
    typeYMeta: 'n = 13 / 21 / 25 · 正味ペイロード 31 / 98 / 141 B',
    typeOName: 'Type O — 六角フィールド',
    typeODesc: '最も基本の形。中央のファインダを中心に菱形セルが広がります。',
    typeOMeta: 'k = 6 / 8 / 10 · 正味ペイロード 18 / 39 / 65 B',
    typeAName: 'Type A — 三角シルエット',
    typeADesc: '六角のコアにコーナーパッチを足して正三角形になります。',
    typeAMeta: 'k = 6 / 8 / 10 · 正味ペイロード 31 / 62 / 101 B',
    typesFoot: '正味ペイロードは ECC-M 基準です。3 タイプとも<strong>フォールバック QR</strong> を併記でき、TL コードが読めない環境でも最低限の経路が残ります。',

    howTitle: '仕組み',
    how1Title: '1. セル = 3 つの菱形', how1Desc: 'rhombille タイリングで六角セルを T・L・R の 3 面に分けます。',
    how2Title: '2. 順序 = シンボル', how2Desc: '3 面の輝度に順位をつけると 3! = 6 通り — base-6 の 1 桁です。',
    how3Title: '3. 3 桁 = 1 シンボル', how3Desc: '素体 GF(211) 上の Reed–Solomon で誤りを訂正します。',
    whyTitle: 'なぜこの作りなのか',
    why1: '<strong>単調変換に対して不変です。</strong> 全体的な照明の変化・ガンマ・プリンタのトーンマッピングは単調なので、順序を入れ替えられません。順序が保たれれば値は生きます。',
    why2: '<strong>レンダラが自由です。</strong> データ契約は「面どうしの順序 + 最小分離幅」だけ。その中で色・質感・面のグラデーション・アニメーションがすべて開いています。この自由度こそがこのフォーマットの核心です。',
    why3: '<strong>代わりに密度は捨てました。</strong> 菱形セルは正方モジュールより面積効率で不利です。このフォーマットは密度で競いません。QR を置き換えるのではなく、隣にもう一席つくるものです。',

    statusTitle: 'スキャナ開発状況',
    statusLead: 'デコーダは開発中です。以下は<strong>実機で撮影した写真</strong>で測った現在の状態で、合成テストではなく実際のスマートフォンのカメラの結果です。',
    thType: 'タイプ', thDecoded: '実写真の復号', thTime: '復号時間', thRealtime: 'リアルタイム',
    rowYName: '<strong>Type Y</strong> — 単一キューブ',
    rowOName: '<strong>Type O</strong> — 六角フィールド',
    rowAName: '<strong>Type A</strong> — 三角シルエット',
    rowCenterQr: '<strong>中央 QR 変種</strong>（3 タイプ共通）',
    badgeUsable: '実用的', badgeSlow: '遅い',
    statusNote1: '復号時間がリアルタイム性の体感を左右します。スキャナは約 0.3 秒ごとにフレームを見ますが、1 回の読み取りに数秒かかるとその間のフレームは捨てられ、精度とは無関係に<strong>「たまにしか読めない」</strong>感覚になります。いまは速度が最優先課題です。',
    statusNote2: `撮影条件も大きく効きます。実測では<strong>セルあたり ${stats.cellFloorPx} ピクセル</strong>が復号の下限で、同じ距離でも<strong>超広角レンズ</strong>で撮るとコードが小さく写ってこの線を下回りました（超広角 ${stats.ultraWideFailPx}px 失敗 / 広角 ${stats.wideOkPx}px 成功）。スキャナにレンズ選択を入れているのはそのためです。`,
    statusNote3: '<strong>中央 QR 変種</strong>は QR ブロックが中央ファインダの位置を代わりに占める形です。入口がなくしばらく読めませんでしたが、QR 自身のファインダを基準にする経路を入れて読めるようになりました。',
    statusFoot: `測定 ${stats.measuredOn} · 標本はスマートフォンの 3 つのセンサー（超広角・広角・望遠）で撮った写真 ${stats.sampleCount} 枚 · 短辺 ${stats.shortSidePx}px 基準。標本が小さいので成功率ではなく<em>現在の状態</em>として読んでください。`,

    specTitle: '仕様と実装',
    spec1: 'フォーマット仕様とリファレンス実装は <strong>Apache License 2.0</strong> で公開しています。バニラ JavaScript、ビルドツールチェーンなし、ランタイム依存 0 — 単一の HTML ファイルで動きます。',
    spec2: '<strong>デコーダだけの実装でも適合実装</strong>とみなします。普及は読む側から始まるからです。',
    ctaSpec: '仕様を読む', ctaImpl: 'リファレンス実装',
    thSite: 'サイト', thRole: '役割', thState: '状態',
    roleGenerator: 'ジェネレータ', roleScanner: 'スキャナ', roleHub: '紹介ハブ',
    stateWorking: '稼働中', stateHere: 'ここ', stateDev: '開発中 — 状況 ›',
    footerTrademark: 'QR Code is a registered trademark of DENSO WAVE INCORPORATED.',
    footerCopyright: '© 2026 SoliEstre — TrilLuminance (cube) · コードネーム Trilume',
  },
};
