/** Preview-only controls. These helpers never change encoded data or export pixels. */
export function hRotationSpaceKey(event,{active=false,preview3d=false}={}) {
  if(!active||!preview3d||event.repeat||event.defaultPrevented||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey)return false;
  if(event.code!=='Space'&&event.key!==' ')return false;
  const target=event.target;
  return !target?.isContentEditable&&!target?.closest?.('input,textarea,select,button,a,[role="textbox"],[contenteditable="true"]');
}
export function hPreviewSquareSide({width,height,toolbarHeight=0,padding=24,gap=12}) {
  if(![width,height,toolbarHeight,padding,gap].every(Number.isFinite))return 0;
  return Math.max(0,Math.floor(Math.min(width-padding,height-padding-toolbarHeight-gap)));
}
export function hBrightestPaletteHex(levels=[]) {
  const rgb=levels.map(level=>typeof level==='string'&&/^#[0-9a-f]{6}$/i.test(level)?{r:parseInt(level.slice(1,3),16),g:parseInt(level.slice(3,5),16),b:parseInt(level.slice(5,7),16)}:level)
    .filter(level=>level&&['r','g','b'].every(key=>Number.isFinite(level[key])&&level[key]>=0&&level[key]<=255));
  const linear=v=>v/255<=.04045?v/255/12.92:((v/255+.055)/1.055)**2.4;
  const luminance=v=>.2126*linear(v.r)+.7152*linear(v.g)+.0722*linear(v.b);
  const best=rgb.reduce((a,b)=>!a||luminance(b)>luminance(a)?b:a,null);
  return best?'#'+['r','g','b'].map(key=>Math.round(best[key]).toString(16).padStart(2,'0')).join(''):'#ffffff';
}
export function hControlIcon(kind) {
  const paths={
    play:'<path d="m8 4 12 8-12 8Z" fill="currentColor" stroke="none"/>',
    pause:'<path d="M6 4h4v16H6zm8 0h4v16h-4z" fill="currentColor" stroke="none"/>',
    cube:'<path d="m12 2 9 5v10l-9 5-9-5V7Zm-9 5 9 5 9-5M12 12v10"/>',
    plane:'<path d="M3 5h18v14H3Z"/>',
    home:'<path d="m3 11 9-8 9 8M6 9v12h12V9M10 21v-7h4v7"/>',
    zoom:'<circle cx="10" cy="10" r="7"/><path d="m15 15 6 6M6 10h8M10 6v8"/>',
    rotate:'<path d="M4 9a8 8 0 1 1 0 6M4 3v6h6"/>',
    x:'<path d="m8 4 4-3 4 3m-4-3v22m-4-3 4 3 4-3"/><ellipse cx="12" cy="12" rx="9" ry="4"/>',
    y:'<path d="m4 8-3 4 3 4m-3-4h22m-3-4 3 4-3 4"/><ellipse cx="12" cy="12" rx="4" ry="9"/>',
    gyro:'<circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><ellipse cx="12" cy="12" rx="9" ry="4"/>',
    image:'<rect x="2" y="3" width="20" height="18" rx="2"/><circle cx="8" cy="8" r="2"/><path d="m3 18 6-6 4 4 4-6 5 7"/>',
    copy:'<rect x="8" y="7" width="12" height="14" rx="2"/><path d="M16 7V3H4v14h4"/>',
    down:'<path d="m5 9 7 7 7-7"/>',up:'<path d="m5 15 7-7 7 7"/>',
  };
  return `<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[kind]??paths.cube}</svg>`;
}
