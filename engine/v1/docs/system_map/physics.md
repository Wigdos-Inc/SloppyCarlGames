# physics/ — Physics Pipeline

## Responsibility
Computes physics for moving entities each frame: gravity, buoyancy, fluid resistance, water currents, collision detection and surface correction. The pipeline is externally driven: handlers pass entity state in, and physics does not manage its own update loop. Detection, correction and force functions **return results**, and `Master.js` is the only module that writes those results onto the entity.

## Files
- `Master.js` — Pipeline orchestrator. Its sole export is `ApplyPhysicsPipeline(entity, sceneGraph, deltaSeconds)`, called per physics-active entity per step by `handlers/game/Level.js`.
  - **Stage flags** come from `entity.movement.physics` (`gravity`, `buoyancy`, `resistance`, `correction`, `collision`) for every entity, the player included.
  - **`physicsState`** is built per call. It holds `displacement` and stage blocks:
    - `gravity`, `buoyancy` and `resistance`, each `enabled` from `CONFIG.Physics` and the stage flag;
    - `collision`: `enabled` is `entity.performance.collision !== false`, plus `triggers`, `hasUnresolvedPenetration` (starts `false` each step) and `overlaps`;
    - `correction`: `enabled`, `frameStart`, `groundReach`, `fold`, `groundContact`, `groundHits`;
    - `loop`: `iterations`, `hadMeaningfulWork`.

  **Resting.** `ApplyPhysicsPipeline` returns immediately while the entity rests. An entity rests when all of these hold:
  - `physics.lastFrame.resting` is set;
  - its velocity is still;
  - no awake entity's collision box overlaps it (`touchedByMover`).

  `recordStep(entity)` writes `physics.lastFrame` (`position`, `rotation`) at the end of every step. It marks `resting` when the step left position and rotation unchanged with a still velocity. `handlers/game/Level.js`'s `wakeEntities` clears `resting` on every entity after a non-entity spawn or any despawn.

  **Force stages.**
  - **Water.** Every step measures `physics.submergence` and sets `physics.medium` (`"Water"` at ≥ 0.5, else `"Air"`), whatever the water flags. `physics.buoyancyForce` is 0 unless buoyancy runs.
  - **Gravity** is scaled by `physics.slopes.gravityScale`, which `player/Movement.js` lowers while coasting a loop lock and raises for a released jump.
  - **Buoyancy**, then **resistance**, which is skipped while `physics.slopes.isCoasting`.
  - **Floatiness.** For the player, floatiness smooths the step's vertical change.
  - **Static friction.** A positive `physics.slopes.staticFriction` cancels the along-surface part of that change (`GetStaticFriction`), so an idle player holds still on walkable slopes.
  - **Displacement** is `velocity × dt`.

  **`runPhysicsLoop`, in order:**
  1. `GetCorrectionFrame` freezes `frameStart`: `physics.correction.referenceNormal` and `physics.lastFrame.groundSurfaceId`.
     - It also sets `groundReach`: the snap tolerance plus, with kept footing, |displacement| × sin(`MaxAngleDelta.Ground`).
     - It sets the walkable `fold`: `{ normal, minCos }` with kept footing, else `null`.
     - It decays this step's `contactGrace`.
  2. Swept pass: `DetectPhysicsCollisions` → `ResolveCollisions(velocity, displacement, solids, fold)`, then a move. A new `collisionKey` (stored in `physics.lastFrame.collisionKey`) fires `PLAYER_COLLISION`/`ENTITY_COLLISION` when the entity and `CONFIG.CustomEvents` both opt in.
  3. Up to three overlap/correction passes. Each runs `DetectCurrentPhysicsOverlaps` → `ResolveCollisions` with zero displacement, then `correctSurface`: `GatherGroundHits` → `PickGroundContact` → `GetSurfaceCorrection`.
     - Its results are written into `physics.correction` and `velocity`.
     - A probe hit writes `physics.lastFrame.groundSurfaceId`, and a miss leaves it.
     - The loop stops early when neither half changed anything.
  4. `physics.grounded = ResolveGrounded(entity, physics.correction.surfaceContact)`. `physics.launched` clears once velocity along `alignedUp` is ≤ `EPSILON`. `physics.slopes.gripDemand` and `physics.correction.referenceNormal` take `GetGripDemand`/`GetReferenceNormal`.
  5. `GetGroundSnap` seats the capsule along the contact normal.
  6. A final overlap detection stores the step's triggers. The player copies them into `playerState.activeTriggers`, which `camera/Master.js` reads for camera triggers.
  7. `GetSurfaceOrientation` makes the frame's single orientation write: rotation, then the position shift that keeps the pivot in place.

  **Detection reuse.** `moveEntity` applies every position change and clears `collision.overlaps` and `correction.groundHits`. Every entity reuses its last overlap detection and raw ground hits until a move clears them. Ground hits are re-classified and re-ranked every pass even when reused.

  After the loop, the death barrier clamps position and triggers `TriggerPlayerDeath` for the player. `PLAYER_GROUNDED_CHANGE` fires on a grounded flip when opted in.
- `Collision.js` — Detection against the candidates gathered for the entity this step, plus scene queries. Exports `BroadphaseCollectCandidates`, `IsCutByVoid`, `HostVoids`, `DetectPhysicsCollisions`, `DetectCurrentPhysicsOverlaps`, `DetectCombatOverlaps`, `ResolveCollisions`, `GatherGroundHits`, `PickGroundContact` and `NO_GROUND_CONTACT`.

  **The broadphase walks collision chunks.** `BroadphaseCollectCandidates(sceneGraph, simRadiusAabb, includeTriggers, includeEntities)` walks `sceneGraph.collision.chunks`, then each chunk's members, then each member's void linings, keeping what's within the sim radius.
  - **Solids.** Terrain and obstacle part meshes become solid candidates from `physics.collision`. Meshes with `detailedBounds === null` are skipped.
  - **Void linings.** A lining's `wallBounds` and non-null `floorBounds` become separate `voidWall` candidates (the floor's id gets a `-floor` suffix), carrying a `sourceType`.
  - **Order.** Candidates sort by `rank`/`seq` to keep the authored order.
  - **Triggers and entities** are appended after the sort when asked. Entities leave out the player and particles.
  - **Storage.** `handlers/game/Performance.js`'s `UpdateCollisionCandidates` stores the list on `entity.performance.collision` once per step (see handlers.md). Every detection pass and the ground probe iterate that list rather than broadphasing themselves. Camera rays call the broadphase directly.

  **Swept detection.** `DetectPhysicsCollisions(entity, displacement, sceneGraph)` sweeps a sphere collider through `SweptSphereBounds`, and anything else through `SweptAABB`.
  - **Fast moves.** When a step is longer than the body's smallest box half-extent, it also traces the body's box center along the move against each triangle-soup candidate's grid cells (front faces only, inside the path box). The nearest crossing that isn't void-cancelled becomes a solid, so fast bodies cannot pass through soup.
  - **Contact point.** The player's contact is taken at the end of the move, else at the swept entry. Other entities reuse a cached contact per candidate until they move along its push axis.

  **Overlaps.** `DetectCurrentPhysicsOverlaps` gates each candidate on `AabbOverlap` first, then takes the contact from `math/Collision.js`'s `NarrowphaseContact` against the entity's declared collider. It pushes out by the smaller of the collider's contact depth and the two boxes' overlap along the contact normal.

  **Void suppression is per contact.** `isVoidCancelled` cancels a terrain/obstacle contact only where the material behind it was carved away.
  - **Which voids.** It checks only voids that have a relation record for that host (`Object.hasOwn(void.relations, hostId)`), and never hosts marked `nullable: false` or in `invisible` mode.
  - **Tests.** A contact is cancelled when the body's box center is inside the void's `solidGrid` (`PointInsideGrid`), or when the contact point stepped `contactMaterialProbe` (0.05 cnu) back into the host is. A contact without a point falls back to a `NarrowphaseContact` against the void's bounds.
  - **Related queries.** `IsCutByVoid(point, candidateId, voids)` answers the same question for a single point. `HostVoids(sceneGraph, isTerrain)` returns `voids.terrain` or `voids.obstacles`.

  **Resolution.** `ResolveCollisions(velocity, displacement, solids, fold)` returns early with no hits.
  - Otherwise it names a floor impact (highest `normal.y > 0.5`) and a wall impact, resolving a void wall under its `sourceType`.
  - It slides along the contacts, turning velocity across walkable folds instead of cutting it.
  - It returns `collisionKey` (`"floor"`, `"wall"`, `"floor+wall"`, `"solid"` or `""`) and the changed flags.

  **Ground probe.** `GatherGroundHits(entity, sceneGraph, groundReach)` places the frozen `physics.collision.rest.groundCapsule`'s lower cap center by the transform.
  - **Hit collection.** It collects raw hits from each terrain/obstacle candidate within `radius + groundReach`. Boxes ground only through a face the probe is over, and soups use the nearest front triangle.
  - **Voids.** It drops hits inside a void, and probes both lining soups of every void wall under the void's id and `sticky` flag.
  - **Ranking.** `PickGroundContact(entity, probe, frameStart)` classifies each hit with `Correction.js`'s `ClassifySurface` and drops walls. It ranks walkable over sliding, then nearest `t`, with the remembered `groundSurfaceId` breaking ties.
  - **Result.** `{ hit, normal, contact, restDelta, surfaceId }`, or `NO_GROUND_CONTACT`.

  `DetectCombatOverlaps(playerState, entities)` tests hitboxes against hurtboxes. It returns early while `CONFIG.Physics.Collision.Hurtbox`/`Hitbox` are off, and skips collectibles and particles.
- `Correction.js` — Surface classification and correction results. Exports `ClassifySurface`, `GetCorrectionFrame`, `GetSurfaceCorrection`, `GetGroundSnap`, `GetSurfaceOrientation`, `GetGripDemand`, `GetReferenceNormal`, `PoseAnchor`, `ResolveGrounded` and `CORRECTION_DISABLED` (the frozen all-false result). None of them write the entity.

  **Surface classification.** `ClassifySurface(referenceNormal, candidate, currentContact, medium, speedRatio, gripDemand)` returns `"walkable"`, `"sliding"` or `"wall"`.
  - It uses `CONFIG.Physics.Correction.MaxAngleDelta[medium]`.
  - Anything within `FlatSnapDegrees` of world up is walkable.
  - A candidate no steeper than the reference is judged on absolute incline. A steeper one is judged on the delta from the reference.
  - The walkable limit is `Recover` rather than `Ground` mid-slide.
  - Past the `Ground` incline, a would-be walkable contact slides when `speedRatio < gripDemand`.

  **`GetSurfaceCorrection(entity, groundContact, frameStart)`** returns the new `surfaceContact`, `contactGrace`, `surfaceNormal`, `alignedUp` and `velocity`.
  - **Pinning.** Velocity is pinned to the surface only with kept footing, not `launched`, and grounded on the new contact. Otherwise only an into-surface component is removed.
  - **Release.** A ground hit while `launched` with velocity pointing away from the surface returns `releasedSurface`.
  - **Grace.** A miss returns contact `"none"` and, unless launched, a contact grace during which `alignedUp` and `surfaceNormal` hold.

  **Snap, grip and reference.** `GetGroundSnap` applies only while grounded and within tolerance. `GetGripDemand` eases toward the slope's grip requirement, holding while airborne. `GetReferenceNormal` adopts a walked surface instantly and decays toward world up once contact-less past the grace.

  **Orientation.** `GetSurfaceOrientation(entity)` returns nothing during the contact grace. Otherwise it solves the standing rotation and the position offset that keeps `PoseAnchor(entity)` fixed. `handlers/game/Animation.js` turns the eased model pose about the same anchor.

  **`ResolveGrounded(entity, contact)`** is a pure derivation: a walkable contact, minus a launch veto measured along `physics.correction.alignedUp`, minus buoyancy exceeding gravity.
- `Forces.js` — Engine-shaped force assembly over `math/Forces.js`: `GetGravity` (applies `slopes.gravityScale`), `GetBuoyancy`, `GetResistance`, `GetSubmergence` (from the entity's `fullAabb`, so it works without a collision box), `GetFloatiness` and `GetStaticFriction`. Each returns a value, and `Master.js` writes it. The scene's water `topY` Unit is passed to `math/Forces.js` as a plain number or null.
- `Current.js` — Movement velocity adjustments for entities inside underwater current volumes (a two-line stub).

## Boundaries
**Called by:**
- `handlers/game/Level.js` calls `ApplyPhysicsPipeline` directly. There is no intermediary physics handler.
- `Collision.js` is also imported by `handlers/game/Performance.js` (`BroadphaseCollectCandidates`), `handlers/game/Enemy.js` (combat), `camera/Master.js` (`BroadphaseCollectCandidates`, `IsCutByVoid`, `HostVoids`) and `builder/subProcesses/Chunks.js` (`IsCutByVoid`).
- `Correction.js`'s `PoseAnchor` is imported by `handlers/game/Animation.js` and `camera/Modes.js`.

**Calls into:** `math/` (Vector3, Utilities, Collision, Geometry, Matrix, Forces); `core/` (config, meta); `player/Master.js` (`TriggerPlayerDeath`); `builder/NewEntity.js` (`UpdateEntityModel`, used identically for the player and every other entity).

**Does not:** read user input, manage its own update loop, drive rendering, or broadphase during detection (the registry supplies candidates).

## Invariants
- `SimDistance` is the single distance authority. Every other reach is a fraction of it in `PERFORMANCE_SCALING.SimDistance.Fractions`, and consumers read `PERFORMANCE_SCALING.SimDistance.Tiers[CONFIG.Performance.SimDistance]` directly.
- `Master.js` is the only physics module that writes entity state. Detection, correction and force functions return results. Their frozen "nothing" results (`NO_GROUND_CONTACT`, `CORRECTION_DISABLED`, `noDetection`) are shared and never mutated.
- Collision runs only when `entity.performance.collision` is a non-empty candidate list. `UpdateCollisionCandidates` sets it every step before the player pipeline.
- Displacement is computed outside every stage-flag check, so zeroing an entity's stage flags does not make the pipeline inert. Anything that owns its own motion must be skipped at the `Level.js` layer; particle `physicsMode "none"` is the current case.
- Particles are excluded from entity-vs-entity collision in both directions. They still collide with terrain, obstacles and void walls.
- **Colliders are frozen at build time and only placed afterwards.** `physics.collision.rest` holds the local-space shapes (see builder.md's rest bounds). The ground probe reads `rest.groundCapsule` and places it by the transform.
- **The ground probe is the sole authority on surface contact, and `physics.lastFrame.groundSurfaceId` is its memory.** It is written after every hit, never on a miss. `camera/` reads it for ramps and loop surfaces.
- **Physics never imports camera.** Camera-driven behaviour reaches physics only through the `physics.slopes` fields Movement writes (`gravityScale`, `staticFriction`, `isInLoop`, `isCoasting`).
- **`physics.grounded` is derived, never assigned.** `ResolveGrounded` produces it and `runPhysicsLoop` applies it once per step. A consumer that wants to know what the entity stands on reads `physics.correction.surfaceContact`.
- **`referenceNormal` is the last walked surface, written once per step.** `frameStart` freezes it for the loop. Adoption is instant and release is eased, on purpose.
- **`physics/` writes exact orientation only.** Visual smoothing is `handlers/game/Animation.js`'s model-pose channel, which never writes back.
- Penetration pushout resolves along the detected contact from the declared collider's narrowphase. Ground seating is `restDelta` from the probe.
- The player's swept path (`DetectPhysicsCollisions`) still has no tight `AabbOverlap` gate on solids, unlike `DetectCurrentPhysicsOverlaps` (see `DEFERRED.md`).
