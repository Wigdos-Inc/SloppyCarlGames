# camera/ — Level Camera

## Responsibility
Runs the in-level camera. Each frame it detects the player's situation, maps it through the level's camera **set** to a **mode**, and decides how movement input executes, which it publishes as `cameraState.modeData`. After physics it aims and places the camera and writes the view vectors `Render.js` reads. The camera runs **before** movement: Movement consumes the camera's output, never the other way round.

## Files
- `Master.js` — Orchestrator. Exports `InitializeCameraState(sceneGraph, payloadMeta, target, simulating)`, `PrepareCamera(sceneGraph, deltaSeconds, target, simulating)`, `UpdateCamera(sceneGraph, deltaSeconds, target, simulating)`, `HandleCameraInput(event)` and `GetCameraPosition()`. Holds three module-level stores, all reset by `InitializeCameraState`: `loop` (the loop the player is running), `triggers` (forced mode plus the `inside`/`entered`/`fired` id sets) and `ground` (the ramp check cached per ground surface id). It also holds `frame`, the context object handed to every mode call.

  **Prepare (before movement).** In order: `readCameraTriggers` acts on newly entered `playerState.activeTriggers` of `type: "camera"` (it is the first reader of that list). `payload.mode` forces a mode and `"release"` clears the force; `activateOnce` triggers fire once. `surfaceSpeedShare` is the tangent speed over `maxSpeed`, clamped 0–1. `detectSituation` runs `trackLoop` and returns, highest priority first, `smallLoop`/`largeLoop`, then `slope`, then `fastMovement`/`slowMovement` (`speedShare >= Modes.Triggers.FastSpeedFraction`).
  - **Loops.** A loop is active when its radius is set. It counts as small when `loop.radius < LargeLoopScale × PlayerHeight` and the player is within 2 radii of `loop.center`; any other active loop counts as large.
  - **Slopes.** `slope` means grounded with `alignedUp` tilted past the medium's `MaxAngleDelta.Ground`.
  - **Small loop surfaces.** `frame.onSmallLoop` is set when the ground surface's precomputed loop radius (`sceneGraph.loopSurfaces[medium]`, a `Map` id → radius built by `builder/NewLevel.js`) is below that same threshold.
  - **Mode choice.** The set maps the situation to `setMode`. A custom set that leaves the situation unmapped keeps the running mode. The final mode is chosen in this order: debug `freeCamOverride` (`CONFIG.Debug.All && Debug.Levels.FreeCam`), then `simulating` → `orbitCam`, then a forced trigger mode, then `setMode`. A change runs `activateMode`, which calls the mode's `initialize` with `frame.from` set to the previous mode. Finally the mode's `prepare` returns `cameraState.modeData`.

  **trackLoop.** Integrates the net turn of `alignedUp` about one axis while grounded on a loop surface.
  - **Tube bends.** `AzimuthTurnVector3` strips a tube's bend first and rotates the axis with it, so only the leftover tilt counts as loop travel.
  - **Turn accounting.** Crests and curving back subtract. The radius is `arc / arcTurn`. The axis follows the last half lap, and the center settles across the loop while keeping pace along the axis.
  - **Engage.** Needs all of: `Loops.Player.EnterCurve` of turn, a near-horizontal axis, `up.y` below its value at the run's start (climbing), and travel within `EnterLean` of around the axis.
  - **Release.** Each release logs its reason:
    - lost ground past contact grace;
    - left the loop surface;
    - surface speed below `0.5 × MinGripSpeed[medium] × maxSpeed`;
    - more than `ExitLeanGrace` radii travelled without progress;
    - net turn ≤ 0.

  **Update (after physics).**
  - **Per frame.** Sets `frame.follow = min(1, 15 × Body.LagStrength × dt)` and eases `frame.aimShare` toward 0.5 while looping, otherwise toward the level's `aimHeight`.
  - **Rig modes.** The mode's `update` returns a rig frame, which `placeOnRig` places:
    - **Target.** The target point is `AimPoint`, or the follow target's position while simulating.
    - **Obstruction.** `checkCameraObstruction` (skipped while simulating) shares one `BroadphaseCollectCandidates` call across a center ray plus four rays offset by the rig's radius. It discards hits flagged `inside`, and host surface carved away by a void (`IsPointInSuppressingVoid`). A hit pulls the arm in by `Body.Radius`, but never closer than the camera radius plus the target body's extent along the arm.
    - **Arm distance.** `settleArmDistance` snaps in on obstruction and eases back out after `Walls.ReturnDelayMs`.
    - **Pivot lag.** The pivot lerps toward the center by `follow`. A `holdArm` rig lengthens the arm so the lag never shortens it below the flat-ground equivalent.
    - **View vectors.** Built from the arm. The view's up flips past the top of the arm's pitch arc, using the rig's `tangent`.
  - **freeCam** places itself.

  **Level start.** `resolveDefaultLevelCamera` gives `fov` from `CONFIG.Camera.Fov` and the planes as cnu `Unit`s: `near` 0.1, `far` the world's length + width + height. The opening view aims from `levelOpening.startPosition` at the world center. `cameraState` adds `activeSet`, `activeMode`, `situation`, `looping` and `modeData`.
- `Modes.js` — The modes, as the `CAMERA_MODES` table `{ rig, initialize, prepare, update, handleInput }` for `orbitCam`, `freeCam`, `chaseCam` and `sideCam`. Also exports `AimPoint`, `ResetCameraModes(cameraConfig, levelBase)` (level framing, distance range, pitch limits, freeCam settings, arm on the opening view) and `SetOrbitCamFraming({ distance, heightOffset })`, which the Simulator uses and which scales the zoom range with it.
  - **Shared state.** `rig` is the arm shared by the rig modes: `up`, `direction`, `pivot`, distances, `heightOffset`, `pitchLimit`. A switch between rig modes therefore carries the arm over. `takeOverRig` seeds the arm at level start, or re-anchors it when taking over from freeCam. `lookInput` holds mouse and arrow look plus the wheel; `consumeLookInput` applies zoom (`CONFIG.Camera.ZoomStep` within the level's distance range) and look.
  - **Height.** `settlePitch(scale) = asin(heightOffset × scale / distance.default)` seats the camera the level's `heightOffset` above the aim point. `pitchWindow` turns the level's `pitchLimit {top, bottom}` into a window around the settle pitch. A side above 90 is open, and both open lets the pitch wrap.
  - **Aim and flip.** `AimPoint` is the target's body center offset along `rig.up` by `PlayerHeight × (aimShare − 0.5) × modelFlip`. `modelFlip` is the shown model's up dotted with `rig.up`: 1 upright, −1 upside down, forced to 1 on ramps. The shown model's up comes from the animation `modelPose.rotation`, or from the body rotation when Animations is `"Disabled"`. Because a rolled camera shares the model's up, the flip stays near 1 wherever the camera rolls.
  - **orbitCam.** A player-controlled yaw/pitch orbit with `control: "carried"`. Inside an active loop it swings side-on (`autoYaw`, at `Modes.Orbit.SideSwingSpeed`) while the user isn't turning. Turns made during the side view accumulate in `steerOffset`, and the input basis holds the yaw captured at engage (`held: true`). In `smallLoop` it orbits `loop.center`, inside `insideLoopCone`.
  - **chaseCam / sideCam.** One code path and one runtime (`chaseRuntime`). sideCam trails 90° off the facing, on the side nearest the arm (`pickSide`). Both trail the facing with `TrailStrength`, ramped in over `FollowRampMs`, and scaled by √speedShare while moving or while returning from a loop.
    - **Look freedom.** Look yaw is free when standing and narrows to `MaxNarrowedYaw` at top speed (`chaseFreedom`); `stiffen` resists look toward the limit.
    - **Roll.** The rig rolls toward `alignedUp` when looping, and on any grounded incline past `FlatSnapDegrees` except a small loop's surface. Addons can exclude it: `noLoopRoll`, `noSlopeRoll`, `noRampRoll` (ramps only).
    - **Settle pitch.** Scaled by cos(roll) outside loops and by `modelFlip`. It updates only once look input has settled (`Look.ReturnDelayMs`).
    - **Large loops** lengthen the arm by `LargeLoopZoom`.
    - **loopCam addon.** In an active loop the camera goes upright, eases onto the nearer end of the loop axis and orbits `loop.center`. Its distance is fitted from `TightFraming × radius / sin(fov/2)`, zoomed toward `SpeedZoom` by the speed the player will have at the loop's bottom. Only the center ray is checked for obstruction.
    - **modeData.** `prepare` returns `{ control: "free", basis }`, where the basis is the camera-behind view, or a frozen behind-the-facing basis while returning from a loop. With the `loopControls` addon, in an active loop or on a slope, it returns `{ control: "loopLock", axis, view, coastGravityScale: Loops.CoastGravity, basis }` instead. The axis is the loop axis, or the slope's fall line.
  - **freeCam.** Debug flight, with its view persisted per level/stage key. Pitch is unlimited: right comes from yaw alone, so the view passes over the poles. Yaw input inverts while upside down, and Space/Shift move along the camera's up. Returns `{ control: "carried", basis, yaw, held: false }`.
- `Sets.js` — `ResolveCameraSet(cameraConfig)`. A built-in set takes its own situations, with the level's `situations` layered over them, and its own addons. `"custom"` uses the level's `situations` and `modeAddons` alone.
- `Sets.json` — Engine-authored catalogue: `modes`, `situations`, per-mode available `addons`, and built-in `sets`. `carlCamSet` maps every situation to chaseCam except `smallLoop` → sideCam, with chaseCam `["noRampRoll"]` and sideCam `["loopControls", "loopCam"]`. `core/validate.js` and `core/normalize.js` import it to check `level.camera` (the approved static-JSON exception).

## Boundaries
**Called by:**
- `handlers/game/Level.js`: `InitializeCameraState`; `PrepareCamera` → `UpdatePlayer` → physics → … → `UpdateCamera`.
- `handlers/game/Simulator.js`: `PrepareCamera`/`UpdateCamera` with `simulating = true` and its follow target, plus `SetOrbitCamFraming` from Modes.js.
- `handlers/Controls.js`: `HandleCameraInput`.
- `core/ini.js`: `GetCameraPosition`.
- `core/validate.js`/`normalize.js`: `Sets.json` only.

**Calls into:** `physics/Collision.js` (`BroadphaseCollectCandidates`, `IsPointInSuppressingVoid`); `player/Master.js` (`PlayerHeight`); `math/`; `core/` (config, meta).
**Does not:** Import `handlers/`; write player velocity or position; read the Simulator's state (the Simulator passes `simulating` in).

## Invariants
- **Movement input runs through `cameraState.modeData`.** Its `control` is `"carried"`, `"free"` or `"loopLock"`, and it's rewritten every `PrepareCamera`. The camera never reads movement output to decide this frame's control.
- **While simulating, the camera always runs plain orbitCam** with no situation detection, no triggers and no obstruction, and nothing it produces reaches Movement.
- **A camera trigger's forced mode holds until another camera trigger releases it**, whatever the situation.
- **`AimPoint` and `modelFlip` read `target.animationRuntime.modelPose`, so the player's animation runtime must exist before camera init.** `handlers/game/Level.js` builds it with `EnsureAnimationRuntime` right after `InitializePlayer`, and teleports snap the pose rather than dropping the runtime.
- **Tuning lives in `CAMERA_TUNING` (core/config.js).** Easing base rates and functional guards are module constants, scaled by the `*Strength` multipliers. Level framing — `distance {min,max,default}`, `heightOffset`, `aimHeight`, `pitchLimit`, `freeCam` — is level payload, not tuning.
