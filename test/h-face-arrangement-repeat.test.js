import test from 'node:test';
import assert from 'node:assert/strict';
import {H_ARRANGEMENTS,hDisplayMap,hImageTargets,hContentFitsSingleView} from '../src/h-face-arrangement.js';
import {hModeFaces} from '../src/h-profile.js';

// 2026-09-24 운영자 관찰 «3면 + 6면 (반복) 인데 반대면에 코드가 안 나와요» 의 자예요.
// 규칙: 1…3면 + 6면 렌더(대칭 제외)는 코드가 있는 물리면을 마주보는 빈 물리면에 같은 논리 면으로 복제해요.
const OPPOSITE=[['ZM','ZP'],['XM','XP'],['YM','YP']];
const fake=mode=>({mode,faces:Object.fromEntries(hModeFaces(mode).map(face=>[face,true]))});
const table=map=>Object.fromEntries(Object.entries(map.physicalToLogical));

test('3F + 6면(반복): 아이소메트릭은 여섯 면 모두 코드(반대면 = 같은 논리 면), 빈 면·이미지 카드 0개',()=>{
  for(const arrangement of ['isometric','symmetric']){ // 3F 의 symmetric 은 아이소메트릭으로 정규화돼요
    const map=hDisplayMap(fake(3),{arrangement,renderFaces:6});
    assert.equal(map.arrangement,'isometric');
    assert.deepEqual(table(map),{ZM:'ZM',XM:'XM',YM:'YM',ZP:'ZM',XP:'XM',YP:'YM'});
    assert.deepEqual([...map.logicalDataFaces],['ZM','XM','YM'],'고유 면 수는 그대로 셋');
    assert.deepEqual([...map.blankFaces],[]);
    assert.deepEqual(hImageTargets(fake(3),{arrangement,renderFaces:6}),[]);
  }
});

test('3F + 6면(반복): 수평/수직은 YP←YM 만 추가돼요 — ZM/ZP 회전축 cap 은 계속 비고 한 이미지를 공유해요',()=>{
  for(const arrangement of ['horizontal','vertical']){
    const map=hDisplayMap(fake(3),{arrangement,renderFaces:6});
    assert.deepEqual(table(map),{ZM:null,XM:'XM',YM:'YM',ZP:null,XP:'ZM',YP:'YM'},arrangement);
    assert.deepEqual([...map.blankFaces],['ZM','ZP'],arrangement);
    assert.deepEqual(hImageTargets(fake(3),{arrangement,renderFaces:6}),[{face:'ZM',aliases:['ZM','ZP']}],arrangement);
  }
});

test('3F + 3면 렌더는 그대로예요 — 세 빈 면이 각각 이미지 카드',()=>{
  const map=hDisplayMap(fake(3),{renderFaces:3});
  assert.deepEqual(table(map),{ZM:'ZM',XM:'XM',YM:'YM',ZP:null,XP:null,YP:null});
  assert.deepEqual(hImageTargets(fake(3),{renderFaces:3}).map(t=>t.face),['ZP','XP','YP']);
});

test('반복 불변식(모드 1–6 × 배치 × 3/6면): 반복일 때 마주보는 짝은 한쪽만 코드일 수 없고 두 번 그려진 논리 면은 마주보는 짝에만 있어요(3면 수평/수직의 XM↔XP 는 다른 논리 면), 4…6면·대칭·3면 렌더는 복제하지 않아요',()=>{
  let repeatCases=0,plainCases=0;
  for(const mode of [1,2,3,4,5,6])for(const arrangement of H_ARRANGEMENTS)for(const renderFaces of [3,6]){
    let map;try{map=hDisplayMap(fake(mode),{arrangement,renderFaces});}catch{continue;}
    const label=`${mode}F/${arrangement}/rf${renderFaces}`,p2l=map.physicalToLogical;
    const repeat=mode<=3&&map.renderFaces===6&&map.arrangement!=='symmetric';
    const where=new Map();for(const [physical,logical] of Object.entries(p2l))if(logical)where.set(logical,[...(where.get(logical)??[]),physical]);
    if(repeat){
      repeatCases++;
      for(const [m,p] of OPPOSITE)assert.equal(!p2l[m],!p2l[p],`${label}: ${m}·${p} 중 한쪽만 코드예요`);
      // 두 번 그려진 논리 면은 반드시 마주보는 짝에 있어요(그 밖의 이동은 배치 규칙이지 복제가 아니에요).
      for(const [logical,faces] of where)if(faces.length>1)assert.ok(faces.length===2&&OPPOSITE.some(([m,p])=>faces.includes(m)&&faces.includes(p)),`${label}: ${logical}@${faces}`);
      if(map.arrangement!=='isometric')assert.ok(!p2l.ZM&&!p2l.ZP,`${label}: cap 에 코드 없음`);
    }else{
      plainCases++;
      for(const [logical,faces] of where)assert.equal(faces.length,1,`${label}: 반복 아님 → ${logical} 은 한 번만`);
    }
    // 고유 논리 면은 항상 모드의 면 그대로예요(표시 반복이 용량·수집 required 를 바꾸지 않아요).
    assert.deepEqual([...map.logicalDataFaces],hModeFaces(mode),label);
    assert.deepEqual(new Set(Object.values(p2l).filter(Boolean)),new Set(hModeFaces(mode)),`${label}: 모든 논리 면이 한 번 이상 그려져요`);
  }
  assert.ok(repeatCases>=9&&plainCases>=20,`조합 유도가 무너졌어요 (${repeatCases}/${plainCases})`);
});

test('회귀: 1F·2F 6면(반복) 표와 이미지 alias 는 전과 같아요',()=>{
  assert.deepEqual(table(hDisplayMap(fake(1),{renderFaces:6})),{ZM:null,XM:'XM',YM:null,ZP:null,XP:'XM',YP:null});
  assert.deepEqual(hImageTargets(fake(1),{renderFaces:6}),[{face:'ZM',aliases:['ZM','ZP']},{face:'YM',aliases:['YM','YP']}]);
  for(const arrangement of ['isometric','horizontal','vertical']){
    assert.deepEqual(table(hDisplayMap(fake(2),{arrangement,renderFaces:6})),{ZM:null,XM:'XM',YM:'YM',ZP:null,XP:'XM',YP:'YM'},arrangement);
    assert.deepEqual(hImageTargets(fake(2),{arrangement,renderFaces:6}),[{face:'ZM',aliases:['ZM','ZP']}],arrangement);
  }
  assert.deepEqual(table(hDisplayMap(fake(2),{arrangement:'symmetric',renderFaces:6})),{ZM:null,XM:'XM',YM:null,ZP:null,XP:'YM',YP:null});
  assert.deepEqual(table(hDisplayMap(fake(4),{renderFaces:6})),{ZM:'YP',XM:'XM',YM:'YM',ZP:null,XP:'XP',YP:null},'4F 는 반복이 아니에요');
  assert.deepEqual(table(hDisplayMap(fake(5),{renderFaces:6})),{ZM:'ZM',XM:'XM',YM:'YM',ZP:null,XP:'XP',YP:'YP'},'5F 는 반복이 아니에요');
});

test('3F + 6면(반복): 이전에 올린 빈 면 이미지는 표시·2.5D 판정에서 빠지고(코드 셋이 한 시점에 들어와요) 3면으로 돌아가면 다시 쓰여요',()=>{
  const images={ZP:{},XP:{},YP:{}};
  assert.equal(hContentFitsSingleView(fake(3),images,{renderFaces:6}),true);
  assert.equal(hContentFitsSingleView(fake(3),images,{renderFaces:3}),false,'3면 렌더에서는 이미지 셋까지 한 시점에 못 들어와요');
});
