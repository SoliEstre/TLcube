/** H 부분면 수집. route8은 분류 힌트이고, 본문 수용은 항상 전체 RS/CRC 검사예요. */
import { hModeFaces, normalizeHProfile } from './h-profile.js';
import { validateHFace } from './h-layout.js';
import { decodeH } from './h-codec.js';

const equal=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
const copy=value=>structuredClone(value);
const clamp=value=>Math.min(1,Math.max(0,value));
export function hObservationProfile(obs) {
  if (!obs || obs.ok!==true || obs.mirror!==false
    || !Number.isInteger(obs.hamming)||obs.hamming<0||obs.hamming>(obs.finder==='corners'?2:0)
    || !Number.isInteger(obs.rotation)||obs.rotation<0||obs.rotation>3
    || !['version','n','mode','tones','ecc','mask','routeId'].every(k=>Object.hasOwn(obs,k))) return null;
  try {
    const p=normalizeHProfile(obs);
    if(obs.n!==p.n||!Number.isInteger(obs.routeId)||obs.routeId<0||obs.routeId>255
      ||!hModeFaces(p.mode).includes(obs.face)
      ||!validateHFace(obs.levels,{...p,face:obs.face,routeId:obs.routeId}))return null;
    return {...p,routeId:obs.routeId};
  }catch{return null;}
}
const wireKey=p=>[p.finder,p.version,p.n,p.mode,p.tones,p.ecc,p.mask,p.routeId].join(':');
const rank=v=>v.quality+Math.min(8,v.support)*.025;

/** 기본8묶음×6면×2후보. 48초 회전 주기보다 긴90초 뒤 오래된 면을 버려요. */
export function createHCollector({ttlMs=90_000,maxAssemblies=8,maxFaceVariants=2,
  maxDecodeAttemptsPerUpdate=8,decode=decodeH}={}) {
  if(!Number.isFinite(ttlMs)||ttlMs<1||!Number.isInteger(maxAssemblies)||maxAssemblies<1||maxAssemblies>16
    ||!Number.isInteger(maxFaceVariants)||maxFaceVariants<1||maxFaceVariants>2
    ||!Number.isInteger(maxDecodeAttemptsPerUpdate)||maxDecodeAttemptsPerUpdate<1||maxDecodeAttemptsPerUpdate>16
    ||typeof decode!=='function')throw new RangeError('H collector bounds');
  const rows=new Map(),sessions=new Map();let clock=0,epoch=0,variantId=0,lastSession='camera';
  const stats={frames:0,accepted:0,rejected:0,duplicates:0,evictions:0,expiredFaces:0,decodeAttempts:0,lastAttempts:0};
  function prune(timestamp) {
    for(const [key,row] of rows) {
      if(timestamp-row.lastValidAt>ttlMs){rows.delete(key);stats.evictions++;continue;}
      if(row.result)continue;
      for(const [face,variants] of row.faces){
        const live=variants.filter(v=>timestamp-v.at<=ttlMs);
        stats.expiredFaces+=variants.length-live.length;
        if(live.length)row.faces.set(face,live);else row.faces.delete(face);
      }
      if(!row.faces.size){rows.delete(key);stats.evictions++;}
    }
  }
  function snapshot(sessionId=lastSession) {
    const candidates=[...rows.values()].filter(r=>r.sessionId===sessionId).map(row=>{
      const present=hModeFaces(row.profile.mode).filter(f=>row.faces.has(f));
      return {id:row.id,state:row.result?'DONE':'COLLECTING',profile:{...row.profile},trackId:row.trackId,
        count:present.length,required:row.profile.mode,present,
        missing:hModeFaces(row.profile.mode).filter(f=>!row.faces.has(f)),
        variants:Object.fromEntries([...row.faces].map(([f,v])=>[f,v.length])),
        faceExpiresAt:Object.fromEntries([...row.faces].map(([f,v])=>[f,row.result?row.lastValidAt+ttlMs:Math.max(...v.map(item=>item.at))+ttlMs])),
        lastValidAt:row.lastValidAt,expiresAt:row.lastValidAt+ttlMs,lastDecodeFailure:row.lastDecodeFailure,
        ...(row.result?{result:copy(row.result)}:{})};
    }).sort((a,b)=>Number(b.state==='DONE')-Number(a.state==='DONE')||b.count/b.required-a.count/a.required||b.lastValidAt-a.lastValidAt);
    const best=candidates[0];
    return {state:best?.state??'EMPTY',count:best?.count??0,required:best?.required??0,
      missing:best?.missing.slice()??[],...(best?.result?{result:copy(best.result)}:{}),
      leadingId:best?.id??null,assemblies:candidates,stats:{...stats}};
  }
  function updateFace(row,obs,frameId,timestamp) {
    const variants=row.faces.get(obs.face)??[],existing=variants.find(v=>equal(v.levels,obs.levels));
    const score=Number.isFinite(obs.quality?.score)?clamp(obs.quality.score):.5;
    if(existing){
      if(existing.lastFrame!==frameId){existing.support=Math.min(8,existing.support+1);existing.lastFrame=frameId;}
      existing.quality=Math.max(existing.quality,score);existing.at=timestamp;stats.duplicates++;
    }else variants.push({id:++variantId,levels:obs.levels.slice(),quality:score,support:1,lastFrame:frameId,at:timestamp});
    variants.sort((a,b)=>rank(b)-rank(a)||b.at-a.at||b.id-a.id);
    if(variants.length>maxFaceVariants)variants.length=maxFaceVariants;
    row.faces.set(obs.face,variants);row.lastValidAt=timestamp;
    // 현재 조합은2^6=64이하예요. 교체로 쌓인 오래된 시도키도 유한하게 제한해요.
    if(row.tried.size>128)row.tried.clear();
  }
  function tryComplete(row,budget) {
    const ids=hModeFaces(row.profile.mode);
    if(row.result||ids.some(f=>!row.faces.has(f)))return 0;
    // 면마다2후보라 조합은 최대64예요. 본문 복호는 매 갱신8회 예산을 지켜요.
    let combinations=[{variants:[],score:0}];
    for(const face of ids)combinations=combinations.flatMap(c=>row.faces.get(face).map(v=>({variants:[...c.variants,v],score:c.score+rank(v)})));
    combinations.sort((a,b)=>b.score-a.score);
    let attempted=0;
    for(const candidate of combinations){
      if(attempted>=budget)break;
      const key=candidate.variants.map(v=>v.id).join(',');if(row.tried.has(key))continue;
      row.tried.add(key);attempted++;stats.decodeAttempts++;
      let decoded;
      try{decoded=decode(Object.fromEntries(ids.map((face,i)=>[face,candidate.variants[i].levels.slice()])),{...row.profile});}
      catch{decoded={ok:false,reason:'decode-exception'};}
      if(decoded?.ok===true&&decoded.bytes instanceof Uint8Array){
        row.result={ok:true,bytes:decoded.bytes.slice(),text:decoded.text??null,crc:decoded.crc,corrected:decoded.corrected??0};
        row.lastDecodeFailure=null;break;
      }
      row.lastDecodeFailure=String(decoded?.reason??'body-check');
    }
    return attempted;
  }
  function addFrame({observations=[],timestamp,frameId,sessionId='camera',trackId='view'}={}) {
    if(!Array.isArray(observations)||observations.length>48||!Number.isFinite(timestamp)||timestamp<0
      ||!(typeof frameId==='string'||Number.isSafeInteger(frameId))||typeof sessionId!=='string'||!sessionId||sessionId.length>80
      ||typeof trackId!=='string'||!trackId||trackId.length>80)throw new TypeError('H frame identity');
    lastSession=sessionId;stats.lastAttempts=0;
    let session=sessions.get(sessionId);
    if(timestamp<clock||session&&(timestamp<session.timestamp||session.frames.has(frameId))){stats.rejected++;return snapshot(sessionId);}
    if(!session){
      if(sessions.size>=16){const first=sessions.keys().next().value;cancel(first);}
      session={timestamp,frames:new Set()};sessions.set(sessionId,session);
    }
    session.timestamp=timestamp;session.frames.add(frameId);
    if(session.frames.size>128)session.frames.delete(session.frames.values().next().value);
    clock=Math.max(clock,timestamp);prune(clock);stats.frames++;
    for(const obs of observations){
      const p=hObservationProfile(obs);if(!p){stats.rejected++;continue;}
      const key=JSON.stringify([sessionId,trackId,wireKey(p)]);
      let row=rows.get(key);
      if(!row){
        if(rows.size>=maxAssemblies){
          const victim=[...rows.entries()].filter(([,r])=>!r.result).sort((a,b)=>a[1].lastValidAt-b[1].lastValidAt)[0];
          if(!victim){stats.rejected++;continue;}
          rows.delete(victim[0]);stats.evictions++;
        }
        row={id:`H:${++epoch}`,sessionId,trackId,profile:p,faces:new Map(),lastValidAt:timestamp,tried:new Set(),result:null,lastDecodeFailure:null};
        rows.set(key,row);
      }
      if(!row.result)updateFace(row,obs,frameId,timestamp);
      stats.accepted++;
    }
    // 다른 track/session의 관측은 섞지 않고 모든 묶음의 갱신 예산을 합산해요.
    for(const row of rows.values())if(row.sessionId===sessionId){
      stats.lastAttempts+=tryComplete(row,maxDecodeAttemptsPerUpdate-stats.lastAttempts);
      if(stats.lastAttempts>=maxDecodeAttemptsPerUpdate)break;
    }
    return snapshot(sessionId);
  }
  function advance(timestamp) {
    if(!Number.isFinite(timestamp)||timestamp<clock)throw new RangeError('H monotonic clock');
    clock=timestamp;prune(clock);return snapshot();
  }
  function cancel(sessionId=lastSession) {
    for(const [key,row] of rows)if(row.sessionId===sessionId)rows.delete(key);
    sessions.delete(sessionId);return snapshot(sessionId);
  }
  function reset(){rows.clear();sessions.clear();clock=0;epoch++;for(const key of Object.keys(stats))stats[key]=0;return snapshot();}
  return Object.freeze({addFrame,advance,cancel,reset,snapshot});
}
