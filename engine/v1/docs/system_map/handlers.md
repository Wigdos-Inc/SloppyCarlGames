# handlers/ — Orchestration Layer

## Responsibility
Top-level state managers. Handlers orchestrate the lifecycle and update flow of all other module groups. Most engine pipelines originate here. Handlers delegate low-level work to physics/, player/, builder/, cutscene/, and math/; they coordinate results rather than implementing logic directly.

## Files

### Root (cross-cutting handlers)
- `Render.js` — The sole module permitted to display visual content to the browser. All visual pipelines — DOM UI and WebGL level rendering — end here. Consumes scene graphs produced by builders and element trees from `NewUI.js`. Entity parts are split by `collectRenderableMeshes` into `entitiesUv`/`entitiesTriplanar` (keyed on `mesh.geometry.triplanar`) and drawn via two `drawMeshList` passes; the triplanar pass binds `renderer.entityTriplanarShader` — object-space triplanar sampling of the shared baked noise canvas, blended by a screen-derivative face normal — instead of the standard UV shader, for noise-textured entity parts that would otherwise collapse to flat color at entity scale. Decals (custom textures) draw in a dedicated `drawDecalPass` via `renderer.decalShader`: a tessellated quad grid (`ensureDecalQuadBuffer`) is projected onto the underlying primitive surface in the vertex shader (`projectToSurface`, mirroring `buildSphere`/`buildCylinder`/`buildCapsule` in `builder/NewObject.js`) after `buildDecalPlacementMatrix` positions the quad in part-local space; `u_partWorld` is applied after conforming so the runtime decal transform/tint/swap animation channels stay dynamic rather than baked. Pass-level uniforms (projection/view/fog/colorShift/underwater) for every textured pass are set once via the shared `configureTexturedMeshPass`; `drawDecalPass` sets per-mesh decal uniforms (`u_partWorld`/`u_shape`/`u_halfExtents`/sampler slot) once per mesh while placement/tint/texture-bind stay per-decal. Matrix composition throughout uses `MultiplyMatrix4` (`math/Matrix.js`).
- `Controls.js` — Input router. Attaches to DOM events, routes keyboard and pointer input to the active context (level, UI, or game passthrough). Exports `Controls` class and `StartInputRouter`.
- `Sound.js` — Sound manager. Loads, plays, and controls all audio: music, SFX, voice, cutscene audio. Exports granular play/pause/stop/volume functions surfaced through the ENGINE API.
- `UI.js` — UI state manager. Applies UI payloads to the screen, manages screen transitions, wraps `Render.js` for UI rendering and `NewUI.js` for element construction.
- `Cutscene.js` — Cutscene handler. Drives both engine cutscenes and pre-rendered (video) cutscenes. Coordinates the `cutscene/` module group.

### handlers/game/ (in-game state handlers)
- `Level.js` — Level lifecycle and orchestration. The main game loop. Receives validated/normalized level payloads, builds the scene via `builder/NewLevel.js`, runs the per-frame update loop: player update, physics pipeline, enemy behavior, collectible pickups, camera update, entity animation, and rendering. `SpawnIntoScene` passes `sceneGraph.visualResources.textureRegistry` as the `faceTextureStore` for runtime entity and obstacle builds (new face textures dedup against already-resident entries) and passes `sceneGraph.partGeometryCache` to `BuildEntity` for geometry reuse across same-blueprint spawns.
- `Camera.js` — Camera state for in-game levels. Two modes: **FreeCam** (debug only; requires both `CONFIG.DEBUG.ALL` and `CONFIG.DEBUG.LEVELS.FreeCam`; WASD/arrow-key flight, mouse look via pointer lock, scroll-wheel speed tuning via `applyTuningStep`, position persisted per level/stage key across same-session level visits) and **DefaultCam** (third-person orbit follow; yaw/pitch via mouse drag or arrow keys, obstruction detection against terrain/obstacles/void walls with smooth pull-in distance interpolation). `GetCameraVectors` returns the latest cached `{ forward, right }` for player movement orientation. Exports `InitializeCameraState`, `UpdateCameraState`, `HandleFreeCamInput`, `HandleDefaultCamInput`, `GetCameraVectors`.
- `Animation.js` — Entity animation handler. Drives animation state transitions for non-player entities based on their current state each frame.
- `Enemy.js` — Enemy behavior handler. Per-frame enemy AI and collision response.
- `Collectible.js` — Collectible item behavior. Pickup detection and item state management.
- `Boss.js` — Boss behavior handler.
- `Simulator.js` — Simulator mode lifecycle and live scene preview orchestration. Integrated with Level.js via `IsSimulatorActive` and `UpdateSimulator`. `Load` resets `sceneGraph.partGeometryCache` to a fresh `Map` on each load so edited blueprints under a stable id always rebuild their geometry.
- `Texture.js` — Animated texture state manager. Per animated texture entry, tracks a hold/blend phase cycle: hold waits for `holdDurationMs`, then generates a new target surface (`BuildNoiseFaceCanvas` for face textures, `BuildTextureSurface` for all others) and blends alpha from the previous surface to the new one over `blendDurationMs`. Blend progress is written back to `textureEntry.source` each frame; `dirty` is set so the renderer re-uploads the canvas. `AddTextureAnimationEntries` registers newly spawned textures mid-session without reinitializing the whole map. Exports `InitializeTextureAnimation`, `UpdateTextureAnimation`, `AddTextureAnimationEntries`.

### handlers/menu/ (menu state handlers)
- `Splash.js` — Splash screen sequence management. Coordinates with `Bootup.js` for the startup splash flow via `AcceptSplashPayload` and `ApplySplashScreenSequence`.
- `LoadScreen.js` — Loading screen display logic.
- `Credits.js` — Credits screen UI and behavior.

## Boundaries
**Called by:** `Bootup.js` and `ini.js` for initialization; game code via the `ENGINE` API at runtime.  
**Calls into:** `player/`, `physics/`, `builder/`, `cutscene/`, `math/`, `core/`.  
**Does not:** Implement physics math, mesh construction, or vector math directly — these are always delegated to the appropriate group.

## Invariants
- `Render.js` is the exclusive rendering boundary. No other module writes to the DOM or WebGL context for display purposes.
- `Level.js` owns the main game loop (`requestAnimationFrame`) and is the single entry point for all per-frame game state updates.
- `ENGINE` (assembled by `ini.js`) is the exclusive interface between game code and the engine. Game code does not import engine modules directly.
- `handlers/game/Level.js` is the direct caller of `physics/Master.js`. There is no intermediary Physics handler file in the current source.
