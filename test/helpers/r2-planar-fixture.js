import { encode } from '../../src/encode.js';
import { encodeA } from '../../src/encodeA.js';
import { encodeK } from '../../src/encodeK.js';
import { buildScene } from '../../src/scene.js';
import { rasterize } from '../../src/raster.js';
import { toRelativeLuminance } from '../../src/decoder/luma.js';
import { CENTRAL_N7_FINDER_PATTERN_ID } from '../../src/centralN7Schema.js';
import { FINDER_CELL_MASK_PATTERNS } from '../../src/finder-patterns.js';
import { daehanPatternId } from '../../src/finder-daehan.js';

export const planarPalette = { background: { r: 248, g: 249, b: 251 },
  levels: [{ r: 20, g: 28, b: 42 }, { r: 96, g: 116, b: 145 }, { r: 218, g: 228, b: 242 }],
  bullseyeDark: { r: 0, g: 0, b: 0 }, bullseyeLight: { r: 255, g: 255, b: 255 } };

export function renderPlanar(type, { style = 'n7', text = `${type}-optical`, version = 1,
  eccLevel = 'M', sagoae = false, cornerMarker = false, pixelsPerUnit = 12, supersample = 2 } = {}) {
  const encoder = type === 'O' ? encode : type === 'K' ? encodeK : encodeA;
  const encoded = encoder(text, { version, eccLevel, turnA: type === 'V',
    centralN7: style === 'n7', centralV0: style === 'v0', centerQr: style === 'qr',
    daehanFinder: style === 'daehan', ...(sagoae ? { sagoae } : {}), cornerMarker });
  const finderPatternId = style === 'n7' ? CENTRAL_N7_FINDER_PATTERN_ID
    : style === 'cell' ? FINDER_CELL_MASK_PATTERNS[0].id
      : style === 'oak' ? 'oak-aspirin' : style === 'three-tone' ? 'central-cube-3tone'
        : style === 'daehan' ? daehanPatternId(encoded.k)
          : style === 'v0' ? 'central-v0' : style === 'qr' ? 'center-qr' : 'bullseye';
  const scene = buildScene(encoded, { palette: planarPalette, margin: 20, finderPatternId,
    centralN7Family: type === 'O' ? 'hex' : type === 'K' ? 'star' : 'tri',
    qrText: 'HTTPS://TL.ESTRE.SO/' });
  return { encoded, scene, text,
    field: toRelativeLuminance(rasterize(scene, { pixelsPerUnit, supersample })) };
}
