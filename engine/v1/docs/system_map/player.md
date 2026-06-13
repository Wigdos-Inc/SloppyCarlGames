# player/ — Player Character

## Responsibility
Owns all player state, movement logic, model representation, abilities, and animation. `Master.js` is the central coordinator. Handlers call into it to drive per-frame updates; physics calls into it to sync model state after physics resolution.

## Files
- `Master.js` — Player state manager. Creates and holds the single player state object. Exports `InitializePlayer`, `UpdatePlayer`, `ResolvePlayerState`, `GetPlayerState`, `TriggerPlayerRespawnSequence`, and `PlayerAPI` (the `ENGINE.Level.Player` public surface). Instances character templates from `characters.json` at module load via a top-level IIFE.
- `Movement.js` — Per-frame movement handler. Translates input flags into velocity and displacement deltas.
- `Model.js` — Player mesh representation. Builds and maintains the player WebGL model. Exports `BuildPlayerModel`, `InitializePlayerCollisionProfile`, `SyncPlayerCollisionFromState`, `UpdatePlayerModelFromState`.
- `Abilities.js` — Player ability definitions (jump, boost, etc.) and application logic. Accepts ability handler callbacks from game code.
- `Animation.js` — Player-specific animation handler. Drives visual state transitions based on player movement and action state.
- `characters.json` — Character preset definitions. Raw numeric values are instanced into `Unit`/`UnitVector3` by `Master.js` at module load; downstream code receives pre-instanced values.

## Boundaries
**Called by:** `handlers/game/Level.js` (`InitializePlayer`, `UpdatePlayer`, `ResolvePlayerState`, `GetPlayerState`); `physics/Master.js` (`TriggerPlayerRespawnSequence`, `UpdatePlayerModelFromState`, `SyncPlayerCollisionFromState`).  
**Calls into:** `math/` (Utilities, Vector3); `core/` (meta, config, normalize).  
**Does not:** Manage its own update loop; drive rendering directly (model updates are consumed by `Render.js`); apply physics forces (those are applied by `physics/Master.js`).

## Invariants
- There is one player state object in the engine at a time, held in `Master.js`.
- `playerInputFlags` is written by game code each frame via `ENGINE.Level.Player.Input` and read by the player update each frame.
- `characters.json` values are instanced once at module load by the top-level IIFE in `Master.js`. No downstream code re-instances them.
