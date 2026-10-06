# carlCamSet — Camera & Controls Rework (Scope)

Temporary scoping document, started 2026-10-01. Nothing here is planned or implemented yet; the scope gets discussed first.

The rework replaces 0.34's one-camera-per-level model (`camera.mode`: orbit/chase/free) with a **carlCamSet**: a set of camera modes, each assigned to a movement situation. It rebuilds controls and camera from the ground up.

---

## 1. Target behaviours (author)

### Starting and slow movement
- Starting to move is camera-relative: forward is where you're looking.
- From a standstill, holding D moves Carl right while the camera turns with him. Held, this settles into a steady circle: Carl runs it, and the camera rotates along with him (a mutual orbit, where camera rotation feeds back into input).
- The faster you go, the less freedom the camera has. At speed there is no orbit camera any more.

### At speed
- The camera follows Carl. The player can still move it within limits, and that steers alongside A/D.
- S at speed brakes actively to a standstill, then moves Carl the other way.
- Away from a standstill, the camera also follows your inputs: W+A/D keeps you moving forward, steering relative to your direction of travel, and the camera follows.
- Moving backwards with S is unresolved. The current behaviour is acceptable. The candidate: S is fully camera-relative too, so the camera starts turning and it's up to the player to steer with it.
  - Sonic Generations is not a model here. It either blocks moving backwards, or keeps the camera on its track so you can't see where you're going.

### Small loops (loopCam)
- The camera switches to a side view that follows Carl. Controls become purely direction-based, and the camera has no influence on movement.
- After the loop, the camera returns, and it only influences movement again once that return is complete.
- Experiment: semi-locked controls.
  - Entering the loop doesn't lock anything. The first fresh input inside it locks controls until the next fresh input.
  - Holding that input drives Carl straight to where it points. There's no mutual-orbit settling in small loopable surfaces such as tunnels.
  - The lock holds the direction from the press.
  - Letting go coasts at the current speed, with physics (gravity and the like) weakened rather than full or off. Full physics would be annoying; none would feel unnatural.
  - W speeds him up to max speed. S slows him until he can't keep looping. A/D steer the loop.
  - **No lean.** Only steering changes the loop's angle. This belongs to the side camera, so it applies to small loops only.
  - When looping becomes impossible, or ends any other way, the side view ends. Regular controls return on the next fresh input.
- Large loops don't use any of this.

### Large loops
- They use the rolling camera, and the player keeps direct control. Small loops default to loopCam; bigger loops default to a zoomed-out chaseCam.
- A game can switch the camera anywhere through camera triggers (decision 17).

### Slopes and ramps
- A **ramp** is a part authored as a `ramp-simple` or `ramp-complex` primitive. It gets no camera roll unless it's loopable.
- A **slope** is a chain of incline changes not made by ramps. It rolls, but only once the incline passes the max delta angle (`MaxAngleDelta`), so small incline changes don't turn the camera.

## 2. Must avoid
- **False wall hits:** the camera treats a wall Carl is walking on as an obstruction even when the wall isn't between Carl and the camera. This happens consistently; cause not yet investigated.
- **Braking glitches:** braking (S alone, or with A/D) must not jitter while Carl is stationary or shuffle him in a turning circle.

## 3. Architecture (author)

### carlCamSet
- A level authors which camSet it uses.
- The set assigns a camera mode to each situation: `smallLoop`, `largeLoop`, `slope`, `slowMovement`, `fastMovement`.
- A level can override the mode for a situation (`camera.situations`), opt into addons (`camera.modeAddons`), or switch cameras through triggers.
- The engine supplies the standards, and the game controls the choices.

### Module group `camera/`
Camera moves out of `handlers/` into a new `camera/` group:

| Today | Becomes |
|---|---|
| `handlers/game/Camera.js` | `camera/Master.js`, the orchestrator |
| `handlers/utilities/CamModes.js` | `camera/Modes.js` |
| none | `camera/Sets.js` and `camera/Sets.json` |

## 4. Decisions

1. **0.34's control rules are discarded.** Latched bases, the speed-threshold re-latch, look-steer and the like count as context and lessons, not decisions.
2. **Slow → fast is a smooth blend.** Slow and fast aren't two different behaviours: player movement and camera movement complement each other in both. The camSet only narrows the camera's freedom as speed rises, and the camera's effect on movement isn't reduced.
3. **The camera decides how controls execute.** Camera logic runs before controls, and controls read `cameraState`. Reason: bad controls are annoying, but a bad camera causes motion sickness, which makes the game unplayable.
4. **"No lean" belongs to the side camera.** It applies only to small loops. Large loops don't activate the side view and keep direct control.
5. **Loop size classes are measured against the player's size,** not fixed world units.
6. **Small-loop semi-lock:** the direction locks at the press. Letting go coasts at the current speed under weakened physics.
7. **Two loop classes only:** small and large. `mediumLoop` is dropped as too niche.
8. **loopCam holds velocity at a fixed angle to the loop's axis.** The locked press sets the angle and only A/D changes it. This is acceptable for now; testing after implementation decides whether it stays.
9. **`cameraState` carries the active set, the active mode, and a field with the data the active mode passes downstream** (for loopCam, for example, the locked direction and the loop axis).
10. **Payload fields.**
    - `camera.activeSet` is required: a built-in set's name, or `"custom"`.
    - `camera.situations` maps situations to modes. ("Overrides" was rejected as a name, and so was `set`, which reads like a method.)
    - It replaces today's `camera.mode`.
11. **Custom sets.**
    - `activeSet: "custom"` builds the set from `camera.situations`; `"custom"` is the explicit discriminator.
    - An omitted situation uses the active or standard mode instead of a different one.
12. **The modes.**
    - There are four base modes: `orbitCam`, `freeCam`, `chaseCam` and `loopCam`. Orbit stays a single mode.
    - Built-in sets use tweaked variants of the base modes, so the author's own games can use more of the engine than a custom set can.
13. **Loop detection stays in `camera/Master.js`.** Movement gets only what it needs, through the mode-data field (decision 9).
14. **Overrides vs. custom sets.**
    - With a built-in set, `camera.situations` overrides which mode runs in a given situation.
    - With `"custom"`, it defines the whole set from a blank slate, using the available modes.
15. **Mode addons.**
    - Addons are engine behaviours that branch a mode's logic at runtime, such as a mode borrowing functions from another mode.
    - They're real behaviour differences in code; the addon keys only select the branches.
    - `Sets.json` lists the available addons as arrays. The engine's built-in sets use all of them by default.
    - A game opts into them through `camera.modeAddons`; otherwise they're unavailable.
16. **An omitted situation in a custom set keeps whatever mode is already running.** Entering that situation doesn't switch the camera.
17. **Camera triggers replace per-terrain overrides.**
    - A level trigger can switch the camera at will, which is more consistent and gives more freedom than binding cameras to terrain pieces.
    - A trigger beats everything: the set, the situations and the addons.
    - It stays in effect until another trigger disables it.
18. **`camera.modeAddons` is an object keyed per mode,** for example `{ chaseCam: ["lookSteer"] }`.
19. **A camera trigger switches to one mode.** That's where scripted-sequence modes like `staticCam` or `trackCam` will come in. Those modes are out of scope and deferred.
20. **The addon catalogue gets decided during implementation,** not up front.
    - The core vs. addon line will become clear as things are built.
    - Examples so far:
      - `lookSteer` is an opt-in addon.
      - chaseCam rolls as part of its base behaviour, so roll-related addons are likely exclusions: `noLoopRoll`, `noSlopeRoll`, `noRampRoll`. carlCamSet uses `noRampRoll`.
21. **Tuning values start at sane defaults and get tuned in testing.** These are the large-loop size ratio, the slope-roll angle, when the loop return counts as complete, and how much physics is weakened while coasting.
22. **Disabling a camera trigger** returns control to the set behaviour that was running before it.
23. **The Simulator uses only what it needs.** It's the engine's internal feature with its own control set, so camera modes must not drive its controls. It always runs plain orbitCam. *Built:* the Simulator passes `simulating = true` and its follow target into `PrepareCamera`/`UpdateCamera`, which skip triggers, situation detection and obstruction. The camera no longer imports `Simulator.js`, which removes the cycle noted in §6.
24. **loopCam is allowed only in loop and slope situations** (superseded by 26). On slopes: a side view across the fall line, with slope-locked controls (the fall line takes the loop axis's place; the lock-angle clamp applies to loops only).
25. **Looking around during the post-loop return cancels it,** and input goes live immediately.
26. **sideCam replaces loopCam as a mode.**
    - sideCam is chaseCam rotated 90°, on the side of Carl's travel nearest the current arm.
    - Without `loopControls`, its keys map as if the camera were behind Carl. This avoids the W-spins-in-circles feedback a 90° camera-relative basis would cause.
    - Two separate addons:
      - `loopControls`: the semi-lock control scheme. Active only where there's an axis (loops; slopes use the fall line).
      - `loopCam`: the loop-centred, size-fitted, upright framing, inside active loops.
    - carlCamSet's `smallLoop` uses sideCam with both addons.
    - sideCam works on flat ground, so it's allowed in every situation and as a trigger target.

## 5. Lessons

Measured findings from 0.34 live in [lessons-0.34.md](lessons-0.34.md).

## 6. Engine facts relevant to the rework

- **Triggers:**
  - `levelTrigger` has `id`, `type` (a string, falling back to `"custom"`), a `start`/`end` box, a free-form `payload` and `activateOnce`.
  - Physics writes the overlapped triggers into `playerState.activeTriggers` every frame, and no engine code reads that list yet.
  - A camera trigger would be a new `type` (the discriminator), with its target mode in `payload`. It would be the first consumer of trigger actions.
- **The Simulator, the engine's model viewer:**
  - It drives the orbit camera directly: `UpdateCameraState`, plus `SetOrbitCamFraming` to frame the model.
  - While it runs, the camera skips loop tracking and wall collision.
  - `Simulator.js` and the camera import each other (a cycle).
- **Debug FreeCam:** the override is assumed unchanged.

## 7. Open questions

None for now. Feel and tuning get settled in the author's playtest.
