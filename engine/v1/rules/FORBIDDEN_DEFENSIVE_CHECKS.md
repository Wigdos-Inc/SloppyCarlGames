# Forbidden Defensive Checks

These rules define where defensive checks are forbidden inside engine code.

The engine has guaranteed internal contracts. If an internal contract is violated, the failure must surface immediately and be fixed at the source. Do not hide contract bugs with downstream guards.

---

## 1. Core Rule

Defensive existence/type checks are forbidden for guaranteed in-engine symbols.

If a symbol is engine-owned and guaranteed by initialization/normalization, do not guard it with `if (!x)`, `x && y`, `x ?? y`, or `typeof` checks.

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
- Engine-populated runtime caches after initialization.
- Engine-created DOM nodes tracked by engine state after creation.
- Browser APIs and behavior that the engine expects modern browsers to support after startup verification.
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
const scatterBounds = sceneGraph.debug.scatterBounds ?? [];
```

### C. Defensive `typeof` on Guaranteed Internal Methods/Objects

```js
typeof CONFIG.VOLUME.Cutscene === "number" // when Cutscene volume is a guaranteed config field
typeof internalFn === "function" // when internalFn is guaranteed by module contract
```

### D. Builder-Side Revalidation of Canonical Payload Fields

```js
const anchorPoint = validFaces.includes(part.anchorPoint) ? part.anchorPoint : "center";
if (part.parentId !== "root" && index[part.parentId]) { ... }
```

If enum membership, canonical face ids, or referential integrity need checking, do it in `core/validate.js` or `core/normalize.js` at the boundary. Do not repeat those checks in builder/runtime modules once the payload is canonical.

### E. Normalization Inside Non-normalization Math Helpers

```js
function AddVector3(a, b) {
	const left = NormalizeVector3(a);
	const right = NormalizeVector3(b);
	return { x: left.x + right.x, y: left.y + right.y, z: left.z + right.z };
}
```

Dedicated normalization helpers in `math/` may canonicalize raw vector-like input, but they must be purely for normalization and must not also perform arithmetic.

All other math helpers must consume canonical inputs directly and must not normalize, default, or fallback their operands.

---

## 4. Where to Fix Instead

When an expected symbol is missing, fix one of these upstream layers:

1. `core/validate.js` and `core/normalize.js` for inbound payload shape.
2. Builder output contracts for runtime scene/entity structure.
3. Engine initialization contracts (`core/ini.js`, boot sequence, static config shape).

Enum canonicalization and referential-integrity checks for game payload fields also belong in `core/validate.js` or `core/normalize.js`, not in downstream builder/runtime modules.

Once normalization has canonicalized a field, shape, event map, or other contract, downstream modules must consume that canonical form directly and must not fall back to alternatives, duplicate aliases, shorthand sources, or pre-normalized copies of the same semantic data.

Once `core/normalize.js` has canonicalized an object- or array-typed field itself, that container is guaranteed immediately. Do not run `normalizeObject`, `normalizeArray`, or apply a second fallback to that same container later in the normalization flow.

Once normalization has canonicalized object `shape` or `collisionShape`, builders must not substitute a different primitive, collision mode, or null detailed-bounds result for unsupported ids. Fix the enum boundary in `core/normalize.js` or `core/validate.js` instead.

Once a builder has generated internal geometry arrays, downstream builder helpers must not synthesize placeholder UVs, bounds, or AABBs to cover malformed geometry output. Fix the primitive builder or validate the generated geometry contract once at the builder boundary instead.

Once a runtime subsystem has constructed pooled collision, trigger, or correction result objects, downstream consumers must treat fields such as `normal`, `pushNormal`, `supportY`, `tEntry`, `targetAabb`, and trigger payloads as canonical engine-owned data. Do not normalize, null-guard, or fallback those fields again downstream.

Never patch over upstream contract bugs with downstream guards.

---

## 5. Allowed Exceptions

These are explicitly allowed and are not violations:

### A. External Input Boundary Checks

Validation of game-provided/raw input payloads is allowed in boundary modules:

- `core/validate.js`
- `core/normalize.js`
- other explicit entry-point validators

This exception applies only to game-provided payload data.

Imported engine JSON, alias/schema maps, internal default objects, helper option objects, and any other engine-owned data consumed inside those same boundary modules are still canonical engine data and must be used directly without defensive guards or fallback substitution.

These checks may only appear once on arrival or first usage and should never be repeated.

### B. Explicitly Approved Initialization Guards

If a guard is intentionally retained for initialization bootstrap (for example, controlled cache bootstrap in core meta state), it is allowed only where explicitly approved by the project owner. In practice, this exception has never been invoked — it exists as a formal escape hatch for bootstrap edge cases only.

### C. Bootup Browser Capability Gate

`Bootup.js` may perform the one-time browser capability and environment checks needed to verify that the engine is running in a modern browser that supports all required engine features.

Outside that startup gate, engine modules must treat required modern browser behavior as guaranteed and must not add defensive browser-support checks downstream.

---

## 6. Fail-Fast Policy

If a guaranteed symbol is missing, allow the natural exception to surface.

Do not swallow, coerce, or default around the failure in downstream runtime modules.
Deliberate fail-fast error throwing is not allowed. Errors must naturally surface, not be induced. A deliberate throw requires checking for the symbol's existence first — that check is itself a forbidden defensive pattern on a guaranteed symbol.

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
| Browser/runtime environment detection                   | Only `Bootup.js`, once    |
| External payload validation/normalization boundaries    | Yes, once                 |
| Explicitly approved initialization exceptions           | Yes                       |

