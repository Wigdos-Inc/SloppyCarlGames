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
- [2026-10-12] MAIN: moved the builders' repeated vertex, triangle and bounds math into math/. The author approved it after a SAGE audit and also asked for a flat-array vertex reader. No agents were invoked, since this was a migration.
  - **Outcome:** across 11 files there is now one definition each of the triangle normal, triangle area, triangle centroid, the AABB-to-sphere/capsule/obb collider builders, `TransformPointByMatrix` and the vertex read. Net −100 source lines. Moving `TransformPointByMatrix` also removes the NewObject ↔ NewPrimitive import cycle.
  - **Degenerate triangles:** the old normal copies handled them three ways: NaN (NewVoid `windingNormal`), Up (NewVoid face build and Simulator), and zero (`ResolveVector3Axis` sites). All now return zero below |cross| 1e-6, and Simulator keeps its Up fallback for glTF. In NewVoid the only triangles affected have area ≤ 5e-7, which is under `minimumOpenFaceArea` (1e-6), so they were already culled. The removed private Collision `triangleNormal` used a looser threshold but had no callers.
  - **Spheres:** `SphereFromAabb` takes `inscribed`, because entities deliberately use a sphere that fits inside the box while objects and obstacles use one that reaches its corners.
  - **Verified:** `node --check` and a module-mode `.mjs` check pass on all 11 files, and VS Code diagnostics are clean. No browser run yet.
  - **Found, not fixed, left for the author:**
    - The staged rewrite of `CreateDetailedBoundsFromParts` in NewObstacle.js reads `part.type`/`part.triangles` on meshes. `type` is `"mesh3d"`, so multi-part triangle-soup obstacles get an empty soup.
    - In the same function, `case "sphere"` returns a capsule. This pass kept that behaviour.
    - `uvs.forEach(uv => uv *= uvScale)` in NewObject's `buildEntityPartGeometryTemplate` does nothing (already in HEAD), so frequency-pattern entity parts never get UV density scaling.
- [2026-10-12] MAIN: follow-up to the builder math move. The three bugs logged above as "found, not fixed" are all resolved.
  - The author had already fixed two in the working tree: `CreateDetailedBoundsFromParts` now reads `part.detailedBounds.type`/`.triangles`, and NewObject's UV density loop now scales by index.
  - MAIN fixed the third with the author's approval: a sphere obstacle's envelope is now `SphereFromAabb(bounds, false)` instead of a capsule. One line; `node --check` is clean.
- [2026-10-12] MAIN: second pass of the math/ consolidation. The author approved it after a SAGE survey and chose `.clone().set(...)` for callers that need a `UnitVector3` from the plain helpers.
  - **Added:** `AabbCenter` and `AabbHalfExtents`, replacing about ten hand-written copies across math/, physics/, camera/ and builder/.
  - **No-op physics wrappers removed:**
    - `buildEntityAabbAtPosition` computed `position + (center − position) ± half`, which is just a copy of the entity's own aabb.
    - The `position` argument to `checkSweptAabbPair` cancelled out the same way.
    - Removing both changes nothing beyond float rounding.
  - **Left alone on purpose:**
    - The full-size `max − min` sites (physics/Forces.js, NewEntity `resolvePhysicsShape`, Simulator framing, `CapsuleFromAabb`'s `dim`), because they want the full size, not the half-size.
    - The inline triangle reject in the ground probe's `trySoup`, because it is a hot loop that allocates nothing.
  - **Verified:** `node --check` and the module-mode `.mjs` check pass on all 8 files. No browser run.
- [2026-10-13] MAIN: added an optional `multiplied` flag to `ArrayToVector3` and replaced the engine's hand-written xyz triple reads with it, at the author's request.
  - **Shape:** without the flag it reads three consecutive values from a raw offset, which covers matrix columns and index triples. Every existing vertex-index caller now passes `true`.
  - **Bug found on the way:** `buildVoidMesh` in NewVoid.js pushed `Vector3ToArray(...)` into `newPositions` without a spread, in both branches. That nests arrays, so the `Float32Array` gets `NaN`. Now spread.
  - **Left alone on purpose:** index-lookup composites (`vertices[indices[i]]` in NewVoid `buildWorldTriangles`, NewObject `computeTriangleSoupFromMesh`, Render `SelectDecalFacets`), NewVoid's per-axis `blendAxis` calls, Render's 9-value instance `rows` hypot, NewObject `computeBounds`' `UnitVector3` constructor, and write-side triples (Render.js:214, Simulator `pushVertex`).
  - **Verified:** `node --check` passes on all 7 files. No browser run.
- [2026-10-13] SAGE/MAIN: the author asked whether the inside-box contacts could share a "smallest wins" helper, and for a general `BestMatchOf`. Planned in plan mode and implemented directly, with no agents.
  - **Inside-box contacts:** six candidates collapse to one per axis. The shallower face is the one the point is nearer to, so `gap = half − |local|`, with the normal along `sign(local)`. `+ radius` is the same for every face and is added after the pick. Tie-breaking matches the old strict scan.
  - **AABB vs AABB:** `pushNegative − pushPositive = 2 × (centerA − centerB)`, so the center comparison reduces to comparing push distances.
  - **First `BestMatchOf` draft rejected** by the author: a `reduce` one-liner with abstract names couldn't be read without working through it in your head. The final version is an explicit loop, a yes/no `isBetter`, and a named test at every call site. The author also added the ENGINE_SEMANTICS §5.2 rule (multi-line declared functions use `function`; declarations only).
  - **Not converted:** loops that stop early (the SAT and slab loops), nested loops (`TriangleDistanceSq`, camera `alongTube`) and the `RayCapsuleIntersect` roots loop, which needs `rootIndex`.
  - **Bugs found in the uncommitted math/Collision.js edits:**
    - `projectObbRadiusOntoAxis` returned NaN. It came from the 10-13 `ArrayToVector3` conversion; `ArrayToVector3(obb.axes, 0)` makes a vector of vectors.
    - `ClosestPointOnTriangle` dropped `ac`, and an undeclared `w` threw in strict mode.
    - `TriangleAabb` read `triangle.x`.
    - The reversed `AabbOverlap` `strict` flag had already been corrected in the working tree before the pass.
  - **Fixed on request:** `createObbLineVertices` in Render.js multiplied a vector of axis vectors, so the OBB debug wireframe got NaN corners. HEAD had the same problem, so it predates the conversion. The author's direction: easy bugs get fixed whether or not they are in scope.
  - **Follow-up, `-0` normals:** the first version negated axes with `ScaleVector3(axis, -1)`, which gave the AABB contact paths `-0` components they never had before. Box ground normals reach `atan2` through `surfaceNormal`/`alignedUp` (`carryAcross` → `AzimuthTurnVector3`, Correction → `EulerFromBasis`). In every traced case the result was identical or 2π off, but not every reader of the resulting Euler angles was traced. The fix uses explicit face-normal pairs (`worldBoxFaces`, `obbFaces`), so each path returns exactly the normals it returned before this pass.
  - **Author feedback:** "`test` turns each item into a result" was meaningless on its own. It became `matchFor`, which was still unclear, and then `getCandidate`, with a JSDoc example call (deepest sphere-vs-soup contact). The author also renamed `startingMatch` to `currentBest`. Lesson: for a generic helper, an example call explains it better than an abstract one-line description.
  - **`BestMatchOf` reverted:** even with the JSDoc example, the author couldn't make the helper click, and decided a helper they can't read isn't worth keeping. The author removed it from Utilities.js. MAIN restored every call site to its pre-pass loop: `closestPointsSegmentTriangle`, the soup and void-wall contacts, the capsule-sample contacts, the `aabbTriangleSetContact` facing triangle, the ray soup/compound searches, `RayCapsuleIntersect` and `iterateCompoundSpheres`. The choosers went back to their winner-returning form; `ChooseDeepestContact` stays exported so physics/ shares it. The bug fixes, inside-box merge, `AabbAabbContact` move, face normals and Render.js fix all stay.
  - **Verified:** `node --check` and the `.mjs` module check pass on all 4 files. No browser run.
- [2026-10-13] MAIN: the author rewrote `BestMatchOf` themselves: an item-comparing condition, a `null` stop and a caller-passed `storage` object. They asked where it helps, and for a dedicated helper for the soup contacts.
  - **Fit analysis:** it suits loops where the items themselves are compared: the `aabbTriangleSetContact` facing triangle and the NewEntity axis pick. Both are applied.
  - **Not applied:**
    - The collision loops compare a value computed from each item (a contact or hit). Using it there means building `.filter().map()` arrays every frame, or putting all the logic in the handler and storage, which is longer than the loop.
    - `break label` can't stop the loop early from inside a handler, because labels only work within one function body. A returned stop value is the only way.
    - `closestPointsSegmentTriangle` was skipped: the saving is about 4 lines, but the distance math would run twice in a per-triangle hot function.
  - **Soup contacts:** `deepestContactInBox` holds the loop the four soup and void-wall contacts shared.
  - **Level-start crash** (author-reported, `cullRadius` of undefined at Render.js:1575): a typo, `scatterDecalShader.uniform` instead of `.uniforms`. Every uniform the pass sets exists in the ScatterDecalProgram, and every batch field it reads is built in `buildScatterInstanceBuffers`.
  - **Verified:** `node --check` and the `.mjs` module check pass on all 4 files. No browser run.
- [2026-10-13] MAIN: fixed terrain with void carvings disappearing visually (author-reported).
  - **Cause:** the uncommitted `posSliced`/`uvsSliced` refactor of `carveHostGeometry` moved `groupStart` after the per-group loop, so `indexCount` was always 0 and every `faceTextureGroup` was dropped. Render.js draws grouped meshes per group only, so carved hosts drew nothing.
  - **Same refactor, also fixed:** blended carve vertices all resolved to one index (`positions.length / 3` read the unsliced array), and the Void carve log's "after" stats read pre-carve arrays.
  - **Checked, unchanged:** the `windingNormal` → `TriangleNormal` swap is equivalent (both a normalized cross product).
  - **Verified:** `node --check` passes. No browser run yet.
- [2026-10-13] MAIN: fixed the author-reported underwater U-turn loop bug, measured in the browser (no subagents). Coasting an engaged loop, Carl's velocity sometimes reversed at the top. Speed then dropped hard, the camera zoomed in and out, and he lost grounding.
  - **Repro (author's):** in the tunnel, camera almost side-on, wait to land, hold only D, then let go.
  - **Cause:** on the top facet the surface up is (0,-1,0). `AzimuthTurnVector3` took `atan2` of its float-noise x/z and returned an exact 90° turn. Camera `trackLoop` applied that turn to `loop.axis`.
    - Movement's `loopLock` resets velocity along `lockedDirection`, which is built from that axis, every frame. So velocity swung 90° for about 4 frames.
    - When the axis came back, the way around was re-picked from the turned velocity, which reversed travel. That released the loop (sidecam → chasecam, arm 10.6 → 1.2) and speed and grip fell.
  - **Fix:** `AzimuthTurnVector3` returns no turn when either vector is vertical. The other caller, Movement's `carryAcross`, already skipped the turn in that case, so its output is unchanged.
  - **Verified:** the author's repro, 5 runs, 39 passes over the top: no velocity reversals, coast speed at or above 23.6, no grounding loss, no loop release. Before the fix it reversed within about 13 tops.
  - **Lessons:**
    - The first repro attempts injected velocity and took `loopLock` control as proof of a loop. `loopLock` also turns on in the plain "slope" situation; only the "loop engaged" log proves a loop.
    - Steering out of a loop is intended design, not a bug.
    - Shift boost does nothing and played no part.
- [2026-10-13] ARGUS (run inline by MAIN), then MAIN: author-reported loop-exit control bug, **reproduced** with the author's own inputs on unmodified code. Releasing a loop with S should keep Carl moving backwards. Instead he stops, moves forward briefly, then goes backwards. The camera mode isn't the problem: chaseCam's backpedal and swing are intended (author), but movement fights the input.
  - **Author's inputs:** always lvl2 `uw-tube-uturn`. In a stable loop, press the brake key (A/D against travel) and S together. S stays held the whole time, and Carl stays grounded.
  - **Matching run:** a stable D-locked loop, then A+S together. A is released 700 ms later; S stays held.
    - **Stop:** the loop releases at the bottom with A+S still held, and control goes to chaseCam `"free"`. The carried lock plus the held A brakes Carl to ~0.8.
    - **Forward stint:** releasing A is a key change, which clears the lock. S then maps to `prepareChase`'s frozen `leftLoop` basis, "behind the facing" (the basis forward is the facing at exit), while the camera is still side-on. In the loop, S had leaned the travel toward the side camera, so the facing carries that lean. S = −facing therefore drives Carl away from the camera (fwd up to +11).
    - **Backwards:** when the return ends (~60 frames later, basis forward == live camera forward), S maps to the live chase camera and Carl goes backwards.
  - **Other variants:**
    - A released 400 ms in, while still in the loop: the lock carries out with S alone, which only applies friction. Carl stops and stays stopped.
    - A+S held throughout: the same permanent stop.
    - D held with S added: no stop; the lock throttles along the carried heading.
  - **Earlier error:** the first attempt released D and held S. That showed only the stop, and MAIN filled in the rest with an invented S re-press. MAIN then shipped a one-condition Movement.js change: drop a carried lock outside a loop when no A/D is held. The author: "nothing changed, it did nothing related to the bug". Reverted by edit.
  - **Rationale:** none is documented for freezing the exit basis to the facing.
  - **Fix (MAIN, author-directed):** the author ruled that leaving a loop must never invert S; it stays "toward the camera", and chaseCam's 180° return swing is intended. Any basis frozen at release would still invert S on screen as the camera swings, so the frozen exit basis was removed. `prepareChase` now always uses the live `armBasis`, and `returning` still drives the swing.
    - **Verified (author's inputs):** after A releases, S drives toward the camera right away (speed 4.4 → 10.7, fwd peaks at −6.9). No stop and no forward stint (max +1.8 during the normal backpedal chase, versus +11 before). Carl later loses ground backing up the tube wall at low speed, the same as before the fix.
  - **Follow-up fix (MAIN):** the author confirmed the double invert was fixed, but Carl still always came to a standstill after the loop disengaged. Cause: the lock carried out of the loop, applying only friction with S alone and braking with A held. Fix: outside a loop, a carried lock now persists only while A/D is throttling it. Verified from a stable D-locked loop:
    - **A released at 700 ms:** no stall, S toward the camera from the exit (fwd −6 to −8), max forward +1.4.
    - **A released at 400 ms:** toward the camera at 13–15. Carl later backs up the tube wall and loses ground, as before.
    - **A+S held:** grounded, continuous backwards-left, never forward.
  - **Second follow-up (MAIN):** the author reported that the camera now "super aggressively zooms in" after an S exit and throws Carl into the wall; it used to be slower and interruptible. W exits work perfectly.
    - **Cause (measured):** the return swings to behind the *live* facing and ends at a 5° gap. With S always toward the camera, the facing keeps turning toward it, so the return never ended (gap 80–150° for ~290 frames).
    - **Effect:** while returning, follow strength is 1 at any speed. The camera spun 3–9°/frame at 2–4 u/s (~2.5× the normal sqrt(speedShare) follow), and the arm kept snapping in against the tube wall (6 → 1.7). Before the frozen-basis removal, the return ended ~80 frames after exit.
    - **Fix:** the return trails `exitFacing`, the facing cloned at the exit. Controls still use the live `armBasis`.
    - **Verified, S exit:** the return ends 100 frames after exit, at ≤2.4°/frame. Carl, backpedalling at 15 u/s, then ran up the tube wall into a new small loop (normal engagement). The arm still shortens to ~1.8 from obstruction while Carl backs toward the camera; whether that also happened before this session was not measured.
    - **Verified, W exit:** the return ends 70 frames after exit at under 1°/frame. Side effect: steering with A during the return, the camera holds behind the exit facing; it lagged at most 16° and caught up once the return ended.
  - **Raised to the author, not changed:** with D held and S added, the lock still carries, as designed for D. Carl runs at 24 along the carried heading, which is away from the camera once chaseCam swings behind, and S is ignored while D throttles.
- [2026-10-14] MAIN: 0.34.5 frame pacing. Blended rendering was dropped, and FrameRate is now fitted to a fraction of the refresh rate. Implemented in config.js and Level.js.
  - **Why blending was dropped:** on a fixed-refresh screen, a FrameRate that doesn't divide the refresh rate can't hold every picture for the same number of refreshes. That is arithmetic, and the same limit shows up in TV 3:2 pulldown, in consoles' 40fps modes needing 120Hz, and in Unity's WebGL guidance to let the browser choose the rate.
  - **Rejected by the author:**
    - drawing every refresh with blending, because it works the hardware above FrameRate;
    - capped drawing with blending, because it keeps uneven holds at most FrameRates.
  - **Author's decisions:**
    - FrameRate is coerced to the closest even fraction of the measured refresh rate, using regular rounding;
    - a single getter/setter on `CONFIG.Performance.FrameRate`, with the handler in config.js;
    - `RefreshRate` sits next to FrameRate and both logs and returns.
  - **Implementation:** the refresh rate is the median of 60 rAF gaps at load, rounded to whole Hz. The 0.34.4 frame snap also snaps to `step / N`, so 37.5 on 75Hz steps exactly every 2nd frame.
  - **Finding in the 0.34.4 snap:** its 1ms tolerance also caught near-but-unequal rates. FrameRate 57 on 60Hz counted every 16.67ms frame as one 17.54ms step, running the game about 5% fast. Coercion makes this unreachable.
  - **Behaviour change:** the default FrameRate 60 coerces to 75 on a 75Hz browser.
  - **Known gaps:**
    - the rate is measured once at load, so a window moved to a monitor with a different rate isn't re-measured where the browser follows the window;
    - testGame's slider still offers free values from 30 to 144, which get coerced with a warning.
  - **Verification:** `node --check` passes on both files. The browser check was not run because LiveServer was down.
- [2026-10-14] MAIN: FrameRate handler rework at the author's direction. Moved into a config.js `HANDLERS` section, using `Object.defineProperty`. Superseded today's earlier helper-function version, which the author called overengineered and beyond the scope I had given.
  - **Author's decisions:**
    - fitting and the warning happen in the setter, not the getter;
    - the handler stays in config.js;
    - the rounding rule: between two adjacent refresh fractions, the lower two thirds round down. The minimum is the lowest fraction at or above 30, since 30 is the playability floor. On a 60Hz screen that gives 40→30, 49→30 and 52→60.
  - **Rule added** to ENGINE_SEMANTICS §5.2 as the author stated it: braces holding more than one statement span lines.
  - **Verified in the browser:** RefreshRate measured 75, and the default 60 read back as 37.5.
  - **Open:** the author asked whether `if (refreshRate === null) return;` is defensive. I answered that it covers the real pre-measurement window and offered to install the accessor after measurement instead. No answer yet, so no change.
- [2026-10-14] MAIN: Bug fix. Fast bodies passed through triangle-soup colliders and got stuck inside. The author reported it on the halfpipe back wall and on ramps at lower FrameRates.
  - **Root cause, confirmed:**
    - The only swept test is against a candidate's whole AABB, and narrowphase checks only the end position.
    - When one step carries the capsule middle past a soup face, `capsuleTriangleContact` orients the push by the side the segment midpoint is on, so it pushes inward.
    - Soups are hollow shells, so every inner face then keeps the body inside.
  - **Repro:**
    - Player behind the halfpipe deck (back face z=445), moving at 25 u/s toward -z, from 12 phase-offset starts.
    - 0/12 passed through at FrameRate 75; 2/12 at 37.5.
    - In the pass-through step the player moved 1.03 units where speed explains 0.59, so collision pushed the extra 0.44 inward.
  - **Why the gate isn't `swept.hit`:** `SweptAABB` reports no hit when the body starts inside the object's AABB, which is the ramp case.
  - **Verified at 37.5:**
    - halfpipe wall: 0/36 pass-throughs at 25, 40 and 60 u/s;
    - fast drops (30 u/s) onto the deck top land at y 48.13 and are grounded;
    - fast drops onto slope-ramp-a1 land grounded on the slope (normal y 0.97);
    - runs into both ends of the ramp don't end inside;
    - no console errors.
  - **Not measured:** runtime cost.
  - **Over estimate:** about 25 lines of logic plus imports and exports, against my 15–20 line estimate.
