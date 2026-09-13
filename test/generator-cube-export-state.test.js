/** 실제 UI 핸들러를 VM에서 실행해 pending render와 async snapshot 경계를 잠가요. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const index=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
const start=index.indexOf(index.includes('const CUBE_EXPORT_IDS=')?'const CUBE_EXPORT_IDS=':'const CUBE_EXPORT_LABELS=');
const end=index.indexOf('function flashCopied(',start);
assert.ok(start>=0&&end>start);
const source=index.slice(start,end);
const ids=['exportNetPng','copyNetPng','exportNetSvg','copyNetSvg','exportCubeGltf','copyCubeGltf','exportCubeSchem'];
const current=id=>({id,type:'H',encoded:{version:7,mode:6},scene:{id}});
function harness({gzip='resolve',clipboard='resolve',compression=true}={}){
  const nodes=new Map(),handlers=new Map(),downloads=[],copies=[],pending=[],voxelCalls=[];
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{disabled:false,hidden:false,value:'1',textContent:'',title:'',dataset:{},children:[],innerHTML:'',classList:{add(){},toggle(){}},setAttribute(){},removeAttribute(){},addEventListener:(kind,fn)=>handlers.set(id,fn)});
    return nodes.get(id);
  };
  for(const scale of [1,2,4]){const card=node(`block-${scale}`);card.dataset.blockScale=String(scale);node('cubeBlockScaleCards').children.push(card);}
  const c={TextEncoder,TextDecoder,Blob,Error,RangeError,TypeError,CompressionStream:compression?class{}:undefined,
    ClipboardItem:class{constructor(data){this.data=data;}},current:current('old'),generatorState:{type:'Y',preset:'mono',exportSize:'auto',exportWidth:1008,exportHeight:1008},genI18n:{lang:'ko'},
    $:node,document:{querySelectorAll:()=>[]},paletteOf:()=>({}),flashCopied:()=>{},hImageEditor:{flush(){}},hExportIconMarkup:()=>'',hBlockIconMarkup:()=>'',flushes:0,pendingCurrent:null,
    flushScheduledRender:()=>{c.flushes++;if(c.pendingCurrent){c.current=c.pendingCurrent;c.pendingCurrent=null;return true;}return false;},
    generatorCubeModel:cur=>({id:cur.id}),cubeModelToGltf:m=>({id:m.id}),cubeNetScene:m=>({id:m.id,width:127,height:168}),
    voxelizeCube:(m,{scale})=>{voxelCalls.push({id:m.id,scale});return{id:m.id,width:43,height:43,length:43};},
    gzipSchematic:v=>gzip==='reject'?Promise.reject(new Error('gzip failed')):gzip==='defer'?new Promise((resolve,reject)=>pending.push({resolve,reject,id:v.id})):Promise.resolve(new TextEncoder().encode(v.id)),
    resolveExportSize:()=>({width:1008,height:1008}),exportDitherBits:()=>8,resolveExportPpi:()=>96,
    renderExportPng:s=>new TextEncoder().encode(s.id),renderExportSvg:s=>'<svg>'+s.id+'</svg>',
    exportFilename:ext=>{if(!c.current)throw new Error('filename missing current');return c.current.id+'.'+ext;},
    download:(bytes,mime,name)=>downloads.push({text:new TextDecoder().decode(bytes),mime,name}),
    navigator:clipboard==='absent'?{}:{clipboard:{writeText:async text=>{if(clipboard==='reject')throw new Error('permission denied');copies.push(text);},write:async items=>{if(clipboard==='reject')throw new Error('permission denied');copies.push(items);}}},
  };
  vm.createContext(c);vm.runInContext(source,c,{timeout:1000});
  return{c,node,downloads,copies,pending,voxelCalls,click:id=>handlers.get(id)(),sync:()=>vm.runInContext('syncCubeExportUi()',c,{timeout:1000})};
}

for(const id of ids)test('예약 렌더를 반영한 최신 본문을 내보내요: '+id,async()=>{
  const h=harness();h.c.pendingCurrent=current('new');await h.click(id);
  const copied=id==='copyNetPng'?await h.copies[0]?.[0]?.data['image/png'].text():h.copies[0];
  const data=h.downloads[0]?.text??copied;
  assert.equal(h.c.flushes,1);assert.equal(typeof data,'string');assert.ok(data.includes('new'));assert.ok(!data.includes('old'));
});

for(const next of ['new',null])test('압축 중 current가 바뀌어도 파일명과 본문은 클릭 시점이에요: '+next,async()=>{
  const h=harness({gzip:'defer'}),job=h.click('exportCubeSchem');
  assert.equal(h.pending.length,1);h.c.current=next?current(next):null;
  h.pending[0].resolve(new TextEncoder().encode(h.pending[0].id));await job;
  assert.equal(h.downloads.length,1);assert.equal(h.downloads[0].text,'old');assert.equal(h.downloads[0].name,'old.schem');
  assert.ok(ids.every(id=>!h.node(id).disabled));
});

test('UI 동기화가 busy를 풀지 않고 모든 중복 export를 거부해요',async()=>{
  const h=harness({gzip:'defer'}),job=h.click('exportCubeSchem');
  h.c.current=current('new');h.sync();assert.ok(ids.every(id=>h.node(id).disabled));
  const attempts=ids.map(id=>h.click(id));
  const count=h.pending.length,downloadCount=h.downloads.length,copyCount=h.copies.length;
  for(const pending of h.pending)pending.resolve(new TextEncoder().encode(pending.id));
  await Promise.all([job,...attempts]);
  assert.equal(count,1);assert.equal(downloadCount,0);assert.equal(copyCount,0);assert.equal(h.downloads.length,1);
  assert.ok(ids.every(id=>!h.node(id).disabled));
});

test('gzip 실패도 busy를 복구하고 파일을 내려받지 않아요',async()=>{
  const h=harness({gzip:'reject'});await h.click('exportCubeSchem');
  assert.equal(h.downloads.length,0);assert.match(h.node('cubeExportStatus').textContent,/gzip failed/);assert.ok(ids.every(id=>!h.node(id).disabled));
});

for(const clipboard of ['absent','reject'])test('복사 실패 뒤 수동 다운로드는 살아 있어요: '+clipboard,async()=>{
  const h=harness({clipboard});for(const id of ['copyNetPng','copyNetSvg','copyCubeGltf'])await h.click(id);
  assert.equal(h.copies.length,0);assert.equal(h.downloads.length,0);assert.ok(h.node('cubeExportStatus').textContent.length>0);
  assert.ok(ids.every(id=>!h.node(id).disabled));await h.click('exportCubeGltf');assert.equal(h.downloads.length,1);
});

test('gzip 미지원은 다른 내보내기까지 막지 않아요',()=>{
  const h=harness({compression:false});h.sync();assert.equal(h.node('exportCubeSchem').disabled,true);assert.ok(h.node('exportCubeSchem').title.length>0);
  assert.ok(ids.filter(id=>id!=='exportCubeSchem').every(id=>!h.node(id).disabled));
});

test('비Y 또는 생성실패 current에서는 내보내기 부수효과가 없어요',async()=>{
  for(const value of [{type:'O'},null]){
    const h=harness();h.c.generatorState.type='O';h.c.current=value;h.sync();assert.equal(h.node('cubeExportSection').hidden,true);
    for(const id of ids)await h.click(id);assert.equal(h.downloads.length,0);assert.equal(h.copies.length,0);assert.equal(h.pending.length,0);
  }
});

test('구조물 버튼은 선택한 셀당 블록 수 1/2/4를 숫자로 전달해요',async()=>{
  for(const scale of [1,2,4]){
    const h=harness();h.node('cubeBlockScale').value=String(scale);
    await h.click('exportCubeSchem');
    assert.deepEqual(h.voxelCalls,[{id:'old',scale}]);assert.equal(h.downloads.length,1);
  }
});

test('각 다운로드 버튼의 MIME과 확장자는 실제 형식 분기와 같아요',async()=>{
  for(const [id,mime,name]of [
    ['exportNetPng','image/png','old_net.png'],
    ['exportNetSvg','image/svg+xml','old_net.svg'],
    ['exportCubeGltf','model/gltf+json','old.gltf'],
    ['exportCubeSchem','application/octet-stream','old.schem'],
  ]){
    const h=harness();await h.click(id);assert.equal(h.downloads.length,1);
    assert.equal(h.downloads[0].mime,mime);assert.equal(h.downloads[0].name,name);assert.equal(h.copies.length,0);
  }
});

test('PNG는 이미지 Blob으로, SVG와 glTF는 문자열로 복사해요',async()=>{
  const png=harness();await png.click('copyNetPng');
  assert.equal(png.copies.length,1);assert.equal(png.copies[0].length,1);
  const data=png.copies[0][0].data;assert.deepEqual(Object.keys(data),['image/png']);
  assert.equal(data['image/png'].type,'image/png');assert.equal(await data['image/png'].text(),'old');
  const svg=harness();await svg.click('copyNetSvg');assert.equal(svg.copies[0],'<svg>old</svg>');
  const gltf=harness();await gltf.click('copyCubeGltf');assert.deepEqual(JSON.parse(gltf.copies[0]),{id:'old'});
  for(const h of [png,svg,gltf])assert.equal(h.downloads.length,0);
});
