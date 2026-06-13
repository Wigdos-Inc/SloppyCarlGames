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
**Calls into:** `math/` (Vector3, Utilities, Collision, Forces); `core/` (config, meta); `player/Master.js` (`TriggerPlayerRespawnSequence`) and `player/Model.js` (`UpdatePlayerModelFromState`, `SyncPlayerCollisionFromState`) for player model sync post-physics; `builder/NewEntity.js` (`UpdateEntityModelFromTransform`) for non-player entity model sync post-physics.  
**Does not:** Read user input, manage its own update loop, or drive rendering.

## Invariants
- `ApplyPhysicsPipeline` is called once per frame per physics-active entity, in dependency order determined by `Level.js`.
- Entity state is mutated in place by the pipeline; results are not returned as new objects.
- `math/Forces.js` contains pure numeric math; `physics/Forces.js` wraps it with entity and config context.
- `math/Collision.js` contains pure geometry math; `physics/Collision.js` contains detection logic with scene state.
