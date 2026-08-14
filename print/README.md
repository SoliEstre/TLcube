# Print poster (filming)

Standalone A4 sheet for a short left-to-right scan video.

## File

`print/tlcube-poster.html`

Regenerate (does **not** touch `dist/` or lab bundles):

```bash
node tools/build-print-poster.mjs
```

## Preview

- Direct: open the file over `file://`. No server, no scripts.
- Optional static server, repo root:

```bash
node tools/dev-server.mjs
```

then `http://localhost:8765/print/tlcube-poster.html`

## Print

- Paper: A4 portrait.
- Scale: **100%** (no “fit to page”).
- Enable **background graphics** / print backgrounds so the modules stay black.
- Confirm both codes stay the same on-paper size (`--symbol-box: 45mm`). The
  original 68mm box was reduced by roughly one third, not reduced to one third.

## Payload and format

| | |
|---|---|
| Destination | `https://tl.estre.so` (exact bytes in both symbols) |
| QR | In-repo `qrV2ByteMatrix` (v2, 25×25, ECC-L, byte mode). Encodes the same lowercase string as TLcube. |
| TLcube | Type **Y0** low resolution (n=13), **3-tone**, ECC-**M**, no corner/window QR. |

The poster intentionally uses a magenta Y0 3-tone palette for the requested
visual comparison; the QR card carries the contrasting blue/cyan accents.
Existing field evidence still shows a Type Y **3-tone** real-photo limitation,
so decode the actual color print before filming; this poster change does not
claim or implement a scanner fix.

Both symbols sit in `.symbol-box` (`width`/`height: var(--symbol-box)`) centered
inside identical white stages. QR quiet zone is 4 modules inside that box.
TLcube uses a 3-unit scene margin. Color decoration stays outside both code
areas. Visible product spelling remains `TLcube`.

## Before filming

1. Decode the printed QR and the printed TLcube; both should open the hub.
2. Measure the two black-bordered squares; they must match.
3. Hold the sheet flat. Watch focus and exposure so neither code blows out.
4. Pan left (QR) → right (TLcube). The gutter reads “ONE LINK · CHOOSE YOUR WAY”.
