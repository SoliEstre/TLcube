// 레이아웃별 «용량 대 자세 강건성» 교환비 — 그리고 슬롯 QR 의 대조군.
//
// ## 왜 필요한가 (2026-09-01)
//
// 운영자 실측: 3D 미리보기가 슬롯 QR 을 안 그리던 결함(PM/031 §16)을 고치자 자세 상한이
// 올랐다 — v0TRQ 1°→2° · v0TY 4°→5°. 그런데 **슬롯 없는 v0T·v0TR 은 1°** 다.
// 즉 슬롯 QR 이 자세 강건성에 **순이익**일 가능성이 생겼는데, 지금 용량표는 슬롯을
// 「데이터를 먹는 비용」으로만 회계한다 (PM/031 §15.2 ②).
//
// 여기서 재는 것은 **비(比)** 다. 합성 사다리는 라이브를 3\~7배 과소평가하므로(§14)
// 절대값을 옮겨 적으면 안 된다. 재는 것은 «레이아웃끼리의 순서» 와 «슬롯 QR 유무의 차» 다.
//
// ## 🔴 대조군이 이 하네스의 핵심이다
//
// 이 하네스는 `buildOrbitMesh` 로 그린다 — 운영자가 자세를 시험한 바로 그 경로다.
// 슬롯 레이아웃을 **두 번** 잰다:
//   · `hole` : faceQuads 없음 = 수리 **전** 상태 (슬롯이 검은 구멍)
//   · `qr`   : faceQuads 있음 = 수리 **후** 상태
// 둘의 차가 운영자 실측의 방향과 같으면 인과가 합성으로 재현된 것이고, 다르면
// **내 자가 그 축을 안 지나는 것**이다 (그 경우도 결과다 — 조용히 넘기지 않는다).
//
// ## 통제한 것 / 통제 못 한 것
//
// 통제: 같은 페이로드 · 같은 ECC · 같은 셀당 픽셀(PPU 고정) · 같은 프리셋 · 원근 0.
//   ⚠ PPU 고정은 **해상도 축을 일부러 제거**한다. 라이브는 프레임 크기가 고정이라
//     n 이 커지면 셀당 픽셀이 줄어든다 — 그 축은 여기 없다. v0(n=13) 의 라이브 우위
//     7\~8° 중 얼마가 «셀이 크다» 에서 오는지는 이 표가 대답하지 못한다.
// 통제 못 함: 단발 프레임 · 고정 프레이밍 · AE/AF 없음. 라이브 격차의 알려진 원인이다.
import { encodeY } from '../../src/encodeY.js';
import { buildOrbitMesh } from '../../src/y3d-viewer.js';
import { slotQrFaceQuads } from '../../src/y3d-slot-qr.js';
import { layoutForCube } from '../../src/ygrid.js';
import {
  BULLSEYE_DARK, BULLSEYE_LIGHT, DEFAULT_PRESET, getPreset,
} from '../../src/luminance.js';
import { rasterize } from '../../src/raster.js';
import { decodeFrontend } from '../../src/decoder/frontend.js';
import { hasCenterQrSlot } from '../../src/cellSurfaceFinal.js';

const PAYLOAD = 'https://tl.estre.so';       // 19 B — v0(n=13, 20 B) 에도 들어간다.
const QR_TEXT = 'HTTPS://TLSCAN.ESTRE.SO';   // QR v1 알파뉴메릭.
const ECC = 'M';
const PPU = 17;                              // 셀당 17 px — 하한(9 px) 위.
const MARGIN = 4;
const DEG = Math.PI / 180;
const SPAN = 8;                              // ±8° 를 1° 눈금으로.

const preset = getPreset(DEFAULT_PRESET);
const palette = {
  levels: preset.levels,
  background: preset.background,
  bullseyeDark: BULLSEYE_DARK,
  bullseyeLight: BULLSEYE_LIGHT,
};

/** 운영자가 잰 것은 Y2(n=25) 다. v0 는 정의상 n=13 뿐이다. */
const LAYOUTS = [
  { id: 'v0', version: 0 },
  { id: 'v0t', version: 2 },
  { id: 'v0tr', version: 2 },
  { id: 'v0ty', version: 2 },
  { id: 'v0trq', version: 2 },
  { id: 'v0try', version: 2 },
];

function prepare(spec) {
  const encoded = encodeY(PAYLOAD, {
    cellSurface: true,
    cellSurfaceLayout: spec.id,
    tones: 3,
    eccLevel: ECC,
    version: spec.version,
  });
  const n = encoded.n;
  const layout = layoutForCube(n, { size: 1, margin: MARGIN });
  const digitAt = (i, j) => {
    const c = encoded.cellDigits.get(`${i},${j}`);
    return c ? c.digit : null;
  };
  const levelAt = (i, j, face) => {
    const c = encoded.cellDigits.get(`${i},${j}`);
    if (!c || !c.tones) return null;
    return Number.isInteger(c.tones[face]) ? c.tones[face] : null;
  };
  const faceQuads = slotQrFaceQuads({
    layoutId: spec.id, n, qrText: QR_TEXT, palette,
  });
  return {
    spec, encoded, n, layout, digitAt, levelAt, faceQuads,
  };
}

function render(m, view, withSlotQr) {
  const mesh = buildOrbitMesh({
    n: m.n,
    tones: m.encoded.tones,
    levels: preset.levels,
    layout: m.layout,
    digitAt: m.digitAt,
    levelAt: m.levelAt,
    faceQuads: withSlotQr ? m.faceQuads : [],
    perspective: 0,
    roll: 0,
    faces: 3,
    ...view,
  });
  return rasterize({
    width: m.layout.width,
    height: m.layout.height,
    background: preset.background,
    shapes: mesh.quads.map((q) => ({ kind: 'polygon', points: q.points2d, color: q.color })),
  }, { pixelsPerUnit: PPU, supersample: 2 });
}

/*
 * 🔴 **사유를 버리지 않는다** (2026-09-01 운영자 관측). 처음엔 boolean 만 냈는데,
 *    운영자가 「v0T/v0TR 은 `no-grid-hypothesis`, 읽힐 여지가 있으면 `no-format-candidate`
 *    위주」라는 **다른 축**을 보고 있었다. 그 축이 있어야 「왜 이 레이아웃만 최하인가」를
 *    묻을 수 있다 — 실패 «코드» 집계는 라벨 집계지만, 여기서는 그 라벨이 곧 실패 **단계**다.
 *    사유는 같은 decodeFrontend 호출에서 공짜로 나온다.
 */
function judge(raster) {
  try {
    const d = decodeFrontend({
      width: raster.width, height: raster.height, pixels: raster.pixels,
    }, {});
    if (d && d.ok) return String(d.text) === PAYLOAD ? 'ok' : 'wrong-payload';
    return String((d && (d.reason || d.code)) || 'fail').replace(/^frontend:/, '');
  } catch (e) {
    return 'throw:' + String(e.message).slice(0, 24);
  }
}

/** 연속 통과 구간만 상한으로 친다 — 불연속이면 그 사실을 같이 낸다. */
function sweep(m, axis, withSlotQr) {
  const ok = [];
  const reasons = new Map();
  for (let deg = -SPAN; deg <= SPAN; deg += 1) {
    const view = { yaw: 0, pitch: 0, [axis]: deg * DEG };
    const why = judge(render(m, view, withSlotQr));
    reasons.set(why, (reasons.get(why) || 0) + 1);
    if (why === 'ok') ok.push(deg);
  }
  if (ok.length === 0) return { span: '없음', width: 0, contiguous: true, ok, reasons };
  const lo = Math.min(...ok);
  const hi = Math.max(...ok);
  const width = hi - lo + 1;
  return {
    span: `${lo}°\~${hi}°`, width, contiguous: ok.length === width, ok, reasons,
  };
}

/** 사유 히스토그램을 «많은 것부터» 한 줄로. */
function reasonLine(reasons) {
  return [...reasons].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');
}

const rows = [];
console.log('레이아웃별 자세 허용 폭 — 합성 · 원근 0 · 셀당 ' + PPU + 'px · ±' + SPAN + '° 1° 눈금\n');

for (const spec of LAYOUTS) {
  let m;
  try {
    m = prepare(spec);
  } catch (e) {
    console.log(`${spec.id.padEnd(6)} ⛔ 인코드 실패: ${e.message.slice(0, 70)}`);
    continue;
  }
  const slot = hasCenterQrSlot(spec.id);
  const variants = slot ? [false, true] : [true];

  for (const withQr of variants) {
    // 🔴 기준선 게이트 — 중립이 안 읽히면 그 행의 사다리는 의미가 없다.
    if (!judge(render(m, { yaw: 0, pitch: 0 }, withQr))) {
      console.log(`${spec.id.padEnd(6)} ${(slot ? (withQr ? 'qr  ' : 'hole') : '—   ')} ⛔ 기준선 불통과 — 이 행은 만들지 않는다`);
      continue;
    }
    const yaw = sweep(m, 'yaw', withQr);
    const pitch = sweep(m, 'pitch', withQr);
    rows.push({
      id: spec.id,
      n: m.n,
      variant: slot ? (withQr ? 'qr' : 'hole') : '—',
      bytes: m.encoded.capacity?.maxPayloadBytes ?? null,
      data: m.encoded.capacity?.dataSymbols ?? null,
      yaw,
      pitch,
    });
  }
}

console.log('레이아웃  n   슬롯   용량B  데이터  yaw 폭          pitch 폭');
for (const r of rows) {
  console.log(
    r.id.padEnd(9)
    + String(r.n).padEnd(4)
    + r.variant.padEnd(7)
    + String(r.bytes ?? '—').padEnd(7)
    + String(r.data ?? '—').padEnd(8)
    + `${r.span || ''}${r.yaw.span.padEnd(9)}(${r.yaw.width}칸)${r.yaw.contiguous ? '' : '⚠불연속'}`.padEnd(16)
    + `${r.pitch.span.padEnd(9)}(${r.pitch.width}칸)${r.pitch.contiguous ? '' : '⚠불연속'}`,
  );
}

// ── 실패 사유 교차표 — 운영자 가설(§19.3)의 시험대 ─────────────────────────
//
// 가설: 격자 적합은 전역 모델 하나를 세우므로 셀마다 왜곡 편차가 크면 어느 가설도 안 선다
//       (no-grid-hypothesis). 슬롯이 **극단값 쪽 셀을 들어내면** 편차가 좁아져 가설이 선다.
// 예측: 슬롯 없음(v0T·v0TR) 은 no-grid-hypothesis 비중이 제일 크고,
//       슬롯본은 그 비중이 줄고 no-format-candidate 쪽으로 옮겨 간다.
console.log('\n── 실패 사유 (yaw 축) ──');
for (const r of rows) {
  console.log(`${r.id.padEnd(7)}${r.variant.padEnd(6)}${reasonLine(r.yaw.reasons)}`);
}
console.log('\n── 실패 사유 (pitch 축) ──');
for (const r of rows) {
  console.log(`${r.id.padEnd(7)}${r.variant.padEnd(6)}${reasonLine(r.pitch.reasons)}`);
}

// ── 🔴 자 검증 — 표가 한 값으로 몰리면 재는 대상이 아니라 자를 의심한다 ─────────
const widths = rows.flatMap((r) => [r.yaw.width, r.pitch.width]);
const uniq = [...new Set(widths)];
console.log('');
if (rows.length === 0) {
  console.log('⛔ 행이 하나도 안 섰다 — 기준선 게이트가 전부 막았다. 자를 먼저 고쳐라.');
} else if (uniq.length === 1) {
  console.log(`⛔ 폭이 전부 ${uniq[0]} 칸으로 같다 — 이 자는 레이아웃을 안 가른다. 결론 금지.`);
} else {
  console.log(`자 검증: 폭이 ${Math.min(...widths)}\~${Math.max(...widths)} 칸으로 갈린다 (값 ${uniq.length}종).`);
}

// ── 대조군 판정 — 슬롯 QR 이 폭을 넓히는가 ──────────────────────────────────
console.log('');
for (const id of [...new Set(rows.filter((r) => r.variant !== '—').map((r) => r.id))]) {
  const hole = rows.find((r) => r.id === id && r.variant === 'hole');
  const qr = rows.find((r) => r.id === id && r.variant === 'qr');
  if (!hole || !qr) {
    console.log(`${id}: 대조군 한쪽이 없다 (기준선 불통과) — 판정 보류`);
    continue;
  }
  const dY = qr.yaw.width - hole.yaw.width;
  const dP = qr.pitch.width - hole.pitch.width;
  const sign = (v) => (v > 0 ? `+${v}` : String(v));
  console.log(`${id}: 슬롯 QR 로 yaw ${sign(dY)}칸 · pitch ${sign(dP)}칸`
    + (dY > 0 || dP > 0 ? '  ⇒ 넓어짐 (운영자 실측 방향과 일치)' : dY === 0 && dP === 0 ? '  ⇒ 차이 없음' : '  ⇒ 좁아짐 (실측과 반대 — 자를 의심하라)'));
}
