# TLcube — TrilLuminance (cube)

**English** · [한국어](README.ko.md)

> Formal name **TrilLuminance (cube)** · codename Trilume.
> A 3D barcode (actually 2.5D) that stores data in the **luminance rank** of three rhombic faces per hexagonal cell.
> Status: **encoder, decoder and live camera scanner all running** — the browser generator and scanner are live.

<p align="center">
  <img src="sites/tl/assets/type-Y.png" alt="Type Y — a single isometric cube with a fallback QR at the top left" width="30%">
  <img src="sites/tl/assets/type-O.png" alt="Type O — a hexagonal field with a central QR finder" width="30%">
  <img src="sites/tl/assets/type-A.png" alt="Type A — a triangular silhouette with a central QR finder" width="30%">
</p>

---

## What it is

Each hexagonal cell is split by a rhombille tiling into three rhombi — `T` (top), `L` (left), `R` (right) — and data rides on the **relative luminance order** of those three faces. Three faces permute 3! = 6 ways, so one cell carries one base-6 digit (log₂6 ≈ 2.585 bits).

The result looks like *a field of isometric cubes, each lit from a different direction*. The encoding principle and the visual are the same thing.

## Why

**This is not a QR replacement.** Rhombic cells lose to square modules on density, and that argument is settled. Two things are worth having instead:

1. **Aesthetics** — a code you would actually put on a wall.
2. **Differential-encoding robustness** — data lives in the **relative order** of three faces within a cell, not in absolute luminance. Any **monotonic** tone transform — global illumination change, gamma, printer/display tone mapping — leaves the order intact, and therefore the data.

## Renderer freedom

The data contract is only **the order between faces** and a **minimum separation (Δmin)**. Inside that, a renderer does what it likes: jitter absolute luminance per cell, apply color, gradient the inside of a face, animate over time. Only the order after conversion to relative luminance has to survive.

That freedom is the point of the format.

## Four types

| Type | Silhouette | Net payload (ECC-M) |
|---|---|---|
| **O** | Hexagonal field | 18 / 39 / 65 / 97 B (k = 6 / 8 / 10 / 12) |
| **A** | Triangular silhouette | 31 / 62 / 101 B (k = 6 / 8 / 10) |
| **K** | Hexagram (A union inverted A) | 43 / 86 / 138 B (k = 6 / 8 / 10) |
| **Y** | Single isometric cube | 31 / 98 / 141 B (n = 13 / 21 / 25) |
| **C** | Notched hexagon (Type O family, close-range) | 130 / 172 / 220 / 255 B (k = 14 / 16 / 18 / 20) |

All four share the same data contract and differ only in silhouette. Each can carry a
**fallback QR** printed alongside, so a reader that cannot decode the TL code still has a path.

**K** is a triangle unioned with its 180-degree image. At the same k it holds more cells
than A, so it carries the largest payload, and its six points double as detection anchors.

## Status

| Milestone | Scope | Status |
|---|---|---|
| M0 | Generator — layout frozen | **complete** |
| M1 | Synthetic decoder | **complete** — `src/decoder/`, 194 test files |
| M2 | Real-camera scanner | **running** — [tlscan.estre.so](https://tlscan.estre.so) |
| M3 | Style presets · packaging | in progress — 4 presets |

## Usage

```bash
node tools/dev-server.mjs        # http://localhost:8765 — development (index.html + src/)
node tools/build-single.mjs      # dist/trilume.html — one file, opens over file:// with no server
npm test                         # full suite (node --test)
```

A filming print sheet (A4, QR then TLcube, same on-paper size) lives at [`print/tlcube-poster.html`](print/tlcube-poster.html). It opens over `file://`. See [`print/README.md`](print/README.md).

## How it is built

Vanilla JavaScript. **No build toolchain, zero runtime dependencies.** It runs as a single HTML file.

Export is **deterministic** — identical input yields byte-identical PNG/SVG. That is why pixels come from an in-repo rasterizer (`src/raster.js`) rather than a browser canvas, and PNG encoding is also in-repo (`src/png.js`). Canvas is used only for the on-screen preview.

Encoding path: `encode.js` (payload → RS over GF(211) codeword → per-cell digits) → `scene.js` (digits → shape list) → canvas preview / `raster.js` + `png.js` / `svg.js`. Render self-check lives in `verify.js`, which reads the rasterized pixels back and confirms every cell's luminance ranking matches the intended digit, using the same sample-disc median statistic the decoder is specified to use.

## Spec

The normative format spec is **[SPEC.md](SPEC.md)** — geometry, symbol encoding, layout, capacity, error correction, and conformance requirements. Every numeric table in it is generated from `src/`, and the wire contract is pinned by snapshots in `test/`.

**Implementing only a decoder still counts as a conforming implementation** (SPEC §11). Adoption starts with the reading side, so partial implementations are deliberately not excluded.

## License

Code and spec in this repository are released under the **[Apache License 2.0](LICENSE)**. Copyright 2026 SoliEstre.

**Patents**: as of 2026-08-09, SoliEstre holds **no patents and has no patent applications pending** on this format. That statement is unconditional — anyone may implement this format, whole or in part, decoder-only or not, commercially or not. (Apache-2.0 §3 separately grants an explicit patent license for the distributed code.)

**Third party**: `src/vendor/jcodd.js` is an unmodified vendored copy of [jcodd](https://github.com/Esterkxz/JCODD) and remains under its original MIT license (full text in the file header).

**Trademark notice**: QR Code is a registered trademark of DENSO WAVE INCORPORATED.

---

*Generator: [tlcube.estre.so](https://tlcube.estre.so) · Overview: [tl.estre.so](https://tl.estre.so) · Scanner: [tlscan.estre.so](https://tlscan.estre.so)*
