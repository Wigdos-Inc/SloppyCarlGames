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
- [2026-10-03] ED ×4 (phases 1-4): carlCamSet rework built per the approved plan. Deviations MAIN accepted:
  - invalid optional situations/addons warn and drop in normalize instead of rejecting (validate owns only the required parts);
  - the frozen post-loop return basis is built from Carl's facing, because a side view must not aim input;
  - player height for loop classification uses the rest aabb × scale.y, so pose can't flip small/large mid-lap.

  MAIN deleted the old Camera.js and CamModes.js once no references remained.
- [2026-10-03] ERA (audit-only): clean on FORBIDDEN_DEFENSIVE_CHECKS and UNIT_INSTANCING. Findings: tuning literals in camera/Modes.js, camera/Master.js and player/Movement.js; prose comments; an incomplete Sets.json addons map; the misspelled `TriggerTreshold`.
- [2026-10-03] DRYAD (review-only): findings were:
  - dead modeData fields with per-frame clones;
  - a duplicated inputFrame literal;
  - a duplicated freeCam input handler (its NaN wheel fall-through turned out unreachable, since RequestPointerLock always returns true);
  - small tidy-ups and redundant camera parameters.
- [2026-10-03] MAIN: the author approved all ERA/DRYAD findings and decided three design points:
  - loopCam is allowed only in loop and slope situations;
  - the slope variant is a side view across the fall line with slope-locked controls (axis = fall line, lock clamp loops-only);
  - look input cancels the post-loop return.
- [2026-10-03] ED (fix pass): applied everything except two items:
  - hoisting `MaxAngleDelta`, which physics reads live from game-facing config;
  - seatCamera→armBasis, since seatCamera still needs `right`.

  Added an unrequested validate rule, pending author confirmation: a custom set mapping loopCam must also map fastMovement, so loopCam can't persist on flat ground. Not yet browser-tested.
- [2026-10-03] MAIN: author decisions (scope 23–26):
  - the Simulator uses only what it needs and always runs plain orbitCam;
  - loopCam's slope variant (side view across the fall line, slope-locked controls);
  - look input cancels the post-loop return;
  - loopCam replaced by sideCam (chaseCam rotated 90°) with two separately toggleable addons, `loopControls` (semi-lock where an axis exists) and `loopCam` (loop-centred framing). Without `loopControls`, sideCam keys map as if from behind Carl, avoiding the W-circles feedback of a 90° live basis.

  The author chose to playtest before ARGUS.
- [2026-10-03] ED: sideCam implemented on chaseCam's shared path, with a side offset and a side pick that's stable between look input.

  Deviations:
  - loopLock's basis is the turned-back basis;
  - the side is re-picked when loopCam framing ends, to avoid a 180° swing after U-turn tubes;
  - slopes lost loopCam's across-the-fall-line framing, because the `loopCam` addon applies to loops only, so slopes get sideCam's normal side framing. Flagged to the author.

  ED's untested risk: below 60% speed, looking past Carl's front or back can re-pick the side, flipping the free basis 180° once for held keys.
- [2026-10-03] MAIN: carlCamSet playtest notes, fixed directly after browser measurement in lvl2.
  - No sideCam in tight loops:
    - Measured: Carl's path radius in uw-tube-uturn is 5.18–5.34, and the small-loop cutoff was 4 × rest height 1.13 = 4.52, so the tubes counted as large loops (chaseCam).
    - Fix: LargeLoopRatio raised to 10 (~11.3 cnu, near 0.34's proven 12).
    - Verified: sideCam + loopLock activates at engage, and the camera looks along the tube.
  - Late slope roll:
    - Cause, from code: roll only ran in the `slope` situation, which starts past MaxAngleDelta.Ground (45° underwater, the same as EngageAngle).
    - Author chose roll from any real incline (past FlatSnapDegrees).
    - Not browser-verified on a non-ramp slope.
  - Look limit felt artificial: the author kept the hard limit and added stiffening that builds up to it. Feel is untested.
  - ramp-complex zoom-in:
    - Measured, uphill on slope-ramp-c2 with rising speed: arm 6.72 → 6.52 at 32–50° vs ~7.0 on flat; no obstruction logged.
    - Inference: the pivot's follow lag tilts off the look line on inclines.
    - Author chose to keep the arm length.
    - Verified after the fix: 6.86 at 32°, 6.98 at 50°.
- [2026-10-03] MAIN: the author asked for incline roll to lower the camera so you see where you're going. Implemented as settle pitch = Chase.Pitch × cos(current roll), outside loops only, so it eases with the roll and needs no new tunable (the author flagged tuning bloat as the next topic). Not browser-tested.
- [2026-10-03] MAIN: tuning bloat, part 1. The author ruled `Chase.Pitch` bloat: levels author the camera height, and a pitch overrode it. The old rig raised the look target by heightOffset and then lifted the camera another distance × sin15°.

  Author decisions:
  - aim at Carl;
  - incline lowering scales the height by cos(roll);
  - remove `OrbitPitch` too.

  Verified in the browser: the camera sits exactly heightOffset (1.5) above the body center at the authored distance, aimed at the body center, in lvl2 (chaseCam, d 6) and lvl1 (orbitCam, d 5). No console errors.
- [2026-10-03] MAIN: tuning-bloat review with the author. Principle: every tunable needs a human frame of reference (a unit, a named fraction, or a strength with 1 = default); bare "per second" rates and context-free values are rejected. The author's per-value rulings are captured in the changelog entry.
- [2026-10-03] ED: implemented the cleanup.

  Deviations:
  - DeepFreeze lives in config.js, because meta.js imports config.js (cycle).
  - Pitch limits are measured from the settled pitch; orbit's default range shifts to about −42..+78°. Flagged to the author.
  - Distance-range ordering is checked in normalize (warn + fallback).
  - The Simulator far plane drops 200 → 60 because MinFar was removed. Untested. Flagged.

  MAIN corrected the ReturnStrength comment ("gently" → "quickly"; it multiplies the rate).

  Boot smoke test: ENGINE frozen with CONFIG and Input writable, lvl1 and lvl2 load, input moves Carl, sideCam engages in uw-tube-uturn, no console errors.
- [2026-10-03] ERA (audit-only): no FORBIDDEN_DEFENSIVE_CHECKS / UNIT_INSTANCING / CASING violations. Findings:
  - six reasoning-style comments and a stale "ceiling clip" mention in the UpdateCamera doc;
  - uncertain: is the 45° loop-axis cutoff (Math.SQRT1_2) a feel value?
  - pre-existing Simulator framing constants;
  - Walls.ReturnDelay lacks an Ms suffix.
- [2026-10-03] DRYAD (review-only): no dead keys or leftovers. Small findings:
  - freeCam rebuilds its view vectors twice per frame;
  - `looping` duplicates `loop.active`;
  - placeOnRig parameters could come from `frame`;
  - orbit angle math is duplicated;
  - the look-delta reset is written out three times;
  - facingBasis is single-use;
  - the meta.js re-export of DeepFreeze could be dropped.
- [2026-10-03] MAIN: the author forbade DeepFreeze in config.js ("config is for configurables; meta.js is the standard functionality module") and ordered a no-exceptions re-export ban. SAGE added it as ENGINE_SEMANTICS §4 (Relationship moved to §5).
  - MAIN had accepted ED's import-cycle argument without checking it. Verified since: meta.js only reads CONFIG inside functions, so the cycle is harmless with a hoisted function declaration and in-body constants.
  - A scan found 5 re-exports in engine/v1 (DeepFreeze included); all were removed, and a rescan found 0.
  - The Simulator world was enlarged per the author: few things render there, so a big world costs nothing.
  - Browser-verified: boots through the cycle; ENGINE frozen; lvl2 loads and Carl moves; the Simulator starts in a 500³ world with far plane 1500 and the camera framing the disc at its centre; no console errors.
- [2026-10-03] MAIN: applied the author-approved ERA/DRYAD fixes: comments, ReturnDelayMs, cameraState.situation/looping (the author's direction for the duplicated loop check), placeOnRig reading from frame, facingBasis inlined. The config-tier DEFERRED entry is extended to cover module-scoped constants such as the Simulator framing factors.

  Browser-verified: in uw-tube-uturn, chaseCam → sideCam (smallLoop, loopLock) → chaseCam; lvl1 orbitCam; no console errors.

  Still open: the loop-axis 45° cutoff (explained to the author), the freeCam double vector rebuild (estimated negligible), and the orbit-angle and look-reset duplication (not covered by the cameraState direction).
- [2026-10-03] MAIN: two author decisions, both matching current code, so no change:
  - the 45° loop-axis cutoff (camera/Master.js trackLoop engage; camera/Modes.js orbit side swing) is a fixed rule, not a feel value;
  - level `camera.pitchLimit` top/bottom count from the settled camera angle.
- [2026-10-04] MAIN: level camera `aimHeight` — shipped, not browser-verified (framing feel is the author's to judge).
  - Author report: after the carlCamSet rework aimed the view at the body center, with `heightOffset` raising the camera through the arm pitch, Carl sat locked dead center on screen, which looked wrong. The pre-rework camera aimed at feet + `heightOffset`, which kept Carl below center.
  - MAIN proposed a `pitchOffset` (a view tilt in degrees). The author chose `aimHeight` as more intuitive to author: how many character heights up the camera aims. Fallback 1 (top of the model), Simulator 0.5, lvl2 1.2.
  - Author decision: the aim offset applies outside loops only. That answer came from a question about sideCam's loop framing; it is applied literally to every looping situation, largeLoop included. Inside loops the aim eases back to the body center.
- [2026-10-04] MAIN: S+A/D braking — fixed, not browser-verified.
  - Author report: S+A/D behaved like S alone.
  - Cause, from code reading: in the reverse-intent branch, above `stoppingThreshold` while `stoppingActive`, only `ApplyDeceleration` ran, so the lateral input was dropped until Carl slowed below the threshold.
  - Fix: the input's part across the travel now steers during the brake.
- [2026-10-04] MAIN: Back + turn press order — author design implemented; not browser-verified.
  - Back then Left/Right brakes with some steering.
  - Left/Right then Back slows the regular way instead of actively braking. The author defined "regular" as acceleration only: no reversal drag, so the opposing push slows Carl as a side effect, giving a wide, carving U-turn.
  - A same-frame press counts as Back first.
- [2026-10-04] MAIN: Back + turn — after playtesting both press orders, the author kept only the Left/Right+Back behaviour (acceleration only, a carving U-turn) for every Back+turn combination. Press-order tracking and steer-while-braking were removed. Not browser-verified by MAIN.
- [2026-10-04] MAIN: loop slowdown with no input — fixed for active loops; found by code reading, not reproduced or browser-verified.
  - Author report: Carl slowed down heavily with no input while moving with the side cam in a loop.
  - Cause: the semi-lock only engages on a fresh press inside the loop. Entering with nothing held (or releasing before the loop) left Carl unlocked, so ground friction (`meta.deceleration × support`) and full gravity applied.
  - Fix limited to active loops. Slopes were left alone, since dropping friction there could make an idle Carl slide downhill.
  - Releasing inside the loop was already a locked coast; any heavy slowing there comes from the 0.5 coast gravity, not friction.
- [2026-10-04] MAIN: loop speed loss and small-loop roll — measured in the browser and fixed. No console errors.
  - **Unmeasured fix reverted.**
    - MAIN's earlier fix assumed an unlikely repro: entering the loop with no input. It was not measured and it made the slowdown worse.
    - The author rejected it and directed measuring with ARGUS, so it was reverted.
  - **Fold speed cut:**
    - **How it was measured:** lvl2 cave-tunnel, chrome-devtools with temporary trace hooks (since removed). Holding W, then releasing at about 24.6 u/s.
    - **Symptom:** Carl lost about 13% of his speed in single frames at the tube's facet folds (21.34 → 18.46, i.e. ×cos30°).
    - **Where it happened:**
      - the collision overlap resolve transported velocity onto the next facet with speed kept;
      - then `ApplySurfaceCorrection`'s pin cut it. The ground probe still reported the previous facet, so the pin subtracted the lift.
    - **Result:** after the fix, the correction stage loses no speed.
  - **Air drag:**
    - Most of the remaining coast loss was air resistance. The drag coefficient is g / TerminalVelocity.Air = 10/30 ≈ 0.33/s, about 8 u/s² at 24 u/s.
    - It applies to grounded running too; holding W hides it.
    - The author chose "No drag in loop coast" over removing grounded air drag or keeping it.
    - The implementation skips all resistance during a lock coast, water drag included.
  - **Coast after both fixes:** released at 24.7 u/s, Carl coasted the tunnel for the whole 10 s window, with speed swinging between 22.3 and 24.9. Before the fixes he fell off within 0.5 s.
  - **Roll:**
    - **Before:** walking up the tunnel wall without looping was the `slope` situation, and chaseCam rolled up to 92°.
    - **Author ruling:** small loops never roll, because it induces motion sickness. Large-loop roll stays unchanged.
    - **Build radii:**

      | Surface | Radius |
      |---|---|
      | tubes | ≈5.3 |
      | cave-chamber-d/e | 5.5 (3.75 in water) |
      | cave-chamber-a/c | 12.49 |
      | large-loop threshold | 11.3 |

      Chambers a/c therefore stay large.
    - **After:** the same wall walk gave 0° roll across 97 slope frames, on walls up to 75°.
    - **Not tested:** large-loop roll was not browser-tested; its code path is unchanged.
- [2026-10-04] MAIN: loop-lock control remap (author design) — measured in the browser (lvl2 cave-tunnel); the temporary read-only hook was removed afterwards. No console errors.
  - **Author's mapping:**
    - A/D control speed, rotationally: D is counter-clockwise as seen from the camera.
    - W steers away from the camera, S toward it.
    - Braking never reverses.
  - **Measured, camera looking +x:**
    - **D:** at the bottom of the loop D pushes screen-right, which was with the travel. It held about 25 u/s for 2.6 laps with no drift along the axis.
    - **A:** against the travel. It braked 24.7 → 11.6 u/s, grip failed at 135°, and it kept braking to Idle without reversing.
    - **W:** along-axis velocity +12.7 in 0.4 s, away from the camera.
    - **S:** −12.1, toward the camera. An apparent asymmetry seen earlier came from approach drift in MAIN's measurement averaging, not from the code.
    - **Other side:** one W run with the camera on the opposite side (looking −x) still steered away from the camera.
    - **Not tested:** D from the opposite side.
  - **Incident during testing:**
    - Removing an earlier TEMP hook had folded a line break.
    - Re-adding the hook then commented out an `if`, which broke module loading ("Illegal return statement").
    - `node --check` on `.js` files misses this, because it parses them as CommonJS.
    - It was caught and fixed before handover. All changed files were rechecked as `.mjs` copies.
- [2026-10-04] MAIN: loop doesn't let go after braking to a stop at the bottom — fixed and measured in the browser. No console errors.
  - **Author's repro:** every tube; brake with the key against travel; stop at the bottom. Before sideCam's loop controls, braking in loops was camera-relative and used the free-control reversal brake (deceleration + 0.75 × acceleration ≈ 28.75 u/s² for Carl). The loop lock had replaced it with friction only (10 u/s²).
  - **Measured with the friction brake:** in uw-tube-uturn, Carl stopped grounded on the 45° facet; the loop never released and sideCam stayed. The pre-remap W/S code, temporarily restored, behaved the same, so the A/D remap was not the cause.
  - **Fix:** the lock's brake now uses the reversal brake.
  - **Results after the fix**, braking at the bottom:
    - uw-tube-uturn and uw-tube-winding: from 12.5 u/s, the loop released at 1.3 u/s while grounded on the bottom panel; Carl stopped at about 0.39 s; chaseCam.
    - cave-tunnel: from 18.8 u/s, the loop released at 4.7 u/s while grounded; Carl stopped at the bottom at 0.6 s.
  - **Process:** MAIN first wrongly reworked the post-loop input lock (reverted) and tested grip-timing theories (rejected by the author). It also reverted an unrequested stop reset and a fold-fix probe.
- [2026-10-04] MAIN: loop release floor — implemented as the author's design.
  - **Why the release failed:** on walkable panels the live grip demand eases to 0, so "speed < demand × maxSpeed" could never fire at a standstill. The reversal-brake fix only hid this: it stopped Carl before the demand had decayed.
  - **Author's design:** release whenever Carl isn't going fast enough, however he slowed down. The floor is the grip demand one degree past each medium's own Ground limit.
  - **Rejected:**
    - a floor at EnterCurve: 0 underwater, because 45° is the water Ground limit;
    - air limits for both mediums: a medium mismatch;
    - can-make-the-top thresholds: they would make loops harder to enter.
  - **Floor values** (Carl, max speed 25): about 0.11 u/s in air (36°) and 0.15 u/s in water (46°). Both are above the measured standstill residuals of 0.05 and 0.02.
  - **Verified in the browser:** only an air brake-hold stop, which released at 3.7 u/s.
  - **Not verified:** the non-brake slowdown and underwater cases. MAIN's test setup kept failing (camera alignment, launch speed, landing), so the author is to play-test.
  - **Also decided:** the reversal brake for the lock's brake key stays.
- [2026-10-04] MAIN: corrected the loop release floor.
  - The author had asked for the grip demand at the CEILING (180°). MAIN had wrongly built it at the Ground limit + 1°.
  - The floor is now MinGripSpeed × maxSpeed: 20 u/s for Carl in both media.
  - This makes the live grip demand redundant in the release check.
  - Not browser-tested. In MAIN's earlier runs the loop engaged at about 10–12 u/s, which is below this floor.
  - The author noted they can't play-test the slowdown, because nothing slows Carl in a loop coast.
- [2026-10-04] MAIN: the author found the ceiling floor (20 u/s) too strong and chose to halve it, to approximate the intended 45° value. The floor is now 10 u/s for Carl. Not browser-tested.
- [2026-10-04] MAIN: "Carl seems much faster while loop-locked" (author: underwater tubes, speed key held only) — measured, no code change.
  - **uw-tube-uturn, locked, speed key held:** velocity averaged 22.7 u/s (max 24.7); actual movement 23.3 u/s; about 0.7 laps/s at a 5.3 radius.
  - **Normal flat running underwater:** 24.65 u/s velocity, 24.1 u/s movement.
  - **Air tunnel, locked:** 24.5 u/s average (max 25.03).
  - **Conclusion:** locked speed doesn't exceed the normal top speed.
  - **Unverified explanation:** before today's fold fix, each tube facet cut about 13% of the speed, so loops ran well below top speed. They now run at it.
- [2026-10-04] MAIN: tight-loop framing now zooms out slightly with speed, at the author's request. The perceived speed in small loops is visual: locked speeds measured at or under the normal top speed. SpeedZoom starts at 1.25, a feel value for the author to tune. Not browser-tested (visual).
- [2026-10-04] MAIN: speed zoom remapped, at the author's request. Mapping the zoom over the whole 0–max speed range made low values unnoticeable, while high values meant the standard framing was never reached. The zoom now runs from the ceiling grip speed (full MinGripSpeed × maxSpeed, 20 u/s for Carl) up to max speed. The author set SpeedZoom to 5. Not browser-tested (visual).
- [2026-10-04] MAIN: the speed zoom pulsed in and out while coasting. That came from the weakened-gravity speed swing, about 22.3–24.9 u/s per lap, inside the 20–25 u/s zoom window. The zoom now holds during a coast, read from the player's `dragFree` flag (set exactly while coasting a lock), and follows speed only while a speed key is held. Not browser-tested (visual).
- [2026-10-04] MAIN: loop speed zoom.
  - **Coast hold rejected:** the author found holding the zoom while coasting worse ("random"), because players can't see what gravity is doing. Reverted.
  - **Author chose:** speed at the loop's bottom.
  - **Measured coasting in uw-tube-uturn:** raw surface speed 23.76–25.04 against bottom speed 23.62–23.93, about 4× steadier. Camera distance still ranged 31.0–34.8 (±6%), because the 20–25 u/s window with SpeedZoom 5 magnifies the residual 0.3 u/s.
  - **Air tunnel:** that run wasn't a clean coast, so no result.
  - No console errors.
- [2026-10-04] MAIN: idle camera drift on slopes and tunnels — fixed with static friction (author chose "hold still" over "camera and facing ignore the creep")
  - **Reported:** the chase cam slowly rotates while standing still on slopes or in tunnels, and starting sideways feels different on a slope than on flat ground.
  - **Measured (lvl2 cave tunnel, 15° panel, Idle):** Carl crept downhill at a steady 0.054 u/s.
  - **Cause:**
    - Idle friction zeroes surface velocity before physics.
    - Gravity then re-adds one tick of slope pull, and the normal-only surface pin leaves it in place.
    - 0.054 is above `minTangent` (0.05), so facing turned downhill.
    - `speedShare` above 0 enabled the chase follow toward behind that facing.
  - No earlier design decision on idle slope behaviour was found.
  - **After the fix:**
    - Three 15° spots held speed 0 at an unchanged position over 5 s.
    - A D-held run up the loop, then release, settled back and stopped.
    - A 45° sliding panel still slid.
    - No console errors.
  - **Not measured:** underwater slopes, the camera yaw directly, and the flat-vs-slope sideways start.
- [2026-10-05] MAIN: A/D from standstill turned the camera hard on slopes but ramped in on flat ground (author noted that moving the camera first "fixed" it) — fixed
  - **Measured (temporary hook on chaseRuntime, removed after):**
    - Idle on a 15° tunnel panel: surface speed 1.3e-17 (float residue of the tilted surface pin), and `sinceChase` climbed 1.2 → 3.3 s.
    - Idle on flat spawn: speed exactly 0, `sinceChase` stayed 0.
  - **Cause:**
    - `following` tested `speedShare > 0`, so the noise counted as moving.
    - The FollowRampMs ramp was therefore already complete before any key was pressed.
    - Look input resets `sinceChase`, which is why moving the camera first hid it.
  - **Fix:** the test is now `> EPSILON`.
  - **After the fix:** idle on the slope held `sinceChase` at 0; holding D ramped it from 0. No console errors.
- [2026-10-05] MAIN: tunnel facet switches jolted both the camera and Carl (author: it differs from 0.33.3) — fixed (author chose "remove both pops" over "match 0.33.3" and "compare on Wigdos first")
  - **Measured (temporary hook on camera frame, removed after):** at a 30° switch, compared with the body AABB center's own motion:
    - Carl's origin jumped ~0.2, because physics snaps the rotation and pivots about the contact cap.
    - The camera aim jumped ~0.41 in the opposite direction, because it was AABB center + `alignedUp` × 0.76 and the snapped up swung the offset.
    - Render aims straight at that target, unlagged.
  - **Model:** the pose eased its rotation but set its position to the jumped origin, so it popped ~0.2. That code (Animation.js, Correction pivot) is unchanged since 0.33.3.
  - **Camera:** 0.33.3 aimed at `transform.position` + world-y offset, which moved with Carl's pop, so he stayed steady on screen. This is inferred from 0.33.3 source; 0.33.3 was not run.
  - **After the fix:** five switches (S and W runs, tunnel near spawn):
    - Aim jump 0.
    - Model root moves 0.05 beyond the body, which is its first rotation step about the pivot, not a pop.
    - Body origin is still 0.23 (physics unchanged).
    - No console errors.
  - Not judged for feel.
- [2026-10-05] MAIN: author-designed camera flip for walking onto ceilings without the side cam — implemented
  - **The problem:** the camera aimed above Carl and sat above him, so on a ceiling it clipped into it.
  - **The fix:**
    - The aim offset and the chase/side height scale by the shown model's up · `rig.up`.
    - That makes it gradual with the visual rotation, and 1 wherever the camera already rolls.
    - Ramps are forced to 1.
    - The settle (height) holds while look input is active, so it doesn't fight looking. This also holds the existing roll-based lowering during look.
    - orbitCam gets the aim flip only, since its pitch is player-controlled.
  - **Lifecycle:** the camera now reads the player's animation runtime from frame one.
    - Level setup builds it early.
    - Teleport/respawn used to drop the whole runtime. Found when the first browser run crashed after `SetPosition` (no `modelPose`). Now only the pose rotation snaps.
  - **Measured (tunnel S run):** the aim offset along Carl's up went 0.74 upright → 0.46 at 45° → 0.05 at 75°. That matches 0.76 × flip × cos(tilt). No console errors.
  - **Not verified:**
    - the ceiling itself: a scripted run never got past 75°;
    - a late frame where the camera was pulled in to ~1.5 while Carl slid back down at 45° (cause not investigated);
    - the trigger pads.
  - The author confirmed camera triggers, level 1 and the Simulator work from their own testing.
- [2026-10-05] MAIN: DeepFreeze guard audit and rule update — every guard was checked against the real inputs (config tuning objects, the ENGINE API object). Only the null/non-object stop is ever reached (templates contain nulls); live objects sit under excluded keys (`Input`, `Cache`).
  - Removed: the visited set and the getter skip.
  - The JS-native exclusions (`globalThis`, typed arrays, the `instanceof` list) were removed, then restored at the author's ruling: they're JS protection, not guards.
  - **Author ruling, added to FORBIDDEN_DEFENSIVE_CHECKS:**
    - Exposure on the ENGINE API is not a boundary; game misuse throws.
    - Circular-reference guards are forbidden (§3F, §5A).
  - **Found:** the `"CONFIG"` exclusion never matched the renamed `Config` key, so the engine's CONFIG was being deep-frozen at startup.
  - **Browser boot check:** ENGINE and Blueprints are frozen; `ENGINE.Config` and `Player.Input` are writable.
  - **Pre-existing, unrelated breakage (not fixed, reported):** testGame/main.js still uses `ENGINE.Config` with the old all-caps keys (`VOLUME`, `DEBUG.SKIP`, `CAMERA`, `PERFORMANCE`). It throws "reading 'VOLUME'" at `applySettings` (main.js:220) on boot.
- [2026-10-05] MAIN: blank level on load — measured in the browser. The camera state was valid (no NaN), the render loop ran and there were no console errors.
  - **Cause:** 252 of 8856 `uniformMatrix4fv` uploads were projection matrices with NaN depth terms. camera/Master.js `resolveDefaultLevelCamera` set `near: 0.1` (a number), while Render reads `cameraState.near.value` → `undefined`. HEAD's handlers/game/Camera.js had `new Unit(0.1, "cnu")`; when the plain number came in is unknown.
  - **Fix:** restored the Unit. Verified: the level renders and there are no console errors.
- [2026-10-05] ERA ×4 (fixes authorized, comments only): engine-wide ENGINE_SEMANTICS §1 sweep at the author's request. Ran in parallel over builder/, handlers/, core/+camera/+cutscene/+Bootup.js, and math/+physics/+player/. Module headers were exempt and testGame was excluded.
  - Roughly 500 comments were deleted or rewritten across about 43 modules, for a net of −230 engine lines. No code changed, and every edited module passes node --check.
  - Removed: rationale clauses ("X is Y, so Z"), history and tuning notes, multi-line JSDoc essays, and restatements of the code. No commented-out code was found.
  - MAIN also deleted the two "Floored: zero scale stays finite." comments in handlers/Render.js (GLSL `decalSurfaceUv` and JS `DecalSurfaceUv`).
  - **Reverted in full** (see the next entry).
- [2026-10-05] MAIN: reverted the ERA ×4 comment sweep at the author's direction. Engine net change: 0.
  - **Author ruling:** the sweep was an overcorrection. Their own short declarative single-line comments are the correct style ("comments are for me, so they should cater to me"). ERA had deleted many of them as "restatements" and replaced others with cryptic intent+explanation fragments.
  - **Root cause:** MAIN's brief. It said to prefer deleting over shrinking, to treat restatements of self-evident code as violations, and that a one-liner that reads as prose still fails.
  - **Reversal:** the 497 successful ERA edits were pulled from the subagent transcripts and undone. 412 by exact inverse substitution, 74 pure deletions re-inserted at their git-diff positions, and 11 by hand. The hand fixes include a replace_all double deletion in NewObject.js and an indentation break ERA left next to a deleted comment. The two Render.js "Floored" deletions were undone too.
  - All 44 touched modules are back at their exact pre-sweep line counts and pass node --check.
- [2026-10-05] MAIN: comment-style calibration, round 1, with the author. A temporary COMMENT_REVIEW.md at the repo root held 40 real comments in 6 categories, each with a proposal, and the author ruled on every one.
  - **Applied:** the decided items in 18 modules. Comments only, −30 lines, all pass node --check.
  - **Deleted per the author:**
    - the Utilities.js tuning notes
    - the Enemy.js collectible TODO (the collectible rework is already planned)
    - the Level.js comment arguing with a reviewer
    - the NewObject.js "User-authorized freeze" audit note
    - the orphaned camera/Master.js "Rest collision height" comment
  - **ENGINE_SEMANTICS §1 rewritten at the author's request:**
    - Removed: "the restatement" as a forbidden pattern, and "a fragment beats a sentence".
    - Added:
      - comments are for the author
      - what plus a short why, in one line
      - plain words, no jargon, no over-compression
      - each comment relates to the code below it
      - a `// Note:` prefix for constraints an editor must know
      - trailing comments only on object properties
      - order-critical lines set apart from the code around them
      - file headers exempt
      - JSDoc @param lists only for complex functions
      - a Bad/Good table built from the author's own rewrites
  - **Pending:** round 2 (9 rewrites the author asked to improve), then the engine-wide scoped pass.
- [2026-10-06] MAIN: comment-style round 2. The author approved all 9 rewrites (B1, B2, B5, B6, B7, B11, D1, D4, D6), MAIN applied them, and 3 were added to the §1 Bad/Good table.
- [2026-10-06] ERA ×4 (fixes authorized, comments only): engine-wide scoped pass under the rewritten §1, in four groups: builder/; handlers/; core + camera + cutscene + Bootup; math + physics + player.
  - **Five allowed patterns:**
    - essay or JSDoc prose → one line
    - reasoning chain → what + why
    - trailing comment on a non-property line → moved above
    - cross-file line references dropped
    - reviewer-argument notes deleted
  - Anything uncertain was listed instead of edited.
  - **Result:** 39 edits, −34 lines, and all 18 touched modules pass node --check.
  - **MAIN review:** checked every before → after against the code and corrected two:
    - normalize.js `openPrimitiveShapes` → "Shapes that can't be voids, since a void must be a closed solid."
    - physics/Collision.js "Overlap hits use the push-out above" → "keep the existing push-out". The position claim was unverified.
  - **For the author:** about 60 flagged items are compiled in COMMENT_REVIEW.md round 3.
  - **Found along the way, not fixed:**
    - math/Forces.js:84 compares `config.GradientDepth === 0` against a Unit, which is always false. Line 23 uses `.value` correctly. A zero GradientDepth would divide by zero. Verified by MAIN.
    - Unverified: the NewParticles.js:276 "existence check" guard may fall under FORBIDDEN_DEFENSIVE_CHECKS.
- [2026-10-06] MAIN: comment-style round 3 is complete.
  - **Process failure:** MAIN compiled about 60 flagged items into a 277-line COMMENT_REVIEW.md for the author. The author objected that this broke the agreed plan: calibration examples set the rules, and MAIN applies them. MAIN acknowledged it and saved a feedback memory.
  - **Author rulings (J1–J20) added to §1:**
    - comments must be readable in isolation, as if you don't know the code
    - comments must be accurate for the whole block below; one claimed behaviour the code didn't have
    - comments on data say what it's for
    - math and graphics terms count as jargon
    - control tutorials are forbidden
  - **Applied:** MAIN applied the rules to every remaining item. Comments only, 26 modules, −51 lines, all pass node --check. COMMENT_REVIEW.md was deleted.
  - **Resolved:**
    - The NewParticles.js "existence check" is not a defensive check: a dead target legitimately leaves its entry undefined (Level.js `resolveGeneratorTargets`). Its comment is now "The target died or was removed."
    - The math/Forces.js GradientDepth bug was already fixed on disk (`GradientDepth.value === 0`).
    - Typos fixed: Prompte → Promote, Normlize → Normalize.
- [2026-10-06] MAIN: added ENGINE_SEMANTICS §5 "Constant Chains" at the author's request — rule written, no engine source changed.
  - Long unbroken constant chains are discouraged; most of their constants are used once or twice and clutter the code.
  - Inline when readable; otherwise break into subchains just before their use. Widely used constants go at the top, separated by a blank line.
  - Constants span lines only for arrays, objects, functions or ternaries. A multi-line ternary keeps its condition on the name's line; the next lines start on `?` and `:`.
  - At the author's suggestion, long property paths used throughout a scope are destructured at its top (e.g. `const { Look, Loops, Modes, Body } = CAMERA_TUNING;`). This doesn't apply to paths used only once or twice.
  - Relationship section moved to §6; three Summary Table rows added.
  - Examples come from camera/Modes.js `updateChase`. At the author's request, MAIN then split `fall` and `scaledDistance` into one-line constants (`floatiness`, `fitDistance`, `speedZoom`). Behavior is unchanged and node --check passes.
- [2026-10-06] MAIN: a jump didn't lift Carl off the ground — measured in the browser.
  - **Symptoms:** the jump fired (`launched` set), but vertical speed after the frame was only 0.03, and the action fell straight back.
  - **Cause:** `ComputeStepVelocity.scalar` returned its input unchanged. The cleanup had rewritten `if (disabled) { if (!logged) … } else apply` without braces, so the `else` bound to the inner `if`. Gravity, buoyancy and drag never applied in `scalar`.
  - **Effect:** `solveJumpLaunchVelocity` simulated a jump that never slowed. Its bisection settled near the smallest launch speed whose 10000-step travel reached the jump height (~0.05).
  - **Scope:** `scalar` is only called by the jump solver; `sim` has no callers.
  - **Fix:** restored the branches.
  - **Verified:** underwater spawn rises 5.5 and sinks back; on dry ground (slope-ramp-c1) the jump rises 2.4 and lands Jumping → Running → Idle; no console errors.
  - No other `if (…) if (…)` nesting exists in the engine.
- [2026-10-06] MAIN: testGame finding, not fixed. testGame/main.js reads `cfg.Debug.ALL` (line 185) and writes it (line 227), but the config key is `Debug.All`. So the debug-mode setting neither loads into the settings snapshot nor applies. The rest of main.js is migrated to `ENGINE.Config` with UpperCamel keys (the author's migration; this supersedes the 2026-10-05 note about `ENGINE.CONFIG`/`VOLUME`). Reported to the author.
- [2026-10-06] SAGE: release sweep for 0.34. The [2026-09-26] DEFERRED entry "Movement and camera design inside loops and tubes" was deleted at the author's sign-off. carlCamSet ships it: smallLoop/largeLoop situation detection in camera/Master.js, the loop handling in camera/Modes.js, and the loop lock in player/Movement.js.
- [2026-10-06] ARGUS: 0.34 patch 1, loop-detection false positives on the final climb of lvl2 `uw-tube-winding`, which two −45° z-roll nodes bend up to vertical before it exits above water. Measurement only, no code changed. `frame.loop` was read by wrapping `CAMERA_MODES[*].prepare` through a dynamic import, with no source edits.
  - **Reproduced once in 7 runs.** A fresh run started mid-bend (startUpY 0.814) and engaged at turned 50.4° (EnterCurve 45°): radius 16.0, horizontal axis (−0.42, 0, −0.91), up.y 0.07. Situation largeLoop → chaseCam. It held until "lost ground" at the exit (y≈37). Turned peaked at 54.5° and up.y never went below 0.
  - **Other runs:** two didn't engage on the climb. In three, a corkscrew lap around the tube wall had already engaged earlier (x≈490–517, turned 180–235°, radius 21–121, largeLoop) and carried through the climb to the exit. In the vertical shaft the player spiralled around the shaft wall: turned froze, because an azimuth turn counts as bend, and the loop stayed active.
  - **sideCam was never seen on the climb.** It appeared only for a genuine tube-wall lap near the entrance (smallLoop, r 5.26–5.36, matching the builder's loopSurfaces radius of ~5.30 for this tube).
  - **lvl2 has no vertical loop geometry.** Its loopSurfaces are the 3 tubes and the cave chambers; `sonic-loop-marker-sign` is only a sign.
  - **Inference, not verified:** comparing the tracked radius with the surface's built loop radius (16–121 vs 5.3) separates the false positives from tube laps.
  - No console errors. A stale MCP Chrome (PID 40176) was killed, with the author's approval, to unblock the browser.
- [2026-10-06] MAIN: 0.34 patch 1, loop-detection false positives — fixed directly by MAIN (no ED/ERA/DRYAD).
  - **Cause:** loop surfaces were judged per whole piece, so one tube was one loop surface. The bend up to vertical at the `uw-tube-winding` exit therefore engaged as a loop.
  - **Author's view:** the climb is a wall run out of the tube, so it should get slope roll like a regular slope.
  - **Author decision 1:** a tube's loop direction comes from its centerline. A per-triangle axis from fold geometry was rejected because it is approximate in tight bends.
  - **Author decision 2:** only engagement is gated. Also releasing a running loop on a mismatch was rejected, so a corkscrew lap that engaged earlier can still carry through a climb.
  - **Rule:** the loop axis must lie within 45° of the nearest centerline tangent. This reuses the existing fixed `Math.SQRT1_2` rule.
  - **Browser-verified** with a runtime hook (no source edits):
    - uw-tube-winding, 5 runs: the climb never engaged (0 active ticks) and its situation was slope. Two runs reached turned 54.5°, where it engaged before. One corkscrew lap engaged with its axis along the tube and released before the climb.
    - uw-tube-uturn: tube-wall laps still engage as smallLoop/sideCam (r 5.0–5.23, axis along the tube) in 2 of 3 runs. The third (no boost) didn't engage, but the new gate passed on every eligible tick (dot 1.00), so an existing condition blocked it.
  - No console errors. Slope roll on the climb was not visually verified; that sign-off is the author's. node --check passed on all 3 files, including as .mjs.
- [2026-10-07] MAIN: 0.34 patch 1 follow-up, a regression the author reported after the centerline gate — fixed in camera/Master.js `detectSituation`.
  - **Report:** getting out of the vertical exit of uw-tube-winding got harder at speed. The author saw worse wobble, a forced loss of all speed or forced horizontal circles (with no loop controls), and sliding at a crawl on the near-vertical wall.
  - **How it was measured:** browser runtime hook, A/B by emptying `sceneGraph.tubeCenterlines` at runtime (no source edits for the A/B).
  - **Gate on:** the climb stayed `slope` and the camera stayed upright. `frame.onSmallLoop` suppresses chaseCam slope roll, and it was true for the whole tube, since the tube's built radius is 5.3 against an 11.3 threshold. Free-control W (camera forward projected onto the wall) pointed mostly horizontal, so Carl circled the shaft and slid back into the tube.
  - **Gate off, loop engaged:** largeLoop rolled the camera, W pointed straight up the wall (≈0,1,0), and Carl exited.
  - **Gate off, not engaged:** the same failure as gate on. So the old code only exited when the climb happened to engage as a loop.
  - **Fix:** the small-loop no-roll exception is the author's 2026-10-04 ruling (motion sickness), so it stays for tube walls. `onSmallLoop` now also requires `alongTube` with the slope's tilt axis, `cross(world up, alignedUp)`. Walls tilting around the centerline still don't roll; a bend along the tube's length rolls like a regular slope, as the author asked. Non-tube small-loop surfaces are unchanged.
  - **Verified, 5 runs:** 4 exited, spending 0.7–1.1 s on the climb with speed held at 22–24.6; the camera rolled and W pointed up the wall. On the side walls `onSmallLoop` stayed true on ≥99% of ticks. The failed run reached the bend at a crawl (speed 1.7–4) and slid at its 56° base.
  - **Crawl on the 90° wall (holding S), open:** below ~8–10 u/s the contact becomes `sliding` (grounded false), and Carl slides down the wall at 2–7 u/s rather than coming off it.
    - Cause, by code reading: [`ClassifySurface`](engine/v1/physics/Correction.js#L79) judges wall vs sliding by the angle from the last walked normal. That normal follows the curve up, so the wall reads as sliding below grip speed.
    - This is the existing grip design; neither camera fix changed it. What should happen at a crawl on a vertical wall was put to the author and is undecided.
  - Circling the vertical shaft never triggers loop controls, by design: a vertical axis fails the fixed 45° engage rule.
  - No console errors. node --check passed.
- [2026-10-07] MAIN: 0.34 patch 2 (backface culling, in progress): void walls fixed in builder/NewVoid.js.
  - **Cause:** void wall linings kept the void solid's source winding, which faces outward. With `CONFIG.Performance.BackfaceCulling` on, the walls were culled from inside the cavity and showed only from outside.
  - **Fix:** `resolveCavitySign` already finds which way the source winding faces. Faces with `cavitySign < 0` reverse their lining triples.
  - **Unaffected:** collision soups (they carry explicit normals) and UV generation. Triplanar takes its normals from screen-space derivatives, so winding doesn't matter there.
  - Culling for every other pass is unchanged. Water seen from below, decal quads, debug wireframes and single-quad planes are still one-sided and haven't been checked in the browser with culling on.
  - Not browser-verified. node --check passed, also as .mjs.
- [2026-10-07] MAIN: 0.34.2 continued. The author ruled that one-sided surfaces are excluded from culling rather than given new geometry. Water and planes are now never culled, in handlers/Render.js.
  - **Water:** the body cube and top plane are seen from behind underwater, so they're excluded. Rejected: flipping the culled side while underwater. That would also change the look from above, where the body's back faces currently add to the tint.
  - **Planes:** excluded per mesh, per scatter batch and per decal draw. Crossed-pair scatter cards were the motivating case. Rejected: two-sided `buildPlane` geometry, because collision, decal-facet and UV code would all read the duplicate triangles. The author noted that planes are only 2 triangles, so excluding them costs nothing.
  - Debug wireframes, bounding boxes and trails are drawn as lines, which culling doesn't affect. The DEFERRED entry "Per-draw backface culling for closed opaque meshes" is resolved and removed.
  - Not browser-verified. node --check passed, also as .mjs.
  - Separately fixed: a ReferenceError in camera/Master.js `trackLoop`. Commit 6c7225e (0.34.1) switched to destructured `playerState` fields but missed `contactGrace`. It threw on the first airborne frame. The author confirmed the fix.
  - Still open in 0.34.2: the todo sub-item "Fix Water vs Trigger layering" (not yet discussed).
- [2026-10-07] MAIN: 0.34.2, "Fix Water vs Trigger layering" — fixed in handlers/Render.js.
  - **Report:** the author's screenshot showed the water top drawn in front of trigger overlays regardless of distance.
  - **Cause, by code reading:** the trigger overlay drew before the water with no depth write, so the water always painted over it.
  - **Rejected:** sorting triggers by center into the water-anchored translucent pass. Trigger columns run from start.y to world height, so most straddle the waterline, and the bug would just move to the underwater half.
  - **Fix:** triggers are split at the water level by a fragment clip in the main mesh shader. The half on the far side of the water draws before the water pass, the near half after it.
  - Not browser-verified; the GLSL only compiles at runtime.
  - **Open questions to the author (not deferred):**
    - With culling on, trigger volumes (cubes) are invisible from inside. Should the overlay get `cull: false` like the water?
    - `buildTriggerMesh` in builder/NewLevel.js sets `position.y = (start.y + triggerHeight) * 0.5`, which is worldHeight * 0.5. So the visual box spans start.y/2 to worldHeight − start.y/2. Code reading only; whether trigger detection uses this mesh is unchecked.
- [2026-10-07] MAIN: 0.34.2 follow-up — both open trigger questions from the previous entry are resolved by author rulings.
  - **Culling:** triggers are never culled, so the overlay shows from inside.
  - **Span:** triggers render and detect from their authored start.y up to world.height, reaching up only. Detection reads the trigger mesh's own worldAabb (physics/Collision.js), so the drawn box is the detection box. The old centre, (start.y + triggerHeight) * 0.5, worked out to worldHeight * 0.5, which offset both boxes to span start.y * 0.5 to worldHeight − start.y * 0.5.
  - **Rejected:** a full world-bottom-to-top column, because it would make start.y meaningless. Also a separate render-only box.
  - Not browser-verified.
- [2026-10-07] MAIN: 0.34.3 Toon Mode scoped with the author — scope only, no code changed, implementation not yet authorized.
  - **Shape:** a whole-scene config filter, not per-character. Rejected: per-character outlines by inverted hull.
  - **Switches:** `Filters.ToonLines` and `Filters.Comic`. Their parent path in API_CONFIG (`Rendering.Filters` vs top-level) is unconfirmed.
  - **ToonLines:** the scene draws into an off-screen color+depth target (resized in `syncCanvasSize`). A fullscreen post pass at the end of `drawScene` inks depth edges and fades them with fog. Debug overlays draw after it.
  - **Comic:** posterize and halftone in the same post pass, plus temporary cel banding (quantized N·L) that runs only when Comic is on. Normals come from screen-space derivatives of `v_viewPos` inside the shared `createFoggedTextureFragmentShader`. All five surface programs (main, triplanar, scatter, decal, scatter decal) already pass `v_viewPos`, so no vertex shader changes. Two-sided planes (scatter blades) flip the normal toward the camera. The light direction is a fixed engine tuning constant, converted to view space once per frame in `passState`.
  - **Why temporary:** the engine has no lighting and no vertex normals (vertex data is position+uv only). Smooth normals need analytic normals per curved primitive: cylinder side quads share no vertices and the sphere duplicates its seam column, so generic averaging fails. They would also have to survive void carving, entity templates and scatter, and need a normal matrix for non-uniform scale. That's 0.40-sized. The author accepted faceted bands until 0.40 Lighting & Shadows replaces them.
  - **Runtime cost:** shading itself is negligible. Shadows (an extra per-frame depth pass from the light) are the real cost and stay in 0.40.
  - **Known limit:** depth-only edges miss creases that face the camera (e.g. cube edges). Per-pixel normals would fix it, but that wasn't scoped in.
  - **Plan:** MAIN implements directly in Render.js + config.js, not ED. The Shaders.js split (0.34.4) stays separate.
- [2026-10-07] MAIN: 0.34.3 Toon Mode implemented after the author's go-ahead (no ED/ERA/DRYAD), in core/config.js and handlers/Render.js. Switches live at `CONFIG.Rendering.Filters` per the author. Both are on for testing; the intended shipping default is off.
  - **Edge method:** ink lines come from a Laplacian of inverse view depth, normalized by depth. Inverse depth changes evenly across any flat surface, so this catches creases as well as silhouettes. That supersedes the scoping entry's "depth-only edges miss creases".
  - **Debug overlays:** the filter pass copies scene depth into the canvas through `gl_FragDepth` (`depthFunc ALWAYS`), so overlays drawn afterwards stay hidden behind geometry. Without it they'd show through walls, since the canvas depth is never written while filtered.
  - **Decals:** the light-band normal is computed at the top of the fragment shader, before the decal cut's `discard`, so derivatives run in uniform control flow.
  - **Tradeoffs reported to the author:**
    - With a filter on, the scene loses the canvas's built-in antialiasing (the off-screen target is single-sampled).
    - `Lines.Threshold` depends on resolution and needs feel-tuning; set low, it may ink the facet edges on spheres.
    - Halftone dots appear on bright colors too, just smaller.
  - Not browser-verified; the GLSL only compiles at runtime. node --check passed on both modules, also as .mjs.
- [2026-10-07] MAIN: 0.34.3 Toon Mode revised after the author's first in-game screenshot. The verdict was "both are a bit much": the comic filter overpowered instead of reading as a filter, scatter shouldn't have outlines, and the water meshes should be exempt.
  - **Scatter:** lines moved out of the final pass into a mid-frame ink pass that runs after decals and before scatter and translucents. It reads a copy of the scene depth, because the scene target's own depth can't be sampled while it's attached. Scatter never reaches that copy, so it makes no lines, and blades and translucents draw over the lines behind them.
  - **Water:** water never wrote depth, so it never made lines itself. What remained was lines seen through it. The ink pass rebuilds each pixel's world height and drops lines on the far side of the water surface, the same rule the main shader uses for clipping. The water meshes span the whole level at one height, so the plane test exempts exactly the water area.
  - **Comic softened:**
    - the sky is skipped
    - posterize blends halfway to its steps
    - halftone dots only form in darker tones
    - the darkest band is lighter (0.6 → 0.75)
  - Not browser-verified. node --check passed on both modules, also as .mjs.
- [2026-10-07] MAIN: 0.34.3 — the author reported an fps drop, judged by feel at 25–30, while running at speed across the lvl2 above-water grass field (`complex-geo-ground`) toward `swiss-cheese-platform`. It seemed to happen only, or more, with the filters on, and took seconds to recover after stopping. Not reproduced; the author then couldn't find it either.
  - **Measured (chrome-devtools, 1920×950, both filters on), on that route and others:**
    - a steady 60 renders/s, the full simulation rate
    - worst frame ≤16 ms
    - GPU 1.4–1.8 ms per frame (EXT_disjoint_timer_query_webgl2); both filters together cost about +0.2 ms (1.71 vs 1.48 ms standing on the field)
    - no substep-cap warnings
    - particle count steady at 12 running or still, which rules out a particle backlog
  - **Unconfirmed hypothesis:** the choppiness was perceived, not a frame drop. Candidates are the antialiasing lost with the off-screen target, aliased ink lines, screen-fixed halftone, and 60 renders on a 75 Hz display.
  - **Outcome:** the author kept the halftone and asked for antialiasing back. The scene now draws into 4× multisampled renderbuffers and is resolved by blit into the textures the filter passes read. The ink lines stay per-pixel, so only geometry edges are multisampled. Browser-checked: no GL or console errors, edges smoothed, debug overlays still on top. Visual sign-off is the author's. node --check passed on both modules, also as .mjs.
