import test from 'node:test';import assert from 'node:assert/strict';import {cubeGuideNudge} from '../src/scanner-scan-assist.js';
const base={engine:'r2',kind:'cube',required:3,state:'COLLECTING',epoch:7,lastProgressAt:1000};
test('cube guide waits for one face and three seconds',()=>{assert.equal(cubeGuideNudge({...base,faceCount:0,now:5000}),null);assert.equal(cubeGuideNudge({...base,faceCount:1,now:3999}),null);assert.equal(cubeGuideNudge({...base,faceCount:1,now:4000}).key,'status.cubeGuide')});
test('progress, done/reset and R1 hide cube guide',()=>{assert.equal(cubeGuideNudge({...base,faceCount:2,lastProgressAt:4000,now:5000}),null);for(const x of [{state:'DONE',faceCount:3},{engine:'r1',faceCount:1},{faceCount:0}])assert.equal(cubeGuideNudge({...base,...x,now:6000}),null)});
