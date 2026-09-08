// 격리 관측 실험: 정규화 영상 평면의 8자유도 H + 밝기 gain/bias Gauss-Newton.
// cost는 진단값이며 sourceIdentity/신뢰/수용 게이트를 결정하지 않는다.
export function bilinear(field, x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  if (ix < 0 || iy < 0 || ix + 1 >= field.width || iy + 1 >= field.height) return null;
  const f = x - ix, g = y - iy, i = iy * field.width + ix, d = field.data;
  return (1-g)*((1-f)*d[i]+f*d[i+1])+g*((1-f)*d[i+field.width]+f*d[i+field.width+1]);
}
function solve(A, b) {
  const n = b.length, a = A.map((row,i)=>[...row,b[i]]);
  for(let c=0;c<n;c++) {
    let pivot=c; for(let r=c+1;r<n;r++)if(Math.abs(a[r][c])>Math.abs(a[pivot][c]))pivot=r;
    if(Math.abs(a[pivot][c])<1e-12)return null;
    [a[c],a[pivot]]=[a[pivot],a[c]];
    const scale=a[c][c];for(let j=c;j<=n;j++)a[c][j]/=scale;
    for(let r=0;r<n;r++)if(r!==c){const factor=a[r][c];for(let j=c;j<=n;j++)a[r][j]-=factor*a[c][j];}
  }
  return a.map(row=>row[n]);
}
export function multiply3(a,b){const out=new Float64Array(9);for(let i=0;i<3;i++)for(let j=0;j<3;j++)for(let k=0;k<3;k++)out[3*i+j]+=a[3*i+k]*b[3*k+j];return out;}
export function trackPhotometric(previous,current,points,{iterations=30,initial=null}={}) {
  const started=performance.now();
  if(previous.width!==current.width||previous.height!==current.height)throw new Error('크기가 다른 프레임');
  if(!points.length)throw new Error('빈 관측 점');
  const cx=previous.width/2,cy=previous.height/2,scale=Math.max(previous.width,previous.height)/2;
  const normalize=new Float64Array([1/scale,0,-cx/scale,0,1/scale,-cy/scale,0,0,1]);
  const denormalize=new Float64Array([scale,0,cx,0,scale,cy,0,0,1]);
  const seed=initial?multiply3(multiply3(normalize,initial),denormalize):new Float64Array([1,0,0,0,1,0,0,0,1]);
  let p=[seed[0]/seed[8]-1,seed[1]/seed[8],seed[2]/seed[8],seed[3]/seed[8],seed[4]/seed[8]-1,seed[5]/seed[8],seed[6]/seed[8],seed[7]/seed[8],1,0];
  const template=points.map(pt=>({u:(pt.x-cx)/scale,v:(pt.y-cy)/scale,t:bilinear(previous,pt.x,pt.y)})).filter(pt=>pt.t!==null);
  function evaluate(params,derivatives=false){
    const A=Array.from({length:10},()=>new Float64Array(10)),b=new Float64Array(10),residuals=[];
    let cost=0,sumT=0,sumI=0,sumTT=0,sumII=0,sumTI=0;
    for(const {u,v,t} of template){
      const den=1+params[6]*u+params[7]*v;if(Math.abs(den)<1e-6)continue;
      const un=((1+params[0])*u+params[1]*v+params[2])/den;
      const vn=(params[3]*u+(1+params[4])*v+params[5])/den;
      const x=cx+scale*un,y=cy+scale*vn,I=bilinear(current,x,y);
      if(I===null)continue;
      const residual=I-params[8]*t-params[9];cost+=residual*residual;residuals.push(Math.abs(residual));
      sumT+=t;sumI+=I;sumTT+=t*t;sumII+=I*I;sumTI+=t*I;
      if(!derivatives)continue;
      const xp=bilinear(current,x+.5,y),xm=bilinear(current,x-.5,y),yp=bilinear(current,x,y+.5),ym=bilinear(current,x,y-.5);
      if([xp,xm,yp,ym].some(z=>z===null))continue;
      const gx=(xp-xm)*scale/den,gy=(yp-ym)*scale/den;
      const J=[gx*u,gx*v,gx,gy*u,gy*v,gy,-(gx*un+gy*vn)*u,-(gx*un+gy*vn)*v,-t,-1];
      for(let a=0;a<10;a++){b[a]-=J[a]*residual;for(let z=0;z<=a;z++)A[a][z]+=J[a]*J[z];}
    }
    for(let a=0;a<10;a++)for(let z=0;z<a;z++)A[z][a]=A[a][z];
    const n=residuals.length;residuals.sort((a,b)=>a-b);
    const varianceT=sumTT-sumT*sumT/n,varianceI=sumII-sumI*sumI/n;
    return {cost:n?cost/n:Infinity,count:n,coverage:n/template.length,rms:n?Math.sqrt(cost/n):null,
      p95:residuals[Math.min(n-1,Math.floor(n*.95))]??null,
      ncc:varianceT>0&&varianceI>0?(sumTI-sumT*sumI/n)/Math.sqrt(varianceT*varianceI):null,A,b};
  }
  const before=evaluate(p);let fitted=before,used=0;
  for(;used<iterations;used++){
    const linear=evaluate(p,true);if(linear.count<20)break;
    for(let i=0;i<10;i++)linear.A[i][i]+=Math.max(1e-7,linear.A[i][i]*1e-5);
    const delta=solve(linear.A,linear.b);if(!delta)break;
    let next=null;
    for(const alpha of [1,.5,.25,.125,.0625]){
      const trial=p.map((value,i)=>value+alpha*delta[i]),score=evaluate(trial);
      if(score.coverage>=before.coverage&&score.cost<fitted.cost){next={trial,score};break;}
    }
    if(!next)break;p=next.trial;fitted=next.score;
  }
  const normalized=new Float64Array([1+p[0],p[1],p[2],p[3],1+p[4],p[5],p[6],p[7],1]);
  const motion=multiply3(multiply3(denormalize,normalized),normalize);
  const compact=s=>({count:s.count,coverage:s.coverage,rms:s.rms,p95:s.p95,ncc:s.ncc});
  return {motion,before:compact(before),after:compact(fitted),gain:p[8],bias:p[9],iterations:used,ms:performance.now()-started};
}
