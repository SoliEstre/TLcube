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

<!-- Do not put a type COUNT in this heading or the prose below (2026-09-03).
     It rotted: the heading still read "Four types" over a five-row table after Type C
     landed. The table is the source of truth for how many types there are, and
     test/readme-types.test.js fails if the prose asserts a count the table disagrees with. -->
## Types

| Type | Silhouette | Net payload (ECC-M) |
|---|---|---|
| **O** | Hexagonal field | 18 / 39 / 65 / 97 B (k = 6 / 8 / 10 / 12) |
| **A** | Triangular silhouette | 31 / 62 / 101 B (k = 6 / 8 / 10) |
| **K** | Hexagram (A union inverted A) | 43 / 86 / 138 B (k = 6 / 8 / 10) |
| **Y** | Single isometric cube | 31 / 98 / 141 B (n = 13 / 21 / 25) |
| **C** | Notched hexagon (Type O family, close-range) | 130 / 172 / 220 / 255 B (k = 14 / 16 / 18 / 20) |

All types share the same data contract and differ only in silhouette. Each can carry a
**fallback QR** printed alongside, so a reader that cannot decode the TL code still has a path.

**K** is a triangle unioned with its 180-degree image. At the same k it holds more cells
than A, so it carries the largest payload, and its six points double as detection anchors.

### True 3D H cube extension

The Y selector also offers **True 3D → H**, with 1–6 unique data faces,
2/3 tones, ECC L/M/H and H0…H8 grids (13…45 cells per side). With the generator's default
layout policy, ECC-M payloads are **3 / 21 / 45 / 78 / 119 / 123 / 185 / 255 / 333 B** for three faces
and **6 / 42 / 90 / 156 / 238 / 330 / 440 / 510 / 666 B** for six faces.
Two- to five-face H5+ and six-face H7+ place four square finders, format and references inside the
unchanged face grid. Legacy frame H remains readable. The library default `finder:'frame'`
keeps the old capacities; the generator uses `finder:'auto'`.
H is a separate wire format and does not use Y's QR inset, locators or shading. H has its own lighting controls;
rotation fill lights data/reference tones together while protecting black/white finder marks.
Standard PNG/SVG and snapshots contain only the visible H faces. The Y group's 3D data section
exports complete PNG/SVG cube nets, glTF 2.0 models and Minecraft `.schem` structures with
nearest-color concrete, not complete worlds. The preview panel provides screen-axis X/Y(default)/composite
rotation, speed and independent pose/perspective controls. New H views default to 4° perspective and auto-rotation.
Automatic X/Y and gyro speeds are 75/60°/s through H5, 60/45°/s for H6–H7, and 50/35°/s for H8.
Manual speed overrides persist until the speed reset button restores the resolution-based defaults.
X/Y tilt compensation ranges from 0–35° (default 17.5°) with its own reset; gyro uses a fixed 35°.
Aligned horizontal/vertical layouts suppress the secondary tilt on their corresponding rotation axis.
H supports corner QR, but not inset QR. Corner QR preserves the cube's center and scene size.
Auto-rotation can be exported as a silent, closed-loop MP4 at 720×720, 1080×1080 or 1440×1440 in AVC/MP4-capable browsers. Transparent backgrounds
are replaced by checkerboard/green(default)/blue/magenta, not encoded as alpha video.
Video FPS cards offer 24, 30, 60 (default) and 120; 60/120 requires WebCodecs AVC support with no silent FPS downgrade.
X/Y and gyro paths close after 360/speed seconds, including secondary-axis motion, for seamless repetition.
Isometric (default), horizontal and vertical arrangements separate the physical display from logical face IDs.
Horizontal/vertical use at most four side faces and offer centered-seam alignment presets with screen Y/X rotation.
One- to three-face codes repeat on the free opposite sides in six-face rendering ("6 faces (repeat)", except the opposite-faces arrangement); opposite faces that are both blank share one image.
Other blank faces accept independent PNG/JPEG/WebP/SVG images, 45° rotation, contain/fill/cover and background colors; five-face H has one blank face.
The capacity figures above describe three-tone 3/6-face modes with the generator's automatic finder policy only. New 1/2/4/5-face modes use separately identified
pair/group packets and require an updated scanner; existing 3/6-face bytes remain unchanged.
Images stay in the current page
and are included in visible-view exports, full nets, embedded glTF, rotation video and nearest-concrete schematic output.
The mask defaults to 7 for new generator state; automatic size still prioritizes strong ECC. H previews use cached
GPU face textures when available, with the exact scene renderer retained for exports and a Canvas fallback.
See the [H spec](SPEC.md#13-h-v2--y-그룹의-실제-큐브-확장-시험판).

**Maker files (paper and 3D printing).** With H active, the generator offers a collapsed *Maker files* section.
Every file is built in physical coordinates, so seen from outside the cube each face matches the screen (no mirror image).
For 3D printing it exports a 3MF with one part per color (Bambu Studio, OrcaSlicer, Cura), the same parts as a
per-color STL bundle (ZIP, for PrusaSlicer) and a single-color stand STL that holds the cube on a vertex.
Options cover cell size, embedded code depth (0.6–2.0 mm) and hollowing (on by default) with inner ribs and a vent hole
per chamber; the 3MF places the cube on the build plate, so slicers that keep file coordinates, such as Cura, open it on the plate.
Paper patterns come as a one-sheet net with glue tabs (paper up to 0.45 mm), a wrap skin with a board-core cutting list,
or butt-jointed board pieces, chosen by thickness. They export as millimeter-exact SVG, 300 dpi PNG and vector PDF, or print directly,
on A3, A4, A5, ISO and JIS B4/B5 and Letter, with plain paper, card, board and corrugated thickness presets or a measured thickness.
Each pattern carries a 50 mm calibration bar. If a printer driver shrinks the page, enter the measured bar length and the next
PNG, PDF and direct print are pre-scaled to compensate (remembered per paper size in this browser only). SVG stays unscaled
as the real-size file for cutting machines and editing.
A cube folded from the one-sheet net has been read by the scanner; the wrap skin, the board pieces and a 3D-printed cube have not yet been verified with a real scan.
The older cube nets in the 3D data section are mirrored on every face and do not scan when folded — use these paper patterns instead.

The scanner collects H faces across R2 camera frames or consecutive photos. It releases a
payload only after all required unique 1–6 faces and full RS/CRC verification; partial faces expire after 90 seconds.
Y processing pauses while valid H partial collection is active and resumes after reset/expiry.
Verified H URLs follow the TL opening policy; ordinary fallback QR URLs remain manual. Changing the display language does not reopen the URL.
The camera guide shows a bottom-center zigzag face net and briefly overlays detected face IDs
using the observed perspective; stale or mismatched camera geometry hides the labels.
Dark-data candidate crowding is reduced by ranking up to 512 components before the bounded
128-component contour stage. This does not relax face, ECC or CRC validation.
Camera and photo collections are separate. A confirmed non-Y/H reader QR hint or verified N7 can
temporarily switch the camera to R1 without changing the saved R2 preference; restarting restores it.
Unhinted QR content is not used to guess the family. Synthetic and worker checks are not a real-camera
recognition-rate or mobile-FPS guarantee.

The camera FPS badge counts completed processing results in a five-second window, not camera frames
or H detector calls. It resets on session/engine changes and dims when results stop. Expand Performance
diagnostics for local-only rates and preparation/service/queue timing; no image, decoded content or device
identifier is included. The scanner avoids unused luminance percentile work without changing pixel values.
An experimental two-frame preparation queue is **lab-only and off by default**: developers may set
`localStorage.setItem('tlscan.r2.pipelineDepth', '2')` on the lab origin and reload; remove that key to restore
the default. Formal pages always use depth one. More overlap can raise CPU use and result age, so this is
not a claim of higher recognition rate or 10 FPS on phones. H detection intervals and Y/QR routing stay unchanged.

## Status

| Milestone | Scope | Status |
|---|---|---|
| M0 | Generator — layout frozen | **complete** |
| M1 | Synthetic decoder | **complete** — `src/decoder/`, regression tests in `test/` |
| M2 | Real-camera scanner | **running** — [tlscan.estre.so](https://tlscan.estre.so) |
| M3 | Style presets · packaging | in progress — 4 presets |

## Usage

```bash
node tools/dev-server.mjs        # http://localhost:8765 — development (index.html + src/)
node tools/build-single.mjs      # dist/trilume.html — one file, opens over file:// with no server
npm test                         # bounded default checks
npm run test:full                # release functional gate; requires corpus, no skips
npm run test:bench               # opt-in performance experiments, not the release gate
```

A filming print sheet (A4, QR then TLcube, same on-paper size) lives at [`print/tlcube-poster.html`](print/tlcube-poster.html). It opens over `file://`. See [`print/README.md`](print/README.md).

## How it is built

Vanilla JavaScript with in-repository Node.js build scripts and **zero runtime dependencies**. The generator bundles into a single HTML file.

Export is **deterministic** — identical input yields byte-identical PNG/SVG. That is why pixels come from an in-repo rasterizer (`src/raster.js`) rather than a browser canvas, and PNG encoding is also in-repo (`src/png.js`). Canvas is used only for the on-screen preview.

Encoding path: `encode.js` (payload → RS over GF(211) codeword → per-cell digits) → `scene.js` (digits → shape list) → canvas preview / `raster.js` + `png.js` / `svg.js`. Render self-check lives in `verify.js`, which reads the rasterized pixels back and confirms every cell's luminance ranking matches the intended digit, using the same sample-disc median statistic the decoder is specified to use.

## Spec

One-face H (`mode: 1`) combines two logical scan regions on XM into a single RS/CRC-checked packet; H0 is not available in this mode. With strong ECC, the default 19-byte URL selects H3 (25×25), with 19 B in two tones or 27 B in three tones. Blank-face images and opposite-face repetition use the same 3D/export mapping. Existing 2–6-face wire formats remain unchanged. See [SPEC §13.9](SPEC.md#139-h-v2s--h-v2sc--한-물리면의-단일-패킷) for the exact layout and capacity table. RS/CRC checks integrity, not cryptographic authenticity.

The normative format spec is **[SPEC.md](SPEC.md)** — geometry, symbol encoding, layout, capacity, error correction, and conformance requirements. Every numeric table in it is generated from `src/`, and the wire contract is pinned by snapshots in `test/`.

**Implementing only a decoder still counts as a conforming implementation** (SPEC §11). Adoption starts with the reading side, so partial implementations are deliberately not excluded.

## License

Code and spec in this repository are released under the **[Apache License 2.0](LICENSE)**. Copyright 2026 SoliEstre.

**Patents**: as of 2026-08-09, SoliEstre holds **no patents and has no patent applications pending** on this format. That statement is unconditional — anyone may implement this format, whole or in part, decoder-only or not, commercially or not. (Apache-2.0 §3 separately grants an explicit patent license for the distributed code.)

**Third party**: `src/vendor/jcodd.js` is an unmodified vendored copy of [jcodd](https://github.com/Esterkxz/JCODD) and remains under its original MIT license (full text in the file header).

**Trademark notice**: QR Code is a registered trademark of DENSO WAVE INCORPORATED.

---

*Generator: [tlcube.estre.so](https://tlcube.estre.so) · Overview: [tl.estre.so](https://tl.estre.so) · Scanner: [tlscan.estre.so](https://tlscan.estre.so)*
