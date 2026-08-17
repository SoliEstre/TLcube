/**
 * claude-v0t-i18n-apply.mjs — index.html i18n 기계 수술 (v0T 프로그램 레인, 2026-08-17).
 *
 * 하는 일 (한 번만 — 멱등: 이미 적용돼 있으면 무변경으로 끝난다):
 *   ① g965 (QR 위치 «면» 카드 부제) — 전 언어 «(v0WY)» → «(v0TY)» + HTML 기본 텍스트.
 *   ② g964 (해상도 연동 힌트) — 전 언어 «중 = v0W (v0WQ …)» → «중 = v0T (v0TY …)».
 *   ③ 신규 키 g993~g998 (v0T·v0TY 카드 라벨·부제·설명) — 각 언어의 g968 뒤에 삽입.
 *
 * 왜 스크립트인가: 8언어 × 6키 = 48 문자열 삽입은 손 편집이 어긋나기 쉽고,
 * 이 파일이 곧 «무엇을 어떻게 바꿨나» 의 감사 기록이 된다.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const PATH = new URL('../../../index.html', import.meta.url);
let text = readFileSync(PATH, 'utf8');
const before = text;

// ── ① g965 — 값 교체 (8언어 + HTML 기본 텍스트) ─────────────────────────
for (const [from, to] of [
  ['먼 코너 (v0WY)', '먼 코너 (v0TY)'],
  ['Far corner (v0WY)', 'Far corner (v0TY)'],
  ['遠コーナー (v0WY)', '遠コーナー (v0TY)'],
  ['Coin éloigné (v0WY)', 'Coin éloigné (v0TY)'],
  ['Angolo lontano (v0WY)', 'Angolo lontano (v0TY)'],
  ['Ferne Ecke (v0WY)', 'Ferne Ecke (v0TY)'],
  ['Esquina lejana (v0WY)', 'Esquina lejana (v0TY)'],
  ['Canto distante (v0WY)', 'Canto distante (v0TY)'],
]) text = text.split(from).join(to);

// ── ② g964 — 연동 문구의 v0W/v0WQ 구간 교체 (8언어) ─────────────────────
for (const [from, to] of [
  ['중 = v0W (QR 안쪽 배치면 v0WQ)', '중 = v0T (QR 위치가 «면» 이면 v0TY)'],
  ['Mid = v0W (v0WQ when the QR sits inside)', 'Mid = v0T (v0TY when the QR position is "Face")'],
  ['中 = v0W（QR が内側配置なら v0WQ）', '中 = v0T（QR 位置が「面」なら v0TY）'],
  ["Moyenne = v0W (v0WQ si le QR est à l'intérieur)", "Moyenne = v0T (v0TY si la position du QR est « Face »)"],
  ["Media = v0W (v0WQ se il QR sta all'interno)", "Media = v0T (v0TY se la posizione del QR è «Faccia»)"],
  ['Mittel = v0W (v0WQ, wenn der QR innen sitzt)', 'Mittel = v0T (v0TY, wenn die QR-Position „Fläche“ ist)'],
  ['Media = v0W (v0WQ si el QR va dentro)', 'Media = v0T (v0TY si la posición del QR es «Cara»)'],
  ['Média = v0W (v0WQ se o QR ficar por dentro)', 'Média = v0T (v0TY se a posição do QR for «Face»)'],
]) text = text.split(from).join(to);

// ── ③ 신규 키 삽입 — 각 언어 블록의 g968 라인 뒤 ────────────────────────
const NEW_KEYS = {
  ko: {
    g993: '셀 표면 v0T (Y1)',
    g994: 'v0T. Type Y 최종 파인더예요 — K3 계보 중앙 16셀 + 안쪽 비대칭 블록 9셀 + 북쪽 팔 10셀 + 3코너 동심 사각 36셀 + 서쪽 블록 24셀 + 먼 코너 위상 마커 9셀 = 104셀 · 데이터 307. 방향 판별 블록을 안쪽과 먼 코너에 하나씩 일부러 둘 뒀어요 — 파생 슬롯이 한쪽을 덮어도 나머지가 방향을 줘요. 방향 여유(margin)는 0.096 이에요. Y1(n=21) 전용이며 성능을 보장하지 않아요.',
    g995: '전면 6블록',
    g996: '셀 표면 v0TY · 먼 코너 QR (Y1)',
    g997: 'v0TY. v0T 파생 — QR 을 큐브 안쪽 먼 코너(T면 위 꼭짓점)에 8×8셀 슬롯으로 묻어요. 슬롯이 v0T 의 먼 코너 위상 마커 9셀을 덮지만, 안쪽 비대칭 블록 9셀이 남아 방향을 줘요 — 두 방향 블록은 그러라고 둔 의도된 이중화예요. 파인더 95셀 · 슬롯 64셀 · 데이터 252 예요. QR 위치에서 «면» 을 고르면 이 검출기로 바뀌어요. Y1(n=21) 전용이며 성능을 보장하지 않아요.',
    g998: '전면 + 먼 코너 QR',
  },
  en: {
    g993: 'Cell surface v0T (Y1)',
    g994: 'v0T. The final Type Y finder — a K3-lineage centre (16 cells), an inner asymmetric block (9 cells), a north arm (10 cells), concentric squares on the three seam corners (36 cells), a west block (24 cells) and a far-corner phase marker (9 cells) — 104 cells, 307 data. Two orientation blocks are placed on purpose, one inner and one at the far corner, so a derivative slot can cover either one and the other still gives the orientation. Orientation margin 0.096. Y1 (n=21) only; does not guarantee performance.',
    g995: 'Six-block full surface',
    g996: 'Cell surface v0TY · far-corner QR (Y1)',
    g997: 'v0TY. The v0T derivative — the QR is buried inside the cube at the far corner (the top vertex of the T face) in an 8×8-cell slot. The slot covers v0T’s far-corner phase marker (9 cells), but the inner asymmetric block (9 cells) remains and gives the orientation — the two orientation blocks are an intentional redundancy for exactly this. 95 finder cells, a 64-cell slot, 252 data. Choosing "Face" for the QR position switches to this detector. Y1 (n=21) only; does not guarantee performance.',
    g998: 'Full surface + far-corner QR',
  },
  ja: {
    g993: 'セル表面 v0T (Y1)',
    g994: 'v0T。Type Y の最終ファインダです — K3 系譜の中央 16セル + 内側の非対称ブロック 9セル + 北の腕 10セル + 3コーナー同心四角 36セル + 西ブロック 24セル + 遠コーナー位相マーカー 9セル = 104セル・データ307。方向判別ブロックを内側と遠コーナーに意図的に2つ置いており、派生スロットが一方を覆っても残りが方向を与えます。方向余裕（margin）は 0.096 です。Y1(n=21) 専用で、性能は保証しません。',
    g995: '全面6ブロック',
    g996: 'セル表面 v0TY・遠コーナーQR (Y1)',
    g997: 'v0TY。v0T 派生 — QR をキューブ内側の遠コーナー（T面の上頂点）に 8×8 セルのスロットとして埋めます。スロットは v0T の遠コーナー位相マーカー 9 セルを覆いますが、内側の非対称ブロック 9 セルが残って方向を与えます — 2 つの方向ブロックはそのための意図的な二重化です。ファインダ 95 セル・スロット 64 セル・データ 252。QR 位置で「面」を選ぶとこの検出器に切り替わります。Y1 (n=21) 専用で、性能を保証しません。',
    g998: '全面＋遠コーナーQR',
  },
  fr: {
    g993: 'Surface de cellules v0T (Y1)',
    g994: "v0T. Le motif final du Type Y — un centre de lignée K3 (16 cellules), un bloc asymétrique intérieur (9 cellules), un bras nord (10 cellules), des carrés concentriques sur les trois angles de couture (36 cellules), un bloc ouest (24 cellules) et un marqueur de phase au coin éloigné (9 cellules) — 104 cellules · données 307. Deux blocs d'orientation sont placés à dessein, l'un à l'intérieur, l'autre au coin éloigné : un emplacement dérivé peut couvrir l'un, l'autre donne encore l'orientation. Marge d'orientation 0,096. Réservé à Y1 (n=21) ; ne garantit pas les performances.",
    g995: 'Pleine surface, six blocs',
    g996: 'Surface de cellules v0TY · QR au coin éloigné (Y1)',
    g997: "v0TY. Dérivé de v0T — le QR est enfoui dans le cube, au coin éloigné (le sommet supérieur de la face T), dans un emplacement de 8×8 cellules. L'emplacement couvre le marqueur de phase du coin éloigné de v0T (9 cellules), mais le bloc asymétrique intérieur (9 cellules) reste et donne l'orientation — les deux blocs d'orientation sont une redondance voulue, exactement pour cela. 95 cellules de motif, un emplacement de 64 cellules, 252 données. Si vous choisissez « Face » comme position du QR, ce détecteur est activé. Y1 (n=21) uniquement ; les performances ne sont pas garanties.",
    g998: 'Pleine surface + QR au coin éloigné',
  },
  it: {
    g993: 'Superficie a celle v0T (Y1)',
    g994: "v0T. Il finder definitivo del Type Y — un centro di lignaggio K3 (16 celle), un blocco asimmetrico interno (9 celle), un braccio nord (10 celle), quadrati concentrici sui tre angoli di giunzione (36 celle), un blocco ovest (24 celle) e un marcatore di fase nell'angolo lontano (9 celle) — 104 celle · dati 307. Due blocchi di orientamento sono messi apposta, uno interno e uno nell'angolo lontano: uno slot derivato può coprirne uno e l'altro dà ancora l'orientamento. Margine di orientamento 0,096. Riservato a Y1 (n=21); non garantisce le prestazioni.",
    g995: 'Piena superficie, sei blocchi',
    g996: 'Superficie a celle v0TY · QR nell’angolo lontano (Y1)',
    g997: "v0TY. Derivato di v0T — il QR è sepolto dentro il cubo nell’angolo lontano (il vertice superiore della faccia T) in uno slot di 8×8 celle. Lo slot copre il marcatore di fase dell’angolo lontano di v0T (9 celle), ma il blocco asimmetrico interno (9 celle) resta e dà l’orientamento — i due blocchi di orientamento sono una ridondanza voluta, esattamente per questo. 95 celle di pattern, uno slot di 64 celle, 252 dati. Se scegli «Faccia» come posizione del QR, passi a questo rilevatore. Solo Y1 (n=21); le prestazioni non sono garantite.",
    g998: 'Piena superficie + QR angolo lontano',
  },
  de: {
    g993: 'Zellfläche v0T (Y1)',
    g994: 'v0T. Der endgültige Type-Y-Finder — ein Zentrum der K3-Linie (16 Zellen), ein innerer asymmetrischer Block (9 Zellen), ein Nordarm (10 Zellen), konzentrische Quadrate an den drei Nahtecken (36 Zellen), ein Westblock (24 Zellen) und ein Phasenmarker an der fernen Ecke (9 Zellen) — 104 Zellen · Daten 307. Zwei Orientierungsblöcke sind absichtlich gesetzt, einer innen und einer an der fernen Ecke: Deckt ein abgeleiteter Slot den einen ab, gibt der andere weiterhin die Orientierung. Orientierungsmarge 0,096. Nur für Y1 (n=21); Leistung wird nicht zugesichert.',
    g995: 'Volle Fläche, sechs Blöcke',
    g996: 'Zellfläche v0TY · QR in der fernen Ecke (Y1)',
    g997: 'v0TY. Das v0T-Derivat — der QR liegt im Würfel an der fernen Ecke (der oberen Spitze der T-Fläche) in einem Slot von 8×8 Zellen. Der Slot deckt v0Ts Phasenmarker an der fernen Ecke (9 Zellen) ab, aber der innere asymmetrische Block (9 Zellen) bleibt und gibt die Orientierung — die zwei Orientierungsblöcke sind genau dafür eine gewollte Redundanz. 95 Finder-Zellen, ein 64-Zellen-Slot, 252 Daten. Wird als QR-Position „Fläche“ gewählt, schaltet dieser Detektor ein. Nur für Y1 (n=21); Leistung wird nicht zugesichert.',
    g998: 'Volle Fläche + QR ferne Ecke',
  },
  es: {
    g993: 'Superficie de celdas v0T (Y1)',
    g994: 'v0T. El localizador definitivo del Type Y — un centro del linaje K3 (16 celdas), un bloque asimétrico interior (9 celdas), un brazo norte (10 celdas), cuadrados concéntricos en las tres esquinas de costura (36 celdas), un bloque oeste (24 celdas) y un marcador de fase en la esquina lejana (9 celdas) — 104 celdas · datos 307. Hay dos bloques de orientación puestos a propósito, uno interior y otro en la esquina lejana: una ranura derivada puede tapar uno y el otro sigue dando la orientación. Margen de orientación 0,096. Solo Y1 (n=21); no se garantiza el rendimiento.',
    g995: 'Superficie completa, seis bloques',
    g996: 'Superficie de celdas v0TY · QR en la esquina lejana (Y1)',
    g997: 'v0TY. El derivado de v0T — el QR queda enterrado dentro del cubo en la esquina lejana (el vértice superior de la cara T) en una ranura de 8×8 celdas. La ranura tapa el marcador de fase de la esquina lejana de v0T (9 celdas), pero el bloque asimétrico interior (9 celdas) queda y da la orientación — los dos bloques de orientación son una redundancia intencionada exactamente para esto. 95 celdas de patrón, una ranura de 64 celdas, 252 datos. Si elige «Cara» como posición del QR, se cambia a este detector. Solo Y1 (n=21); no se garantiza el rendimiento.',
    g998: 'Superficie completa + QR esquina lejana',
  },
  pt: {
    g993: 'Superfície de células v0T (Y1)',
    g994: 'v0T. O localizador definitivo do Type Y — um centro da linhagem K3 (16 células), um bloco assimétrico interior (9 células), um braço norte (10 células), quadrados concêntricos nos três cantos de costura (36 células), um bloco oeste (24 células) e um marcador de fase no canto distante (9 células) — 104 células · dados 307. Há dois blocos de orientação postos de propósito, um interior e outro no canto distante: uma ranhura derivada pode cobrir um e o outro continua a dar a orientação. Margem de orientação 0,096. Apenas Y1 (n=21); o desempenho não é garantido.',
    g995: 'Superfície completa, seis blocos',
    g996: 'Superfície de células v0TY · QR no canto distante (Y1)',
    g997: 'v0TY. O derivado do v0T — o QR fica enterrado dentro do cubo no canto distante (o vértice superior da face T) numa ranhura de 8×8 células. A ranhura cobre o marcador de fase do canto distante do v0T (9 células), mas o bloco assimétrico interior (9 células) permanece e dá a orientação — os dois blocos de orientação são uma redundância intencional exatamente para isso. 95 células de padrão, uma ranhura de 64 células, 252 dados. Se escolher «Face» como posição do QR, passa para este detetor. Apenas Y1 (n=21); o desempenho não é garantido.',
    g998: 'Superfície completa + QR canto distante',
  },
};
const LANGS = ['ko', 'en', 'ja', 'fr', 'it', 'de', 'es', 'pt'];
if (!text.includes('"g993"')) {
  const lines = text.split('\n');
  let langIndex = 0;
  const out = [];
  for (const line of lines) {
    out.push(line);
    if (line.includes('"g968":')) {
      const lang = LANGS[langIndex];
      if (!lang) throw new Error('g968 이 언어 수(8)보다 많이 나왔다');
      const entries = NEW_KEYS[lang];
      const indent = line.match(/^(\s*)/)[1];
      for (const key of ['g993', 'g994', 'g995', 'g996', 'g997', 'g998']) {
        out.push(indent + JSON.stringify(key) + ': ' + JSON.stringify(entries[key]) + ',');
      }
      langIndex += 1;
    }
  }
  if (langIndex !== 8) throw new Error('g968 앵커가 8개가 아니다: ' + langIndex);
  text = out.join('\n');
}

if (text === before) {
  console.log('무변경 — 이미 적용된 상태다.');
} else {
  writeFileSync(PATH, text);
  const added = (text.match(/"g993":/g) || []).length;
  console.log('적용 완료 — g993 삽입 ' + added + '언어 · g965/g964 교체 완료.');
}
