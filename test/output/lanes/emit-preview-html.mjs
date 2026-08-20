import fs from 'node:fs';

const DIR = new URL('./preview/', import.meta.url);
const IMG = JSON.parse(fs.readFileSync(new URL('./images.json', DIR), 'utf8'));

const CONCEPTS = [
  {
    id: 'O-CM', label: 'O-CM', sub: 'Type O · 순수 육각',
    centre: '불스아이 (기존 그대로)',
    where: '육각 <strong>변</strong> 위 교대 3곳',
    cells: '12셀 (앵커 3 + 마커 9)',
    cost: '<strong>데이터 셀을 파먹는다</strong>',
    origin: '명부 근거 <strong>없음</strong> — A-CM 을 유비로 옮긴 것',
  },
  {
    id: 'A-CM', label: 'A-CM', sub: 'Type A · 삼각 확장부',
    centre: '불스아이 (기존 그대로)',
    where: '삼각 <strong>꼭짓점</strong> 3곳',
    cells: '21셀 (링 18 + 중심 3)',
    cost: '확장부라 데이터 손실이 작다',
    origin: 'H2O 의 <code>detector</code> 18셀을 떼어 온 것',
  },
  {
    id: 'H2O', label: 'H2O', sub: '정본 후보 원형',
    centre: '<strong>3톤 큐브</strong> (finderStarter)',
    where: '삼각 꼭짓점 3곳 — A-CM 과 <strong>동일</strong>',
    cells: '21셀 — A-CM 과 <strong>동일</strong>',
    cost: '〃',
    origin: '<code>finderMode: central-finder</code> — <strong>파인더는 중앙</strong>',
  },
];
const KS = [6, 8, 10];

const shot = (id, k, mode) => '\n        <figure class="shot">'
  + '<img src="' + IMG[id + (mode === 'hl' ? '-hl-k' : '-k') + k] + '" alt="' + id + ' k=' + k + '" loading="lazy">'
  + '<figcaption>k=' + k + '</figcaption></figure>';

const grid = (mode) => CONCEPTS.map((c) => '\n      <div class="row">'
  + '<div class="rowhead"><h3>' + c.label + '</h3><p class="sub">' + c.sub + '</p></div>'
  + '<div class="shots">' + KS.map((k) => shot(c.id, k, mode)).join('') + '</div>'
  + '</div>').join('');

const col = (pick) => CONCEPTS.map((c) => '<td>' + pick(c) + '</td>').join('');

const html = `<title>마커 개념 비교</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{
  --ground:#0e1018; --surface:#171a26; --raise:#1e2231;
  --ink:#dce4f0; --dim:#8794b0; --faint:#5c667f;
  --mark:#ff5c3a; --rule:#262c42; --blue:#7994d1;
  --sans:"IBM Plex Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
  --mono:"IBM Plex Mono",ui-monospace,"SFMono-Regular",Menlo,monospace;
}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--sans);
  font-size:16px;line-height:1.6;-webkit-font-smoothing:antialiased}
.wrap{max-width:1180px;margin:0 auto;padding:56px 24px 96px;display:flex;flex-direction:column;gap:44px}
header{display:flex;flex-direction:column;gap:12px;border-bottom:1px solid var(--rule);padding-bottom:28px}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--faint);margin:0}
h1{margin:0;font-size:clamp(28px,4vw,40px);font-weight:600;letter-spacing:-.02em;text-wrap:balance}
.lede{margin:0;max-width:64ch;color:var(--dim)}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:1px;background:var(--rule);
  border:1px solid var(--rule);border-radius:10px;overflow:hidden}
.fact{background:var(--surface);padding:20px 22px;display:flex;flex-direction:column;gap:6px}
.fact b{font-family:var(--mono);font-size:22px;font-weight:500;color:var(--mark);font-variant-numeric:tabular-nums}
.fact span{font-size:14px;color:var(--dim)}
section{display:flex;flex-direction:column;gap:20px}
h2{margin:0;font-size:20px;font-weight:600;letter-spacing:-.01em}
h2 .note{font-weight:400;color:var(--faint);font-size:14px;margin-left:10px}
.row{display:grid;grid-template-columns:190px 1fr;gap:20px;align-items:start;
  background:var(--surface);border:1px solid var(--rule);border-radius:12px;padding:20px}
.rowhead h3{margin:0;font-family:var(--mono);font-size:17px;font-weight:500;color:var(--ink)}
.rowhead .sub{margin:4px 0 0;font-size:13px;color:var(--faint)}
.shots{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;min-width:0}
.shot{margin:0;background:var(--ground);border:1px solid var(--rule);border-radius:8px;overflow:hidden}
.shot img{display:block;width:100%;height:auto}
.shot figcaption{padding:7px 10px;border-top:1px solid var(--rule);font-family:var(--mono);font-size:12px;color:var(--faint)}
.tablewrap{overflow-x:auto;border:1px solid var(--rule);border-radius:10px;background:var(--surface)}
table{border-collapse:collapse;width:100%;min-width:660px;font-size:14px}
th,td{padding:12px 16px;text-align:left;border-bottom:1px solid var(--rule);vertical-align:top}
thead th{font-family:var(--mono);font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);
  background:var(--raise);font-weight:500}
tbody tr:last-child td{border-bottom:none}
td.n,th.n{font-family:var(--mono);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
td strong{color:var(--ink);font-weight:600}
code{font-family:var(--mono);font-size:.9em;background:var(--raise);padding:1px 6px;border-radius:4px;color:var(--blue)}
.callout{border-left:3px solid var(--mark);background:var(--surface);padding:18px 22px;border-radius:0 10px 10px 0;
  display:flex;flex-direction:column;gap:10px}
.callout p{margin:0;max-width:72ch}
.callout p:first-child{color:var(--ink);font-weight:500}
.callout p+p{color:var(--dim);font-size:15px}
.legend{display:flex;align-items:center;gap:10px;font-size:14px;color:var(--dim)}
.chip{width:14px;height:14px;border-radius:3px;background:var(--mark);flex:none}
footer{border-top:1px solid var(--rule);padding-top:20px;color:var(--faint);font-size:13px;font-family:var(--mono);line-height:1.9}
@media(max-width:860px){.row{grid-template-columns:1fr}.shots{grid-template-columns:1fr}}
</style>

<div class="wrap">
<header>
  <p class="eyebrow">TrilLuminance · 2026-08-21</p>
  <h1>마커 개념 비교</h1>
  <p class="lede">O-CM · A-CM · H2O 를 격자 반경 k 별로 나란히 놓는다.
     세 줄이 «같은 것의 변형» 인지, 아니면 범주가 다른 것인지를 눈으로 가리기 위한 자료다.</p>
</header>

<div class="facts">
  <div class="fact"><b>동일</b><span>A-CM 과 H2O 의 발자국 <strong>21셀은 좌표까지 같다</strong>. 다른 것은 중앙뿐이다</span></div>
  <div class="fact"><b>9~11</b><span>A-CM 마커 셀의 hex 반경 (격자 반경 <code>k=6</code> 일 때) — 육각 코어 <strong>바깥</strong></span></div>
  <div class="fact"><b>0</b><span>O-CM 의 명부 근거. 전례 없이 유비로 만들어졌다</span></div>
</div>

<section>
  <h2>발자국 강조 <span class="note">주황 = 마커 셀. 진단용 오버레이이지 제안이 아니다</span></h2>
  <div class="legend"><span class="chip"></span> 마커 / detector 셀 위치</div>
  ${grid('hl')}
</section>

<section>
  <h2>무엇이 다른가</h2>
  <div class="tablewrap">
    <table>
      <thead><tr><th>축</th><th>O-CM</th><th>A-CM</th><th>H2O</th></tr></thead>
      <tbody>
        <tr><td><strong>중앙</strong></td>${col((c) => c.centre)}</tr>
        <tr><td><strong>마커 위치</strong></td>${col((c) => c.where)}</tr>
        <tr><td><strong>셀 수</strong></td>${col((c) => c.cells)}</tr>
        <tr><td><strong>데이터 비용</strong></td>${col((c) => c.cost)}</tr>
        <tr><td><strong>출처</strong></td>${col((c) => c.origin)}</tr>
      </tbody>
    </table>
  </div>
</section>

<section>
  <h2>실측 — 마커 셀은 격자 반경 밖에 있다</h2>
  <div class="tablewrap">
    <table>
      <thead><tr><th>버전</th><th class="n">격자 반경 k</th><th class="n">마커 셀 hex 반경</th><th class="n">셀 수</th><th>판정</th></tr></thead>
      <tbody>
        <tr><td>A0CM</td><td class="n">6</td><td class="n">9 · 10 · 11</td><td class="n">21</td><td>육각 코어 밖 (삼각 확장부)</td></tr>
        <tr><td>A1CM</td><td class="n">8</td><td class="n">13 · 14 · 15</td><td class="n">21</td><td>〃</td></tr>
        <tr><td>A2CM</td><td class="n">10</td><td class="n">17 · 18 · 19</td><td class="n">21</td><td>〃</td></tr>
      </tbody>
    </table>
  </div>
  <p class="lede">즉 A-CM 은 <strong>내부 육각 영역 파인더가 아니다</strong>. OAK 명부가 다루는 축과 범주가 다르다.</p>
</section>

<section>
  <h2>실제 렌더 <span class="note">강조 없음 — 지금 생성기가 내보내는 그대로</span></h2>
  ${grid('plain')}
  <div class="callout">
    <p>강조를 빼면 마커가 데이터 셀과 구별되지 않는다. 그것이 운영자 보고 ②다.</p>
    <p>2026-08-20 에 마커를 파인더 축(<code>#ffffff</code> 포함)으로 보내 구별을 만들었더니
       <strong>원거리 인식률이 떨어졌다</strong> — 순백 셀이 안전영역·흰 지면과 구별되지 않아
       실루엣에 구멍이 났기 때문이다. 되돌렸다. 「데이터와 다르게」를 좇다가
       「배경과도 다르게」를 잃은 것이다.</p>
  </div>
</section>

<section>
  <h2>정본 H2O 의 실제 정의</h2>
  <div class="tablewrap">
    <table>
      <thead><tr><th>필드</th><th>값</th><th>뜻</th></tr></thead>
      <tbody>
        <tr><td><code>finderMode</code></td><td><code>central-finder</code></td><td>파인더는 <strong>중앙</strong>에 있다</td></tr>
        <tr><td><code>finderStarter</code></td><td><code>central-cube-3tone</code></td><td>그 중앙 파인더가 <strong>3톤 큐브</strong>다</td></tr>
        <tr><td><code>counts.detector</code></td><td class="n">18</td><td>꼭짓점 18셀은 <strong>보조(detector)</strong></td></tr>
        <tr><td><code>counts.data</code></td><td class="n">26</td><td>—</td></tr>
        <tr><td><code>userNonData</code></td><td><code>[-7,3] [3,-7] [4,2] …</code></td><td>반경 7 — 삼각 확장부</td></tr>
      </tbody>
    </table>
  </div>
  <div class="callout">
    <p>A-CM 은 H2O 의 <strong>보조 셀만 떼어</strong> 독립 구조물로 승격시킨 것이고,
       H2O 자신의 파인더(중앙 3톤 큐브)는 버렸다.</p>
    <p>「H2O 보다 나은 안으로 채택」된 적은 없다 — 비교 자체가 없었다.
       기하 규칙(꼭짓점에서 2칸 안쪽 셀 중심의 반경-1 육각 링 3개)은 정확히 유도했지만,
       그 18셀이 명부 안에서 <strong>무슨 역할이었는지</strong>를 안 물었다.</p>
  </div>
</section>

<footer>렌더 <code>test/output/lanes/marker-preview.mjs</code> · ppu 16 · supersample 3 · 프리셋 slate<br>
정본 <code>.agent/decoder/data/finder-oak-candidates.json</code> · 발자국 유도 <code>src/markerA.js</code></footer>
</div>`;

fs.writeFileSync(new URL('./marker-concepts.html', DIR), html);
console.log('페이지 ' + (html.length / 1024 / 1024).toFixed(2) + ' MB → ' + new URL('./marker-concepts.html', DIR).pathname);
