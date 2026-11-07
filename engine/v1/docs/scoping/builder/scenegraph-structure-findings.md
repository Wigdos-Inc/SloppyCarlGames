# SceneGraph Runtime Structure: Findings

0.35.9 (todo: "Refactor Parts & Models Shapes"), recorded 2026-11-05. These are findings only. Nothing here is decided, and the target shapes are still to be designed.

The sceneGraph was read live from `GetActiveLevel()` once per second while playing Zone 1 Stage 1 (`level0/stage0`) and Stage 2 (`level0/stage1`, Scale Tester), for 636 samples merged into one shape. Play covered water and air, the trigger, the void shaft, the collectible pickup, standing on an enemy, player animation sets, level particles and spark bursts.

The full shape is in [scenegraph-shape-recorded.txt](scenegraph-shape-recorded.txt). The shapes below are condensed from it.

**Legend**
- `→path`: the same object as the one at `path`. Every object is expanded once, at its shallowest path.
- `⇄shared`: one object shared by several siblings.
- `A×n | B×m`: the field held type A in n samples and type B in m.
- `key? (n/m)`: the key exists on n of m objects.
- `Unit<cnu>`, `UnitVector3<radians>`: engine units. `{x,y,z}`: a plain vector.

---

## 0. Patterns

Each pattern is detailed in the sections below.

1. **No common contract for a scene object.** Terrain, obstacles, triggers, voids, void walls, water, scatter batches and entities each have their own outer structure. Parts come in three structures. (§2)
2. **Grab-bag groups.** `mesh.meta`, `mesh.detail`, `entity.performance`, `entity.state` and the sceneGraph top level each hold unrelated things side by side. (§1, §3, §4)
3. **The same data in several places.** This covers values copied under another name (`shape`/`primitive`), objects reachable from two parents (`entity.mesh`/`model.parts[0].mesh`), and data kept twice in different forms (`instances`/`instanceData`). (§1, §3, §4, §5, §6)
4. **Runtime state inside definitions.** Live camera state sits in `cameraConfig`. The entity's physics flags sit in its path definition. The character template shares objects with the built meshes. (§1, §4, §5)
5. **Fields on objects that never use them.** Particles carry `hp`, `attacks` and `inputFrame`. Every mesh carries 7 `meta` keys. Trigger volumes carry a full render mesh. (§2, §3, §6)
6. **Leftovers.** `scatter`, `pendingFaceTextures`, `boost`, `checkpoint`, `abilities`, `state.lastJumpMs`, `state.activeAnimation` and `obstacle.scatter`. (§1, §2, §4, §5)

---

## 1. Top level

```
sceneGraph
  world, meta, cameraConfig, playerConfig                              level data (payload copies)
  terrain[], obstacles[], triggers[], voids{terrain[], obstacles[]},
  entities[], waterVisual{body, top} | null, scatterBatches Map, scatter[]   scene objects
  chunks[], collisionSeq, loopSurfaces{Air, Water}, tubeCenterlines Map,
  spawnSurfaces{<id>: {position, dimensions, scale, topY}}             collision / placement lookup
  scatterPrimitiveGeometry, partGeometryCache Map, visualResources{…}  render resources
  debug{showTriggerVolumes, detailedBounds[], scatterBounds[]},
  debugBoundingBoxes[]                                                 debug
  pendingFaceTextures                                                  build leftover
  effects{underwater{enabled, particleHook}}, player                   runtime state
```

- **25 keys, 7 roles, no grouping.**
- **Three keys are added outside the build literal** ([NewLevel.js:428](../../../builder/NewLevel.js#L428)):
  - `debugBoundingBoxes` ([NewLevel.js:308](../../../builder/NewLevel.js#L308))
  - `visualResources` ([NewTexture.js:626](../../../builder/NewTexture.js#L626))
  - `player` ([player/Master.js:124](../../../player/Master.js#L124))
- **The same object at two top-level paths:**
  - `scatterPrimitiveGeometry` is `visualResources.primitiveGeometry`.
  - `player` is also in `entities`.
- **Debug data is split** between `debug.detailedBounds`, `debug.scatterBounds` and the top-level `debugBoundingBoxes` (24,713 entries in Stage 1, 24,654 of them scatter). The scatter boxes' `min`/`max` objects are shared between `debug.scatterBounds` and `debugBoundingBoxes`.
- **`cameraConfig.state` is the live camera** (`position`, `target`, basis, `near`/`far`, `activeMode`, `situation`, `modeData`), stored inside the payload copy.
- **`spawnSurfaces`** is a build lookup that stays in the graph. Its `position`/`scale`/`dimensions` are the terrain meshes' own objects.
- **Leftovers:**
  - `scatter` is always `[]`. Scatter lives in `scatterBatches`.
  - `pendingFaceTextures` stays `{}`.
- **No water:** `waterVisual` and `world.water.level` are `null`.

---

## 2. Scene objects come in eight structures

| Kind | Container | Where the mesh is | Own bounds | Own `performance` |
|---|---|---|---|---|
| Terrain | `terrain[]` | is a mesh | on the mesh | on the mesh |
| Obstacle | `obstacles[]` | `record.mesh`, `record.parts[]` | record **and** each part mesh | record **and** each part mesh |
| Trigger | `triggers[]` | is a mesh (`role: "trigger"`) | on the mesh | on the mesh |
| Void | `voids.terrain[]` | is a reduced mesh | on the mesh | on the mesh |
| Void wall | `voids.terrain[].relations.<terrainId>.voidWallMeshes[]` | is a mesh-like object | `worldAabb`, `floorBounds`, `wallBounds` | none |
| Water | `waterVisual.body` / `.top` | is a mesh (`role: "water"`) | on the mesh | on the mesh |
| Scatter | `scatterBatches` values | none (instanced batch) | none | none |
| Entity | `entities[]` | `model.parts[].mesh`, `entity.mesh` | `collision`, `fullAabb`, part meshes | `entity.performance` and each part mesh |

**Obstacle record**
```
{ id, mesh (→ parts[0]), parts[mesh], worldAabb, detailedBounds, collisionShape,
  destructible, hp, static, state{destroyed}, performance{rendering},
  mode, nullable, sticky, scatter: undefined }
```
- `mode`, `nullable` and `sticky` repeat the mesh's `meta.mode`/`meta.nullable`/`meta.sticky`.
- `worldAabb`, `detailedBounds` and `collisionShape` are on the record and on each part. For a single-part obstacle these are sometimes the same objects (crate-stack) and sometimes separate ones (smoke-torch).
- `scatter` is a key that is always `undefined`.

**Trigger:** a box volume that carries a full render mesh: `material`, `detail.texture`, `detail.scatter`, `customTextures`, `geometry` and `renderMatrixCache`. The trigger itself lives in `meta.trigger{type, payload, activateOnce}`.

**Void:** the mesh without `material`, `detail`, `role`, `shape` or `primitive`. Its geometry is `{positions, indices, indexCount}` with no `uvs`. It adds two things:
- `relations{<terrainId>: {suppressed, openFaces, voidWallMeshes[]}}`
- `solidGrid`

**Void wall:** built separately, with its own shape:
```
{ id, primitive: "void", complexity: "void", dimensions, displayTransform (→ the void's transform),
  material, geometry{positions, uvs, indices}, worldAabb, floorBounds, wallBounds,
  displayColor, renderMatrixCache, detail{texture}, occluded }
```
It has no `type`, `meta`, `transform`, `role` or `shape`.

**Scatter batch**
```
{ primitive, dimensions, complexity, primitiveOptions, primitiveKey, textureID, texture, customTextures[],
  instances[{modelMatrix[16], tint[4]}], instanceCount, instanceData: Float32Array }
```
- **The same instance data twice.** `instances` holds one object per instance (up to 119,385), next to `instanceData`, which packs the same 20 numbers per instance (2,387,700 = 119,385 × 20).
- It uses `primitive`, where meshes use both `shape` and `primitive`.

**Parts come in three structures**
- Obstacle part: a plain mesh.
- Entity part: `{id, label, parentId, anchorPoint, attachmentPoint, addsToBounds, children[], localTransform, dimensions, builtDimensions, mesh}`.
- Authored part, as in the character template (`player.character.model.parts[]`) and the scatter registry (`visualResources.scatterRegistry.<id>.parts[]`): `{shape, complexity, dimensions, localPosition, localRotation, localScale, pivot, primitiveOptions, texture{generated, custom}, …}`.
- Uneven part fields:
  - Entity part `label` is a string on the player, `null` on enemies and stage 2 entities, and either on particles.
  - `addsToBounds` is `undefined` on player parts and a boolean elsewhere.

---

## 3. The mesh

One builder makes every mesh ([NewObject.js:235](../../../builder/NewObject.js#L235)). Later stages add fields to it. Grouped by concern:

```
identity    id, type: "mesh3d", role ("terrain" | "obstacle" | "trigger" | "water" | "entity-part")
meta        { trigger, platform, parentId, sticky, mode, nullable, particle }
transform   transform{position, rotation, scale, pivot}, displayTransform,
            renderMatrixCache{matrix, position, rotation, scale, pivot}
size        dimensions
primitive   shape, primitive, complexity
bounds      collisionShape, worldAabb, localBounds, detailedBounds, occluder (terrain), centerline
look        material{textureID, color, opacity, transparent}, displayColor,
            detail{scatter[], texture{…}, complexity, primitiveOptions{…}}, customTextures[], sprite
geometry    geometry{positions, indices, uvs, bounds, faceTextureGroups?}
gating      performance{rendering}
```

- **`type` never varies.** It is `"mesh3d"` on every mesh in both stages. `role` is the real discriminator.
- **`meta` sets 7 keys on every mesh, though each kind uses only some of them:**

  | Key | Set on | Read by |
  |---|---|---|
  | `trigger` | triggers | [Collision.js:227](../../../physics/Collision.js#L227) |
  | `platform` | `undefined` on every mesh recorded | no runtime reader found |
  | `parentId` | entity and obstacle parts | no runtime reader found |
  | `sticky`, `nullable` | terrain, voids, obstacle meshes | [Collision.js:260](../../../physics/Collision.js#L260) (`surfaceFlags`), [NewVoid.js:640](../../../builder/NewVoid.js#L640), [Chunks.js:70](../../../builder/subProcesses/Chunks.js#L70) |
  | `mode` | terrain, voids, obstacle meshes | Render, NewTerrain, NewLevel, NewTexture, NewVoid, Occlusion, Simulator |
  | `particle` | particle carriers (terrain, obstacle part, entity part) | [NewParticles.js:443](../../../builder/NewParticles.js#L443) |

  Water meshes and triggers carry these keys as `undefined`.
- **The same value under two names.** Live check across 102 meshes in Stage 2:
  - `shape` === `primitive` on all 102.
  - `complexity` === `detail.complexity` on all 102.
  - `sprite` is the same object as `detail.primitiveOptions.sprite`. `crossed` sits next to it in `primitiveOptions`, which is the todo's "per-part flags" item.
- **The transform is kept three times:**
  - `transform`
  - `displayTransform`, which is `transform` itself on 96 of 102 meshes and a separate object only while animated
  - `renderMatrixCache`, which holds the matrix plus copies of all four vectors
- **The texture is spread over four places:**
  - definition: `detail.texture`
  - derived key: `material.textureID`
  - per-face keys: `geometry.faceTextureGroups[].textureID`
  - live texture: `visualResources.textureRegistry`

  `detail.texture.primary` is often the same object as the registry entry's `definition.primary`.
- **`detail` mixes four unrelated things:** scatter requests, the texture definition, a complexity copy and primitive options.
- **Bounds:** `worldAabb`, `localBounds`, `detailedBounds` and `geometry.bounds`, plus `occluder` (terrain only) and `centerline` (`null` in both stages). On terrain, obstacles, triggers and water, `geometry.bounds` is `localBounds`. On entity parts it is its own object inside the shared geometry cache.
- **Geometry storage differs by kind:**
  - Terrain, obstacles, triggers and water use plain number arrays, built per mesh.
  - Entity parts and particles use `Float32Array`/`Uint16Array`, frozen and shared through `partGeometryCache` ([NewObject.js:223](../../../builder/NewObject.js#L223)).
  - Voids use plain arrays with no `uvs`, plus `indexCount`.
  - Void walls use typed arrays.
- **Decal records (`customTextures[]`) are a union with only `decalType` to tell the kinds apart.** One record holds:
  - authored fields: `decalType`, `imagePath`, `sourceType`, `shape`, `side`, `localTransform`, `texture`, `sources`, `id`
  - runtime display fields: `displayTransform`, `displayColor`, `activeSourceKey`, `bitmap`
  - a key: `textureKey`

  Image decals have no `shape`/`texture`. Shape decals have `imagePath`/`sourceType` set to `null`. `mutable` is on mesh decals but not on scatter batch decals.

---

## 4. The entity

Every entity comes from `BuildEntity` ([NewEntity.js:491](../../../builder/NewEntity.js#L491)), grouped here by concern:

```
authored    id, type, hp, attacks[], hardcoded{aggroRange, scoreValue?}, platform,
            collisionOverride{physics, hurtbox, hitbox}, customEvents{7 flags}, animations{}
path        movement{start, end, repeat, backAndForth, speed, jump, jumpInterval, jumpOnSight,
                     disappear, chase, physics{gravity, buoyancy, resistance, correction, collision}}
            state{movementProgress, direction, lastJumpMs, activeAnimation}
motion      transform{position, rotation, scale}, velocity, facing, modelTurnRate{air, water}
physics     submergence, medium, buoyancyForce, action, grounded, launched, contactGrace, gripDemand,
  (loose)   gravityScale, dragFree, staticFriction, surfaceContact, surfaceNormal, alignedUp, referenceNormal
physics     physicsRuntime{lastPosition, lastRotation, hasUnresolvedPenetration, resting,
  (grouped)                lastPhysicsCollisionKey, groundSurfaceId}
input       inputFrame{carriedForward, lastCameraYaw, hadInput, wasGrounded, lastUp, lastKeys{forward, right},
                       lastControl, remapPending, holding, locked, lockAngle, lockSign, lockThrottle}
model       model{rootTransform, spawnSurfaceId, surfacePosition, parts[], index{}, roots[],
                  posedTransform, defaultPose{rootTransform, parts[{id, localTransform}]}, restFullAabb}
            mesh (→ model.parts[0].mesh)
bounds      collision{rest{aabb, groundCapsule, physics, hurtbox, hitbox}, simRadiusPadding,
                      aabb, simRadiusAabb, physics, hurtbox, hitbox} | null
            fullAabb, hitboxActive
gating      performance{physics, rendering, animatedTexture, collision}
render      showsThroughWalls, fitsParts
particles   particle
```

- **Physics state is spread over four places:**
  - 15 loose top-level fields
  - `physicsRuntime`
  - the physics flags inside the path definition (`movement.physics`)
  - `action`
- **`state` vs `movement`:** `state` holds path progress plus two dead fields. `lastJumpMs` has no reader, and `activeAnimation` stayed `"idle"` through every action in both stages. `movement` is the path definition.
- **`performance` mixes gating flags with a contact list.** `performance.collision` starts as `false` ([NewEntity.js:560](../../../builder/NewEntity.js#L560)) and becomes an array of contact records near other objects. Recorded: `boolean×3132 | Array` on particles, `boolean×45 | Array` on stage 2 entities.
- **Every entity gets player input state.** `inputFrame` is the player's input-carry state ([Movement.js:102](../../../player/Movement.js#L102)), built for every entity, particles included.
- **Collision:**
  - Each layer is kept twice: at rest (`collision.rest.*`) and placed (`collision.*`).
  - `collision.rest.aabb` is `model.restFullAabb`, and `collision.aabb` is `fullAabb`.
  - `groundCapsule` exists only at rest.
  - `collision` is `null` when no part adds to bounds, while `fullAabb` sits outside it.
  - The combat layers (`hurtbox`, `hitbox`, `hitboxActive`) share the group with the physics bounds.
- **The root transform is kept four times:**
  - `transform`
  - `model.rootTransform`, which reuses `transform`'s position/rotation/scale objects and adds its own `pivot`
  - `model.posedTransform`
  - `model.defaultPose.rootTransform`

  Each part then has a `localTransform`, a `defaultPose.parts[].localTransform`, plus the mesh's `transform`, `displayTransform` and `renderMatrixCache`.
- **The part tree is stored four ways:** `parts[].parentId`, `parts[].children` (ids), `model.index` (id → part) and `model.roots` (ids).
- **Part size is kept three times:** `part.dimensions`, `part.builtDimensions` and `mesh.dimensions`.
- **`hardcoded`** is an AI parameter bag (`aggroRange`, `scoreValue`). `attacks` exists on every entity and is empty except on enemies.
- **`platform`** is `null` on every entity recorded.
- **Animation runtime:** non-player entities with `animations` (enemies, NPC, collectible) have no `animationRuntime` field. Only the player has one.

---

## 5. The player on top of the entity

`createDefaultPlayerState` ([player/Master.js:49](../../../player/Master.js#L49)) adds these loose fields:

```
active, character{…}, jumpStartY, jumpApexY, jumpWindow{buffer, coyote}, stoppingActive, primaryOppositeHeld,
lastAction, collectibles, maxCollectibles, attackFlag, modelOpacity, abilities, boost{active, timer,
maxSpeedMultiplier, accelMultiplier}, invulnerable{active, timer, flashTimer}, activeTriggers[], checkpoint,
spawnPosition, animationRuntime{…}
```

- **`player.movement` has a different shape:** `{speed, start, end}`, against the other entities' 11-field path.
- **Some player fields are the config's own objects:** `customEvents` is `playerConfig.customEvents`, and `animations` is `playerConfig.animations`.
- **The character template shares objects with the built model.**
  - Template shape: `character{name{s, l}, meta{10 tuning values}, physics{5 flags}, collisionOverride (→ player.collisionOverride), model.parts[]}`.
  - The authored part definitions share their `dimensions`, `pivot`, `primitiveOptions`, `texture.generated` (→ `mesh.detail.texture`), `texture.custom` (→ `mesh.customTextures`) and `detail.scatter` (→ `mesh.detail.scatter`) with the built meshes.
  - The physics flags live in `character.physics` for the player and in `movement.physics` for other entities.
- **Leftovers:**
  - `boost`: boost doesn't exist, but the group does. [Movement.js:234-235](../../../player/Movement.js#L234-L235) multiplies max speed and acceleration by it, and [Master.js:268](../../../player/Master.js#L268) resets it.
  - `checkpoint` and `abilities` have no writer anywhere in engine source and are always `null`.
- **`lastAction` exists twice:** `player.lastAction` and `animationRuntime.lastAction`. They can differ at the same moment (`"Sinking"` vs `"Floating"` in one sample).
- **`activeTriggers[]`** holds collision result records `{target, tEntry, normal, pushDepth, type, sourceType, trigger, attacker}`, so trigger contacts carry a combat field (`attacker`).
- **`animationRuntime`**
  ```
  { lastAction, currentSetName, elapsed, correctionN, correctionCounter,
    displayedOffsets Map, snapshots Map, partLocals Map<partId>, partDisplays Map<mesh>,
    decalDisplays Map, colorDisplayed Map, colorSnapshots Map, colorDisplays Map, decalIndex Map,
    restLocals{<partId>: transform}, modelPose{position, rotation, scale} }
  ```
  - Keys vary: strings, part ids, mesh objects. `restLocals` is a plain object while the rest are Maps.
  - `displayedOffsets` and `snapshots` hold part offsets (`rotation` is `{x,y,z}`) and decal offsets (`rotation` is a number) in the same Map. The caller passes `isDecal` separately ([Animation.js:301-307](../../../handlers/game/Animation.js#L301-L307)).
  - `model.defaultPose.parts[].localTransform` is `restLocals.<partId>`.

---

## 6. Particles

A particle group is a full entity (`type: "particle"`) plus a class instance in `entity.particle` (`seedingParticleGroup`, `particleGroup` or `burstParticleGroup`). Each particle is a model part (`p0`…`p9`) with its own mesh, and `entity.mesh` is `p0`.

- **Entity fields with no particle meaning:**
  - `hp` and `attacks[]`
  - `inputFrame` and `modelTurnRate`
  - `customEvents` (empty) and `state`
  - `movement` with chase, jump and disappear flags
  - `collisionOverride{physics: "aabb", hurtbox: null, hitbox: null}`
  - `collision.rest.groundCapsule`

**`entity.particle`**
```
{ entity (→ the entity),
  request{templateId, position, offset, rotation, area, overrides{count, spread, physics, color, velocity, duration},
          mode, target, side?},
  duration{mode, holdTimeMs, endTimeMs, intervalMs}, physicsMode, startColor, endColor, variance, offsets[], halfAngle,
  target{type, id, partId}, targetKey, offset, followedRotation, rotatedOffset, orphaned,
  spawnOrigin, originCorrection, spawnAxis, lifespan, total, decayStart, finished,
  amount?, seedClock?, seeded?   (seeding groups only) }
```
- **Fields that repeat each other:**
  - `request.target` is `particle.target`.
  - `request.overrides.duration` is `particle.duration`.
  - The offset sits at both `request.offset` and `particle.offset`.
- **`endColor` is `startColor`:** the same object on all 72 live groups in Stage 2.
- **The emitter side:** the emitting mesh keeps `meta.particle{id, side, area, position, overrides}`. Its `area`, `overrides` and rotation are the same objects as the group's `request` fields.

---

## 7. Records that point at scene objects

| Record | Lives in | Fields |
|---|---|---|
| Contact | `entity.performance.collision[]` | `id, pairId, aabb, detailedBounds, isTrigger, type, ref, rank, seq` (+ `sourceType`, `trigger` by kind) |
| Chunk member | `chunks[].members[]` | `ref, type, rank, seq, aabb, linings[]` |
| Collision result | `player.activeTriggers[]` | `target, tEntry, normal, pushDepth, type, sourceType, trigger, attacker` |
| Debug bounds | `debug.detailedBounds[]` | `type, id, bounds, toggle` |
| Debug box | `debugBoundingBoxes[]`, `debug.scatterBounds[]` | `type, id, min, max` |

- **Casing differs:** `type` is lowercase in collision records (`"terrain"`, `"voidWall"`) and capitalized in debug records (`"Terrain"`, `"VoidWall"`).
- **The pointer field is named differently:** `ref` in contacts and chunk members, `target` in collision results.
- **Entity contacts carry no `aabb`/`detailedBounds`,** unlike terrain and obstacle contacts.

---

## 8. Value types

- **Consistent:** `scale` is always a plain `{x,y,z}`, and `position`/`rotation`/`pivot` are always `UnitVector3`.
- **Triangle normals:** plain `{x,y,z}` in mesh `detailedBounds`, but `UnitVector3<cnu>` in the debug void triangles.
- **Triangle vertices:** `UnitVector3` in `detailedBounds`, but plain in `voids.terrain[].solidGrid`.
- **Boxes:** chunk and chunk-member boxes are plain `{x,y,z}`, while mesh `worldAabb` is `UnitVector3`.
- **Rotation:** decal rotation is a scalar `Unit<radians>`, part rotation a `UnitVector3`. In the animation offsets above, the same field holds either.

---

## 9. Found while recording

- **Fixed in this pass:** scatter decals had no rotation.
  - Cause: `cloneScatterDecal` copied the decal through `CloneTransform`, which treats the scalar `Unit` rotation as a vector, so the rotation became `{x: undefined, y: undefined, z: undefined}`.
  - Effect: `BuildDecalPlacementMatrix` then built a NaN placement for all 9 scatter decals in Stage 1 ([Render.js:436](../../../handlers/Render.js#L436), [Render.js:1560](../../../handlers/Render.js#L1560)).
  - Fix: the clone now copies each field ([NewScatter.js:391](../../../builder/NewScatter.js#L391)).
- **Not verified as a bug:** the player's hurtbox sphere has a radius of 0.135, centered 0.65 up. Standing on enemy-01, the solid layer keeps the player about 0.04 short of its hitbox, so contact damage never fired.
