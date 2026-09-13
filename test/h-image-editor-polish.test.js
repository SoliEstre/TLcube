import test from 'node:test';import assert from 'node:assert/strict';
import {hexToRgb,rgbToHex,normalizeHFaceImageSettings} from '../src/h-image-editor.js';
test('palette default color is canonical and invalid colors reject',()=>{assert.equal(rgbToHex(hexToRgb('#AaBbCc')),'#aabbcc');assert.throws(()=>hexToRgb('red'));assert.equal(normalizeHFaceImageSettings({background:'#ffffff'}).background,'#ffffff')});
