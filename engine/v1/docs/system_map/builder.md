# builder/ — Scene and Asset Construction

## Responsibility
Constructs all visual and structural scene data: 3D WebGL meshes, entity models, obstacles, terrain, void walls, procedural textures, scatter details, UI element trees, and the full level scene graph. Builders are called by handlers (and in one case by physics), produce output objects, and return. They hold no persistent state and drive no update loops.

## Files
- `NewLevel.js` — Level scene graph assembler. `BuildLevel` is the primary entry point. Orchestrates all other builders to produce the complete `sceneGraph` object consumed by the renderer and physics pipeline. Also exports `RefreshSceneBoundingBoxes`.
- `NewObject.js` — Primitive 3D mesh builder. Generates WebGL geometry (positions, normals, UVs, indices) for mesh primitives. Foundation for all other geometry builders. Exports `GenerateUVs` and `TransformPointByMatrix` (used by `NewVoid.js`).
- `NewEntity.js` — Generic animated entity builder (`BuildEntity`). Constructs multi-part entity models with collision profiles. Exports `UpdateEntityModelFromTransform` for post-physics model synchronization.
- `NewObstacle.js` — Obstacle mesh builder (`BuildObstacles`). Constructs obstacle geometry for scene placement.
- `NewTexture.js` — Procedural texture mapping onto meshes. Manages visual resource preparation and registration (`PrepareLevelVisualResources`, `AddToVisualResources`).
- `NewScatter.js` — Procedurally generated multi-part static scatter objects placed on terrain surfaces.
- `NewUI.js` — HTML UI element builder (`UIElement`). Produces DOM element trees consumed by `Render.js`.
- `NewBoss.js` — Boss entity builder. Specializes entity construction for boss characters.
- `NewTerrain.js` — Terrain builder entry point. Currently an empty placeholder — exports no functional builders.
- `NewVoid.js` — Null-space void wall builder (`BuildVoidWalls`). Classifies null-space mesh faces as embedded vs open using AABB overlap and narrowphase tests, then constructs renderable void wall meshes. Called post-build by `NewLevel.js` to populate `sceneGraph.voidWalls`.
- `templates/` — JSON blueprint data: `characters.json`, `enemies.json`, `levels.json`, `obstacleBlueprints.json`, `projectiles.json`, `terrainBlueprints.json`, `textures.json`. Treated as part of the builder group; `core/normalize.js` may import from here for payload canonicalization (documented exception in MODULE_GROUPS.md).

## Boundaries
**Called by:** `handlers/` (Level.js, Cutscene.js, and game-layer handlers call builders to construct scene content); `physics/Master.js` imports `UpdateEntityModelFromTransform` from `NewEntity.js` for post-physics model sync.  
**Calls into:** `math/` (Matrix, Vector3, Utilities, Collision); `physics/Collision.js` (`NewVoid.js` uses `NarrowphaseTest`); `core/` (meta, config).  
**Does not:** Manage persistent state, drive update loops, or write to the DOM or WebGL directly — all output is consumed downstream by `Render.js`.

## Invariants
- Builders are pure constructors: given scene input data, they produce scene output objects. They do not cache or mutate persistent engine state.
- The `sceneGraph` produced by `NewLevel.js` is the authoritative scene representation shared by the renderer and the physics pipeline.
- `NewTerrain.js` is currently a placeholder and contributes no runtime behavior.
- `NewVoid.js` is called by `NewLevel.js` after the main scene graph is assembled, populating `sceneGraph.voidWalls.terrain` and `sceneGraph.voidWalls.obstacles`.
