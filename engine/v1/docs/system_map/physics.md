# physics/ — Physics Pipeline

## Responsibility
Computes and applies physics for moving entities each frame: gravity, buoyancy, fluid resistance, water currents, collision detection, and surface correction. The pipeline is externally driven — handlers pass entity state in and the pipeline mutates it in place. physics/ does not manage its own update loop.

## Files
- `Master.js` — Physics pipeline orchestrator. `ApplyPhysicsPipeline` is the external entry point called per physics-active entity per frame. Coordinates detection, force application, correction, and model sync internally. Also exports model-sync helpers used by `handlers/game/Level.js` for player and entity rebuild.
- `Collision.js` — Broadphase and narrowphase collision detection against scene geometry. Trigger overlap detection. Scene spatial queries. Exports `GetSimDistanceValue` for LOD/simulation distance thresholds.
- `Correction.js` — Post-collision position and orientation adjustment: surface alignment (`ApplySurfaceCorrection`), ground snapping (`ApplyGroundSnap`), slope angle correction, player surface orientation (`ApplyPlayerSurfaceOrientation`).
- `Forces.js` — Engine-shaped force assembly. Reads entity state and `CONFIG` to produce gravity, buoyancy, resistance, and submergence force vectors. Delegates pure math to `math/Forces.js`.
- `Current.js` — Movement velocity adjustments for entities inside underwater current volumes.

## Boundaries
**Called by:** `handlers/game/Level.js` — calls `ApplyPhysicsPipeline` directly from `Master.js` each frame. No intermediary Physics handler file exists in the current source.  
**Calls into:** `math/` (Vector3, Utilities, Collision, Forces); `core/` (config, meta); `player/Master.js` (`TriggerPlayerRespawnSequence`) for player respawn; `builder/NewEntity.js` (`UpdateEntityModelFromTransform`, `ComputeCapsuleFromAabb`) for post-physics model sync and ground-probe capsule derivation, used identically for the player and every non-player entity since the player build was unified onto the entity pipeline.  
**Does not:** Read user input, manage its own update loop, or drive rendering.

## Invariants
- `ApplyPhysicsPipeline` is called once per frame per physics-active entity, in dependency order determined by `Level.js`.
- Entity state is mutated in place by the pipeline; results are not returned as new objects.
- `math/Forces.js` contains pure numeric math; `physics/Forces.js` wraps it with entity and config context.
- `math/Collision.js` contains pure geometry math; `physics/Collision.js` contains detection logic with scene state.
- The player and non-player entities share one model-sync path (`UpdateEntityModelFromTransform`) and one collision-bounds shape (`aabb`/`physics`/`hurtbox`/`hitbox`); `Master.js` branches on `isPlayer` only for player-only stages (input-driven correction source, ground-contact probing, respawn, action-state events), not for model or collision-bounds representation.
- `ProbeGroundContact` (`Collision.js`, player-only) derives its probe capsule from `entity.collision.aabb` via `ComputeCapsuleFromAabb`, not from a stored capsule. The player's swept-solid detection path (`DetectPhysicsCollisions`) still differs from the non-player path (`DetectCurrentPhysicsOverlaps`) in how it gates candidates before the swept test — see `DEFERRED.md`.
