# Triangle Overlay With Screen-Derived Color Mask

Electron overlay app that renders animated WebGL triangles and filters that overlay by the most frequent color captured from the desktop.

## What It Does

1. Creates a transparent always-on-top overlay window.
2. Renders triangles using the extracted `src/triangles.js` core.
3. Captures the desktop at 15 FPS.
4. Finds the single most frequent RGB color in the captured frame.
5. Builds a mask for only that exact RGB color.
6. Applies that mask to the hidden triangles canvas.
7. Composites background capture + masked triangles + debug rectangle into the visible screen canvas.

## Current Canvas Pipeline

Runtime is implemented in `src/triangles-runtime.js`.

1. `captureCanvas` (hidden): desktop capture frame.
2. `sourceCanvas` (hidden WebGL): raw triangles output.
3. `applyScreenColorMaskFrame(captureCanvas, sourceCanvas, ...)`: computes mask from capture, applies to triangles.
4. `screenCanvas` (visible): final composition shown in overlay window.

## Debug Window (4 Panels)

A popup debug window opens automatically and mirrors four live views:

1. Hidden Capture
2. Triangles Source
3. Mask
4. Final Screen

This is useful for validating each rendering/masking stage independently.

## Project Structure

Top-level:

- `main.js`: Electron main process, overlay window creation, cursor IPC, display capture source handler.
- `preload.js`: secure IPC bridge (`overlayApi`).
- `overlay.html`: renderer page and script loading order.
- `renderer.js`: cursor event forwarding + GPU color frequency sampler (`window.overlayColorStats`).
- `styles.css`: overlay page layout styles.

Runtime/modules:

- `src/triangles.js`: extracted triangles engine/core, exposed as `window.createTrianglesCore(...)`.
- `src/triangles-runtime.js`: orchestration loop, capture/mask integration, composition, debug window.
- `src/screen-color-mask-loop.js`: dominant-color mask logic and helpers:
	- `window.startScreenColorMaskLoop(...)`
	- `window.applyScreenColorMaskFrame(sourceCanvas, targetCanvas, maskOutputCanvas?)`

## Install and Run

```bash
npm install
npm start
```

## Controls and Exposed Globals

Renderer/runtime globals:

- `window.trianglesRuntime`: runtime control object from triangles core.
- `window.trianglesWebGL`: WebGL renderer instance.
- `window.overlayColorStats`: GPU histogram top-5 color stats from `renderer.js`.

Mask/debug globals:

- `window.startScreenColorMaskLoop`
- `window.applyScreenColorMaskFrame`

## Notes

1. Desktop capture uses `getDisplayMedia`; the user must grant capture permission.
2. Mask matching is exact RGB match against the most frequent screen color (not a tolerance band).
3. Overlay window is configured with content protection and mouse passthrough.

## Troubleshooting

### No mask effect

1. Confirm desktop capture permission was granted.
2. Check debug window panels:
	 - If `Hidden Capture` is blank, capture stream is not active.
	 - If `Mask` is blank, dominant color may be unstable or too sparse.

### Popup debug window does not appear

1. Ensure popup windows are not blocked.
2. Check renderer console for `Failed to open debug window`.

### Poor performance

1. Reduce capture FPS (`CAPTURE_FPS` in `src/triangles-runtime.js`).
2. Lower runtime render FPS (`TARGET_FPS` in `src/triangles-runtime.js`).

## License

MIT (project) plus licenses embedded in extracted third-party code blocks inside `src/triangles.js`.


