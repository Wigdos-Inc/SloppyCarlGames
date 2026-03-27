# Forbidden Defensive Checks

These rules define where defensive checks are forbidden inside engine code.

The engine has guaranteed internal contracts. If an internal contract is violated, the failure must surface immediately and be fixed at the source. Do not hide contract bugs with downstream guards.

---

## 1. Core Rule

Defensive existence/type checks are forbidden for guaranteed in-engine symbols.

If a symbol is engine-owned and guaranteed by initialization/normalization, do not guard it with `if (!x)`, `x && y`, or `typeof` checks.

Forbidden examples:

```js
if (!CONFIG || !CONFIG.DEBUG) { ... }
const debug = CONFIG && CONFIG.DEBUG ? CONFIG.DEBUG : null;
const world = sceneGraph && sceneGraph.world ? sceneGraph.world : {};
if (!playerState || !playerState.active) { return; }
```

Required behavior:

```js
if (!CONFIG.DEBUG.ALL) { ... }
const world = sceneGraph.world;
if (!playerState.active) { return; }
```

---

## 2. Guaranteed In-Engine Symbols

The following are treated as guaranteed unless explicitly documented otherwise:

- `CONFIG` and its engine-defined subtrees used by a module.
- `sceneGraph` in runtime game/render/update paths after level creation.
- `playerState` in player/game runtime paths after player initialization.
- `entity` structure in runtime entity loops after builder output.
- Engine API symbols imported from engine modules.
- Anything else that was declared upstream and passed along.

If one of these is missing, that is an upstream bug.

---

## 3. Forbidden Pattern Families

### A. Existence Chains on Guaranteed Symbols

```js
CONFIG && CONFIG.DEBUG && CONFIG.DEBUG.ALL
sceneGraph && sceneGraph.cameraConfig && sceneGraph.cameraConfig.state
playerState && playerState.transform
entity && entity.collision && entity.collision.aabb
```

### B. Fallback Object Substitution for Guaranteed Symbols

```js
const world = sceneGraph && sceneGraph.world ? sceneGraph.world : {};
const config = CONFIG && CONFIG.PHYSICS ? CONFIG.PHYSICS.Buoyancy : {};
```

### C. Defensive `typeof` on Guaranteed Internal Methods/Objects

```js
typeof CONFIG.VOLUME.Cutscene === "number" // when Cutscene volume is a guaranteed config field
typeof internalFn === "function" // when internalFn is guaranteed by module contract
```

---

## 4. Where to Fix Instead

When an expected symbol is missing, fix one of these upstream layers:

1. `core/validate.js` and `core/normalize.js` for inbound payload shape.
2. Builder output contracts for runtime scene/entity structure.
3. Engine initialization contracts (`core/ini.js`, boot sequence, static config shape).

Never patch over upstream contract bugs with downstream guards.

---

## 5. Allowed Exceptions

These are explicitly allowed and are not violations:

### A. External Input Boundary Checks

Validation of game-provided/raw input payloads is allowed in boundary modules:

- `core/validate.js`
- `core/normalize.js`
- other explicit entry-point validators

These checks may only appear once on arrival or first usage and should never be repeated.

### B. Explicitly Approved Initialization Guards

If a guard is intentionally retained for initialization bootstrap (for example, controlled cache bootstrap in core meta state), it is allowed only where explicitly approved by rule decision.

---

## 6. Fail-Fast Policy

If a guaranteed symbol is missing, allow the natural exception to surface.

Do not swallow, coerce, or default around the failure in downstream runtime modules.
Deliberate fail-fast error throwing is not allowed. Errors must naturally surface, not be induced.

This keeps bugs visible and forces fixes at the correct architectural boundary.

---

## 7. Examples: Bad vs Good

### Config access

Bad:

```js
const freeCamEnabled = Boolean(CONFIG && CONFIG.DEBUG && CONFIG.DEBUG.LEVELS && CONFIG.DEBUG.LEVELS.FreeCam === true);
```

Good:

```js
const freeCamEnabled = Boolean(CONFIG.DEBUG.LEVELS.FreeCam === true);
```
or
```js
const freeCamEnabled = !!(CONFIG.DEBUG.LEVELS.FreeCam === true);
```

### Scene graph access

Bad:

```js
const entities = Array.isArray(sceneGraph && sceneGraph.entities) ? sceneGraph.entities : [];
```

Good:

```js
const entities = sceneGraph.entities;
```

### Player state access

Bad:

```js
if (!playerState || !playerState.active) { return; }
```

Good:

```js
if (!playerState.active) { return; }
```

### Fail-Fast Handling

Bad:
```js
const entity = payload?.entity;
if (!entity) throw new Error(...);
```

Good:
```js
const entity = payload.entity;

// code using entity as if it's canon...
// Error will naturally surface if entity is malformed or missing
```

---

## 8. Relationship to Other Rules

- Use this together with `rules/UNIT_INSTANCING.md` (no downstream fallback instancing).
- Respect `rules/MODULE_GROUPS.md` when moving checks upstream.
- Respect `rules/ENGINE_GAME_COMMUNICATION.md` when handling boundary events.

---

## Summary Table

| Context                                                 | Defensive Checks Allowed? |
|---------------------------------------------------------|---------------------------|
| Internal runtime modules on guaranteed engine symbols   | No                        |
| Browser/runtime environment detection                   | No                        |
| External payload validation/normalization boundaries    | Yes, once                 |
| Explicitly approved initialization exceptions           | Yes                       |

