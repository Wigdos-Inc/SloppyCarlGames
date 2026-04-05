# Unit Instancing Rules

These rules govern how `Unit` and `UnitVector3` instances are used throughout the engine. Every agent, contributor, or developer editing engine code must follow these rules without exception.

---

## 1. Instance on Arrival

All world-space values (distance, rotation, dimension, position) must be instanced as `Unit` or `UnitVector3` **at the first point of entry** into the engine.

- **Payload values** (from games) are instanced in `core/normalize.js`, called by `core/validate.js`.
- **Engine-internal defaults** (e.g. camera defaults) are instanced in the module that declares them.
- A value is instanced **once**. After instancing, it is never instanced again.

### Default type assumptions

| Value kind        | Default type   | Example                                |
|-------------------|----------------|----------------------------------------|
| Distance/position | `"cnu"`        | `new Unit(10, "cnu")`                  |
| Rotation/angle    | `"degrees"`    | `new Unit(45, "degrees")`              |
| Camera defaults   | `"worldunit"`  | `new Unit(10, "worldunit")`            |

These defaults apply unless the source explicitly states otherwise.

### Engine-owned static JSON sources

If engine-owned static JSON contains world-space values, canonicalize those values exactly once at import/load time inside the owning module, typically with an IIFE that replaces raw JSON world-space units/vectors with `Unit` or `UnitVector3` instances respectively.

Do not leave raw engine JSON in place and compensate by re-instancing it later inside shared runtime or builder paths.

---

## 2. No Re-instancing

Once a value is a `Unit` or `UnitVector3` instance, it must never be wrapped in a new instance.

### Forbidden

```js
// Re-instancing an already-instanced value — NEVER do this
new Unit(existingUnit.value, "worldunit")
new UnitVector3(existingVector.x, existingVector.y, existingVector.z, "cnu")
```

### Allowed

```js
// Convert via built-in methods
existingUnit.toWorldUnit()        // returns converted scalar (no mutation)
existingUnit.toWorldUnit(true)    // mutates instance in-place, returns this
existingVector.toWorldUnit()      // returns plain {x, y, z} object (no mutation)
existingVector.toWorldUnit(true)  // mutates instance in-place, returns this

// Update scalar value
existingUnit.value = 42;

// Update vector components
existingVector.set({ x: 1, y: 2, z: 3 });
```

### Type-change exception

Re-instancing is allowed **only** when a `Unit` must become part of a `UnitVector3`, or a `UnitVector3` must be broken into separate `Unit` scalars. This is a type change, not a re-wrap.

```js
// Allowed: composing a vector from separate Unit scalars
new UnitVector3(unitX.value, unitY.value, unitZ.value, unitX.type)

// Allowed: decomposing a vector into separate scalars
new Unit(vector.x, vector.type)
```

### Clone exception

If an existing instanced value must be copied so the original instance is not mutated, use its `clone()` method when one is provided.

```js
const nextPosition = existingVector.clone();
```

Do not manually reconstruct the copy with `new Unit(...)` or `new UnitVector3(...)` from an existing instance.

If a default, config, or template instance is meant to be reused as shared baseline data, do not install that exact instance into mutable runtime state. Clone it before storing or mutating it so the reusable source remains stable.

---

## 3. Assume Pre-instanced Values Downstream

All engine functions must assume that incoming world-space values are already `Unit` or `UnitVector3` instances. This means:

- **No `instanceof` checks** on incoming Unit/UnitVector3 values.
- **No `typeof` guards** to verify that a value is a Unit before using `.value` or `.toWorldUnit()`.
- **No fallback instancing** (e.g. `value instanceof Unit ? value : new Unit(value, "cnu")`).
- **No defensive wrapping** (e.g. `typeof value === "number" ? new Unit(value, "cnu") : value`).

If a raw number arrives where a Unit is expected, **that is an upstream bug**. The resulting error must surface naturally — it reveals a weakness in the normalization layer that must be fixed there, not papered over downstream.

---

## 4. What Stays Raw

Not everything gets instanced. The following value types remain plain numbers:

| Category         | Examples                                          | Reason                    |
|------------------|---------------------------------------------------|---------------------------|
| Coefficients     | `dampingFactor`, `sensitivity`, `opacity`         | Dimensionless multipliers |
| Scale multipliers| `textureScale`, `scatterScale`, `transform.scale` | Multiplicative factors    |
| Normalized values| Interpolation `t` values, colors (0–1)            | Not spatial quantities    |
| Counts/indices   | Array indices, entity counts                      | Discrete, not spatial     |
| Boolean/string   | Flags, IDs, mode strings                          | Not numeric measurements  |

**Rule of thumb**: If a value represents a measurement in a coordinate space (distance, position, angle, dimension), it gets instanced. If it is a dimensionless ratio, coefficient, or non-spatial number, it stays raw.

If a builder or runtime subsystem deterministically computes auxiliary collision data such as simulation padding, capsule dimensions, or bounds offsets, instance that data at the module that computes it and keep it internal to the engine.

---

## 5. Conversion at Point of Use

When a function operates in a different unit space than the incoming instance, convert at point of use via built-in methods. Do not pre-convert upstream "just in case."

```js
// Camera operates in worldunit; player position arrives as CNU.
// Convert at the moment of use:
const playerPos = playerState.transform.position.toWorldUnit();  // returns plain {x,y,z}

// AABB bounds are CNU UnitVector3 instances.
// Convert at the moment of use:
const scaledMin = aabb.min.toWorldUnit();  // returns plain {x,y,z}
```

Do not create intermediate variables that re-instance the converted value. The `.toWorldUnit()` / `.toCNU()` methods on `UnitVector3` return plain `{x, y, z}` objects — use those directly.

---

## 6. Pipeline Flow

```
Game Payload (raw JSON)
    │
    ▼
validate.js → ValidateLevelPayload()
    │  - Validates structure
    │  - Calls normalize.js functions
    │  - Returns payload with instanced world/camera values
    │
    ▼
Level.js → cacheLevelPayload()
    │  - Stores reference (no cloning — instances are objects)
    │
    ▼
NewLevel.js → BuildLevel()
    │  - Receives pre-instanced world/camera
    │  - Accesses values via .value / .x / .y / .z
    │  - Never re-instances
    │
    ▼
Camera.js → InitializeCameraState()
    │  - Camera defaults are worldunit (declared locally)
    │  - Incoming cameraConfig values are CNU (from normalize)
    │  - Converts CNU → worldunit via .toWorldUnit() at point of use
    │  - Never re-instances
    │
    ▼
Update Loop
    │  - playerState.transform.position is UnitVector3("cnu")
    │  - Camera converts at point of use via .toWorldUnit()
    │  - worldAabb min/max are UnitVector3("cnu")
    │  - Camera converts at point of use via .toWorldUnit()
```

---

## 7. Mutation Patterns

### Updating a scalar Unit

```js
unit.value = newNumber;
```

### Updating a UnitVector3

```js
vector.set({ x: newX, y: newY, z: newZ });
// or
vector.set(otherVector);
```

### Prefer instance math methods when mutating an existing vector

When the left-hand side is already a `UnitVector3` instance you intend to mutate, prefer the instance helpers over wrapping generic math helpers in `.set(...)`.

```js
vector.add(otherVector);
vector.subtract(otherVector);
vector.multiply(otherVector);
vector.scale(scalar);
```

Prefer these over patterns like `vector.set(AddVector3(vector, otherVector))`.

### Converting with mutation (overwrite mode)

```js
unit.toWorldUnit(true);    // mutates value and type in-place
vector.toWorldUnit(true);  // mutates x, y, z, and type in-place
```

### Converting without mutation (read mode)

```js
const worldValue = unit.toWorldUnit();       // returns number
const worldPos = vector.toWorldUnit();       // returns plain {x, y, z}
```

---

## 8. Module Responsibilities

| Module          | Responsibility                                                |
|-----------------|---------------------------------------------------------------|
| `normalize.js`  | Instance raw payload values as Unit/UnitVector3 (CNU/degrees) |
| `validate.js`   | Validate payload structure, call normalize, return instanced  |
| `NewLevel.js`   | Build scene from pre-instanced data. Never instance.          |
| `Camera.js`     | Declare worldunit defaults. Convert CNU at point of use.      |
| `NewObject.js`  | Instance geometry bounds as UnitVector3("cnu").               |
| `Master.js`     | Instance player position as UnitVector3("cnu").               |
| `Physics.js`    | Update positions via .set(). Never re-instance.               |

---

## Quick Reference

```
✅ existingUnit.toWorldUnit()
✅ existingUnit.value = 42
✅ existingVector.set({ x, y, z })
✅ existingVector.toWorldUnit()
✅ existingVector.clone()               — when alias separation is required
✅ new Unit(rawNumber, "cnu")           — only at first entry point
✅ new UnitVector3(x, y, z, "cnu")      — only at first entry point

❌ new Unit(existingUnit.value, "worldunit")
❌ new UnitVector3(unit.toWorldUnit(), unit.toWorldUnit(), unit.toWorldUnit(), "worldunit")
❌ if (value instanceof Unit) { ... }
❌ typeof value === "number" ? new Unit(value) : value
❌ value.value !== undefined ? value.value : value
```
