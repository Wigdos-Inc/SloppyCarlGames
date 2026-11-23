# builder/ — Scene and Asset Construction

## Responsibility
Constructs all visual and structural scene data: 3D WebGL meshes, entity models, obstacles, terrain, void walls, procedural textures, scatter batches, particle groups, UI element trees and the full level scene graph. Builders are called by handlers, produce output objects, and return. They drive no update loops. Two module-level caches exist and are cleared by their owners: NewEntity's `partGeometry` and the game-template registration in `templates/Instance.js`.

## Files
- `NewLevel.js` — Level scene graph assembler. Exports `BuildLevel` and `RefreshDebugBoundingBoxes`.

  **Build order** (`BuildLevel(payload)`):
  1. `RegisterGameTemplates(payload.templates)` and `ClearPartGeometry()`.
  2. Terrain and obstacle definitions resolve through `ResolveObjectSource`. Then `BuildTerrain` and `BuildObstacles` run.
  3. `BuildVoidWalls({ terrain, obstacles, voids }, textureScale)`.
  4. `BuildOccluders(terrain, voidTerrain)`.
  5. `AssembleTerrainChunks(terrain, voidTerrain)`.
  6. `FindLoops(terrainChunks, [...terrain, ...voidTerrain])`.
  7. `AssembleCollisionChunks(...)`.
  8. Open faces are gathered per host id from every void's `relations`.
  9. Scatter batches are built for every `default`-mode terrain mesh (seed `index + 1`) and obstacle part (seeds continue after the terrain).
  10. Triggers, then the spawn surface map (`buildSurfaceMap(terrainDefinitions, obstacleDefinitions, allObstacles)`), then entities.
  11. Level-authored particle generators, then the water meshes.

  The spawn surface map gives `{ position, dimensions, scale, topY }` per terrain id and obstacle group. An obstacle's `topY` is its highest solid part, and a void-only obstacle uses its voids. `buildTriggerMesh` centres a trigger box at `start.y + triggerHeight × 0.5` with `triggerHeight = world.dimensions.y − start.y`.

  **The sceneGraph:**
  - `world` holds `world.water = { topY, tint, body, top }`. `body` and `top` are null without water.
  - `terrain: { entries, chunks }`, where `chunks` is the `AssembleTerrainChunks` result.
  - `obstacles: { entries, groups }`: `entries` is every non-void obstacle part mesh, and `groups[id]` is `{ id, destructible, hp, parts }`.
  - `entities`, `triggers`, and `voids: { terrain, obstacles }`.
  - `scatter: { batches, geometry }`.
  - `collision: { chunks, seq }`.
  - `surfaces: { spawn, loops, tubes }`.
  - `debug: { showTriggerVolumes, boundingBoxes, detailedBounds, scatterBounds }`.
  - `effects`, `cameraConfig`, `playerConfig`, `meta`.
  - `visualResources: { textureRegistry }`, which is the build's face texture store.

  **Debug bounds.** NewLevel owns the debug-bounds collection. `pushVoid` emits a void's volume, its lining floor and wall soups, and its open faces as separately coloured records (`Void`/`VoidWall`/`VoidOpenFace`) that share the one `Void` toggle. Entities without `fitsParts` refit their part boxes when debug boxes refresh.
- `NewPrimitive.js` — Primitive shape construction.
  - **Export.** Its only export is `BuildGeometry(shape, size, primitiveOptions)`, called by NewObject and NewScatter. Complexity is read from `primitiveOptions.complexity` on cylinder, sphere, cone, capsule, tube, torus and ramp-complex. The complexity resolvers are `resolveCylinderSegments` 8/12/16 and `resolveSphereResolution` with 7/13/19 stacks.
  - **Planes.** A plane is an upright x-by-y quad facing +Z. `crossed: true` builds two quads at ±45° around the height.
  - **Orientation.** Every builder emits outward-wound triangles.
    - `buildPyramid` is centred on its origin.
    - `appendRadialVertices` takes an `angleOffset`: cylinders, capsules and every tube ring turn by `π / segments`, and spheres add `π / slices` to `theta`, so curved primitives lie flat when rotated 90°.
  - **Tube.** A node-chain bone walk.
    - `resolveTubeNodes` composes each `primitiveOptions.nodes[]` entry onto the running frame.
    - `buildTube` lays one ring at every node and lofts curved connectors along `ParallelTransportFrames`.
    - It then stitches rings, caps the ends and emits per-connector face groups.
    - `primitiveOptions.solid` sweeps a solid (outer rings only, disc caps).
    - It returns the tube's centerline as `geometry.centerline`.
  - **Ramps carry no angle.** `resolveRampShape(size)` derives the incline from `dimensions.y` and `.z`. `ramp-complex` takes a 0–1 `depth` that curves its top along a quadratic Bézier.
  - The decal surface map in `handlers/Render.js` (`DecalSurfaceUv`) assumes the analytic shapes of `buildSphere`/`buildCylinder`/`buildCapsule`, which must stay in sync if either changes.
- `NewObject.js` — Mesh builder over NewPrimitive's geometry. Exports `BuildObject`, `UpdateObjectWorldAabb`, `GenerateUVs` and `GenerateFaceProjectedUvs`. `BuildObject(source)` returns `{ mesh }`.
  - **Base mesh:** `{ id, meta: { sticky, mode, nullable, particle }, transform, dimensions, display: { transform, color: null, aabb }, physics, performance: { rendering: true, localBounds } }`.
    - `meta.centerline` is a tube's world centerline, else `null`.
    - Obstacle parts add `meta.group`, and trigger volumes add `meta.trigger`.
  - **Physics:** `{ collision: { aabb, detailedBounds } }`, where the collision box is a clone of the display box. Entity parts get `physics: null`; their entity builds its own colliders.
  - **Modes:**
    - **Invisible** meshes get no geometry, except for triangle-soup collision.
    - **Void** meshes carry `geometry { positions, indices, indexCount }` and no texture.
    - **Default** meshes add `primitive`, `role`, `geometry`, `performance.renderMatrixCache` and `detail: { scatter, texture: { base, custom }, primitiveOptions }`.
  - **Texture record.** `texture.base` is `{ templateID, ...the authored look fields, registryID, faceNoiseGroups }`. `faceNoiseGroups` is `null` unless the mesh is textured per face. An image sprite's `base` is `{ registryID, faceNoiseGroups }` only. Decals live in `texture.custom`. Sprite options live in `detail.primitiveOptions.sprite` on planes.
  - **Entity parts** (role `"entity-part"`) use the geometry NewEntity passes in (`source.geometry`), or build a frozen template through `buildEntityPartGeometryTemplate`. Triplanar entity parts set `display.textureScale` per mesh.
- `NewEntity.js` — Generic entity builder, shared by non-player entities, particle groups and the player.
  - **Exports:** `NewInputFrame`, `BuildEntity`, `ClearPartGeometry`, `GetFaceCenterOffset`, `UpdateEntityModel`, `ResetEntityToDefaultPose` and `ComposeTransform`.
  - **`BuildEntity(definition, surfaceMap, textureScale, faceTextureStore)`** resolves the definition through `ResolveEntitySource`, builds the model and colliders, and returns `{ entity }`.

  **Part geometry cache.** A module-level `partGeometry` Map holds part geometry, keyed `"<blueprint>::<part>"`.
  - `buildPart` passes a cached geometry to `BuildObject` and stores the result.
  - `ClearPartGeometry()` empties it. `BuildLevel` calls it at the start, and the Simulator calls it on each `Load`.

  **The entity literal:**
  - **Identity and movement:** `{ id, type, collisionOverride, customEvents, movement, transform: { position, rotation, scale }, velocity }`.
  - **`physics`:**
    - Water: `submergence`, `medium` (`"Air"`/`"Water"`), `buoyancyForce`.
    - Contact: `grounded`, `launched`.
    - `slopes`: `{ gravityScale, staticFriction, isInLoop, isCoasting, gripDemand }`.
    - `correction`: `{ surfaceContact, surfaceNormal, alignedUp, referenceNormal, contactGrace }`.
    - `lastFrame`: `{ position, rotation, collisionKey, groundSurfaceId, resting }`.
    - `collision`: `null` when no part collides, else `{ rest, simRadiusPadding, aabb, simRadiusAabb, physics, hurtbox, hitbox }`.
  - **Facing and input:** `action`, `modelTurnRate: { air, water }`, `facing` (the authored rotation applied to forward), and `inputFrame` from `NewInputFrame()`. The input frame holds the carried heading, the control hand-off state and the loop lock.
  - **Model and runtime:** `model`, `fullAabb`, `performance: { physics, rendering, animatedTexture, collision }`, `animations`, `particle` (`null` unless a particle group), `fitsParts`, `display: { showsThroughWalls, animationRuntime }` and `pathfinding`.
  - **Combat:** every type except particles gets `combat: { hp, attacks, hitboxActive, invulnerable }`, with `hp` taken from authored `meta`. What's left of `meta` is kept only when non-empty, which today means enemies' `{ aggroRange }`.

  **Rest bounds.** `captureRestBounds` poses the model at the origin once, at build. It returns `{ full, collision }`.
  - `full` is stored as `model.restFullAabb`.
  - `collision` is `{ aabb, groundCapsule, physics, hurtbox, hitbox }`, or `null` when no part collides.
  - `computeDetailedBoundsForEntity` resolves the three layers from `collisionOverride`. `"auto"` physics resolves to `capsule` for tall boxes, else `sphere`, and sphere colliders are inscribed.

  **Placement.** `assignEntityBounds` places `fullAabb` and every collision layer from the rest set and `entity.transform`, so a collider is placed, never re-fitted. `compound-sphere` alone rebuilds from the posed model. `fitsParts` is true when any layer is `compound-sphere`, and only then does a rotation change refit part boxes.

  **Re-posing.** `UpdateEntityModel` does one of three things:
  - returns when the posed transform matches;
  - shifts every part when only position moved (`translateEntityDerivedState`);
  - otherwise recomposes through `refreshEntityDerivedState`.

  `entity.transform` shares position and rotation with `model.rootTransform`.
- `NewObstacle.js` — Obstacle builder. Exports `BuildObstacles(definitions, options)`, which returns `{ entries, groups, voidParts, meshes }`.
  - **Parts.** Every part becomes its own mesh, with id `"<obstacle>:<part>"` and `meta.group`.
  - **Groups.** Every obstacle gets a group `{ id, destructible, hp, parts }`. `parts` holds only non-void parts, so a void-only obstacle gets an empty group.
  - **Scatter.** A part without its own scatter inherits the root's when it's the first part.
- `NewTerrain.js` — Terrain builder. Exports `BuildTerrain(objects, world, faceTextureStore)`.
  - It builds one mesh per single-part definition, or one per part (id `"<object>:<part>"`) with root and local transforms composed and per-part grounding.
  - It returns `{ terrain, voidTerrain, meshes }`, where `meshes` is every mesh in authored order.
- `NewTexture.js` — Procedural 2D texture generator and visual resource manager.
  - **Patterns.** Six: `noise`, `tiles`, `stripes`, `grid`, `radial`, `linear`. Three element shapes for noise/tiles/grid cells: `circle`, `diamond` and square. `drawShape` has no `"square"` case, so `null` and any unrecognized string fall through to square.
  - **`ForEachTexturedMesh(sceneGraph, visit)`** is the single enumeration of meshes that can contribute a texture id. It visits default-mode terrain (`"terrain"`), triggers (`"plain"`), default-mode obstacle parts and entity model parts (`"detailed"`), and the water `body`/`top` (`"plain"`) when `topY` is set. `collectTextureUsage` and `handlers/game/Texture.js`'s `assignOwnerMeshes` both consume it.
  - **Other usage sources.** `collectTextureUsage` also registers every scatter batch's `textureID` and decals, and every void lining.
  - **`collectMesh`** skips meshes whose `detail.texture.base.faceNoiseGroups` is set, since `drawMeshList` binds per face group.
  - **`PrepareLevelVisualResources(sceneGraph)`** replaces `visualResources` with `{ textureRegistry, primitiveGeometry }`. `handlers/game/Texture.js` adds `textureAnimation` afterwards. The registry is the generated textures followed by the build's face textures, which win on the same id.
  - **Templates.** It imports `templates/textures.json` for the presets and `templates/scatter.json` only for its "Visual resources ready" log count.

  **Shape decals.** A shape decal's mask comes from `shapeMaskBuilders`, keyed by `shape`: `square`, `circle`, `triangle` and `pill`.
  - **Mask stretch.** The mask bakes square and is stretched to the decal's authored size. `compositeShapeDecal` therefore passes the authored aspect, and `pill` pre-divides its cap radii by it.
  - **Registering a new shape** takes three places: `shapeMaskBuilders`, `core/normalize.js`'s `shapeRequiredFields`, and `canonSchemas.json`'s `shape.allowedValues`.
  - **Compositing.** `compositeShapeDecal` resolves a decal's texture through the shared `decalTexture` schema and composites mask-last, so the pattern's own per-pixel alpha survives. `texture` keeps `detail` as a deprecated alias.
  - **Usage and identity.**
    - `collectCustomTextures(decals, mesh, usage)` walks a decal list into `customTextureUsage`. Image entries carry `opacity`, baked when below 1.
    - Decal texture keys are content-keyed (`ct.textureKey`).
    - `ComputeCustomTextureSignature` gives a batch identity for a decal list.
    - `InitializeDecalDisplay(customTextures, dimensions)` sets up each decal's runtime transform, tint and swap display fields.

  **Compositing.** Elements are painted through `fillReplacing`, which takes a `replace` flag from `resolveReplace`.
  - That reads `compositeMode`: `"replace"`, `"overlay"`, or `null` meaning derive it from `secondary.a < 1`. It's a no-op for `radial`.
  - When set, the element is erased under `destination-out` before painting under `source-over`, so a translucent element replaces the pixel beneath it.
  - Noise coverage is `1 − exp(−density × shapeFactor)`, so `speckSize` sets grain size only.
  - Frequency patterns (`tiles`, `stripes`, `grid`) carry their frequency in UV tiling. Non-frequency patterns (`noise`, `radial`) bake `density` into the canvas.

  **Face textures and ids.**
  - Per-face textures (noise only, sized to the face's UV span) are content-addressed through `buildFaceTextureSignature`. `BuildFaceTextureData(store, ...)` returns the face groups.
  - `ResolveTextureBlueprint(textureBlueprint, textureDetail)` composes density and speckSize and applies shape and colour overrides.
  - `ComputeGeneratedTextureID(baseTexture)` derives the registry id, with one segment per non-neutral override. Every field that changes the baked canvas must appear in it, because the registry is shared by id and last-writer-wins.
  - A colour object must never be interpolated into a signature string directly.

  **Resumable bakes.**
  - `BeginTextureBake(definition, textureScale)` dispatches on `bakeKind` to `BeginNoiseBake`, and `AdvanceNoiseBake(job, budget)` draws up to `budget` specks. `handlers/game/Texture.js` is the sole caller and owns pacing.
  - The synchronous `noise` case keeps its 16000-speck cap.
  - `AddToVisualResources` registers textures for objects spawned mid-session.
- `NewScatter.js` — Scatter batch generator. Exports `BuildScatterBatches` and `BuildScatterVisualResources`. Scatter types come from `templates/scatter.json`, plus any game-registered types.
  - **Placement.** `iterateScatterInstances` tries `floor(width × depth / 18 × request.density × scatterMultiplier)` candidates per scatter request over the host's display box. Each candidate is dropped when it hits any of these:
    - the `clusterThreshold` hash test;
    - the `heightMin`/`heightMax` band, tested against the host's top;
    - the host's detailed-bounds outline;
    - the `noiseScale`/`slopeMax` noise test;
    - a root-part footprint that doesn't fit the parent (`fitsParent`);
    - a footprint over an opening (open faces that reach the host's top).
  - **Model.** Each model draws one random spin (`modelYaw`), and part offsets turn with it. The handler receives `{ scatterType, instanceIndex, partContexts }`, and each part context is `{ part, position, rotation, scale }`.
  - **Low quality.** `CONFIG.Performance.Scatter.Quality === "Low"` converts every part that isn't already a crossed plane:
    - A flat part (height ≤ a tenth of its smaller side) becomes one horizontal sheet. Its `top` decals move to the front.
    - Every other part becomes a crossed pair that keeps its front and back decals.
    - `skipLow` types are skipped.
  - **The batch** (`batchMap`, keyed `${primitiveKey}_${textureID}_${customSignature}`): `{ primitive, dimensions, primitiveOptions, primitiveKey, textureID, texture: { base, custom }, instances, instanceCount }`.
    - `instances` is a list of 16-float model matrices, and `instanceCount` counts them as they're pushed.
    - `cloneScatterDecal` clones decals field by field, so batching never mutates the template.
  - **Shared geometry.** `BuildScatterVisualResources` builds one geometry per `primitiveKey`. Placement into GPU buffers and ground-square cells happens once in `Render.js`'s `buildScatterInstanceBuffers`.
- `NewParticles.js` — Particle group generator and the group lifetime classes.
  - **Exports:** `GenerateParticles`, `GeneratorPlacement`, `ParticleGeneratorRequests` and `PARTICLE_OVERRIDE_KEYS` (`count`, `spread`, `physics`, `color`, `velocity`, `duration`; `part` and `amount` are template-owned).
  - **`GenerateParticles(request, textureScale, faceTextureStore)`** returns `{ groups }`.
    - The density multiplier `PERFORMANCE_SCALING.Density.Particles[CONFIG.Performance.Particles]` scales `count`. `0` warns and builds nothing.
    - A request's first build opens `request.emitter = { mode, groups }`. Siblings share it through their request copies, so it counts every live group.
  - **Group sizing.**
    - Under 3 particles stay single. Up to 7 form three near-equal groups. Above that, a random group count is split and jittered, with groups of at most 10.
    - Layout offsets are multiples of the part's size: hand-tuned for 1–5, golden-angle sphere for 6–10.
    - Each group draws one velocity inside the spread cone, so the number of distinct trajectories is the group count.
  - **The definition** built per group:
    - `customEvents` has the 7 standard flags, all false. There's no `meta` or `attacks`.
    - `movement.physics` derives from the resolved `physics`. `"full"` gets gravity, resistance and collision; `"simple"` gets collision only; `"none"` gets nothing.
    - It spawns on a zero-origin surface.
  - **`GeneratorPlacement(generator, mesh, transform)`** returns a generator's offset from its carrier face, world position and carrier rotation.
  - **`ParticleGeneratorRequests(carrier, kind)`** turns a built terrain mesh, obstacle part or entity into generator requests, including the generator's `customEvents`. It's shared by the level build and `Simulator.Load`.

  **Group runtime (`entity.particle`).** There are three classes: `burstParticleGroup` for bursts, `seedingParticleGroup` for a generator's first group, and the base `particleGroup` otherwise. The base fields:
  - `entity`, `request` (a copy with `mode: "sibling"` and its own `position`), `physicsMode`, `halfAngle`, `target`, `targetKey`, `orphaned`.
  - `display: { color: { start, end, brightness: { variance, partOffsets } } }`. One brightness offset per part is shared by r, g and b.
  - `parent` (the carrier): `{ rotation, lastRotation, offset: { local, world } }`.
    - `rotation` is the carrier's live rotation.
    - `offset.world` is `offset.local` turned by it, recomputed only when the rotation differs from `lastRotation`.
  - `lifecycle: { duration, lifespanMs, ageMs, decayStart, finished, spawn: { origin: { position, correction }, axis } }`.

  `follow(targets)` moves the request and spawn origin with the carrier and orphans the group when the carrier is gone. `advance` ages, moves and fades the group, writing `part.mesh.display.color` and, for `"shrink"`, `entity.transform.scale`. `recycle` restarts the group at its spawn origin with a fresh direction.

  The seeding group adds `amount`, `seedClock` and `seeded`, and seeds `amount − 1` siblings over `intervalMs`. The burst group's `lifespanMs` is `endTimeMs`, and its `expire` always sets `finished`.
- `NewUI.js` — HTML UI element builder (`UIElement`). Exports `BuildElement`, `BuildElements`, `ParseHTML` and `UIElement`.
  - `ParseHTML(html, options)` converts an authored HTML string into a raw menu payload and returns it.
  - `readInlineStyles` reads each inline style property (`for...of` over `node.style`) into camelCase `styles`.
  - `collectStylesheet` gathers every `<style>` block verbatim. CSS is never parsed.
  - `droppedTags` (`script`, `style`, `link`) are skipped.
  - The output passes the same `normalizePayloadSchema` gate as hand-authored JSON.
- `NewBoss.js` — Comment-only stub. It has no code and nothing imports it. Bosses build through NewEntity as type `"boss"`.
- `NewTemplate.js` — Template-reference and repeat-expansion resolver. Exports `ResolveObjectSource(source, role)`, `ResolveEntitySource(source)` and `CloneTemplatePart(part)`.
  - Non-template sources pass through untouched.
  - **Template references** clone the boot-instanced template field by field and expand `repeat` parts (copy *i* offset by *i* steps, ids `${partId}-r${i}`). Then they merge overrides at the ref level and per authored part id, with null-sentinel precedence.
  - **Objects** take `destructible`/`hp` only for role `"obstacle"`.
  - **Entities** take each `meta` field from the ref, or from the template where the ref leaves it null. They take `collisionOverride` and the root transform the same way, and `type` from the template.
- `NewVoid.js` — Void wall builder. Exports `BuildVoidWalls({ terrain, obstacles, voids }, textureScale)`, which cuts terrain voids into terrain and obstacle voids into obstacle parts, in place.

  **Pairing.** `pairVoids` pairs each void with the hosts it cuts.
  - Hosts are `default`-mode meshes not marked `nullable: false`.
  - A host's cutting solid is built on its first box overlap with a void, then confirmed with `MeshesIntersect`.
  - Each void mesh gets `relations` (keyed by host mesh id) and `solidGrid` (its triangle grid, used for inside-the-cavity tests).
  - A relation record is `{ openFaces, voidWallMeshes }`. A void that only grazes a host still gets a record, with 0 open faces and 0 walls.

  **Cutting solids.** `buildCuttingSolid(triangles, aabb)` gives each triangle its bounds and plane, the corner vertices, a `BuildTriangleGrid` grid and a lazily filled `clearSides` array. `clearSideOf` caches which side of a wall the whole solid stays clear of, and `outsideByWall` keeps a piece whole when it stands on that side.

  **Openings and linings.** Open faces come from `clipHostSurfaceToVoid`, the host's own surface clipped to the void. They're instanced as world-space `UnitVector3` triangles.
  - `buildVoidFaces` prepares each void triangle with a cavity-facing normal (`resolveCavitySign`) and a `flipWinding` flag.
  - `buildHostLining` keeps the pieces inside the host and subtracts every neighbouring void cutting the same host, so overlapping voids produce one boundary.
  - Pairing is deferred (`queuePairing`, then `drainPairings`) so the full neighbour set per host is known.

  **The lining mesh** (`buildVoidMesh`): `{ id: "<void>-void-<host>", primitive: "void", dimensions, geometry, display: { transform, color: null, aabb }, worldAabb, floorBounds, wallBounds, detail: { texture }, performance: { renderMatrixCache, occluded } }`.
  - `dimensions` and `display.transform` are the void's own objects.
  - `display.aabb` is the same object as `worldAabb`.
  - `floorBounds` (up-facing faces) and `wallBounds` (the rest) are `"voidWall"` triangle soups, either one `null` when empty.
  - The texture copies the host's base with `faceNoiseGroups: null` and `custom: []`.
  - Noise textures get face-projected UVs. Other textures get `geometry.triplanar` and `display.textureScale: 1`.
  - `performance.occluded` is written by `Render.js`'s occlusion pass.

  **Host carving.** Hosts are cut at build time. `carveHostGeometry` rewrites the host's index buffer around its voids and appends blended vertices, so bounds are unchanged. It writes only `geometry.positions`, `uvs`, `indices` and `detail.texture.base.faceNoiseGroups`. A host's collision box still spans the trench.

  **Logging.** Two lines per build: a classification summary and a carve summary.
- `subProcesses/Occlusion.js` — Terrain blockers. Exports `BuildOccluders(terrain, voidTerrain)`, called by NewLevel after the void walls and by `handlers/game/Level.js` for spawned terrain.
  - Every terrain mesh gets `performance.occluder = { inverse, pieces }`.
  - `buildOccluder` takes the mesh's inscribed box (default mode, non-transparent textures only) and subtracts each carving void's cut boxes. The cut boxes come from the void's `solidGrid.triangles` along its `meta.centerline`.
  - It keeps the solid pieces at least `Culling.MinBlockerSize` wide. Each piece carries its local box, world corners, `worldAabb` and largest face.
- `subProcesses/Chunks.js` — Surface and collision chunks. Exports `AssembleTerrainChunks`, `AssembleCollisionChunks`, `AddChunk` and `RemoveChunkMember`.

  **`AssembleTerrainChunks(terrain, voidTerrain)`** returns `{ chunks, pieces, owner, facets, links }`.
  - Its pieces are terrain detailed-bounds facets (`boundsFacets`; AABB bounds become an OBB through `ObbFromAabb`). Facets cut by a void are dropped through `physics/Collision.js`'s `IsCutByVoid`.
  - Each terrain void's lining floor and wall triangles are added as one piece under the void's id.
  - Facets link by shared edges within a piece, and across touching pieces by `TriangleDistanceSq` ≤ `EPSILON²`. Each link records whether it's concave and its fold angle.

  **`AssembleCollisionChunks(assembled, terrain, obstacles, voids)`** returns `{ chunks, seq }`.
  - Obstacle parts join the terrain chunks they touch, and an obstacle touching two chunks merges them.
  - A chunk is `{ id, worldAabb, members }`. A member is `{ ref, type, rank, seq, aabb, linings }`, with each void lining listed under its host as `{ voidWall, sourceType, rank, seq }`.
  - `AddChunk` gives spawned terrain or obstacles their own chunk. `RemoveChunkMember` takes one out and refits.
- `subProcesses/Loops.js` — Loop surfaces. Exports `FindLoops(assembled, meshes)`, which returns `{ loopSurfaces: { Air, Water }, tubeCenterlines }`.
  - **Loops.** Per medium, take the components joined by concave folds within `MaxAngleDelta.Ground` that hold both a floor and a ceiling (≥ `CAMERA_TUNING.Loops.MinCurveThreshold`). The steeper-than-ground parts that reach the ceiling are the loops.
  - **Radius.** Each loop takes its median `foldRadius` as a CNU Unit, or `Infinity` with no folds.
  - **Tubes.** `tubeCenterlines` maps a terrain or void-terrain surface id to its centerline. Obstacles are not loop surfaces.
- `templates/` — JSON blueprint data, each collection keyed by id:
  - **Collections:** `characters.json`, `enemies.json`, `projectiles.json`, `terrain.json`, `obstacles.json`, `particles.json`, `levels.json` (the Simulator's level), `textures.json` (texture presets, top level) and `scatter.json` (scatter types, top level). `player/characters.json` is canonicalized alongside them.
  - **`Instance.js`** exports `InstanceEngineTemplates`, `RegisterGameTemplates` and `ClearGameTemplates`.
    - `InstanceEngineTemplates()` runs once at boot. It `structuredClone`s the eight engine collections (`PlayerCharacters`, `Terrain`, `Obstacles`, `Characters`, `Enemies`, `Projectiles`, `Particles`, `Scatter`) into `raw`, the authored shape behind `ENGINE.Blueprints`.
    - It then Unit-instances the originals in place (`instanced`), covering characters, scatter parts, object, entity and particle templates and the Simulator's level.
    - `loadTemplateDecalBitmaps` starts an image load for every image decal and sprite image, player characters included.
    - `RegisterGameTemplates` writes a level's game templates into the instanced collections, with `npcs` filling characters and enemies. `ClearGameTemplates` restores any engine entries they replaced.

## Boundaries
**Called by:**
- `handlers/` (`Level.js`, `Simulator.js` and the game handlers).
- `physics/Master.js` and `handlers/game/Performance.js` import `UpdateEntityModel`.
- `player/` imports `BuildEntity`, `NewInputFrame` and `UpdateEntityModel`.
- `NewParticles.js` is called by NewLevel at build time and by `handlers/game/Level.js` and `Simulator.js` at runtime.

**Calls into:** `math/` (Matrix, Vector3, Utilities, Collision, Geometry, Curves) and `core/` (meta, config). `subProcesses/Chunks.js` imports `IsCutByVoid` from `physics/Collision.js`. NewTemplate imports the template collections directly; these are the boot-instanced singletons Instance.js mutates in place.

**Does not:** drive update loops, or write to the DOM or WebGL directly. All output is consumed downstream by `Render.js`.

## Invariants
- Builders produce scene output objects from scene input. Callers supply `faceTextureStore`, and builders write into it. The level build's store becomes `visualResources.textureRegistry`, and runtime spawns pass the live registry.
- The `sceneGraph` produced by NewLevel is the authoritative scene representation shared by the renderer and the physics pipeline.
- Builders attach `performance` blocks at construction, fully populated, so consumers read them unguarded. That covers every `BuildObject` mesh, void linings, scatter cells (in Render) and entities. Default-mode meshes and void linings carry `performance.renderMatrixCache`.
- The `renderMatrixCache` snapshot is by value, not by reference.
- Non-template definitions are never touched by NewTemplate's resolvers. `repeat` is template-authoring-only.
- **Void relations:** `relations[hostMeshId] = { openFaces, voidWallMeshes }` on every void mesh, always initialized. Collision treats a record's existence as the void cancelling that host (`Object.hasOwn`).
- **Build order is load-bearing:**
  1. terrain and obstacles;
  2. `BuildVoidWalls`;
  3. `BuildOccluders`, which needs the void relations;
  4. terrain chunks, loops and collision chunks;
  5. the open-face lookup;
  6. scatter batches, which reject samples over openings.
- **Particle generators** resolve at build time. NewLevel sweeps terrain meshes, obstacle part meshes and entities into one request list before generating, because generation pushes groups into the same `entities` array. `mesh.meta.particle` is always present (`null` or a generator). Runtime-spawned entities don't create their part generators (see `DEFERRED.md`).
- **Particle groups** are ordinary entities in `sceneGraph.entities`. `entity.particle !== null` and `type === "particle"` identify them, and `"particle"` is absent from `ENTITY_TYPES`.
  - Part geometry is keyed by template id with part ids `p0..p9`, so per-particle size variation must go through `localScale`, never `dimensions`.
- **Particle physics.** The resolved `physics` mode is the sole authority over a group's physics flags. For `"none"`, `Level.js` skips the pipeline and the group integrates its own position.
- **Particle tick writes.** The tick writes `entity.transform.position`/`.scale`, `entity.velocity` and `part.mesh.display.color` only. Part transforms and boxes are recomputed by the entity re-pose.
- **`count` and `amount`** are orthogonal. `count` is one emission split across in-phase groups. `amount` is how many phase-offset emissions are alive at once. The performance tier scales `count` only. Generator groups recycle rather than despawn.
- A `mode: "void"` object must be a closed solid. `core/normalize.js` drops one built from an open primitive.
- **Tubes.** A node's `localRotation` defines the tangent at that node, shared by the connectors on either side. A node owns only the connector that departs it, so `curved`/`smoothness` on the final node are never read. `buildTube` reuses `resolveCylinderSegments(complexity)` for rings and connector samples.
