# Module Groups

The engine is organized into module groups, each with a defined responsibility and set of access rules. Every engine file belongs to at most exactly one group. These groupings dictate who can call whom and where logic should live.

---

## 1. `player/`

All scripts pertaining to the player character.

- **Called by**: Handlers.
- **Managed by**: `Master.js` — the central coordinator for player state and lifecycle.
- **Contains**: Player state management, movement logic, abilities, animation, model synchronization.
- **Does not**: Manage its own update loop. Handlers call into the player pipeline at the appropriate time.

---

## 2. `physics/`

All logic belonging to the physics pipeline.

- **Called by**: Physics handler (`handlers/game/Physics.js`).
- **Contains**: Gravity, collision detection, alignment correction, buoyancy, resistance, water currents.
- **Does not**: Read input, manage state, or drive its own update loop. It receives state and returns results.

---

## 3. `math/`

All math helper functions needed by multiple files.

- **Can be accessed**: Anywhere at will — no restrictions on who imports from `math/`.
- **May import/export**: Anywhere at will — math is a global helper layer on par with `core/`.
- **Contains**: Vector operations, unit conversion classes (`Unit`, `UnitVector3`), interpolation functions (`Lerp`, `SmoothStep`), clamping (`Clamp`), number parsing (`ToNumber`), physics math (ray-AABB intersection), curve utilities.
- **Does not**: Hold state or perform side effects. Math remains pure and stateless even when it imports shared engine primitives or constants.

---

## 4. `handlers/`

State managers. These orchestrate the behaviours of other module groups.

- **Role**: Most pipelines start here. Handlers manage the lifecycle and update flow of their respective systems.
- **Contains**: Level handler, camera handler, renderer, sound handler, UI handler, controls handler, physics handler, cutscene handler, entity animation handler, entity behaviour handlers.
- **Calls into**: `player/`, `physics/`, `builder/`, `cutscene/`, `math/`, `core/`.
- **Does not**: Implement low-level logic directly. Handlers delegate to the appropriate module group and coordinate results.

### Sub-structure

- `handlers/game/` — Handlers specific to in-game (level) state: `Level.js`, `Camera.js`, `Physics.js`, `Enemy.js`, `Collectible.js`, `Animation.js`, `Boss.js`, `Texture.js`.
- `handlers/menu/` — Handlers for menu state: `Credits.js`, `LoadScreen.js`, `Splash.js`.
- `handlers/` (root) — Cross-cutting handlers: `Render.js`, `Sound.js`, `UI.js`, `Controls.js`, `Cutscene.js`.

---

## 5. `cutscene/`

All logic belonging to the cutscene pipeline.

- **Called by**: Cutscene handler (`handlers/Cutscene.js`).
- **Contains**: Scene sequencing, actor management, animation scripting, audio synchronization.
- **Does not**: Manage its own lifecycle. The cutscene handler drives playback and coordinates with other systems.

---

## 6. `core/`

Anything of critical importance to the functionality of the engine.

- **Role**: Foundation layer. Everything else depends on `core/`, but `core/` should minimize dependencies on other groups.
- **Contains**:
  - **Configs** — `config.js`: Runtime configuration values.
  - **Debug switches** — Declared in config and exposed through ini.
  - **Custom Event API** — `meta.js:SendEvent`: Engine-to-game communication.
  - **Custom Logging API** — `meta.js:Log`: Centralized, channel-aware logging.
  - **Helper functions** — `meta.js`: Cursor control, pointer lock, session storage, wait utilities.
  - **Payload validation** — `validate.js`: Structural validation of incoming game payloads.
  - **Data normalization** — `normalize.js`: Unit instancing of raw payload values.
  - **Engine API initialization & export** — `ini.js`: Bootstraps the engine and returns the public API surface.
- **Does not**: Contain game-specific logic, rendering code, or physics calculations.

---

## 7. `builder/`

All logic for building anything visuals-related.

- **Called by**: Handlers.
- **Contains**: Mesh construction (`NewObject.js`), entity building (`NewEntity.js`), obstacle building (`NewObstacle.js`), scatter/detail generation (`NewScatter.js`), texture/material management (`NewTexture.js`), level assembly (`NewLevel.js`), UI building (`NewUI.js`).
- **The rendering pipeline depends on these** — builders produce the mesh and scene data that the renderer consumes.
- **Does not**: Manage state or drive update loops. Builders are called, produce output, and return.

---

## Dependency Direction

```
core/          ← shared foundation layer
math/          ← shared helper layer
  ↑
physics/       ← called by handlers
player/        ← called by handlers
cutscene/      ← called by handlers
builder/       ← called by handlers
  ↑
handlers/      ← top-level orchestrators
```

Most dependencies flow upward through these shared layers. `core/` and `math/` may be used across the engine as needed. `handlers/` still sits at the top and coordinates everything below.

Modules within the same tier may import from each other freely. The one-directional restriction applies only across tier boundaries — lower tiers must not import from higher tiers.

### Approved Exception: `core/normalize.js`

- `core/normalize.js` may import static template JSON from `builder/templates/` strictly for payload canonicalization at the boundary.
- This exception applies only to normalization-time lookups of allowed IDs/defaults.
- `core/normalize.js` must not call builder runtime functions or depend on builder execution flow.
- This exception does not apply to any other `core/` module.

---

### Nested Directories

Nested directories belong to their parent module group by default. `builder/templates/` is part of `builder/`. A sub-directory is only a separate module group if it is explicitly declared as one in this document.

---

## Placement Rule

When adding new code, ask:

1. Is it a pure math or conversion utility? → `math/`
2. Is it about validating, configuring, or initializing the engine? → `core/`
3. Is it about constructing visual/mesh data? → `builder/`
4. Is it about the player character? → `player/`
5. Is it about physical forces or collision? → `physics/`
6. Is it about cutscene sequencing? → `cutscene/`
7. Is it about anything else? → probably `handlers/`

---

## testGame/

`engine/v1/testGame/` is not an engine module. It is a game stored inside the engine directory for testing and showcase purposes. It is exempt from all module group rules. Its only constraint is the game communication contract: it may interact with the engine exclusively through the `ENGINE` API exposed by `ini.js` and `Bootup.js`.
