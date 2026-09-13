/** 사진 업로드 사이에 유지되는 H 전용 수명. 카메라 누적과는 섞이지 않아요. */
import { H_PHOTO_WORKER_URL,createHPhotoWorkerEndpoint } from './h-photo-worker-entry.js';

const clone=value=>structuredClone(value);
const abort=()=>Object.assign(new Error('H photo collection reset'),{name:'AbortError'});
export function createHPhotoReader({createWorker=url=>new Worker(url,{type:'module',name:'tlscan-h-photos'}),
  timeoutMs=15000}={}) {
  if(typeof createWorker!=='function'||!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>60000)throw new RangeError('H photo reader bounds');
  let worker=null,fallback=null,generation=1,requestId=0,pending=null,snapshot=null,disposed=false;
  const metrics={mode:'worker',processed:0,errors:0,staleResults:0,lastServiceMs:0};
  function finish(error,result){
    const active=pending;if(!active)return;pending=null;clearTimeout(active.timer);
    if(error)active.reject(error);else active.resolve(clone(result));
  }
  function receive(message){
    if(!pending||message?.generation!==generation||message?.requestId!==pending.requestId){metrics.staleResults++;return;}
    if(message.type==='error'){metrics.errors++;finish(new Error(message.message));return;}
    if(message.type!=='result')return;
    snapshot=clone(message.stats);metrics.processed++;metrics.lastServiceMs=message.serviceMs;
    finish(null,{hit:message.hit,stats:snapshot});
  }
  function reset(){generation++;worker?.terminate();worker=null;fallback=null;snapshot=null;finish(abort());}
  function workerFailure(error){metrics.errors++;
    finish(Object.assign(new Error(error?.message || 'H photo worker failed'),{name:'WorkerError'}));
    reset();metrics.mode='main-fallback';
    // 워커를 잃으면 수집도 새로 시작해요. 옛 통계로 계속 모으는 것처럼 표시하지 않아요.
    fallback=createHPhotoWorkerEndpoint(receive);
  }
  function ensureWorker(){
    if(worker||fallback)return;
    try {
      worker=createWorker(H_PHOTO_WORKER_URL);const created=worker;
      created.onmessage=event=>receive(event.data);
      created.onerror=event=>{if(worker===created){event.preventDefault?.();workerFailure(event);}};
      created.onmessageerror=()=>{if(worker===created)workerFailure(new Error('H photo message'));};
      metrics.mode='worker';
    }catch{metrics.mode='main-fallback';fallback=createHPhotoWorkerEndpoint(receive);}
  }
  async function read(image,{timestamp=performance.now()}={}){
    if(disposed)throw new Error('H photo reader disposed');
    if(pending)throw new Error('H photo reader busy');
    if(!Number.isFinite(timestamp)||timestamp<0||!image?.data?.slice)throw new TypeError('H photo request');
    // 호출자가 배열을 바꾸거나 canvas를 재사용해도 진행 중인 사진은 바뀌지 않아요.
    const owned={width:image.width,height:image.height,data:image.data.slice()};
    ensureWorker();
    return new Promise((resolve,reject)=>{
      const id=++requestId;
      pending={requestId:id,resolve,reject,timer:setTimeout(()=>{
        metrics.errors++;finish(Object.assign(new Error('H photo processing timed out'),{name:'TimeoutError'}));reset();
      },timeoutMs)};
      const message={type:'photo',generation,requestId:id,timestamp,image:owned};
      if(fallback){queueMicrotask(()=>{if(pending?.requestId===id)fallback(message);});return;}
      try{worker.postMessage(message,[owned.data.buffer]);}catch(error){workerFailure(error);}
    });
  }
  return Object.freeze({read,reset,get stats(){return snapshot?clone(snapshot):null;},get metrics(){return {...metrics};},
    dispose(){reset();disposed=true;}});
}
