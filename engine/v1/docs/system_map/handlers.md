# handlers/ — Orchestration Layer

## Responsibility
Top-level state managers. Handlers orchestrate the lifecycle and update flow of all other module groups. Most engine pipelines originate here. Handlers delegate low-level work to physics/, player/, builder/, cutscene/, and math/; they coordinate results rather than implementing logic directly.

## Files

### Root (cross-cutting handlers)
- `Render.js` — The sole module permitted to display visual content to the browser. All visual pipelines — DOM UI and WebGL level rendering — end here. Consumes scene graphs produced by builders and element trees from `NewUI.js`.
- `Controls.js` — Input router. Attaches to DOM events, routes keyboard and pointer input to the active context (level, UI, or game passthrough). Exports `Controls` class and `StartInputRouter`.
- `Sound.js` — Sound manager. Loads, plays, and controls all audio: music, SFX, voice, cutscene audio. Exports granular play/pause/stop/volume functions surfaced through the ENGINE API.
- `UI.js` — UI state manager. Applies UI payloads to the screen, manages screen transitions, wraps `Render.js` for UI rendering and `NewUI.js` for element construction.
- `Cutscene.js` — Cutscene handler. Drives both engine cutscenes and pre-rendered (video) cutscenes. Coordinates the `cutscene/` module group.

### handlers/game/ (in-game state handlers)
- `Level.js` — Level lifecycle and orchestration. The main game loop. Receives validated/normalized level payloads, builds the scene via `builder/NewLevel.js`, runs the per-frame update loop: player update, physics pipeline, enemy behavior, collectible pickups, camera update, entity animation, and rendering.
- `Camera.js` — Camera state for levels and cutscenes. Manages position, target, FOV, and transition states. Exports `InitializeCameraState`, `UpdateCameraState`, `GetCameraVectors`.
- `Animation.js` — Entity animation handler. Drives animation state transitions for non-player entities based on their current state each frame.
- `Enemy.js` — Enemy behavior handler. Per-frame enemy AI and collision response.
- `Collectible.js` — Collectible item behavior. Pickup detection and item state management.
- `Boss.js` — Boss behavior handler.
- `Simulator.js` — Simulator mode lifecycle and live scene preview orchestration. Integrated with Level.js via `IsSimulatorActive` and `UpdateSimulator`.
- `Texture.js` — Custom texture loading onto scene meshes and per-frame animated texture frame updates.

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
