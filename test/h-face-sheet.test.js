import test from 'node:test';import assert from 'node:assert/strict';
import {encodeH} from '../src/h-codec.js';import {hModeFaces} from '../src/h-profile.js';import {buildHFaceSheet} from '../src/h-render.js';
test('all H mode face sheets use logical hModeFaces order and a ceil(needed/3) row count',()=>{
  for(const mode of [2,3,4,5,6]){
    const encoded=encodeH('face-sheet',{version:5,mode,tones:3,ecc:'M',mask:0,finder:'corners'}),sheet=buildHFaceSheet(encoded,{margin:2}),faces=hModeFaces(mode);
    assert.deepEqual(sheet.hModel.faces,faces);assert.equal(new Set(sheet.shapes.map(shape=>shape.face)).size,faces.length);
    const expectedRows=Math.ceil(faces.length/3);assert.equal(sheet.height,expectedRows*encoded.n+(expectedRows+1)*2);
  }
});
