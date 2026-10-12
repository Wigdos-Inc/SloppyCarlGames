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
- [2026-10-09] MAIN: built parts 4.2 (entity distance gate) and 4.3 (frustum culling) of the culling scope, with the author's approval.
  - **Author decisions:**
    - **4.1 fog-aware draw distance: rejected by design.** The band between full fog and the draw distance keeps objects drawn (invisible in the fog) before they come into view, so nothing pops in at high speed.
    - **D2: no new flag.** Entities reuse `performance.rendering`; being off-screen is now a second way for it to be false. This is safe because only Render.js reads the flag, a frame is drawn only after at least one tick, and every tick starts by resetting the flag from distance in `UpdatePerformanceFlags`.
    - **D4: occlusion culling stays in scope.** A dense hotspot behind walls that still lags would read as a bug. GPU occlusion queries are out because their answer arrives a frame late; MAIN is explaining a same-frame CPU check to the author.
  - **Result:** draw calls per frame dropped from 565 to 296 at spawn, 536 to 315 on the hub, and 204 to 109 on the swiss platform. The player stayed drawn, and the other 17 entities were culled, matching the earlier visibility count. No console errors. Visual sign-off is the author's.
- [2026-10-09] MAIN: built part 4.4 of the culling scope, scatter cell culling, with the author's approval.
  - **What it does:** grass and other scatter are now grouped into 20 × 20 ground squares. Only squares within the scatter radius and on screen are drawn. The in-shader fade is unchanged.
  - **Verified on lvl2:** 311 squares, the same 53,091 instances in total, and no console errors. Per frame, before → after:

    | Spot | Instances | Indices | Instanced draws |
    |---|---|---|---|
    | Spawn | ~47.6k → 7,285 | ~4.3M → 0.72M | |
    | Hub | ~44.6k → 1,302 | ~4.1M → 0.20M | |
    | Swiss platform | ~46.8k → 0 | ~4.2M → 0.065M | |
    | Grass field | ~47k → 24,604 | ~4.2M → 2.2M | 12 → 288 |

  - **Size:** about 60 lines, against the 100–130 estimated.
  - **Still to check:** the visual check by eye is the author's: grass at the edge of the scatter radius, and at the screen edges when turning fast.
  - **Next:** occlusion culling is its own later pass. Where its module goes is still undecided by the author.
- [2026-10-09] MAIN: fixed the author-reported scatter bug: since the soft dissolve was added, some instances stayed semi-transparent forever, seemingly at random.
  - **Cause:** each instance gets a random value (`cullHash`, from its position) between 0 and 1. Its opacity is `(fade - cullHash) × 4`, capped at 1, and `fade` never goes above 1. Any instance whose hash is above 0.75 can therefore never reach full opacity. An instance at 0.9 tops out at 40%. That's about a quarter of all instances, spread pseudo-randomly by position.
  - **Fix:** one line. The hash is scaled by 0.75, so every instance keeps the same quarter-wide fade-in and always finishes it before `fade` reaches 1.
  - **Side effect:** inside the fade band, instances now appear slightly earlier, so the band is a bit denser.
  - **Checked:** the shader compiles and lvl2 loads with no console errors. The visual check is the author's.
- [2026-10-10] MAIN: design decision with the author. Occlusion culling moves out of 0.34.4 into its own patch, 0.34.6; orbitCam Rework, Sprite/Billboard and Movement Enhancements shift to 0.34.7–0.34.9.
  - **Why:** neither the CPU cost of the depth check nor the GPU work it would save is known.
    - This machine is never GPU-limited.
    - After frustum and scatter cell culling, lvl2 draws only ~100k regular indices per frame, so there may be little left to hide.
    - The trade-off matters for weaker hardware and upcoming mobile support.
  - **Plan: measure first.** A one-off debug count uses GPU occlusion queries to total how much drawing is fully hidden behind walls. Their answers arrive a frame late, which doesn't matter for counting. Build only if the total justifies the CPU cost.
  - **Placement (author):** new `math/Occlusion.js`.
  - **Edge rule:** depth is filled at pixel corners, and a pixel counts as walled only when all four corners hit the same object.
    - The strict per-triangle rule was rejected because it leaves empty lines along every triangle join.
    - The plain corner rule was rejected because it could close sub-pixel cracks between objects.
  - **Sequencing:** item 5 (Todo Performance Enhancements) starts only after the item 4 culling has shipped and the author has signed it off visually.
- [2026-10-12] MAIN: investigated author-reported frame drops in lvl2: an intermittent ~1 s drop, plus a near-constant "looks like 30 fps" stutter.
  - **No slow frames anywhere.**
    - The MCP test browser showed no slow frames across three 25 s move-and-turn runs (spawn, hub/runway, grass field).
    - The author's own traces showed nothing either.
  - **TEMP pacing probe:** an error-level log in the Level.js loop that fires on ≥3 catch-up frames a second. On the author's 75 Hz primary monitor at FrameRate 75 it logged:
    - 75 frames, of which 69–71 were drawn and 5–7 were catch-up frames
    - longest gap ≤14.4 ms, longest work ≤2 ms
    - recurring every ~33–34 s
  - **Cause 1 (engine):** when the fixed step rate equals the display's frame rate, the two clocks drift slowly apart. Whenever they line up, timing wobble makes frames alternate between no step (a repeated picture) and two steps (a jump), for about a second. How often that happens depends on the exact rates.
  - **Cause 2 (not engine):**
    - On the author's 60 Hz secondary monitor, Chrome times `requestAnimationFrame` to the 75 Hz primary. A ~1 s frame count gave 77 at both FrameRate 60 and 75.
    - At FrameRate 60, the engine draws 60 new pictures into 75 frames, evenly; the probe never fired there.
    - Windows then shows 60 of those 75 frames, so some new pictures are skipped and some repeats are shown. That reads as ~30 fps.
    - FrameRate 75 is smooth on that monitor.
  - **Rejected:**
    - **A warning to games when the browser rate and the monitor rate differ** (the author's idea). Not feasible: browsers expose no refresh-rate API, and `requestAnimationFrame` follows the primary monitor, so the page can't see the mismatch.
    - **Putting the fix values in `PERFORMANCE_SCALING.Loop`:** per the author, that group is for feel settings, not correctness values.
  - **Fix:**
    - The loop averages the last 4 frame times. If that average is within 1 ms of a whole number of steps, the frame counts as exactly that many steps.
    - A replay simulation counted seconds that would log, before → after:
      - 75 Hz at FrameRate 75: 11 → 0
      - 60 Hz at FrameRate 60: 21 → 5, all of them deliberate hitches
      - 75 Hz and 144 Hz at FrameRate 60: unchanged
    - lvl2 loads with no console errors. The author verifies on the 75 Hz monitor; the TEMP probe is removed after that and is not planned as permanent.
  - **Blended rendering:** drawing between the last two steps, using a stripped-down previous-state snapshot as the author proposed. The author ruled it a discussion only: no todo entry, no scoping, not deferred.
- [2026-10-12] MAIN: follow-up to the frame-step fix.
  - **Verified:** the author confirmed the ~1 s stutter on the 75 Hz monitor at FrameRate 75 is gone. The TEMP pacing probe was then removed, as planned.
  - **Author ruling:** the 4-frame average and the 1 ms window are part of how the fix works, not feel tunables, so they don't belong in config.js or `PERFORMANCE_SCALING`. They're now inline in the Level.js loop, like the scatter dissolve's inline `0.75`. `FRAME_SNAP` was removed.
