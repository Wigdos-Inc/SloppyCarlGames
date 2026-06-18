# builder/ — Scene and Asset Construction

## Responsibility
Constructs all visual and structural scene data: 3D WebGL meshes, entity models, obstacles, terrain, null-space void walls, procedural textures, scatter details, UI element trees, and the full level scene graph. Builders are called by handlers (and in one case by physics), produce output objects, and return. They hold no persistent state and drive no update loops.

## Files
- `NewLevel.js` — Level scene graph assembler. `BuildLevel` is the primary entry point. Orchestrates all other builders to produce the complete `sceneGraph` object consumed by the renderer and physics pipeline. Also exports `RefreshSceneBoundingBoxes`.
- `NewObject.js` — Primitive 3D mesh builder. Generates WebGL geometry (positions, normals, UVs, indices) for mesh primitives. Foundation for all other geometry builders. Exports `GenerateUVs` and `TransformPointByMatrix` (used by `NewVoid.js`).
- `NewEntity.js` — Generic animated entity builder (`BuildEntity`). Constructs multi-part entity models with collision profiles. Exports `UpdateEntityModelFromTransform` for post-physics model synchronization.
- `NewObstacle.js` — Obstacle mesh builder (`BuildObstacles`). Constructs obstacle geometry for scene placement. Each obstacle record carries a `worldAabb` (renamed from `bounds` in v0.20, unifying AABB naming with terrain meshes).
- `NewTexture.js` — Procedural texture mapping onto meshes. Manages visual resource preparation and registration (`PrepareLevelVisualResources`, `AddToVisualResources`).
- `NewScatter.js` — Procedurally generated multi-part static scatter objects placed on terrain surfaces. Each object's open faces (from null-space relations, see `NewVoid.js`) are threaded through to `iterateScatterInstances`, which rejects any sample whose XZ footprint AABB overlaps a top-relevant open face's XZ AABB (conservative AABB-vs-AABB, reusing the footprint math shared with the parent-bounds check) so scatter is not generated over openings. Only root parts (`level === 0`) are footprint-checked.
- `NewUI.js` — HTML UI element builder (`UIElement`). Produces DOM element trees consumed by `Render.js`.
- `NewBoss.js` — Boss entity builder. Specializes entity construction for boss characters.
- `NewTerrain.js` — Terrain builder entry point. Currently an empty placeholder — exports no functional builders.
- `NewVoid.js` — Null-space void wall builder (`BuildVoidWalls`). `classifyFaces` partitions each null-space mesh's faces using AABB overlap and narrowphase tests, returning `{ groups, openFacesByMesh }`: embedded faces (inside a default mesh) become renderable void walls, while open/touching faces are retained as world-space `Triangle`s (`UnitVector3`, instanced at this boundary). Rather than returning flat arrays, the builder attaches a per-pair `relations` map onto each null-space entry in place and returns only `{ faceTextures }`. Called post-build by `NewLevel.js`.
- `templates/` — JSON blueprint data: `characters.json`, `enemies.json`, `levels.json`, `obstacleBlueprints.json`, `projectiles.json`, `terrainBlueprints.json`, `textures.json`. Treated as part of the builder group; `core/normalize.js` may import from here for payload canonicalization (documented exception in MODULE_GROUPS.md).

## Boundaries
**Called by:** `handlers/` (Level.js, Cutscene.js, and game-layer handlers call builders to construct scene content); `physics/Master.js` imports `UpdateEntityModelFromTransform` from `NewEntity.js` for post-physics model sync.  
**Calls into:** `math/` (Matrix, Vector3, Utilities, Collision); `physics/Collision.js` (`NewVoid.js` uses `NarrowphaseTest`); `core/` (meta, config).  
**Does not:** Manage persistent state, drive update loops, or write to the DOM or WebGL directly — all output is consumed downstream by `Render.js`.

## Invariants
- Builders are pure constructors: given scene input data, they produce scene output objects. They do not cache or mutate persistent engine state.
- The `sceneGraph` produced by `NewLevel.js` is the authoritative scene representation shared by the renderer and the physics pipeline.
- `NewTerrain.js` is currently a placeholder and contributes no runtime behavior.
- Null-space data lives in a per-pair `relations` map on each null-space entry (terrain mesh or obstacle record): `relations[relatedObjectId] = { suppressed, openFaces: Triangle[], voidWallMeshes: VoidWallMesh[] }`. `relatedObjectId` is a terrain mesh id or an obstacle *record* id (never a part id); `relations` is always initialized (`{}` at minimum) so readers never guard the container. This replaces the removed `sceneGraph.voidWalls.{terrain,obstacles}` arrays and the removed `suppressedCandidateIds` sets (suppression is now `relations[id].suppressed`).
- Build order in `NewLevel.js` is load-bearing: terrain and obstacles are built first, then `BuildVoidWalls` runs (attaching `relations`, collecting `faceTextures`), then an `openFaces` lookup (`Map<defaultObjectId, Triangle[]>`) is assembled from the relations, and only then are scatter batches enqueued. Scatter must run after void walls so it can reject samples over openings — it is no longer enqueued inline during terrain/obstacle construction.
- Consumers read the `relations` model directly: `physics/Collision.js`, `handlers/Render.js`, and `handlers/game/Camera.js` iterate `relations → voidWallMeshes` (and `openFaces` for the stencil) instead of the removed flat arrays. The `Render.js` stencil pass also draws open faces (world-space tris, identity model matrix) with a negative `polygonOffset` to suppress coplanar z-fighting.
