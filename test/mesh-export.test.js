/**
 * 3D 인쇄 파일 직렬화(src/mesh-export.js)의 성질이에요 — 설계 §6-7(STL 바이트 레이아웃) · §6-8(3MF·ZIP 유효성) ·
 * §6-9 중 내보내기 몫(좌표를 옮기지 않아요).
 *
 * 검증 자(test/helpers/mesh-export-verify.mjs)는 만드는 쪽 코드를 쓰지 않는 독립 구현이고, 자 자체도 심은 결함
 * fixture 로 결함마다 빨갛게 되는지 여기서 확인해요. 기하 fixture 는 직접 만든 상자 메쉬예요(파트 기하는 다른 모듈 몫).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {fullOnly} from './helpers/scope.mjs';
import {
  STL_HEADER_TEXT, THREEMF_PART_NAMES, MAX_EXPORT_TRIANGLES, COLOR_GROUP_BASE_ID, MAX_3MF_PARTS,
  meshToBinaryStl, partsTo3mfFiles, zipStore, zipDeflate, supportsDeflateRaw, assertTriangleCap,
} from '../src/mesh-export.js';
import {
  readZip, check3mf, check3mfZip, parseBinaryStl, parseXml, XmlError, signedVolume, dosFields, issueCodes, crc32Bitwise,
} from './helpers/mesh-export-verify.mjs';
import {crc32} from '../src/png.js';
import {PRINT_TRIANGLE_CAP} from '../src/print-mesh.js';

// ─────────────────────────────────────────────────────────────────────────────
// fixture
// ─────────────────────────────────────────────────────────────────────────────

/** 상자들(mm, [x0,y0,z0,x1,y1,z1])을 한 메쉬로 만들어요. 상자마다 정점 8개 · 삼각형 12개, 바깥 법선(반시계) 감김이에요. */
function boxMesh(boxes) {
  const positions = [], indices = [];
  for (const b of boxes) {
    const base = positions.length / 3;
    for (let bits = 0; bits < 8; bits += 1) positions.push(b[bits & 1 ? 3 : 0], b[bits & 2 ? 4 : 1], b[bits & 4 ? 5 : 2]);
    for (let a = 0; a < 3; a += 1) {
      const u = (a + 1) % 3, v = (a + 2) % 3; // e_u × e_v = e_a
      for (const side of [0, 1]) {
        const corner = (pu, pv) => base + ((side << a) | (pu << u) | (pv << v));
        let quad = [corner(0, 0), corner(1, 0), corner(1, 1), corner(0, 1)];
        if (side === 0) quad = quad.reverse();
        indices.push(quad[0], quad[1], quad[2], quad[0], quad[2], quad[3]);
      }
    }
  }
  return {positions: Float64Array.from(positions), indices: Uint32Array.from(indices)};
}
const boxVolume = (boxes) => boxes.reduce((s, b) => s + (b[3] - b[0]) * (b[4] - b[1]) * (b[5] - b[2]), 0);
const meshTriangles = (mesh) => {
  const out = [];
  for (let t = 0; t < mesh.indices.length / 3; t += 1) out.push([0, 1, 2].map((k) => Array.from(mesh.positions.subarray(3 * mesh.indices[3 * t + k], 3 * mesh.indices[3 * t + k] + 3))));
  return out;
};
const zminOf = (positions) => {
  let z = Infinity;
  for (let k = 2; k < positions.length; k += 3) z = Math.min(z, positions[k]);
  return z;
};

/**
 * 설계 §6-9 모양을 흉내 낸 작은 파트 묶음(c = 2 mm, d = 1 mm)이에요. 흰 파트 zmin 0 · 코어 zmin d · 검정 zmin ≥ c.
 * 회색 파트에는 µm 격자 밖 좌표(핀치 사본 ε/√2 같은)를 넣어 소수 표기를 흔들어요.
 */
const PART_BOXES = [
  {name: 'w #ffffff', role: 'w', hex: '#ffffff', boxes: [[0, 0, 0, 10, 10, 1]]},
  {name: 'core', role: 'core', hex: '#FFFFFF', boxes: [[1, 1, 1, 9, 9, 9]]},
  {name: 'k & <black> "0"', role: 'k', hex: '#000000', boxes: [[0, 0, 2.2, 2, 2, 4.2], [8, 8, 2.2, 10, 10, 4.2]]},
  {name: 't1', role: 't1', hex: '#adadad', boxes: [[3.0176776695296637, 3, 2.4, 5, 5.025, 2.6]]},
];
const makeParts = () => PART_BOXES.map((p, k) => ({id: `p${k}`, name: p.name, role: p.role, hex: p.hex, mesh: boxMesh(p.boxes), volumeMm3: boxVolume(p.boxes)}));

const filesMap = (files) => new Map(files.map((f) => [f.name, f.data]));
const textOf = (bytes) => new TextDecoder().decode(bytes);
const bytesOf = (text) => new TextEncoder().encode(text);

function assertCoordinatesPreserved(model, parts) {
  const meshObjects = model.objects.filter((o) => o.vertices);
  assert.equal(meshObjects.length, parts.length);
  parts.forEach((part, k) => {
    const object = meshObjects[k];
    assert.equal(object.name, part.name, 'XML 이스케이프가 이름을 되살려요');
    const {positions, indices} = part.mesh;
    assert.equal(object.vertices.length, positions.length / 3);
    object.vertices.forEach((v, i) => v.forEach((x, a) => assert.ok(Math.abs(x - positions[3 * i + a]) <= 5e-7, `파트 ${k} 정점 ${i} 축 ${a}: ${x} vs ${positions[3 * i + a]}`)));
    assert.deepEqual(object.triangles.flat(), Array.from(indices));
    assert.deepEqual(model.colorGroups.get(object.pid), [`${part.hex.toUpperCase()}FF`]);
    assert.equal(object.pindex, 0);
  });
}

async function withCompressionStream(replacement, run) {
  const had = Object.prototype.hasOwnProperty.call(globalThis, 'CompressionStream');
  const saved = globalThis.CompressionStream;
  if (replacement === undefined) delete globalThis.CompressionStream;
  else globalThis.CompressionStream = replacement;
  try {
    return await run();
  } finally {
    if (had) globalThis.CompressionStream = saved;
    else delete globalThis.CompressionStream;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// §6-7 binary STL
// ─────────────────────────────────────────────────────────────────────────────

test('STL: 길이 84+50T · 헤더 · 삼각형 수 · 단위 법선이 감김과 같은 쪽 · 속성 0 · 좌표 f32 · 부피 보존 · 결정성 (§6-7)', () => {
  for (const part of makeParts()) {
    const stl = meshToBinaryStl(part.mesh);
    const T = part.mesh.indices.length / 3;
    assert.equal(stl.length, 84 + 50 * T);
    const parsed = parseBinaryStl(stl);
    assert.deepEqual(parsed.issues, []);
    assert.equal(parsed.count, T);
    assert.ok(parsed.header.startsWith(STL_HEADER_TEXT));
    assert.ok(!/^\s*solid/i.test(parsed.header));
    const expected = meshTriangles(part.mesh);
    parsed.triangles.forEach((tri, t) => tri.v.forEach((v, k) => v.forEach((x, a) => assert.equal(x, Math.fround(expected[t][k][a])))));
    // 바깥 법선 감김이 그대로면 부호 있는 부피가 상자 부피 합과 같아요(f32 반올림 안에서).
    const volume = signedVolume(parsed.triangles.map((tri) => tri.v));
    assert.ok(Math.abs(volume - part.volumeMm3) <= 1e-4 * Math.max(1, part.volumeMm3), `${part.name}: ${volume} vs ${part.volumeMm3}`);
    assert.deepEqual(meshToBinaryStl(part.mesh), stl, '같은 입력 → 바이트 동일');
  }
});

test('STL: 넓이 0 삼각형은 법선 0 · 빈 메쉬는 84 B · 헤더/메쉬 계약 위반은 던져요', () => {
  const mesh = {positions: Float64Array.of(0, 0, 0, 1, 0, 0, 2, 0, 0, 0, 1, 0), indices: Uint32Array.of(0, 1, 2, 0, 1, 3)};
  const parsed = parseBinaryStl(meshToBinaryStl(mesh));
  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.triangles[0].normal, [0, 0, 0], '일직선 삼각형');
  assert.deepEqual(parsed.triangles[1].normal, [0, 0, 1]);
  const empty = meshToBinaryStl({positions: new Float64Array(0), indices: new Uint32Array(0)});
  assert.equal(empty.length, 84);
  assert.deepEqual(parseBinaryStl(empty).issues, []);
  const box = boxMesh([[0, 0, 0, 1, 1, 1]]);
  for (const header of ['solid cube', '  SOLID x', 'Solid']) assert.throws(() => meshToBinaryStl(box, {header}), RangeError, header);
  assert.throws(() => meshToBinaryStl(box, {header: 'x'.repeat(81)}), RangeError);
  assert.throws(() => meshToBinaryStl(box, {header: '큐브'}), RangeError);
  assert.equal(meshToBinaryStl(box, {header: 'x'.repeat(80)}).length, 84 + 50 * 12);
  assert.throws(() => meshToBinaryStl({positions: Array.from(box.positions), indices: box.indices}), TypeError);
  assert.throws(() => meshToBinaryStl({positions: box.positions, indices: Int32Array.from(box.indices)}), TypeError);
  assert.throws(() => meshToBinaryStl({positions: box.positions.subarray(1), indices: box.indices}), RangeError);
  assert.throws(() => meshToBinaryStl({positions: Float64Array.of(0, 0, NaN), indices: new Uint32Array(0)}), RangeError);
  assert.throws(() => meshToBinaryStl({positions: box.positions, indices: Uint32Array.of(0, 1, 8)}), (e) => e.code === 'TLP_TOPOLOGY');
  assert.throws(() => meshToBinaryStl(box, {triangleCap: 11}), (e) => e.code === 'TLP_TRI_CAP');
  assert.equal(meshToBinaryStl(box, {triangleCap: 12}).length, 84 + 50 * 12);
});

test('STL 자: 심은 결함마다 해당 코드로 빨개져요', () => {
  const clean = meshToBinaryStl(boxMesh([[0, 0, 0, 3, 2, 1]]));
  assert.deepEqual(parseBinaryStl(clean).issues, []);
  const mutate = (edit) => {
    const bytes = clean.slice();
    edit(new DataView(bytes.buffer), bytes);
    return bytes;
  };
  const cases = {
    length: [Uint8Array.from([...clean, 0])],
    'header-solid': [mutate((_, b) => b.set(bytesOf('solid '), 0))],
    count: [mutate((v) => v.setUint32(80, 13, true))],
    normal: [mutate((v) => v.setFloat32(84, 2 * v.getFloat32(84, true), true)), mutate((v) => ['x', 'y', 'z'].forEach((_, k) => v.setFloat32(84 + 4 * k, 0, true)))],
    'normal-winding': [mutate((v) => [0, 1, 2].forEach((k) => v.setFloat32(84 + 4 * k, -v.getFloat32(84 + 4 * k, true), true)))],
    attribute: [mutate((v) => v.setUint16(84 + 48, 1, true))],
    vertex: [mutate((v) => v.setFloat32(84 + 12, NaN, true))],
  };
  const expectedCode = {count: 'length'};
  for (const [defect, fixtures] of Object.entries(cases)) {
    for (const bytes of fixtures) {
      const codes = issueCodes(parseBinaryStl(bytes).issues);
      assert.ok(codes.includes(expectedCode[defect] ?? defect), `${defect}: ${codes.join(',')}`);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// §6-8 3MF · ZIP
// ─────────────────────────────────────────────────────────────────────────────

test('3MF components: 필수 파트 3개 · mm · m:colorgroup · 부모 1 + 파트 한 번씩 · 변환 없음 · 좌표·삼각형 왕복 (§6-8)', () => {
  const parts = makeParts();
  const files = partsTo3mfFiles(parts, {application: 'TrilLuminance (cube) 2026-09-23.01'});
  assert.deepEqual(files.map((f) => f.name), [...THREEMF_PART_NAMES]);
  const zip = zipStore(files);
  const {issues, zip: read, model} = check3mfZip(zip);
  assert.deepEqual(issues, []);
  assert.deepEqual(read.entries.map((e) => e.name), ['[Content_Types].xml', '_rels/.rels', '3D/3dmodel.model']);
  assert.ok(read.entries.every((e) => e.method === 0));
  assert.equal(model.structure, 'components');
  assert.equal(model.application, 'TrilLuminance (cube) 2026-09-23.01');
  const parent = model.objects.find((o) => o.components);
  assert.deepEqual(model.build, [parent.id]);
  assert.deepEqual([...parent.components].sort((a, b) => a - b), model.objects.filter((o) => o.vertices).map((o) => o.id));
  assert.deepEqual([...model.colorGroups.keys()], parts.map((_, k) => COLOR_GROUP_BASE_ID + k));
  assertCoordinatesPreserved(model, parts);
  const modelText = textOf(files[2].data);
  assert.ok(modelText.includes('unit="millimeter"'));
  assert.ok(modelText.includes('<m:colorgroup'));
  assert.ok(!/requiredextensions|basematerials|transform=/.test(modelText));
  assert.deepEqual(zipStore(partsTo3mfFiles(parts, {application: 'TrilLuminance (cube) 2026-09-23.01'})), zip, 'STORE 경로는 바이트가 결정적이에요');
});

test('3MF items: 부모 없이 파트마다 build item 하나 · 나머지 규약은 같아요 (§6-8)', () => {
  const parts = makeParts();
  const {issues, model} = check3mfZip(zipStore(partsTo3mfFiles(parts, {structure: 'items'})));
  assert.deepEqual(issues, []);
  assert.equal(model.structure, 'items');
  assert.ok(model.objects.every((o) => !o.components));
  assert.deepEqual(model.build, model.objects.map((o) => o.id));
  assertCoordinatesPreserved(model, parts);
});

test('3MF 입력 계약: Bambu 접두·hex·구조·파트 수·겹친 인덱스·삼각형 4개 미만·삼각형 상한 · 입력 불변', () => {
  const parts = makeParts();
  const snapshot = parts.map((p) => [p.mesh.positions.slice(), p.mesh.indices.slice()]);
  partsTo3mfFiles(parts);
  parts.forEach((p, k) => {
    assert.deepEqual(p.mesh.positions, snapshot[k][0]);
    assert.deepEqual(p.mesh.indices, snapshot[k][1]);
  });
  assert.throws(() => partsTo3mfFiles(parts, {application: 'BambuStudio-02.00'}), RangeError);
  assert.throws(() => partsTo3mfFiles(parts, {application: ''}), TypeError);
  assert.throws(() => partsTo3mfFiles(parts, {structure: 'flat'}), RangeError);
  assert.throws(() => partsTo3mfFiles([]), RangeError);
  assert.throws(() => partsTo3mfFiles([{...parts[0], hex: 'white'}]), TypeError);
  assert.throws(() => partsTo3mfFiles([{...parts[0], name: 'a\u0001b'}]), RangeError);
  const tetra = {positions: Float64Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1), indices: Uint32Array.of(0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3)};
  assert.deepEqual(check3mfZip(zipStore(partsTo3mfFiles([{name: 'tetra', hex: '#123456', mesh: tetra}]))).issues, []);
  const three = {positions: tetra.positions, indices: tetra.indices.slice(0, 9)};
  assert.throws(() => partsTo3mfFiles([{hex: '#123456', mesh: three}]), (e) => e.code === 'TLP_TOPOLOGY');
  const repeated = {positions: tetra.positions, indices: Uint32Array.of(0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 1, 3)};
  assert.throws(() => partsTo3mfFiles([{hex: '#123456', mesh: repeated}]), (e) => e.code === 'TLP_TOPOLOGY');
  const total = assertTriangleCap(parts);
  assert.equal(total, parts.reduce((s, p) => s + p.mesh.indices.length / 3, 0));
  // 걸린 상한과 삼각형 수가 오류에 실려요(화면 문구의 {cap} 은 이 값을 그대로 써요).
  assert.throws(() => partsTo3mfFiles(parts, {triangleCap: total - 1}), (e) => e.code === 'TLP_TRI_CAP' && e.triangleCap === total - 1 && e.triangles === total);
  assert.throws(() => meshToBinaryStl(parts[0].mesh, {triangleCap: 1}), (e) => e.code === 'TLP_TRI_CAP' && e.triangleCap === 1);
  assert.equal(partsTo3mfFiles(parts, {triangleCap: total}).length, 3);
  assert.equal(MAX_EXPORT_TRIANGLES, 300000);
  // 사본이 아니라 파트를 만드는 쪽(print-mesh) 상한 그대로예요.
  assert.equal(MAX_EXPORT_TRIANGLES, PRINT_TRIANGLE_CAP);
  // 파트 id(1..K)·부모 id(K+1)가 색 그룹 id(100+k)와 겹치지 않는 최대 파트 수까지 받고, 그 너머는 거부해요.
  const many = Array.from({length: MAX_3MF_PARTS}, (_, k) => ({hex: '#010203', name: `p${k}`, mesh: tetra}));
  const big = check3mfZip(zipStore(partsTo3mfFiles(many)));
  assert.deepEqual(big.issues, []);
  assert.throws(() => partsTo3mfFiles([...many, many[0]]), RangeError);
});

test('ZIP STORE: 결정적 바이트 · 기본 mtime 은 DOS 기점 · Date 는 로컬 시각 2초 단위 · UTF-8 이름 플래그 · CRC 는 png.js 와 독립 구현이 같아요', () => {
  const files = [{name: 'a.txt', data: bytesOf('hello')}, {name: '3D/모델 설명.txt', data: bytesOf('큐브')}, {name: 'empty', data: new Uint8Array(0)}];
  const zip = zipStore(files);
  assert.deepEqual(zipStore(files), zip);
  const read = readZip(zip);
  assert.deepEqual(read.issues, []);
  assert.deepEqual(read.entries.map((e) => e.name), files.map((f) => f.name));
  read.entries.forEach((e, k) => assert.deepEqual(e.data, files[k].data));
  assert.deepEqual(read.entries.map((e) => (e.flags & 0x0800) !== 0), [false, true, false]);
  assert.deepEqual(dosFields(read.entries[0].time, read.entries[0].date), {year: 1980, month: 1, day: 1, hour: 0, minute: 0, second: 0});
  const when = new Date(2026, 8, 23, 14, 37, 59);
  const stamped = readZip(zipStore(files, {mtime: when}));
  assert.deepEqual(stamped.issues, []);
  assert.deepEqual(dosFields(stamped.entries[0].time, stamped.entries[0].date), {year: 2026, month: 9, day: 23, hour: 14, minute: 37, second: 58});
  assert.deepEqual(readZip(zipStore(files, {mtime: when.getTime()})).entries.map((e) => [e.time, e.date]), stamped.entries.map((e) => [e.time, e.date]));
  const early = readZip(zipStore(files, {mtime: new Date(1970, 0, 1)}));
  assert.deepEqual(dosFields(early.entries[0].time, early.entries[0].date).year, 1980);
  assert.throws(() => zipStore(files, {mtime: new Date('nope')}), TypeError);
  for (const data of [new Uint8Array(0), bytesOf('123456789'), Uint8Array.from({length: 1000}, (_, k) => (k * 37) & 255)]) assert.equal(crc32(data), crc32Bitwise(data));
  assert.equal(crc32Bitwise(bytesOf('123456789')), 0xcbf43926, 'CRC-32 점검값');
});

test('ZIP 이름·데이터 계약: 빈·절대·역슬래시·«..»·끝 «/»·중복 이름과 Uint8Array 아닌 데이터를 거부해요', () => {
  const data = bytesOf('x');
  for (const name of ['', '/abs', 'a\\b', 'a/../b', './a', 'dir/', 'a\u0000b']) assert.throws(() => zipStore([{name, data}]), Error, JSON.stringify(name));
  assert.throws(() => zipStore([{name: 'a', data}, {name: 'a', data}]), RangeError);
  assert.throws(() => zipStore([{name: 'a', data: 'x'}]), TypeError);
  assert.throws(() => zipStore('a'), TypeError);
  assert.equal(readZip(zipStore([])).issues.length, 0, '빈 ZIP 도 올발라요');
});

test('ZIP deflate: 3MF 가 method 8 로 줄고, 풀면 STORE 와 같은 파트예요 · 엔트리마다 «8 이면 더 작음, 아니면 0» (§6-8)', async () => {
  assert.equal(supportsDeflateRaw(), true, 'Node 24 는 deflate-raw 를 받아요');
  const files = partsTo3mfFiles(makeParts());
  const store = zipStore(files);
  const deflated = await zipDeflate(files);
  const {issues, zip} = check3mfZip(deflated);
  assert.deepEqual(issues, []);
  zip.entries.forEach((e, k) => {
    assert.deepEqual(e.data, files[k].data);
    if (e.method === 8) assert.ok(e.csize < e.usize, e.name);
    else assert.equal(e.csize, e.usize, e.name);
  });
  assert.equal(zip.entries.find((e) => e.name === '3D/3dmodel.model').method, 8);
  assert.ok(deflated.length < store.length);
  const tiny = readZip(await zipDeflate([{name: 'one', data: Uint8Array.of(7)}]));
  assert.deepEqual(tiny.issues, []);
  assert.equal(tiny.entries[0].method, 0, '압축이 이득이 없으면 STORE 로 둬요');
  await assert.rejects(() => zipDeflate([{name: '/abs', data: Uint8Array.of(1)}]), RangeError, '입력 오류는 폴백하지 않아요');
});

// 쓰기 실패 스텁은 읽기가 영영 끝나지 않아요. 경주가 빠지면 멈추므로 시간 제한으로 «멈춤» 을 실패로 바꿔요.
test('ZIP deflate 폴백: 생성자 없음 · deflate-raw 생성자만 던짐 · 스트림 도중 실패(읽기·쓰기) → zipStore 와 바이트 동일 (설계 §2.2 · §6-8)', {timeout: 30000}, async () => {
  const files = partsTo3mfFiles(makeParts());
  const store = zipStore(files, {mtime: new Date(2026, 8, 23, 9, 0, 0)});
  const run = () => zipDeflate(files, {mtime: new Date(2026, 8, 23, 9, 0, 0)});
  const Real = globalThis.CompressionStream;
  class OnlyGzip {
    constructor(format) {
      if (format === 'deflate-raw') throw new TypeError('Unsupported compression format');
      return new Real(format);
    }
  }
  let made = 0;
  class ReadFailsMidStream {
    constructor(format) {
      if (format !== 'deflate-raw') throw new TypeError('format');
      made += 1;
      let reads = 0;
      this.writable = {getWriter: () => ({write: async () => {}, close: async () => {}})};
      this.readable = {getReader: () => ({read: async () => {
        reads += 1;
        if (reads === 1) return {done: false, value: Uint8Array.of(1, 2, 3)};
        throw new Error('stream broke');
      }})};
    }
  }
  let streams = 0;
  class WriteFailsOnSecondEntry {
    constructor(format) {
      const real = new Real(format);
      streams += 1;
      if (streams <= 2) return real; // 1 = 탐지용, 2 = 첫 엔트리
      this.writable = {getWriter: () => ({write: async () => { throw new Error('write broke'); }, close: async () => {}})};
      this.readable = {getReader: () => ({read: () => new Promise(() => {})})}; // 끝나지 않는 읽기
    }
  }
  const cases = [['생성자 없음', undefined], ['deflate-raw 만 던짐', OnlyGzip], ['읽기 도중 실패', ReadFailsMidStream], ['쓰기 실패 + 끝나지 않는 읽기', WriteFailsOnSecondEntry]];
  for (const [label, Stub] of cases) {
    const out = await withCompressionStream(Stub, run);
    assert.deepEqual(out, store, label);
    assert.deepEqual(check3mfZip(out).issues, [], label);
  }
  assert.ok(made >= 2, '읽기 실패 스텁이 실제 압축 경로까지 들어갔어요');
  assert.ok(streams >= 3, '쓰기 실패 스텁이 두 번째 엔트리까지 들어갔어요');
  assert.equal(await withCompressionStream(undefined, async () => supportsDeflateRaw()), false);
  assert.equal(await withCompressionStream(OnlyGzip, async () => supportsDeflateRaw()), false);
});

// ─────────────────────────────────────────────────────────────────────────────
// 자 자체: 심은 결함
// ─────────────────────────────────────────────────────────────────────────────

test('ZIP 자: 심은 결함마다 해당 코드로 빨개져요', async () => {
  const files = [{name: 'a.txt', data: bytesOf('hello world')}, {name: 'b.txt', data: bytesOf('abcabcabc')}, {name: '모델.txt', data: bytesOf('xyz')}];
  const clean = zipStore(files);
  assert.deepEqual(readZip(clean).issues, []);
  const view = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
  const read = readZip(clean);
  const cdOffset = view(clean).getUint32(clean.length - 22 + 16, true);
  const cd = (k) => {
    let o = cdOffset;
    for (let i = 0; i < k; i += 1) o += 46 + view(clean).getUint16(o + 28, true);
    return o;
  };
  const both = (k, localAt, centralAt, write) => (b) => { write(view(b), read.entries[k].offset + localAt); write(view(b), cd(k) + centralAt); };
  const mutate = (...edits) => {
    const b = clean.slice();
    for (const edit of edits) edit(b);
    return b;
  };
  const eocd = clean.length - 22;
  const withGap = (() => {
    const b = new Uint8Array(clean.length + 3);
    b.set(clean.subarray(0, cdOffset), 0);
    b.set(clean.subarray(cdOffset), cdOffset + 3);
    view(b).setUint32(b.length - 22 + 16, cdOffset + 3, true);
    return b;
  })();
  const cases = {
    crc: mutate((b) => { b[read.entries[0].dataStart] ^= 1; }),
    'local-mismatch': mutate((b) => view(b).setUint32(read.entries[0].offset + 14, 0, true)),
    'eocd-count': mutate((b) => view(b).setUint16(eocd + 10, 1, true)),
    'eocd-cd-range': mutate((b) => view(b).setUint32(eocd + 16, cdOffset + 1, true)),
    'eocd-missing': clean.subarray(0, clean.length - 1),
    method: mutate(both(0, 8, 10, (v, o) => v.setUint16(o, 12, true))),
    flags: mutate(both(0, 6, 8, (v, o) => v.setUint16(o, 0x0008, true))),
    'utf8-flag': mutate(both(2, 6, 8, (v, o) => v.setUint16(o, 0, true))),
    size: mutate(both(0, 22, 24, (v, o) => v.setUint32(o, 5, true))),
    layout: withGap,
    'duplicate-name': mutate(both(1, 30, 46, (v, o) => v.setUint8(o, 'a'.charCodeAt(0)))),
    version: mutate(both(0, 4, 6, (v, o) => v.setUint16(o, 45, true))),
  };
  for (const [code, bytes] of Object.entries(cases)) {
    let codes;
    try {
      codes = issueCodes(readZip(bytes).issues);
    } catch (error) {
      assert.fail(`${code}: 자가 던졌어요 ${error.message}`);
    }
    assert.ok(codes.includes(code), `${code}: ${codes.join(',')}`);
  }
  // deflate 데이터 손상: 첫 블록 헤더를 예약 타입(BTYPE=11)으로 → 풀기 실패로 잡혀요.
  const deflated = await zipDeflate([{name: 'x', data: bytesOf('abc'.repeat(200))}]);
  const entry = readZip(deflated).entries[0];
  assert.equal(entry.method, 8);
  const broken = deflated.slice();
  broken[entry.dataStart] = 0x07;
  assert.ok(issueCodes(readZip(broken).issues).includes('inflate'));
});

test('3MF 자: 심은 결함마다 해당 코드로 빨개져요', () => {
  const good = filesMap(partsTo3mfFiles(makeParts()));
  assert.deepEqual(check3mf(good).issues, []);
  const model = textOf(good.get('3D/3dmodel.model'));
  const withModel = (text) => new Map([...good, ['3D/3dmodel.model', bytesOf(text)]]);
  const withPart = (name, text) => new Map([...good, [name, bytesOf(text)]]);
  const once = (text, from, to) => {
    assert.ok(text.includes(from), `fixture 치환 대상이 있어야 해요: ${from}`);
    return text.replace(from, to);
  };
  const firstObject = model.slice(model.indexOf('<object id="1"'), model.indexOf('</object>') + 9);
  const firstTriangles = firstObject.match(/<triangle [^>]*\/>\n/g);
  const trimmed = firstObject.replace(firstTriangles.join(''), firstTriangles.slice(0, 3).join(''));
  const cases = {
    'part-missing': new Map([...good].filter(([name]) => name !== '_rels/.rels')),
    'part-extra': new Map([...good, ['Metadata/extra.txt', bytesOf('x')]]),
    xml: withModel(once(model, '</build>', '')),
    unit: withModel(once(model, 'unit="millimeter"', 'unit="inch"')),
    namespace: withModel(once(model, 'xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02"', 'xmlns:m="http://example.com/material"')),
    'm-prefix': withModel(model.replaceAll('m:color', 'mat:color').replace('xmlns:m=', 'xmlns:mat=')),
    forbidden: withModel(once(model, '<resources>\n', '<resources>\n<basematerials id="900"><base name="w" displaycolor="#FFFFFFFF"/></basematerials>\n')),
    application: withModel(once(model, '>TrilLuminance (cube)<', '>BambuStudio-02.00<')),
    pid: withModel(once(model, 'pid="100"', 'pid="999"')),
    pindex: withModel(once(model, 'pindex="0"', 'pindex="1"')),
    'index-range': withModel(once(model, '<triangle v1="', '<triangle v1="99999" x1="')),
    'triangle-repeat': withModel(once(model, /<triangle v1="(\d+)" v2="\d+"/.exec(model)[0], `<triangle v1="${/<triangle v1="(\d+)"/.exec(model)[1]}" v2="${/<triangle v1="(\d+)"/.exec(model)[1]}"`)),
    'triangle-count': withModel(once(model, firstObject, trimmed)),
    reach: withModel(once(model, '<component objectid="1"/>\n', '<component objectid="1"/>\n<component objectid="1"/>\n')),
    transform: withModel(once(model, '<component objectid="2"/>', '<component objectid="2" transform="1 0 0 0 1 0 0 0 1 0 0 5"/>')),
    'forward-ref': withModel(once(model, '<component objectid="2"/>', '<component objectid="77"/>')),
    'build-ref': withModel(once(model, /<item objectid="\d+"\/>/.exec(model)[0], '<item objectid="78"/>')),
    'id-dup': withModel(once(model, '<m:colorgroup id="101">', '<m:colorgroup id="100">')),
    'content-types': withPart('[Content_Types].xml', once(textOf(good.get('[Content_Types].xml')), 'application/vnd.ms-package.3dmanufacturing-3dmodel+xml', 'application/xml')),
    rels: withPart('_rels/.rels', once(textOf(good.get('_rels/.rels')), 'Target="/3D/3dmodel.model"', 'Target="/3D/3DModel.model"')),
  };
  const item = /<item objectid="\d+"\/>/.exec(model)[0];
  const itemWith = (transform) => withModel(once(model, item, item.replace('/>', ` transform="${transform}"/>`)));
  const extra = {
    forbidden: withModel(once(model, '<model unit=', '<model requiredextensions="m" unit=')),
    reach: withModel(once(model, '<component objectid="2"/>\n', '')),
    'm-prefix': withModel(once(model, '<m:color color=', '<color color=')),
  };
  // build item 변환은 판 위 평행 이동만 받아요: 회전 · 거울 · 배율 · 필드 수 · 수 아님 · ST_Number 밖 표기(16진 · 끝 점 · Infinity)
  // · 음수 이동(양의 8분 공간 밖) · z 들림은 모두 'transform' 이에요. 결함마다 따로 단언해요(아래 루프).
  const itemTransforms = [
    itemWith('0 1 0 -1 0 0 0 0 1 50 50 0'),
    itemWith('-1 0 0 0 1 0 0 0 1 50 50 0'),
    itemWith('2 0 0 0 2 0 0 0 2 0 0 0'),
    itemWith('1 0 0 0 1 0 0 0 1 50 50'),
    itemWith('1 0 0 0 1 0 0 0 1 50 x 0'),
    itemWith('1 0 0 0 1 0 0 0 1 0x25 0x25 0'),
    itemWith('1 0 0 0 1 0 0 0 1 37. 37. 0'),
    itemWith('1 0 0 0 1 0 0 0 1 Infinity 37 0'),
    itemWith('1 0 0 0 1 0 0 0 1 -5 -5 0'),
    itemWith('1 0 0 0 1 0 0 0 1 37 37 5'),
  ];
  for (const [code, files] of [...Object.entries(cases), ...Object.entries(extra), ...itemTransforms.map((f) => ['transform', f])]) {
    const codes = issueCodes(check3mf(files).issues);
    assert.ok(codes.includes(code), `${code}: ${codes.join(',')}`);
  }
  // 대조군: 평행 이동만 있는 item 변환은 깨끗하고 그 이동을 돌려줘요.
  const moved = check3mf(itemWith('1 0 0 0 1 0 0 0 1 37 37 0'));
  assert.deepEqual(moved.issues, []);
  assert.deepEqual(moved.model.buildTranslations, [[37, 37, 0]]);
  // 대조군: ST_Number 가 허용하는 다른 표기(지수 · 앞 점 · 부호 +)도 깨끗해요 — 자가 표기를 과하게 좁히지 않아요.
  const spelled = check3mf(itemWith('1 0 0 0 1 0 0 0 1 1e1 .5 +0'));
  assert.deepEqual(spelled.issues, []);
  assert.deepEqual(spelled.model.buildTranslations, [[10, 0.5, 0]]);
  assert.deepEqual(check3mf(good).model.buildTranslations, [null]);
});

test('3MF 판 배치: buildTranslationMm 은 build item 마다 같은 평행 이동 하나이고, 메쉬 좌표 · component 는 그대로예요', () => {
  const parts = makeParts();
  for (const structure of ['components', 'items']) {
    const files = partsTo3mfFiles(parts, {structure, buildTranslationMm: [37, 37, 0]});
    const text = textOf(files[2].data);
    const {issues, model} = check3mfZip(zipStore(files));
    assert.deepEqual(issues, [], structure);
    assert.equal(model.structure, structure);
    assert.deepEqual(model.buildTranslations, model.build.map(() => [37, 37, 0]), structure);
    assert.equal((text.match(/ transform="1 0 0 0 1 0 0 0 1 37 37 0"/g) ?? []).length, model.build.length, structure);
    assert.ok(!/<component [^>]*transform=/.test(text), 'component 변환은 여전히 없어요');
    assertCoordinatesPreserved(model, parts);
  }
  // 소수 이동도 좌표와 같은 표기(고정 6자리, 끝 0 제거)예요.
  assert.ok(textOf(partsTo3mfFiles(parts, {buildTranslationMm: [2.5, 0.125, 0]})[2].data).includes('transform="1 0 0 0 1 0 0 0 1 2.5 0.125 0"'));
  // 없음 · 0 이동은 속성 자체가 없어요(기존 바이트 그대로).
  const plain = textOf(partsTo3mfFiles(parts)[2].data);
  assert.equal(textOf(partsTo3mfFiles(parts, {buildTranslationMm: [0, 0, 0]})[2].data), plain);
  assert.equal(textOf(partsTo3mfFiles(parts, {buildTranslationMm: null})[2].data), plain);
  for (const bad of [[1, 2], [1, 2, NaN], [1, 2, Infinity], ['1', 2, 3], [1, 2, 2e6], 5]) assert.throws(() => partsTo3mfFiles(parts, {buildTranslationMm: bad}), RangeError, JSON.stringify(bad));
  // 판 위 자리만: 음수 x·y(양의 8분 공간 밖)와 z 들림은 쓰지 않아요 — 검증 자가 거부하는 꼴을 직렬화기도 만들지 않아요.
  for (const bad of [[-1, 0, 0], [0, -0.5, 0], [37, 37, 1], [37, 37, -1]]) assert.throws(() => partsTo3mfFiles(parts, {buildTranslationMm: bad}), RangeError, JSON.stringify(bad));
  assert.equal(textOf(partsTo3mfFiles(parts, {buildTranslationMm: [-0, 0, -0]})[2].data), plain, '-0 은 0 이에요');
});

test('XML 자: 잘못된 문서를 거부하고, 이스케이프를 되살려요', () => {
  const bad = [
    '<a><b></a>', '<a x="1" x="2"/>', '<m:a/>', '<a>&nbsp;</a>', '<a/><b/>', '<a x="<"/>', '<a x="1"y="2"/>',
    '<?xml version="2.0"?><a/>', '<a><!-- x -- y --></a>', '<a><![CDATA[x]]></a>', '<a>&#0;</a>', '<a q:x="1"/>',
  ];
  for (const text of bad) assert.throws(() => parseXml(text), XmlError, text);
  const root = parseXml('<?xml version="1.0" encoding="UTF-8"?>\n<!-- c --><r xmlns="u" xmlns:m="v" xml:lang="en"><m:c k="&amp;&lt;&gt;&quot;&apos;&#x41;&#66;">t&amp;u</m:c></r>\n');
  assert.equal(root.ns, 'u');
  assert.equal(root.children[0].ns, 'v');
  assert.equal(root.children[0].attrs.k, '&<>"\'AB');
  assert.equal(root.children[0].text, 't&u');
});

// ─────────────────────────────────────────────────────────────────────────────
// §6-9 내보내기 몫: 좌표를 옮기지 않아요
// ─────────────────────────────────────────────────────────────────────────────

test('좌표 일치: STL·3MF 모두 파트 원점을 옮기지 않아요 — 전체 zmin 0 · 파트별 zmin·전 정점이 입력 그대로 · 변환 없음 (§6-9 내보내기 몫)', () => {
  const parts = makeParts();
  const zmins = parts.map((p) => zminOf(p.mesh.positions));
  assert.deepEqual(zmins, [0, 1, 2.2, 2.4], 'fixture: 흰 0 · 코어 d · 그 밖 ≥ c');
  parts.forEach((part, k) => {
    const stl = parseBinaryStl(meshToBinaryStl(part.mesh));
    assert.equal(Math.min(...stl.triangles.flatMap((t) => t.v.map((v) => v[2]))), Math.fround(zmins[k]));
  });
  for (const structure of ['components', 'items']) {
    const {issues, model} = check3mfZip(zipStore(partsTo3mfFiles(parts, {structure})));
    assert.deepEqual(issues, [], structure);
    const meshObjects = model.objects.filter((o) => o.vertices);
    meshObjects.forEach((o, k) => assert.ok(Math.abs(Math.min(...o.vertices.map((v) => v[2])) - zmins[k]) <= 5e-7));
    assert.equal(Math.min(...meshObjects.flatMap((o) => o.vertices.map((v) => v[2]))), 0);
    assertCoordinatesPreserved(model, parts);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// full: 배터리 · 큰 메쉬
// ─────────────────────────────────────────────────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

fullOnly(() => {
  test('full 배터리: 무작위 상자 파트 60종 × 구조 2 × STORE/deflate — 자 깨끗 · 좌표·삼각형 왕복 · STL 부피 보존', async () => {
    for (let seed = 1; seed <= 60; seed += 1) {
      const rand = mulberry32(seed);
      const um = () => Math.round(rand() * 3600) * 25 / 1000; // 25 µm 격자, 0..90 mm
      const parts = Array.from({length: 1 + Math.floor(rand() * 6)}, (_, k) => {
        const boxes = Array.from({length: 1 + Math.floor(rand() * 5)}, () => {
          const [x0, x1] = [um(), um()].sort((a, b) => a - b), [y0, y1] = [um(), um()].sort((a, b) => a - b), [z0, z1] = [um(), um()].sort((a, b) => a - b);
          return [x0, y0, z0, x1 + 0.025, y1 + 0.025 * Math.SQRT1_2, z1 + 0.025];
        });
        const hex = `#${Math.floor(rand() * 0x1000000).toString(16).padStart(6, '0')}`;
        return {name: `s${seed}-${k}`, hex, mesh: boxMesh(boxes), volumeMm3: boxVolume(boxes)};
      });
      for (const structure of ['components', 'items']) {
        const files = partsTo3mfFiles(parts, {structure});
        for (const zip of [zipStore(files), await zipDeflate(files)]) {
          const {issues, model} = check3mfZip(zip);
          assert.deepEqual(issues, [], `seed ${seed} ${structure}`);
          assert.equal(model.structure, structure);
          assertCoordinatesPreserved(model, parts);
        }
      }
      for (const part of parts) {
        const parsed = parseBinaryStl(meshToBinaryStl(part.mesh));
        assert.deepEqual(parsed.issues, [], `seed ${seed}`);
        const volume = signedVolume(parsed.triangles.map((t) => t.v));
        assert.ok(Math.abs(volume - part.volumeMm3) <= 1e-5 * Math.max(1, part.volumeMm3) + 1e-3, `seed ${seed}: ${volume} vs ${part.volumeMm3}`);
      }
    }
  });

  test('full 큰 메쉬: 약 11.3만 삼각형(설계 §2.9 n=45 규모) 3MF·STL — 자 깨끗 · 크기·시간 기록', async (t) => {
    // 한 변 97칸 격자 정육면체, 면마다 파트 하나. 칸 0.925 mm 라 좌표가 소수 셋째 자리까지 흔들려요.
    const g = 97, step = 0.925;
    const parts = [];
    for (let a = 0; a < 3; a += 1) for (const side of [0, 1]) {
      const u = (a + 1) % 3, v = (a + 2) % 3;
      const positions = [], indices = [];
      for (let i = 0; i <= g; i += 1) for (let j = 0; j <= g; j += 1) {
        const p = [0, 0, 0];
        p[a] = side * g * step;
        p[u] = Number((i * step).toFixed(3));
        p[v] = Number((j * step).toFixed(3));
        positions.push(...p);
      }
      const at = (i, j) => i * (g + 1) + j;
      for (let i = 0; i < g; i += 1) for (let j = 0; j < g; j += 1) {
        const q = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
        if (side === 0) q.reverse();
        indices.push(q[0], q[1], q[2], q[0], q[2], q[3]);
      }
      parts.push({name: `face-${a}${side}`, hex: `#${(40 * parts.length + 30).toString(16).padStart(2, '0').repeat(3)}`, mesh: {positions: Float64Array.from(positions), indices: Uint32Array.from(indices)}});
    }
    const T = parts.reduce((s, p) => s + p.mesh.indices.length / 3, 0);
    assert.equal(T, 12 * g * g);
    let clock = performance.now();
    const files = partsTo3mfFiles(parts);
    const xmlMs = performance.now() - clock;
    clock = performance.now();
    const store = zipStore(files);
    const storeMs = performance.now() - clock;
    clock = performance.now();
    const deflated = await zipDeflate(files);
    const deflateMs = performance.now() - clock;
    for (const zip of [store, deflated]) {
      const {issues, model} = check3mfZip(zip);
      assert.deepEqual(issues, []);
      assertCoordinatesPreserved(model, parts);
    }
    clock = performance.now();
    const stlBytes = parts.reduce((s, p) => s + meshToBinaryStl(p.mesh).length, 0);
    const stlMs = performance.now() - clock;
    assert.equal(stlBytes, 84 * parts.length + 50 * T);
    const modelBytes = files[2].data.length;
    t.diagnostic(`T=${T} · model XML ${modelBytes} B (${(modelBytes / T).toFixed(1)} B/삼각형) · STORE ${store.length} B · deflate ${deflated.length} B (${(deflated.length / T).toFixed(1)} B/삼각형) · STL 합 ${stlBytes} B`);
    t.diagnostic(`시간: XML ${xmlMs.toFixed(0)} ms · STORE ${storeMs.toFixed(0)} ms · deflate ${deflateMs.toFixed(0)} ms · STL ${stlMs.toFixed(0)} ms`);
    assert.ok(deflated.length < store.length / 4, '구조화 XML 은 deflate 로 크게 줄어요');
  });
});
