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

(empty — no entries since last weekly report)
- [2026-10-23] MAIN: 0.35.2 follow-up — debug MSAA toggle and LSM migration; not yet verified in the browser.
  - **MSAA:** inverted to `NoMSAA` on the author's direction. It's a real debug tool for turning MSAA off, so switching global debug off must always leave MSAA on. Defaults behave the same as before.
  - **LSM migrated (author asked, since LSM raised the gap):** the 180° level-rotation workaround is gone — `HOUSE`/`Flip` removed from build.js, `flipObject` from level.js. Entity offsets are now `x − center` with plain `yaw`. The player uses `rootTransform` at `SPAWN` with rotation 0, facing +Z into the mansion from the front door, so orbitCam opens behind. In game.js, ghost pos/target, `roamTarget` and the room lookup use raw design coordinates; the `MANSION` bounds are symmetric, so they needed no change. LSM README and ENGINE_GAPS.md updated (spawn-facing gap and latched-sensitivity papercut marked resolved). This resolves the known breakage noted in the previous entry. No `Flip`/`HOUSE` references remain; node --check passes on the three files as .mjs.
- [2026-10-23] ARGUS: browser verification of 0.35.2 (orbitCam rework, player rootTransform, culling/MSAA flags, LSM migration) — everything in scope passed; no engine bugs found, no fixes made.
  - **lvl1 stages 1–2:** the player faces −Z and orbitCam opens behind them on the +Z side; both stages grounded (stage 2 on `scale-floor`); no player validation warnings.
  - **Input:** mouse sensitivity is live (100px = 12.0° at Mouse 50, 24.0° at 100, no reload). Arrow look runs at 100°/s at Keyboard 50. W moves exactly along the camera forward.
  - **lvl2:** spawns grounded on `start-platform` with chaseCam directly behind. Death-barrier respawn returns to exactly (650, 12, 491.127). The `camera-orbit` trigger switches chaseCam → orbitCam with no snap, and `camera-release` switches back on the same arm.
  - **Culling and MSAA:** zero console errors, and the temporary `behindBlocker` log never fired with debug on or off. WebGL `antialias` is true in both debug modes.
  - **Engine Simulator:** `player.carl` sits on `sim-disc` and orbitCam frames it.
  - **LSM chapter 1:** the player spawns at the door facing +Z with the camera behind. Trash and hearts sit at their exact authored coordinates, and nothing is turned around. Room entry, ghost waking, vacuuming trash and ghosts, and Try Again respawn all work. The only errors are 404s for missing optional audio files.
  - **Observations, existing behaviour this pass didn't touch:** Escape never pauses in rig modes, because `handleLookInput` always consumes it; P works. Several wheel notches in one frame zoom only a single step (`Math.sign(wheelDelta)` is applied once per frame).
- [2026-10-24] MAIN: camera wheel bug found by ARGUS in the 0.35.2 run — fixed to the author's spec. The summed `deltaY` was applied as `Math.sign` once per frame, so several notches in one frame moved only one step. Each event now counts one notch, and the frame applies all of them. freeCam's top-speed wheel had the same bug and got the same fix. The author clarified that Escape is meant to pause: releasing pointer lock pauses the level, so `handleLookInput` consuming Escape is correct. node --check passes; not re-run in the browser.
