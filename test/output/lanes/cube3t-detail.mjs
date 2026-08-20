import { listLumaDumps, readLumaDump } from '../../../tools/read-luma.mjs';
import { detectCentralCubeFinders } from '../../../src/decoder/cube-detect.js';
for (const { name, path } of listLumaDumps()) {
  if (!name.includes('cube3t-20260820')) continue;
  const luma = readLumaDump(path);
  const c = detectCentralCubeFinders(luma, {});
  console.log('── ' + name.split('/').pop());
  console.log('   ok=' + c.ok + ' reason=' + (c.reason ?? '—'));
  const d = c.detail || c.diagnostics || {};
  console.log('   detail keys: ' + Object.keys(d).join(', '));
  console.log('   ' + JSON.stringify(d).slice(0, 900));
}
