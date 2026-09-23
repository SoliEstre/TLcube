/**
 * 종이공작 도안(paper-net.js)의 성질이에요(설계 §3 · §6-14 · §6-16).
 * 전개도가 «맞게 접히는지» 는 구현의 유도를 다시 쓰지 않고, 종이 위 기하 + 산접기 규칙만으로 접어 물리 큐브와 대조해요
 * (test/helpers/paper-fold.mjs). 거울 여부의 최종 수호자는 paper-scan-roundtrip 의 판독 왕복이에요.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeH} from '../src/h-codec.js';
import {H_FACE_IDS} from '../src/h-profile.js';
import {H_ARRANGEMENTS,hDisplayMap} from '../src/h-face-arrangement.js';
import {buildHCubeModel} from '../src/cube-export.js';
import {physicalHCube} from '../src/cube-physical.js';
import {rasterToPng} from '../src/png.js';
import {rasterize} from '../src/raster.js';
import {sceneToSvg} from '../src/svg.js';
import {
  PAPER_SIZES,THICKNESS_PRESETS,PAPER_METHODS,GLYPH_CHARS,NET_TREE,CROP_MARK_OFFSET_MM,CROP_MARK_LENGTH_MM,BOARD_GAP_MM,
  paperPlan,paperMethodOptions,paperPngPlan,buildPaperSheet,unfoldCube,assignTabs,strokeGlyphs,measureGlyphs,tabWidthUm,defaultPaperMethod,
} from '../src/paper-net.js';
import {fullOnly} from './helpers/scope.mjs';
import {mirrorOneFace} from './helpers/h-physical-camera.mjs';
import {foldAgainstPhys,pageHandedness,paperOverlaps,marginViolations,overlap,dot} from './helpers/paper-fold.mjs';

const IDENTITY=[[1,0,0],[0,1,0],[0,0,1]];

function displayConfigs({version=0,finder='frame',tones=2}={}){
  const out=[],seen=new Set();
  for(const mode of [1,2,3,4,5,6]){
    const encoded=encodeH(Uint8Array.of(mode),{version,mode,tones,ecc:'M',mask:mode%8,finder});
    for(const arrangement of H_ARRANGEMENTS)for(const renderFaces of [3,6]){
      let map;try{map=hDisplayMap(encoded,{arrangement,renderFaces});}catch{continue;}
      if(seen.has(map.cacheKey))continue;seen.add(map.cacheKey);
      out.push({encoded,options:{arrangement,renderFaces},label:`${mode}F/${arrangement}/rf${renderFaces}`});
    }
  }
  return out;
}
const physOf=(encoded,options={},swap)=>physicalHCube(buildHCubeModel(encoded,options),swap?{swap}:{});
const H0_3F=encodeH(Uint8Array.of(1,2,3),{version:0,mode:3,tones:3,ecc:'M',mask:0,finder:'frame'});
const REPRESENTATIVE=[
  {encoded:H0_3F,options:{},label:'H0 3F'},
  {encoded:encodeH('one',{version:3,mode:1,tones:2,ecc:'H',mask:7,finder:'frame'}),options:{renderFaces:6},label:'H3 1F rf6'},
  {encoded:encodeH(Uint8Array.of(7,9),{version:5,mode:6,tones:3,ecc:'M',mask:3,finder:'corners'}),options:{},label:'H5 6F corners'},
];

/** 시트 (i,j) → 물리 3D 셀 꼭짓점과 종이 점의 대응은 접기 자가 재요. 여기서는 P1·P2 한 도안의 성질 묶음을 재요. */
function assertNetSheet(scene,phys,label){
  const meta=scene.paper;
  // (1) 방향성: 모든 면이 종이에서 거울 아님.
  for(const name of H_FACE_IDS)assert.equal(pageHandedness(meta.faces[name]),1,`${label} ${name} det[∂j,∂i]`);
  // (2) 펼침 역적용: 산접기로 접은 종이가 물리 큐브와 셀 꼭짓점마다 일치.
  const fit=foldAgainstPhys(scene,phys);
  assert.ok(fit.properError<1e-9,`${label}: 접은 종이가 물리 큐브와 어긋나요(${fit.properError} @ ${fit.worst})`);
  assert.ok(fit.mirrorError>1,`${label}: 반사 정렬로도 맞으면 자가 거울을 못 가려요`);
  // (3) 모듈 도형은 면 틀 위 제 셀에 있고 색이 물리 면 색이에요.
  const n=phys.n;
  for(const s of scene.shapes.filter(s=>s.role==='module'&&Number.isInteger(s.i))){
    const f=meta.faces[s.face],expect=[[s.i,s.j],[s.i,s.j+1],[s.i+1,s.j+1],[s.i+1,s.j]].map(([i,j])=>({x:f.corner[0]+i*f.di[0]+j*f.dj[0],y:f.corner[1]+i*f.di[1]+j*f.dj[1]}));
    s.points.forEach((p,k)=>assert.ok(Math.abs(p.x-expect[k].x)<1e-9&&Math.abs(p.y-expect[k].y)<1e-9,`${label} ${s.face}(${s.i},${s.j})`));
    assert.deepEqual({...s.color},{...phys.faces[s.face].colors[s.i*n+s.j]});
  }
  // (4) 겹침 0 · 여백 안(재단선 잉크만 선폭까지 바깥).
  assert.deepEqual(paperOverlaps(scene).slice(0,5),[],label);
  assert.deepEqual(marginViolations(scene).slice(0,5),[],label);
}

/** P1 날개: 자르는 모서리 7개마다 날개 정확히 1개. 접은 3D 에서 날개 밑변이 짝 면의 모서리와 같아야 해요. */
function assertTabs(scene,phys,label){
  const meta=scene.paper,n=phys.n,tabs=meta.tabs;
  assert.equal(tabs.length,7,label);
  const folds=new Set(meta.folds.map(f=>[...f.faces].sort().join('|')));
  // 인접한 물리 면 쌍(12 모서리) 중 접는 5개를 뺀 7개가 날개 쌍이에요 — 법선으로 독립 유도해요.
  const pairs=[];
  for(let x=0;x<6;x++)for(let y=x+1;y<6;y++){const a=H_FACE_IDS[x],b=H_FACE_IDS[y];if(dot(phys.faces[a].normal,phys.faces[b].normal)===0&&!folds.has([a,b].sort().join('|')))pairs.push([a,b].sort().join('|'));}
  assert.equal(pairs.length,7,label);
  assert.deepEqual(tabs.map(t=>[t.face,t.partner].sort().join('|')).sort(),pairs.sort(),`${label}: 쌍마다 정확히 1개`);
  for(const t of tabs){
    // 날개 밑변 선분은 그 면 정사각형의 한 변 위이고, 면을 3D 로 옮기면 짝 면 평면 위의 모서리예요.
    const f=meta.faces[t.face],inv=p=>{const dx=p.x-f.corner[0],dy=p.y-f.corner[1],det=f.di[0]*f.dj[1]-f.di[1]*f.dj[0];return [(dx*f.dj[1]-dy*f.dj[0])/det,(f.di[0]*dy-f.di[1]*dx)/det];};
    const partner=phys.faces[t.partner],own=phys.faces[t.face];
    for(const p of [t.a,t.b]){
      const [i,j]=inv(p);
      assert.ok([i,j].every(v=>v>-1e-9&&v<n+1e-9)&&[i,j].some(v=>Math.abs(v)<1e-9||Math.abs(v-n)<1e-9),`${label} ${t.face} 날개 밑변이 면 경계 밖`);
      const q=[0,1,2].map(k=>own.origin[k]+i*own.di[k]+j*own.dj[k]),axis=partner.normal.findIndex(v=>v!==0);
      assert.ok(Math.abs(q[axis]-(partner.normal[axis]>0?n:0))<1e-9,`${label} ${t.face}→${t.partner}: 밑변이 짝 면 모서리가 아니에요`);
    }
    // 45° 사다리꼴, 폭 w, 밑변 양끝 0.5 mm 들임.
    const [a1,b1,c,d]=t.polygon,w=meta.tabMm;
    assert.ok(Math.abs(Math.hypot(a1.x-t.a.x,a1.y-t.a.y)-0.5)<1e-9||Math.abs(Math.hypot(a1.x-t.b.x,a1.y-t.b.y)-0.5)<1e-9,label);
    const h=Math.abs((d.x-a1.x)*t.outward[0]+(d.y-a1.y)*t.outward[1]);
    assert.ok(Math.abs(h-w)<1e-9,label);
    assert.ok(Math.abs(Math.hypot(d.x-a1.x,d.y-a1.y)-h*Math.SQRT2)<1e-9&&Math.abs(Math.hypot(c.x-b1.x,c.y-b1.y)-h*Math.SQRT2)<1e-9,`${label}: 옆각 45°`);
  }
  // 목적: 짧은 축(가로) 밖 0개, 긴 축(세로) 밖 1개(라틴 십자 최적형).
  const net=Object.values(meta.faces).map(f=>f.rect),x0=Math.min(...net.map(r=>r.x0)),x1=Math.max(...net.map(r=>r.x1)),y0=Math.min(...net.map(r=>r.y0)),y1=Math.max(...net.map(r=>r.y1));
  const outX=tabs.filter(t=>t.polygon.some(p=>p.x<x0-1e-9||p.x>x1+1e-9)).length,outY=tabs.filter(t=>t.polygon.some(p=>p.y<y0-1e-9||p.y>y1+1e-9)).length;
  assert.deepEqual([outX,outY],[0,1],label);
}

test('PAPER_SIZES 는 설계 §3.4 표의 8종 치수·@page 키워드·PDF pt 예요',()=>{
  const table=[['A4',210,297,'A4',595.276,841.890],['A3',297,420,'A3',841.890,1190.551],['A5',148,210,'A5',419.528,595.276],
    ['JISB5',182,257,'JIS-B5',515.906,728.504],['JISB4',257,364,'JIS-B4',728.504,1031.811],['B5',176,250,'B5',498.898,708.661],
    ['B4',250,353,'B4',708.661,1000.630],['Letter',215.9,279.4,'letter',612,792]];
  assert.deepEqual(PAPER_SIZES.map(p=>[p.id,p.widthMm,p.heightMm,p.pageKeyword,p.pdfWidthPt,p.pdfHeightPt]),table);
  assert.equal(PAPER_SIZES[0].id,'A4');
  for(const p of PAPER_SIZES){assert.equal(p.widthUm,Math.round(p.widthMm*1000));assert.ok(p.heightMm>p.widthMm);assert.ok(Object.isFrozen(p));}
  assert.deepEqual(PAPER_METHODS,['sheet','skin','board']);
});

test('THICKNESS_PRESETS 는 일반지·카드지·하드보드 3종·골판지 3종이에요(설계 §3.5)',()=>{
  assert.deepEqual(THICKNESS_PRESETS.map(p=>p.thicknessMm),[0.1,0.3,1,1.5,2,1.6,3.2,4]);
  assert.deepEqual(THICKNESS_PRESETS.map(p=>p.thicknessUm),[100,300,1000,1500,2000,1600,3200,4000]);
  assert.equal(new Set(THICKNESS_PRESETS.map(p=>p.id)).size,8);
  assert.equal(defaultPaperMethod(0.1),'sheet');assert.equal(defaultPaperMethod(0.45),'sheet');assert.equal(defaultPaperMethod(0.451),'skin');
});

test('§6-16 자동 최대: 8개 용지 × P1·P2·P3 가 설계 표와 같고, 0.1 mm 만 커도 용지에 안 들어가요',()=>{
  const phys=physOf(H0_3F);
  // P3 열은 설계 §3.4 식에서 조각 격자 둘레 재단 표시 자리 k = 2.8 mm(위 · 양옆)를 뺀 값이에요:
  //   s = min((W − 2m − g − 2k)/2, (H − 2m − 2g − r_b − k)/3). 표시는 인쇄 영역에 붙은 실선 대신이에요(흰 링 잔선 방지).
  const table={A4:[65.3,65.3,82.7],A3:[94.3,94.3,123.7],A5:[44.6,44.6,53.7],JISB5:[56.0,56.0,69.4],JISB4:[81.0,81.0,105.0],B5:[54.0,54.0,67.0],B4:[78.6,78.6,101.4],Letter:[61.5,64.3,76.8]};
  for(const paper of PAPER_SIZES){
    const sheet=paperPlan(phys,{paper:paper.id,thicknessMm:0.1,method:'sheet'}),skin=paperPlan(phys,{paper:paper.id,thicknessMm:1,method:'skin'}),board=paperPlan(phys,{paper:paper.id,thicknessMm:1,method:'board'});
    assert.deepEqual([sheet.pitchMm,skin.pitchMm,board.sideMm],table[paper.id],paper.id);
    // 최대성: 한 칸(0.1 mm) 더 키우면 TLP_PAPER_FIT.
    assert.throws(()=>paperPlan(phys,{paper:paper.id,thicknessMm:0.1,method:'sheet',sideMm:(sheet.sideUm+100)/1000}),e=>e.code==='TLP_PAPER_FIT',paper.id);
    assert.throws(()=>paperPlan(phys,{paper:paper.id,thicknessMm:1,method:'skin',sideMm:(skin.sideUm+100)/1000}),e=>e.code==='TLP_PAPER_FIT',paper.id);
    assert.throws(()=>paperPlan(phys,{paper:paper.id,thicknessMm:1,method:'board',sideMm:(board.sideUm+100)/1000}),e=>e.code==='TLP_PAPER_FIT',paper.id);
    // 자동 최대 장면이 실제로 용지·여백 안에 들어가요(수식이 아니라 그린 결과로).
    for(const plan of [sheet,skin,board]){
      const scene=buildPaperSheet(phys,plan);
      assert.deepEqual(marginViolations(scene),[],`${paper.id} ${plan.method}`);
      assert.equal(scene.width,paper.widthMm);assert.equal(scene.height,paper.heightMm);
    }
  }
});

test('§6-16 관계: P1 s = p + t · P2 코어 s = p − 0.1 · 재단표 면적 합 = 6s² − 12st + 8t² · 날개 폭 = clamp(0.18s, 6, 15)',()=>{
  const phys=physOf(H0_3F);
  for(const t of [0.1,0.3,0.45]){const p=paperPlan(phys,{thicknessMm:t,method:'sheet'});assert.equal(p.sideUm,p.pitchUm+Math.round(t*1000));assert.equal(p.tabUm,tabWidthUm(p.sideUm));}
  assert.equal(tabWidthUm(20000),6000);assert.equal(tabWidthUm(50000),9000);assert.equal(tabWidthUm(100000),15000);
  for(const t of [0.5,1,1.6,3.2,4]){
    const p=paperPlan(phys,{thicknessMm:t,method:'skin'}),s=p.sideUm,tu=p.thicknessUm;
    assert.equal(s,p.pitchUm-100);
    const area=p.core.reduce((sum,c)=>sum+c.count*c.wUm*c.hUm,0);
    assert.equal(area,6*s*s-12*s*tu+8*tu*tu,`t=${t}`);
    assert.deepEqual(p.core.map(c=>[c.id,c.count,c.wUm,c.hUm]),[['A',2,s,s],['B',2,s,s-2*tu],['C',2,s-2*tu,s-2*tu]]);
  }
  // 설계 예: A4, B 골판지 3.2 → p 65.3, s 65.2, B 65.2 × 58.8.
  const eg=paperPlan(phys,{thicknessMm:3.2,method:'skin'});
  assert.deepEqual([eg.pitchMm,eg.sideMm,eg.core[1].hUm],[65.3,65.2,58800]);
  // 한 변을 직접 주면 그 값 그대로(µm 반올림)예요.
  assert.equal(paperPlan(phys,{thicknessMm:0.3,method:'sheet',sideMm:40.1234}).sideUm,40123);
});

test('§6-16 P3 조건 경계: t ≤ 1.3 mm 이고 t < 종이 모듈(s/n) 일 때만, 0.4 × 모듈을 넘으면 경고',()=>{
  const h8=physOf(encodeH(Uint8Array.of(1),{version:8,mode:3,tones:2,ecc:'M',mask:0,finder:'frame'}));
  assert.equal(h8.n,45);
  // s = 58.5 → 모듈 1.3 mm. t = 1.3 은 «t < 모듈» 위반(같음), 1.299 는 통과.
  assert.throws(()=>paperPlan(h8,{thicknessMm:1.3,method:'board',sideMm:58.5}),e=>e.code==='TLP_BOARD_EDGE');
  const ok=paperPlan(h8,{thicknessMm:1.299,method:'board',sideMm:58.5});
  assert.ok(ok.warnings.includes('TLP_WARN_BOARD_EDGE'));
  // 경고 경계: 0.4 × 1.3 = 0.52 mm 는 경고 없음, 0.521 부터 경고.
  assert.deepEqual(paperPlan(h8,{thicknessMm:0.52,method:'board',sideMm:58.5}).warnings,[]);
  assert.deepEqual(paperPlan(h8,{thicknessMm:0.521,method:'board',sideMm:58.5}).warnings,['TLP_WARN_BOARD_EDGE']);
  const phys=physOf(H0_3F);
  assert.doesNotThrow(()=>paperPlan(phys,{thicknessMm:1.3,method:'board'}));
  assert.throws(()=>paperPlan(phys,{thicknessMm:1.301,method:'board'}),e=>e.code==='TLP_BOARD_THICK');
  assert.deepEqual(paperPlan(phys,{thicknessMm:1,method:'board'}).warnings,[]);
  assert.equal(paperPlan(phys,{thicknessMm:1,method:'board'}).cutBandMm,1);
  // P1 은 t ≤ 0.45 만.
  assert.doesNotThrow(()=>paperPlan(phys,{thicknessMm:0.45,method:'sheet'}));
  assert.throws(()=>paperPlan(phys,{thicknessMm:0.451,method:'sheet'}),e=>e.code==='TLP_BOARD_THICK');
  // P2 코어가 두께를 못 이기면 거부.
  assert.throws(()=>paperPlan(phys,{thicknessMm:7,method:'skin',sideMm:14}),e=>e.code==='TLP_BOARD_THICK');
  // 방식 카드: 얇으면 한 장 전개도만, 두꺼우면 붙이기·직접 인쇄 둘이고 막힌 카드는 사유 코드를 달아요.
  assert.deepEqual(paperMethodOptions(phys,{thicknessMm:0.3}),[{method:'sheet',enabled:true,reason:null}]);
  assert.deepEqual(paperMethodOptions(phys,{thicknessMm:1}).map(o=>[o.method,o.enabled]),[['skin',true],['board',true]]);
  assert.deepEqual(paperMethodOptions(phys,{thicknessMm:1.6}).map(o=>[o.method,o.enabled,o.reason]),[['skin',true,null],['board',false,'TLP_BOARD_THICK']]);
  assert.deepEqual(paperMethodOptions(h8,{thicknessMm:1.25,paper:'A4'}).map(o=>[o.method,o.reason]),[['skin',null],['board',null]]);
  assert.deepEqual(paperMethodOptions(h8,{thicknessMm:1.25,paper:'A5'}).map(o=>[o.method,o.reason]),[['skin','TLP_PAPER_MODULE'],['board','TLP_BOARD_EDGE']]);
});

test('종이 모듈 하한: 1.0 mm 미만은 TLP_PAPER_MODULE, 1.2 mm 미만은 경고 · 한 변 하한 13.4 mm',()=>{
  const h8=physOf(encodeH(Uint8Array.of(1),{version:8,mode:3,tones:2,ecc:'M',mask:0,finder:'frame'}));
  const a4=paperPlan(h8,{thicknessMm:0.1});
  assert.ok(Math.abs(a4.moduleMm-65.3/45)<1e-12);assert.deepEqual(a4.warnings,[]);
  assert.throws(()=>paperPlan(h8,{paper:'A5',thicknessMm:0.1}),e=>e.code==='TLP_PAPER_MODULE'); // 44.6 / 45 < 1.0
  assert.deepEqual(paperPlan(h8,{thicknessMm:0.1,sideMm:50}).warnings,['TLP_WARN_MODULE_SMALL']);
  const phys=physOf(H0_3F);
  assert.throws(()=>paperPlan(phys,{thicknessMm:0.1,sideMm:13.3}),e=>e.code==='TLP_PAPER_FIT');
  assert.doesNotThrow(()=>buildPaperSheet(phys,paperPlan(phys,{thicknessMm:0.1,sideMm:13.4})));
  for(const method of ['skin','board'])assert.doesNotThrow(()=>buildPaperSheet(phys,paperPlan(phys,{thicknessMm:0.5,sideMm:13.4,method})));
  // 두께 0.4 에서 s = 13.4 면 인쇄 모서리가 13.0 이라 날개 윗변(13 − 1 − 12)이 남지 않아요 — 계획 단계에서 거부해요.
  assert.throws(()=>paperPlan(phys,{thicknessMm:0.4,sideMm:13.4}),e=>e.code==='TLP_PAPER_FIT');
  assert.throws(()=>paperPlan(phys,{paper:'B6'}),RangeError);
  assert.throws(()=>paperPlan(phys,{thicknessMm:0}),RangeError);
  assert.throws(()=>paperPlan(phys,{method:'origami'}),RangeError);
  assert.equal(paperPlan(phys,{thicknessMm:0.3}).fileTag,'sheet-A4-s65600um-t300um');
  assert.equal(paperPlan(phys,{thicknessMm:3.2,paper:'JISB5'}).fileTag,'skin-JISB5-s55900um-t3200um');
});

test('§6-14 대표 사례: P1·P2 전개도가 거울 없이 물리 큐브로 접히고, 날개·겹침·여백 조건을 지켜요',()=>{
  for(const {encoded,options,label} of REPRESENTATIVE){
    const phys=physOf(encoded,options);
    for(const [method,t] of [['sheet',0.3],['skin',3.2]]){
      const scene=buildPaperSheet(phys,paperPlan(phys,{thicknessMm:t,method}));
      assertNetSheet(scene,phys,`${label} ${method}`);
      if(method==='sheet')assertTabs(scene,phys,`${label} ${method}`);
      else assert.equal(scene.paper.tabs.length,0);
      // 접는 모서리 5개는 트리 그대로이고 한 나무(6면 연결)예요.
      assert.deepEqual(scene.paper.folds.map(f=>f.faces.join('-')),NET_TREE.map(e=>e.join('-')));
    }
  }
});

fullOnly(()=>test('§6-14 배터리: 모든 모드·배치·반대면 복제 × P1·P2 × 용지 셋',()=>{
  const configs=displayConfigs({version:2,tones:3});
  assert.ok(configs.length>=20);
  for(const {encoded,options,label} of configs){
    const phys=physOf(encoded,options);
    for(const paper of ['A4','A5','Letter'])for(const [method,t] of [['sheet',0.1],['sheet',0.45],['skin',1.6]]){
      const scene=buildPaperSheet(phys,paperPlan(phys,{paper,thicknessMm:t,method}));
      assertNetSheet(scene,phys,`${label} ${paper} ${method}`);
      if(method==='sheet')assertTabs(scene,phys,`${label} ${paper} ${method}`);
    }
  }
}));

test('§6-14 P3: 조각 치수는 z 쌍 A s×s · x 쌍 B s×(s−2t) · y 쌍 C (s−2t)², 잘라 낸 변은 덮는 이웃 판과 일치해요',()=>{
  for(const {encoded,options,label} of REPRESENTATIVE){
    const phys=physOf(encoded,options),plan=paperPlan(phys,{thicknessMm:1,method:'board',sideMm:60}),scene=buildPaperSheet(phys,plan);
    assert.deepEqual(boardViolations(scene,phys),[],label);
    for(const name of H_FACE_IDS)assert.equal(pageHandedness(scene.paper.faces[name]),1,`${label} ${name}`);
    assert.deepEqual(paperOverlaps(scene).slice(0,5),[],label);
    assert.deepEqual(marginViolations(scene),[],label);
    // 조각 번호는 모델 이름 기준 ZM=1 … YP=6 이고 번호 글리프가 조각마다 하나예요.
    assert.deepEqual(H_FACE_IDS.map(f=>scene.paper.faces[f].number),[1,2,3,4,5,6]);
    assert.deepEqual(scene.paper.labels.filter(l=>l.id.startsWith('piece-')).map(l=>l.text),['1↑','2↑','3↑','4↑','5↑','6↑']);
    assert.equal(scene.paper.map.length,6);
  }
});

/**
 * P3 자: 조각마다 (1) 보이는 영역 치수가 물리 축 규칙의 A/B/C 치수이고, (2) 네 변 각각 잘라 낸 폭이 «그 변 너머 이웃 판이
 * 맞대기에서 이 판을 덮는가» 와 일치하는지 봐요. 이웃은 3D 공유 모서리로 독립 유도하고, 덮음 규칙은 설계 문장
 * «z 쌍 = 전체 · x 쌍 = z 방향 양끝 · y 쌍 = 네 변» 에서 옮긴 순위(z < x < y)예요.
 */
function boardViolations(scene,phys){
  const meta=scene.paper,n=phys.n,s=meta.sideMm,t=meta.thicknessMm,cell=s/n,out=[];
  const rank=f=>({2:0,0:1,1:2})[f.normal.findIndex(v=>v!==0)];
  const dims={0:[s,s],1:[s,s-2*t],2:[s-2*t,s-2*t]};
  for(const name of H_FACE_IDS){
    const f=phys.faces[name],m=meta.faces[name],v=m.visible,w=v.x1-v.x0,h=v.y1-v.y0,[a,b]=dims[rank(f)];
    if(!(Math.abs(Math.max(w,h)-a)<1e-9&&Math.abs(Math.min(w,h)-b)<1e-9))out.push(`${name} 치수 ${w}×${h}`);
    for(const [edge,dir] of [['i0',f.di.map(x=>-x)],['i1',f.di],['j0',f.dj.map(x=>-x)],['j1',f.dj]]){
      // 이 변 위의 3D 점 둘을 공유하는 다른 면이 이웃이에요.
      const along=edge[0]==='i'?f.dj:f.di,at0=edge.endsWith('0')?0:n;
      const p=[0,1,2].map(k=>f.origin[k]+(edge[0]==='i'?at0*f.di[k]:at0*f.dj[k]));
      const q=[0,1,2].map(k=>p[k]+n*along[k]);
      const onFace=(g,x)=>{const ax=g.normal.findIndex(z=>z!==0);return x[ax]===(g.normal[ax]>0?n:0);};
      const neighbors=H_FACE_IDS.filter(g=>g!==name&&onFace(phys.faces[g],p)&&onFace(phys.faces[g],q));
      if(neighbors.length!==1||dot(phys.faces[neighbors[0]].normal,dir)!==1){out.push(`${name} ${edge} 이웃 유도 실패`);continue;}
      const expected=rank(phys.faces[neighbors[0]])<rank(f)?t:0;
      const got=edge==='i0'?m.crop.i0*cell:edge==='i1'?(n-m.crop.i1)*cell:edge==='j0'?m.crop.j0*cell:(n-m.crop.j1)*cell;
      if(Math.abs(got-expected)>1e-9)out.push(`${name} ${edge} 잘라 낸 폭 ${got} ≠ ${expected}`);
    }
    // 보이는 영역 = 면 틀에서 잘라 낸 시트 영역, 그 면 모듈은 모두 그 안이에요.
    for(const sh of scene.shapes.filter(x=>x.face===name&&(x.role==='module'||x.role==='image')))
      if(sh.points.some(p=>p.x<v.x0-1e-9||p.x>v.x1+1e-9||p.y<v.y0-1e-9||p.y>v.y1+1e-9)){out.push(`${name} 모듈이 조각 밖`);break;}
  }
  return out;
}

test('심은 결함: 자들이 한 번씩 빨갛게 돼요',()=>{
  const phys=physOf(H0_3F),plan=paperPlan(phys,{thicknessMm:0.3}),scene=buildPaperSheet(phys,plan);
  // (a) S = I 물리 큐브: 전개도는 그 큐브로 맞게 접히지만(유도 일관), 모든 면이 종이에서 거울이에요.
  const mirrored=physOf(H0_3F,{},IDENTITY),ms=buildPaperSheet(mirrored,plan);
  assert.deepEqual(H_FACE_IDS.map(f=>pageHandedness(ms.paper.faces[f])),H_FACE_IDS.map(()=>-1));
  assert.ok(foldAgainstPhys(ms,mirrored).properError<1e-9);
  // (b) 한 면만 거울인 큐브: 그 면만 종이에서 −1.
  for(const name of H_FACE_IDS){
    const one=buildPaperSheet(mirrorOneFace(phys,name),plan);
    assert.deepEqual(H_FACE_IDS.filter(f=>pageHandedness(one.paper.faces[f])<0),[name]);
  }
  // (c) 접기 자: 두 면의 종이 자리를 맞바꾸면 접은 결과가 물리 큐브와 어긋나요.
  const swapped={...scene,paper:{...scene.paper,faces:{...scene.paper.faces,XP:scene.paper.faces.YP,YP:scene.paper.faces.XP}}};
  assert.ok(foldAgainstPhys(swapped,phys).properError>1);
  const flipped={...scene,paper:{...scene.paper,faces:{...scene.paper.faces,XM:{...scene.paper.faces.XM,dj:scene.paper.faces.XM.dj.map(v=>-v)}}}};
  assert.ok(foldAgainstPhys(flipped,phys).properError>1);
  // (d) 겹침 자: 캡션 글리프를 면 위로 옮기면 잡혀요.
  const face=scene.paper.faces.ZM.rect,cap=scene.paper.labels.find(l=>l.id==='caption'),dx=face.x0+5-cap.x,dy=face.y0+5-cap.y;
  const moved={...scene,shapes:scene.shapes.map(s=>s.group==='caption'?{...s,points:s.points.map(p=>({x:p.x+dx,y:p.y+dy}))}:s)};
  assert.ok(paperOverlaps(moved).some(x=>x.includes('glyph:caption')&&x.includes('face:ZM')));
  // (e) 여백 자: 도형 하나를 여백으로 밀면 잡혀요.
  // 모듈 하나를 왼쪽 가장자리에서 3 mm(여백 7 mm 안쪽 금지 구역)로 옮겨요.
  const pushed={...scene,shapes:scene.shapes.map((s,k)=>k===0?{...s,points:s.points.map(p=>({x:p.x-Math.min(...s.points.map(q=>q.x))+3,y:p.y}))}:s)};
  assert.deepEqual(marginViolations(pushed),['0:module']);
  // (f) 날개 자: 날개 하나를 빼면 쌍 대조가 실패해요.
  assert.throws(()=>assertTabs({...scene,paper:{...scene.paper,tabs:scene.paper.tabs.slice(1)}},phys,'fixture'));
  // (g) P3 자: 덮음 순위를 뒤집은 도안(잘라 낸 변을 바꿔 치기)은 잡혀요.
  const board=buildPaperSheet(phys,paperPlan(phys,{thicknessMm:1,method:'board'}));
  const xm=board.paper.faces.XM,bad={...board,paper:{...board.paper,faces:{...board.paper.faces,XM:{...xm,crop:{...xm.crop,i0:0}}}}};
  assert.ok(boardViolations(bad,phys).length>=1);
  const yp=board.paper.faces.YP,shrunk={...board,paper:{...board.paper,faces:{...board.paper.faces,YP:{...yp,visible:{...yp.visible,x1:yp.visible.x1-0.5}}}}};
  assert.ok(boardViolations(shrunk,phys).some(x=>x.startsWith('YP 치수')));
});

test('날개 배치 전수: 예약 영역이 긴 축 날개 자리를 막으면 반대쪽 짝을 골라요',()=>{
  const phys=physOf(H0_3F),layout=unfoldCube(phys),p=60,w=10.8;
  const free=assignTabs(layout,p,w),long=free.find(t=>t.outside.long);
  assert.ok(long);
  const box=long.polygon.reduce((r,q)=>({x0:Math.min(r.x0,q.x),y0:Math.min(r.y0,q.y),x1:Math.max(r.x1,q.x),y1:Math.max(r.y1,q.y)}),{x0:Infinity,y0:Infinity,x1:-Infinity,y1:-Infinity});
  const blocked=assignTabs(layout,p,w,{reserved:[box]}),moved=blocked.find(t=>t.cut===long.cut);
  assert.notEqual(moved.face,long.face);assert.equal(moved.face,long.partner);
  assert.ok(!blocked.some(t=>overlap(t.polygon,[{x:box.x0,y:box.y0},{x:box.x1,y:box.y0},{x:box.x1,y:box.y1},{x:box.x0,y:box.y1}])));
  assert.deepEqual([blocked.filter(t=>t.outside.short).length,blocked.filter(t=>t.outside.long).length],[0,1]);
  // 모든 자리를 막으면 거부해요.
  assert.throws(()=>assignTabs(layout,p,w,{reserved:[{x0:-100,y0:-100,x1:400,y1:400}]}),e=>e.code==='TLP_PAPER_FIT');
});

test('전개도 유도: 뿌리 ZM 이 위쪽 두 번째 줄, 3 × 4 세로, 면이 겹치지 않고 빈 칸 6개예요',()=>{
  for(const {encoded,options,label} of REPRESENTATIVE){
    const layout=unfoldCube(physOf(encoded,options));
    assert.deepEqual([layout.cols,layout.rows],[3,4],label);
    assert.equal(layout.faces.ZM.row,1,label);
    assert.equal(new Set(Object.values(layout.faces).map(f=>`${f.col},${f.row}`)).size,6);
    assert.equal(layout.empty.length,6);assert.equal(layout.cuts.length,7);assert.equal(layout.folds.length,5);
    for(const cut of layout.cuts){const [s,t]=cut.segments;assert.notDeepEqual([s.a,s.b],[t.a,t.b],label);}
  }
});

test('결정성: 같은 입력은 같은 SVG 바이트, 모델·물리 큐브는 변이하지 않아요',()=>{
  const model=buildHCubeModel(H0_3F),phys=physicalHCube(model),before=JSON.stringify(model);
  for(const method of PAPER_METHODS){
    const t=method==='sheet'?0.1:1,plan=paperPlan(phys,{thicknessMm:t,method});
    const a=sceneToSvg(buildPaperSheet(phys,plan),{unit:'mm'}),b=sceneToSvg(buildPaperSheet(phys,plan),{unit:'mm'});
    assert.equal(a,b);assert.ok(a.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="210mm" height="297mm" viewBox="0 0 210 297">'));
  }
  assert.equal(JSON.stringify(model),before);
});

test('paperPngPlan: A4 300 dpi = 2480 × 3508 · ppi 300 · 서브샘플 1',()=>{
  const phys=physOf(H0_3F),scene=buildPaperSheet(phys,paperPlan(phys,{thicknessMm:0.1}));
  const plan=paperPngPlan(scene);
  assert.deepEqual([plan.width,plan.height,plan.ppi,plan.supersample],[2480,3508,300,1]);
  assert.ok(Math.abs(plan.ppu-300/25.4)<1e-12);
  const a3=paperPngPlan({width:297,height:420});assert.deepEqual([a3.width,a3.height],[3508,4961]);
});

test('빈 면 이미지는 종이에 들어가요: 시트 틀 그대로(거울 없이), P3 에서는 보이는 영역만큼 잘려요',()=>{
  // 왼쪽 위가 빨강, 오른쪽 위가 초록, 아래 두 픽셀이 파랑인 2 × 2 이미지예요.
  const pixels=Uint8ClampedArray.of(255,0,0,255, 0,255,0,255, 0,0,255,255, 0,0,255,255);
  const image={width:2,height:2,pixels,href:'data:image/png;base64,'+Buffer.from(rasterToPng({width:2,height:2,pixels})).toString('base64')};
  const encoded=encodeH('one',{version:3,mode:1,tones:3,ecc:'H',mask:7,finder:'frame'});
  const phys=physOf(encoded,{faceImages:{ZM:image}});
  assert.equal(phys.faces.ZM.blank,true);
  const net=buildPaperSheet(phys,paperPlan(phys,{thicknessMm:0.1}));
  const shape=net.shapes.find(s=>s.kind==='image'&&s.face==='ZM');
  assert.ok(shape);assert.equal(shape.image,image);
  // 이미지 왼쪽 위 꼭짓점 = 시트 (y, x), 오른쪽 위 = (y, x + width): 종이에서 오른쪽 위가 «왼쪽 위 → 열 방향» 이에요.
  const f=net.paper.faces.ZM,p=phys.faces.ZM.image,at=(i,j)=>({x:f.corner[0]+i*f.di[0]+j*f.dj[0],y:f.corner[1]+i*f.di[1]+j*f.dj[1]});
  [at(p.y,p.x),at(p.y,p.x+p.width),at(p.y+p.height,p.x+p.width),at(p.y+p.height,p.x)].forEach((q,k)=>assert.ok(Math.abs(q.x-shape.points[k].x)<1e-9&&Math.abs(q.y-shape.points[k].y)<1e-9,`꼭짓점 ${k}`));
  // 래스터에서 읽으면 이미지 윗줄 왼쪽이 빨강, 오른쪽이 초록이에요(종이에서 본 방향 = 정본 시트 방향).
  const r=rasterize(net,{pixelsPerUnit:4,supersample:1}),probe=(i,j)=>{const q=at(i,j),k=(Math.floor(q.y*4)*r.width+Math.floor(q.x*4))*4;return [r.pixels[k],r.pixels[k+1],r.pixels[k+2]];};
  const n=phys.n;
  assert.deepEqual(probe(n*0.25,n*0.25),[255,0,0]);assert.deepEqual(probe(n*0.25,n*0.75),[0,255,0]);assert.deepEqual(probe(n*0.75,n*0.5),[0,0,255]);
  // P3: ZM 은 z 쌍(A)이라 안 잘려요. 이미지가 x·y 쌍 빈 면에 있으면 잘린 자산이 보이는 영역 안에 놓여요.
  const side=physOf(encoded,{faceImages:{ZM:image,YM:image,ZP:image,YP:image}});
  const board=buildPaperSheet(side,paperPlan(side,{thicknessMm:1.2,method:'board'}));
  const images=board.shapes.filter(s=>s.kind==='image');
  assert.ok(images.length>=2);
  for(const s of images){
    const v=board.paper.faces[s.face].visible,cropped=board.paper.faces[s.face].crop;
    assert.ok(s.points.every(q=>q.x>=v.x0-1e-9&&q.x<=v.x1+1e-9&&q.y>=v.y0-1e-9&&q.y<=v.y1+1e-9),s.face);
    const whole=cropped.i0===0&&cropped.j0===0&&cropped.i1===side.n&&cropped.j1===side.n;
    if(!whole)assert.notEqual(s.image,image,`${s.face}: 잘린 조각은 새 자산이어야 해요`);
  }
  assert.equal(image.pixels,pixels,'원본 이미지는 그대로예요');
});

test('스트로크 글리프: 허용 문자만 · 문자마다 서로 다른 모양 · 상자 안 · 모르는 문자는 거부',()=>{
  assert.equal(GLYPH_CHARS,'0123456789.mst=×-ABC↑ ');
  const h=10,shapesOf=ch=>strokeGlyphs(ch,0,0,h);
  const signature=ch=>{const scene={width:10,height:12,background:{r:255,g:255,b:255},shapes:shapesOf(ch)};const r=rasterize(scene,{pixelsPerUnit:4,supersample:1});let s='';for(let k=0;k<r.pixels.length;k+=4)s+=r.pixels[k]<128?'1':'0';return s;};
  const seen=new Map();
  for(const ch of GLYPH_CHARS){
    const polys=shapesOf(ch),box=measureGlyphs(ch,h);
    if(ch===' '){assert.equal(polys.length,0);continue;}
    assert.ok(polys.length>=1,ch);
    for(const p of polys){assert.equal(p.kind,'polygon');assert.equal(p.qr,true);assert.equal(p.role,'glyph');}
    // measureGlyphs 는 잉크 끝을 정확히 재요(대각 획 캡 포함): 잉크 ⊂ [left, width] × [top, bottom], 끝은 실제로 닿아요.
    const xs=polys.flatMap(p=>p.points.map(q=>q.x)),ys=polys.flatMap(p=>p.points.map(q=>q.y)),cap=0.12*h*0.25;
    assert.ok(Math.min(...xs)>=box.left-1e-9&&Math.max(...xs)<=box.width+1e-9&&Math.min(...ys)>=box.top-1e-9&&Math.max(...ys)<=box.bottom+1e-9,`${ch} 상자 밖`);
    assert.ok(Math.abs(Math.max(...xs)-box.width)<1e-9||Math.max(...xs)<box.width,`${ch} 폭`);
    assert.ok(box.left>=-cap&&box.top>=-cap&&box.bottom<=h+cap,`${ch}: 캡이 획 굵기의 1/4 보다 삐져나와요`);
    const sig=signature(ch);
    assert.ok(!seen.has(sig),`${ch} 와 ${seen.get(sig)} 가 같은 모양이에요`);seen.set(sig,ch);
  }
  assert.throws(()=>strokeGlyphs('가',0,0,3),RangeError);
  assert.throws(()=>strokeGlyphs('x',0,0,3),RangeError);
  assert.throws(()=>measureGlyphs('Z',3),RangeError);
  // 글자열 폭 = 글자 상자 합 + 간격, 글자 수에 선형(축 정렬 획만 있는 글자).
  const one=measureGlyphs('8',3).width,two=measureGlyphs('88',3).width;
  assert.ok(Math.abs(two-(2*one+0.22*3))<1e-12);
  // 대각 획으로 끝나는 글자('7')는 사각 캡 모서리가 글자 상자보다 오른쪽으로 나가요. 폭은 그 잉크 끝이라, 오른쪽 여백에
  // 맞춰 붙인 캡션(«…t=0.257»)의 잉크가 여백을 넘지 않아요. 상자 합만 쓰면 h = 2.5 에서 약 0.04 mm 넘었어요.
  const seven=measureGlyphs('7',2.5),boxOnly=0.6*(2.5-0.3)+0.3,ink=Math.max(...strokeGlyphs('7',0,0,2.5).flatMap(p=>p.points.map(q=>q.x)));
  assert.ok(seven.width>boxOnly+0.03,`'7' 폭 ${seven.width} 이 상자 합 ${boxOnly} 과 같으면 캡을 안 센 거예요`);
  assert.ok(Math.abs(seven.width-ink)<1e-12);
});

/**
 * «계획 통과 ⇒ 도안 생성 통과» 자예요. 상태 줄과 버튼은 paperPlan(· paperMethodOptions)만 보고 켜지므로, 조립(buildPaperSheet)이
 * 계획보다 엄격하면 «버튼은 켜졌는데 눌러도 아무것도 안 내려받는» 상태가 생겨요. 계획 함수를 인자로 받아 심은 결함으로도 돌려요.
 * @returns {{mismatches:string[], built:number}} 계획은 통과했는데 도안 생성이 던진 조합과, 실제로 만든 도안 수
 */
function planBuildMismatches(phys,{planFn=paperPlan,papers=PAPER_SIZES.map(p=>p.id),thicknessesUm,sides}){
  const mismatches=[];let built=0;
  for(const paper of papers)for(const tUm of thicknessesUm)for(const sideMm of sides){
    const options=paperMethodOptions(phys,{paper,thicknessMm:tUm/1000,sideMm});
    for(const method of options.map(o=>o.method)){
      let plan;
      try{plan=planFn(phys,{paper,thicknessMm:tUm/1000,sideMm,method});}
      catch(error){if(!String(error?.code).startsWith('TLP_'))throw error;continue;}
      // 방식 카드가 켜진 것 ⟺ 계획이 통과한 것(같은 판정이어야 카드 · 상태 줄 · 버튼이 어긋나지 않아요).
      if(planFn===paperPlan&&!options.find(o=>o.method===method).enabled)mismatches.push(`${paper} t=${tUm}µm ${method}: 카드는 막혔는데 계획은 통과`);
      try{buildPaperSheet(phys,plan);built++;}
      catch(error){mismatches.push(`${paper} t=${tUm}µm s=${sideMm??'auto'} ${method}: ${error.code??error.name} ${error.message}`);}
    }
  }
  return {mismatches,built};
}

test('계획 통과 ⇒ 도안 생성 통과: 8용지 × 방식 × µm 두께 × 직접 한 변(하한 근처 포함) — 상태 줄이 켠 버튼은 늘 파일을 내요',()=>{
  // 검토에서 잡힌 조합을 격자에 넣어요: A4 · 감싸기 0.537 mm · 한 변 16 mm(코어 재단표가 빈 칸에 안 들어갔어요),
  // A5 · 한 장 0.257 mm · 13.4 mm(오른쪽에 붙인 캡션 '7' 의 캡이 여백을 0.04 mm 넘었어요), 감싸기 0.451 · 13.4.
  const thicknessesUm=[50,100,257,300,450,451,537,682,1000,1299,1600,3200,6000],sides=[undefined,13.4,13.5,16,20,33];
  let built=0;
  for(const phys of [physOf(H0_3F),physOf(encodeH(Uint8Array.of(1),{version:8,mode:3,tones:2,ecc:'M',mask:0,finder:'frame'}))]){
    const r=planBuildMismatches(phys,{thicknessesUm,sides});
    assert.deepEqual(r.mismatches.slice(0,5),[],`n=${phys.n}`);
    built+=r.built;
  }
  assert.ok(built>=600,`만든 도안 ${built} — 격자가 대부분 계획에서 떨어지면 자가 아무것도 안 재요`);
  // 코어 재단표 치수는 0.1 mm 로 적어요(상태 줄과 같은 값). µm 로 적으면 글자가 길어져 작은 한 변에서 빈 칸에 안 들어가요.
  const phys=physOf(H0_3F),scene=buildPaperSheet(phys,paperPlan(phys,{paper:'A4',thicknessMm:0.537,sideMm:16,method:'skin'}));
  assert.deepEqual(scene.paper.labels.filter(l=>l.id.startsWith('core-')).map(l=>l.text),['A 2× 16.0×16.0','B 2× 16.0×14.9','C 2× 14.9×14.9']);
  // 자 검증: 계획이 조립보다 느슨하면(피치를 몰래 줄인 계획 — 코어 재단표 글자가 1 mm 아래로 내려가요) 자가 잡아요.
  const loose=(p,o)=>{const plan=paperPlan(p,o);return plan.method==='skin'&&plan.sideUm<14000?{...plan,pitchMm:12}:plan;};
  const planted=planBuildMismatches(phys,{planFn:loose,papers:['A4'],thicknessesUm:[682],sides:[13.4]});
  assert.ok(planted.mismatches.some(x=>x.includes('TLP_PAPER_FIT')),'느슨한 계획을 심었는데 자가 통과했어요');
});

fullOnly(()=>test('full: 계획 통과 ⇒ 도안 생성 통과 — µm 두께 50–6000(37 간격) × 한 변 자동 + 13.4–43(0.5 간격) × 8용지',()=>{
  const thicknessesUm=[];for(let t=50;t<=6000;t+=37)thicknessesUm.push(t);
  const sides=[undefined];for(let s=134;s<=430;s+=5)sides.push(s/10);
  const r=planBuildMismatches(physOf(H0_3F),{thicknessesUm,sides});
  assert.deepEqual(r.mismatches.slice(0,5),[]);
  assert.ok(r.built>=10000,`만든 도안 ${r.built}`);
}));

/** P3 재단 표시 자: 조각마다 (1) 인쇄 영역 바깥 OFFSET/2(0.5 mm) 안쪽에 그 조각 인쇄물 말고 다른 잉크가 없고(자르는 오차 안에 잔선이 없어요), (2) 네 가장자리 연장선마다 양끝에 표시가 하나씩(합 8개) 있어요. */
function cropMarkViolations(scene){
  const out=[],o=CROP_MARK_OFFSET_MM,g=o/2,e=1e-6;
  for(const [name,f] of Object.entries(scene.paper.faces)){
    const v=f.visible,guard=[{x:v.x0-g,y:v.y0-g},{x:v.x1+g,y:v.y0-g},{x:v.x1+g,y:v.y1+g},{x:v.x0-g,y:v.y1+g}];
    scene.shapes.forEach((s,k)=>{if(!(s.face===name&&(s.role==='module'||s.role==='image'))&&overlap(s.points,guard))out.push(`${name}: ${k}:${s.role}${s.face?`(${s.face})`:''} 가 인쇄 영역 ${g} mm 안에 닿아요`);});
    const marks=scene.shapes.filter(s=>s.face===name&&s.role==='cut');
    const center=s=>({x:s.points.reduce((a,q)=>a+q.x,0)/s.points.length,y:s.points.reduce((a,q)=>a+q.y,0)/s.points.length});
    for(const [edge,axis,at,lo,hi] of [['top','y',v.y0,v.x0,v.x1],['bottom','y',v.y1,v.x0,v.x1],['left','x',v.x0,v.y0,v.y1],['right','x',v.x1,v.y0,v.y1]]){
      const on=marks.filter(s=>Math.abs(center(s)[axis]-at)<1e-9&&s.points.every(q=>Math.abs(q[axis]-at)<=0.1+1e-9));
      const other=axis==='y'?'x':'y',before=on.filter(s=>s.points.every(q=>q[other]<lo-o+e)),after=on.filter(s=>s.points.every(q=>q[other]>hi+o-e));
      if(before.length!==1||after.length!==1||on.length!==2)out.push(`${name} ${edge}: 연장선 표시 ${on.length}개(앞 ${before.length} · 뒤 ${after.length})`);
    }
    if(marks.length!==8)out.push(`${name}: 재단 표시 ${marks.length}개`);
  }
  return out;
}

test('P3 재단 표시: 조각 인쇄 영역에는 선이 닿지 않고(0.5 mm 안 무잉크), 네 가장자리 연장선 양끝에 표시가 있어요 — 자 검증: 붙은 실선을 심으면 빨개져요',()=>{
  assert.ok(CROP_MARK_OFFSET_MM+CROP_MARK_LENGTH_MM<BOARD_GAP_MM/2,'이웃 조각 표시끼리 닿지 않아요');
  for(const {encoded,options,label} of REPRESENTATIVE)for(const [paper,t] of [['A4',1],['A5',0.8],['Letter',1.299]]){
    const phys=physOf(encoded,options);
    let plan;try{plan=paperPlan(phys,{paper,thicknessMm:t,method:'board'});}catch(error){assert.match(String(error.code),/^TLP_/,label);continue;}
    const scene=buildPaperSheet(phys,plan);
    assert.deepEqual(cropMarkViolations(scene),[],`${label} ${paper}`);
    assert.deepEqual(marginViolations(scene),[],`${label} ${paper}`);
    assert.deepEqual(paperOverlaps(scene).slice(0,5),[],`${label} ${paper}`);
  }
  // 자 검증: 인쇄 영역에 붙은 0.2 mm 회색 실선(이전 도안)을 한 조각에 심으면 (1) 이 잡아요.
  const phys=physOf(H0_3F),scene=buildPaperSheet(phys,paperPlan(phys,{thicknessMm:1,method:'board'})),v=scene.paper.faces.XM.visible,w=0.2;
  const ring=[[v.x0-w,v.y0-w,v.x1+w,v.y0],[v.x0-w,v.y1,v.x1+w,v.y1+w],[v.x0-w,v.y0,v.x0,v.y1],[v.x1,v.y0,v.x1+w,v.y1]]
    .map(([x0,y0,x1,y1])=>({kind:'polygon',color:{r:128,g:128,b:128},role:'cut',face:'XM',points:[{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}]}));
  const planted=cropMarkViolations({...scene,shapes:[...scene.shapes,...ring]});
  assert.ok(planted.some(x=>x.startsWith('XM:')&&x.includes('인쇄 영역')),'붙은 실선을 심었는데 자가 통과했어요');
  // 표시 하나를 빼도 잡아요.
  const dropped=scene.shapes.indexOf(scene.shapes.find(s=>s.face==='ZP'&&s.role==='cut'));
  assert.ok(cropMarkViolations({...scene,shapes:scene.shapes.filter((_,k)=>k!==dropped)}).some(x=>x.startsWith('ZP')));
});

test('전개도 결과물은 설계 예시 상태 수치와 맞아요(A4 · 카드지 0.3 · H8)',()=>{
  const h8=physOf(encodeH(Uint8Array.of(1),{version:8,mode:3,tones:2,ecc:'M',mask:0,finder:'frame'}));
  const plan=paperPlan(h8,{thicknessMm:0.3});
  assert.deepEqual([plan.sideMm,plan.pitchMm,Math.floor(plan.moduleMm*100)/100,plan.method],[65.6,65.3,1.45,'sheet']);
  const scene=buildPaperSheet(h8,plan);
  assert.equal(scene.paper.tabs.length,7);
  // 50 mm 보정 막대: 끝 틱 중심 간 거리 50 mm.
  assert.ok(Math.abs(scene.paper.band.barEnd-scene.paper.band.barStart-50)<1e-12);
  const bar=scene.shapes.filter(s=>s.role==='bar');
  assert.equal(bar.length,7);
  // 캡션은 «s=65.6 t=0.3» 이에요.
  assert.equal(scene.paper.labels.find(l=>l.id==='caption').text,'s=65.6 t=0.3');
});
