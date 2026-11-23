# player/ — Player Character

## Responsibility
Owns all player state, movement logic and model assembly. `Master.js` is the central orchestrator, and `Model.js` assembles the player as an entity through the shared builder. Handlers call into `Master.js` to drive per-frame updates. Physics re-poses the player through the shared `builder/NewEntity.js` model sync after physics resolution, the same as any other entity.

## Files
- `Master.js` — Player state orchestrator.
  - **Exports:** `PlayerAPI` (the `ENGINE.Level.Player` public surface), `InitializePlayer`, `UpdatePlayer`, `UpdatePlayerModel`, `ResolvePlayerState`, `SetPlayerAction`, `ConsumeJumpPress`, `KillPlayer`, `TriggerPlayerDeath`, `RespawnPlayer`, `GetPlayerState`, `GetPlayerInput` and `PlayerHeight(playerState)`. `PlayerHeight` is the rest collision height × `transform.scale.y`, read by `camera/`.

  **The player is an entity.** `createDefaultPlayerState` extends the built entity in place. It doesn't replace the entity's fields; it adds only the player's own.
  - **Collision and combat.** `physics.collision.simRadiusPadding` is widened to 24, and `combat.hitboxActive` starts `false`.
  - **`movement`** keeps the authored fields and `movement.physics` (the stage flags, from `character.physics`). It adds:
    - `jump: { startY, apexY, distance, airTime, window: { buffer, coyote } }`;
    - `braking: { input, active }`;
    - `abilities: null`, a stub.
  - **Added top-level fields:**
    - `character: { id, name, meta }`;
    - `modelTurnRate`: `air` is the base rate, and `water` is scaled by `meta.underwaterAirControl`;
    - `collectibles`, `maxCollectibles` (100) and `activeTriggers`;
    - `spawnPosition: { start, checkpoint }`. Both start at the authored world spawn point (`rootTransform.position + model.surfacePosition`).

  **Initialization and actions.**
  - `InitializePlayer(payload, sceneGraph)` builds the model against `sceneGraph.surfaces.spawn`. The built entity's `facing` comes from `rootTransform.rotation`, which is how a level sets spawn facing.
  - `UpdatePlayer(deltaSeconds, modeData)` passes the camera's `modeData` to `UpdateMovement`.
  - `SetPlayerAction(action)` is the sole write path for `playerState.action`. It logs the transition and, when opted in, fires `PLAYER_ACTION_CHANGE { id, type, position, velocity, lastAction, action }`.

  **Jump input is latched at event time.** `playerInputFlags.jump` is a getter/setter over module-level `jumpHeld`/`jumpPressed`. A false→true write sets `jumpPressed`, so a tap that starts and ends between two fixed steps still registers. `ConsumeJumpPress()` reads and clears the latch, and `Movement.js` is its sole caller.

  **`ResolvePlayerState`'s branch order is the state machine's priority.**
  - `Sliding` sits at the top, keyed on `physics.correction.surfaceContact === "sliding"`. It has no exit rule of its own: it holds for exactly as long as the probe reports a sliding contact.
  - Below it come underwater (`Floating`/`Sinking`), airborne (`Jumping`/`Falling`), then the grounded set (`Stopping`/`Running`/`Idle`).

  **Teleports snap, they do not ease.**
  - `snapOrientationUpright` resets `alignedUp` and `referenceNormal` to world up and clears `contactGrace` and `gripDemand`. It zeroes pitch and roll on `transform.rotation`, keeping yaw, and snaps `display.animationRuntime.modelPose.rotation` to that rotation.
  - `RespawnPlayer` and `PlayerAPI.SetPosition` call it.
  - `RespawnPlayer` returns to `spawnPosition.checkpoint` and reseeds `facing`. It resets `physics.launched`, `physics.slopes`, `movement.jump`, `movement.braking` and `combat`, and replaces `inputFrame` with a fresh `NewInputFrame()`.
  - `KillPlayer` and `SetPosition` end a running jump first (`EndJump`).
- `Movement.js` — Per-frame movement handler. Exports `UpdateMovement` and `EndJump`.
  - It translates input flags into velocity changes and never writes position.
  - `UpdateMovement` works in a **surface-relative frame**. Velocity is split against `physics.correction.alignedUp` into a normal component and a tangent remainder `tVel`. Acceleration, deceleration and clamping all run on `tVel`, and the normal component is kept as is.

  **The camera picks the control.** `UpdateMovement(playerState, input, modeData, deltaSeconds)` branches on `modeData.control`, which `camera/` writes every frame (see camera.md):
  - **`"carried"`** (orbitCam, freeCam). Input runs along a heading carried between surfaces in `inputFrame`.
    - `advanceCarriedForward` transports `carriedForward` from `lastUp` to the current up, applies the camera yaw delta and re-projects onto the surface.
    - It reseeds from the camera on a press, a grounding change, when upright, on a half-turn flip of up, on a pending remap, or when the heading collapses.
    - After a `loopLock`, held keys keep their meaning until they change (`remapPending`).
  - **`"free"`** (chaseCam/sideCam). Live camera-relative input.
  - **`"loopLock"`** (sideCam's `loopControls` addon). Travel is locked at a held angle to `modeData.axis`.
    - A/D is speed: it accelerates with the travel and brakes against it without reversing.
    - W/S steers.
    - Velocity is re-projected onto the lock's direction every frame.

  **Slope hooks.** Every step Movement writes all of `physics.slopes`:
  - `isInLoop`, and `isCoasting` (in a loop, locked, no A/D).
  - `gravityScale`:
    - `modeData.coastGravityScale` while coasting.
    - 1 when grounded.
    - Otherwise ramped toward `MOVEMENT_TUNING.ReleaseGravity` over `ReleaseRampMs` while a launched jump rises with jump released, and stepped back toward 1 after.
  - `staticFriction`: the idle friction with no input, no lock and a walkable contact, which physics uses to hold the player still on slopes. 0 otherwise.

  **Support and braking.**
  - **Support.** `support = max(|up.y|, MOVEMENT_TUNING.MinSupport)` scales friction, so friction falls off with steepness while a wall still brakes.
  - **Reversal braking.** A reversal brakes at `(deceleration + acceleration × ReversalBrakeScale) × support`.
  - **Braking state.** `oppositeHeld` counts braking input when the input pushes against travel on its main axis past `MOVEMENT_TUNING.OppositeInput`. It writes `movement.braking.input`, and `braking.active` latches the stop. Back held with Left/Right is a carve: no reversal brake and no stop latch.
  - **Sliding contacts.** Uphill input on a sliding contact is scaled by `SlideUphillScale`.

  **Jump.** Jumps go through two timed windows on `movement.jump.window`, both floored at 0.
  - **Windows.** A consumed press arms `buffer` for `GROUNDING.JumpBufferMs`. Leaving the ground (`inputFrame.wasGrounded && !grounded`) outside `noCoyoteActions` arms `coyote` for `GROUNDING.CoyoteMs`.
  - **Launch speed.** `solveJumpSpeed` bisects a simulated jump for the speed that reaches `jumpHeight` in the medium. It's cached per height, medium and floatiness, and halved on a slide.
  - **Takeoff.** The jump launches along the surface normal and sets `physics.launched`. It records `jump.startY`/`apexY`, stores the takeoff position in `jump.distance` and starts `airTime`, then sends `PLAYER_JUMP_START { id, type, position, velocity, startY }`.
  - **In the air.** Each airborne frame adds to `airTime` and tracks `apexY`.
  - **Ending.** A running jump ends on any surface contact. `EndJump(playerState)` turns `distance` into the absolute per-axis takeoff-to-landing difference and sends `PLAYER_JUMP_END { id, type, position, velocity, startY, apexY, endY, distance, airTime }`.
  - **Gating.** Both events are gated by `customEvents.jump` and `CONFIG.CustomEvents.Entities.Jump`.

  **Facing.** `turnFacingToward` rate-limits `facing` toward the surface-tangential velocity direction at `character.meta.momentumTurnRate`. Nothing here writes `transform.rotation`: `facing` is the heading, and `physics/Correction.js` solves the rotation from it.
- `Model.js` — Player entity assembler. Exports `BuildPlayerModel`.
  - **Definition.** `synthesizeDefinition` builds a standard entity definition from a `characters.json` entry plus the level's placement data:
    - `id: "player"`, `type: "player"`, `blueprintId: character.id`, `meta: { hp: 3 }`, `attacks: []`;
    - `movement` with zero speed and `physics` from `character.physics`;
    - the `rootTransform`, `spawnSurfaceId`, animations and custom events.
  - **Building.** `BuildPlayerModel(character, playerData, surfaceMap)` calls `BuildEntity` with `null` texture inputs. Part geometry is cached per character through NewEntity's `partGeometry` (`InitializePlayer` gives the character the id `player.<character>`).
  - **Spawn surface.** The surface map is the level's spawn surfaces merged with the module's zero-origin `player-origin` surface, so a `null` `spawnSurfaceId` makes `rootTransform.position` absolute.
  - **Re-posing.** `Master.js` `UpdatePlayerModel` calls `UpdateEntityModel` directly.
  - **Decals.** Image decals of `player/characters.json` load at boot in `builder/templates/Instance.js`. `Model.js` loads and instances nothing itself.
- `Abilities.js` — Comment-only stub.
- `Animation.js` — Empty file.
- `characters.json` — Character presets, one per playable character (`chara`, `chara_prop`, `carl`, `jeff`).
  - Each entry supplies `model.parts` (the standard entity part shape, including `tube` parts), a `collisionOverride`, `physics` stage flags and `meta`.
  - It is engine-authored, pre-compliant data that bypasses `core/normalize.js`. Raw values are Unit-instanced once at boot by `builder/templates/Instance.js`.
  - `handlers/game/Simulator.js` caches every entry as `player.<id>` for preview.

## Boundaries
**Called by:**
- `handlers/game/Level.js` (`InitializePlayer`, `UpdatePlayer`, `ResolvePlayerState`, `GetPlayerState`).
- `physics/Master.js` (`TriggerPlayerDeath` only; model sync goes through NewEntity).
- `camera/` (`PlayerHeight`).
- `handlers/game/Simulator.js` (`BuildPlayerModel`).

**Calls into:** `builder/NewEntity.js` (`BuildEntity`, `NewInputFrame`, `UpdateEntityModel`); `math/` (Utilities, Vector3, Forces); `core/` (meta, config).

**Does not:** manage its own update loop, drive rendering, apply physics forces, or build its own geometry or collision math.

## Invariants
- There is one player state object in the engine at a time, held in `Master.js`.
- `playerInputFlags` is written by game code through `ENGINE.Level.Player.Input` and read by the player update each frame. `jump` is the exception to plain reads: a press is consumed once through `ConsumeJumpPress`.
- `characters.json` values are instanced once at boot. No downstream code re-instances them.
- The player carries no bespoke collision system. `physics.collision` is the same builder-computed structure every entity has.
- `playerState.action` is written only through `SetPlayerAction`.
- `Movement.js` owns `facing` and `inputFrame`. `physics/Correction.js` reads `facing` and writes `transform.rotation`.
- Movement is computed in the plane of `alignedUp`, not world XZ.
- Movement never decides its own control scheme or reads the camera module. `modeData` arrives as an argument.
- Movement writes `physics.slopes` every step. Physics reads it and never imports camera or player state beyond the entity.
