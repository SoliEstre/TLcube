/**
 * y3d-slot-qr.js — 3D 미리보기에 **QR 슬롯**을 그릴 면 사각형을 낸다.
 *
 * ## 왜 있나 (운영자 신고 2026-09-01 「안쪽 QR 은 QR 이 표시 안 됨」)
 *
 * 2.5D(`sceneY.js` §renderSlotQr)는 슬롯 QR 을 **셀보다 잘게** 그린다 — 슬롯 칸은
 * `cellDigits` 에 role 'slot' 으로만 있고 폴리곤을 안 그리며, QR 은 그 위에 별도
 * 파라메트릭 도형으로 얹힌다. 3D(`y3d-viewer.js`)는 **셀 단위**로만 그리고
 * digit·level 이 둘 다 없는 칸은 건너뛴다 ⇒ 슬롯이 **검은 구멍**이 됐다.
 *
 * 이건 2026-08-26 「데이터 부분만 나오고 파인더 영역은 구멍이 뚫린다」와 **같은 사고의
 * 두 번째 절반**이다. 그때는 로케이터 칸을 `levelAt` 으로 메워 고쳤는데, 슬롯 칸은
 * 그 쓸기에서 빠졌다. 렌더 축을 열면 **렌더러를 전부** 쓸어야 한다.
 *
 * ## 왜 셀이 아니라 사각형인가
 *
 * QR 모듈 피치는 `slotCells / 29` 로 **1 셀보다 잘다** (v0trq 슬롯 8셀 → 0.276 셀).
 * `levelAt` 은 셀 단위 계약이라 이 격자를 표현할 수 없다. 그래서 3D 뷰어에 셀 격자와
 * 무관한 면 사각형(`faceQuads`) 축을 열고, 그 기하를 여기서 낸다.
 *
 * ## 2.5D 와 **같은 방식**으로 칠한다 — 그리고 순서가 계약이다
 *
 * 「콰이어트 판 1장 + 다크 모듈 N장」이다 (`renderSlotQr` 과 동일). 반환 배열의
 * **순서가 painter 순서**이고, 소비자는 그 순서를 보존해야 한다 — `buildOrbitMesh` 의
 * 정렬 비교자가 오버레이끼리는 0 을 돌려 방출 순서를 유지한다.
 *
 * ⚠ **한 번 29×29 겹침 없는 타일링으로 짰다가 되돌렸다.** depth 정렬을 피하려는
 *    선택이었는데, `paintQuads` 가 quad 마다 `rgba(0,0,0,0.35)` 0.6px 테두리를 그어
 *    ≈2px 짜리 타일이 통째로 어두워졌다 (운영자: 「QR이 좀 어두운데? 배경까지?」 —
 *    캔버스에 순백이 **0 픽셀**). 자기 색으로 긋는 대안은 다크 모듈에 면적 +60% 의
 *    도트게인을 만들어 더 나쁘다. 정렬 문제는 «오버레이끼리 순서 유지» 로 직접 풀고
 *    칠하는 방식은 2.5D 와 맞추는 것이 옳았다.
 *
 * 두 렌더가 같은 색을 내는지는 `test/y3d-slot-qr.test.js` 가 같은 표본점에서 대조해
 * 잠근다 (사본이 아니라 **대조**로 막는다).
 *
 * ## 면 게인을 안 먹인다 (의도)
 *
 * 3D 뷰어는 `colorOfCell` 이 `levels[lv]` 를 **그대로** 쓴다 — 면 게인 축이 없다.
 * 여기서만 게인을 먹이면 QR 만 주변 셀과 다른 밝기가 된다. 뷰어의 규약을 따른다.
 *
 * @module y3d-slot-qr
 */
import {
  CENTER_QR_MODULE_GRID,
  CENTER_QR_QUIET_MODULES,
  centerQrModulePitchCells,
  centerQrSlotCellsFor,
  centerQrSlotOriginFor,
  centerQrSlotPlacementFor,
  hasCenterQrSlot,
} from './cellSurfaceFinal.js';
import { CENTER_QR_SIDE_FILL } from './sceneY.js';
import { qrMatrix } from './qr.js';

/**
 * 슬롯 QR 을 3D 뷰어용 면 사각형으로 낸다. 슬롯 없는 레이아웃·qrText 없음은 빈 배열
 * (던지지 않는다 — 미리보기는 부분 구성에서도 그려져야 한다).
 *
 * @param {{layoutId: (string|null|undefined), n: number, qrText: (string|undefined),
 *          palette: {bullseyeLight: object, bullseyeDark: object, levels: object[]}}} spec
 * @returns {Array<{face: 'T'|'L'|'R', a: number, b: number, size: number, color: object}>}
 */
export function slotQrFaceQuads(spec) {
  const {
    layoutId, n, qrText, palette,
  } = spec ?? {};
  if (typeof layoutId !== 'string' || !hasCenterQrSlot(layoutId)) return [];
  if (typeof qrText !== 'string' || qrText === '') return [];
  if (!Number.isInteger(n) || n <= 0) return [];
  if (palette === null || typeof palette !== 'object') return [];

  const slotCells = centerQrSlotCellsFor(layoutId);
  if (slotCells <= 0) return [];
  const origin = centerQrSlotOriginFor(layoutId, n);
  const placement = centerQrSlotPlacementFor(layoutId);
  if (origin === null || placement === null) return [];

  // qrMatrix 는 알파뉴메릭 밖 문자·용량 초과에 **던진다**. 미리보기가 그것 때문에
  // 통째로 죽으면 안 된다 — 2.5D 는 같은 상황에서 렌더 전체가 죽는 게 맞지만
  // (내보내는 코드가 거짓이 되므로) 여기는 보기 층이다.
  let qr = null;
  try {
    qr = qrMatrix(qrText);
  } catch {
    return [];
  }
  if (qr.size !== CENTER_QR_MODULE_GRID) return [];

  const flip = placement.flip === true;
  const pitch = centerQrModulePitchCells(slotCells);
  const quiet = palette.bullseyeLight;
  const dark = palette.bullseyeDark;
  const quads = [];

  // ① T 면 — 콰이어트 판(슬롯 전체) **먼저**, 그 위에 다크 모듈.
  quads.push({
    face: 'T', a: origin.i, b: origin.j, size: slotCells, color: quiet,
  });
  for (let qy = 0; qy < CENTER_QR_MODULE_GRID; qy += 1) {
    for (let qx = 0; qx < CENTER_QR_MODULE_GRID; qx += 1) {
      if (qr.modules[qy * qr.size + qx] !== 1) continue;
      // renderSlotQr 과 **같은 사상** — source(qx,qy) → dest(u,v).
      const u = flip ? (CENTER_QR_MODULE_GRID - 1 - qx) : qx;
      const v = flip ? (CENTER_QR_MODULE_GRID - 1 - qy) : qy;
      quads.push({
        face: 'T',
        a: origin.i + (CENTER_QR_QUIET_MODULES + u) * pitch,
        b: origin.j + (CENTER_QR_QUIET_MODULES + v) * pitch,
        size: pitch,
        color: dark,
      });
    }
  }

  // ② L/R 면 — 슬롯 채움 1장. 톤 결정은 sceneY 의 상수를 **가져다 쓴다**.
  const sideColor = CENTER_QR_SIDE_FILL === 'quiet' ? quiet : palette.levels[0];
  for (const face of ['L', 'R']) {
    quads.push({
      face, a: origin.i, b: origin.j, size: slotCells, color: sideColor,
    });
  }
  return quads;
}
