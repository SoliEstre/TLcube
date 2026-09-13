import test from 'node:test';
import assert from 'node:assert/strict';
import {rasterToPng} from '../src/png.js';
import {createHImageEditor} from '../src/h-image-editor-ui.js';

// assertSceneImage deliberately accepts only a real PNG data URL.  Keep the
// transparent source pixel so palette-background recomposition is observable.
const transparentPngHref=`data:image/png;base64,${Buffer.from(rasterToPng({
  width:1,height:1,pixels:new Uint8ClampedArray([0,0,0,0]),
})).toString('base64')}`;

class Element {
  constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.style={setProperty(){}};this.classList={toggle(){}};this.listeners={};this.attributes={};this.hidden=false;this.value='';}
  append(...items){this.children.push(...items);}
  addEventListener(name,listener){this.listeners[name]=listener;}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  removeAttribute(name){delete this.attributes[name];}
  set textContent(value){this._text=String(value);this.children=[];}
  get textContent(){return this._text??'';}
  set innerHTML(value){this._html=String(value);this.children=[new Element('svg')];}
  get innerHTML(){return this._html??'';}
  click(){this.listeners.click?.({});}
  setCustomValidity(){}
  reportValidity(){return true;}
  getBoundingClientRect(){return {left:0,top:0,width:100,height:100};}
  setPointerCapture(){}
}
class Canvas extends Element {
  constructor(){super('canvas');this.width=1;this.height=1;this.data=new Uint8ClampedArray([0,0,0,0]);}
  getContext(){return {imageSmoothingEnabled:true,drawImage:()=>{},getImageData:()=>({data:this.data})};}
  toDataURL(){return transparentPngHref;}
}
const walk=(root,all=[])=>{for(const child of root.children){all.push(child);walk(child,all);}return all;};
const find=(root,predicate)=>walk(root).find(predicate);

test('editor lifecycle tracks applied palette background without overwriting edited cards',async()=>{
  const previousDocument=globalThis.document,previousBitmap=globalThis.createImageBitmap;
  let palette='#ffffff';
  globalThis.document={activeElement:null,createElement:tag=>tag==='canvas'?new Canvas():new Element(tag)};
  globalThis.createImageBitmap=async()=>({width:1,height:1,close(){}});
  try {
    const host=new Element(),status=new Element(),changes=[];
    const editor=createHImageEditor({container:host,status,text:key=>key,onChange:value=>changes.push(value),getDefaultBackground:()=>palette});
    editor.sync({hFaces:3,hArrangement:'isometric',hRenderFaces:3});
    assert.equal(Object.keys(editor.images).length,0,'an untouched empty face does not synthesize a texture');
    assert.ok(walk(host).filter(node=>node.dataset.hTitle).every(node=>node.children.length>0),'icon controls remain SVG children after sync');

    const file=find(host,node=>node.type==='file');
    file.files=[{type:'image/png',size:1}];file.listeners.change();
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(status.textContent,'',`image fixture load failed: ${status.textContent}`);
    const face=Object.keys(editor.images)[0];
    assert.ok(face,'choosing an image creates a canonical asset');
    const before=editor.images[face].pixels.slice(0,4);
    palette='#123456';editor.setDefaultBackground(palette);
    const after=editor.images[face].pixels.slice(0,4);
    assert.notDeepEqual(after,before,'a mutable palette provider still recomposites an unedited raw image');

    const hex=find(host,node=>node.type==='text');
    hex.value='#abcdef';hex.listeners.change();
    const edited=editor.images[face].pixels.slice(0,4);
    palette='#010203';editor.setDefaultBackground(palette);
    assert.deepEqual(editor.images[face].pixels.slice(0,4),edited,'manual background survives later palette changes');
    const reset=find(host,node=>node.dataset.hTitle==='imageBackgroundReset');reset.click();
    palette='#102030';editor.setDefaultBackground(palette);
    assert.notDeepEqual(editor.images[face].pixels.slice(0,4),edited,'reset resumes palette tracking');
    assert.ok(changes.length>0);
  } finally {globalThis.document=previousDocument;globalThis.createImageBitmap=previousBitmap;}
});
