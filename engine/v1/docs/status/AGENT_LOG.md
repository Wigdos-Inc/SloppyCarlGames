# Agent Log

Running log of notable engine-touching work — not custom agents alone. Valid entry
sources are ERA, DRYAD, ARGUS, RIGOR, ED, SAGE, and MAIN (the main/orchestrating
agent acting directly, without spawning a custom agent). SAGE is responsible for
appending an entry here after any of these produces a meaningful finding or change,
including the main agent's own passes. The weekly status task reads this file and
then empties it (back to this header) after summarizing — so entries only need to
cover "since the last weekly report."

## Entry format

`- [YYYY-MM-DD] AGENT: task — outcome (authorized actions taken, if any)`

Examples:

`- [2026-07-09] DRYAD: reviewed NewObject.js tube refactor — found 1 duplicated matrix-multiply, flagged only (no fix authorized)`
`- [2026-07-09] MAIN: applied a flagged low-severity dedup fix directly — extracted a shared helper, no agent spawned`

## Log

- [2026-08-21] MAIN: scoped and then shipped `PERFORMANCE.Resolution`, a render-scale option in [config.js](engine/v1/core/config.js) surfaced in testGame's settings Performance section — implemented directly, no custom agent (the engine portion is ~5 lines and the bulk is testGame, which is outside ED/ERA/DRYAD scope). Scoping found `syncCanvasSize` ([Render.js:1419](engine/v1/handlers/Render.js#L1419)) sized the backing store 1:1 to `clientWidth`/`clientHeight` (DPR ignored) while the canvas is CSS-sized 100%/100% in a `fixed inset:0` root, so a scaled-down buffer is stretched to fill for free, and that `gl.viewport` plus the perspective aspect both derive from `canvas.width`/`.height` in `drawScene` and follow automatically. Nothing else reads default-framebuffer pixel dimensions — no `readPixels`, no screen-space picking, camera input is pointer-lock deltas, UI is a DOM overlay, and the other `gl.viewport` call is the texture-blend FBO on its own surface. Shipped: the config key as an integer percent; a scale-aware `syncCanvasSize` comparing against the *scaled* target rather than `clientWidth` (the flagged pitfall — the naive check reallocates the drawing buffer every frame at any scale below 100% and negates the win), read per frame so the setting applies live without a level restart; and testGame plumbing across [main.js](engine/v1/testGame/main.js), [ui.js](engine/v1/testGame/menus/ui.js) and a new slider row in [ui.json](engine/v1/testGame/menus/ui.json). Deduplicated while in `main.js`: `updateSensitivitySliderVisual` generalised to [`updatePercentSliderVisual(targetId, value, min)`](engine/v1/testGame/main.js#L98) over an extracted `stepPercent(value, min)`, collapsing clamp/step logic that had been duplicated between the visual updater and the input handler, and `SENSITIVITY_SLIDER_MAP` became `PERCENT_SLIDER_MAP` with a per-entry `min` covering both sensitivity sliders (0) and resolution (5), which `syncSettingsUi` now drives in one pass. Design as built, per the user: percentage slider in 5% steps; independent of the performance preset (out of `TIER_SLIDER_MAP`, so it never forces "Custom"); no floor beyond 5%, which is merely the lowest non-zero step — 0% is excluded only because a zero-size buffer makes the perspective aspect `0/0` = NaN ([Render.js:1885](engine/v1/handlers/Render.js#L1885)), blanking the frame rather than rendering small; supersampling above 100% explicitly out of scope. Saved settings migrate without a wipe because testGame `loadSettings` already backfills missing keys. `node --check` passes on all four edited JS files and ui.json parses; no browser verification yet — ARGUS offered to the user rather than auto-invoked, the change being both visual and behavioural.
