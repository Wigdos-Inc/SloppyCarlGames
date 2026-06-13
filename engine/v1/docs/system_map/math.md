# math/ — Shared Math Layer

## Responsibility
Pure, stateless math utilities available to any engine module without restriction. Provides typed unit conversion primitives, 3D vector operations, matrix composition, physics force math, collision geometry helpers, and curve utilities. Together with `core/`, this is the engine's global helper layer — anything may import from it.

## Files
- `Utilities.js` — `Unit` and `UnitVector3` classes: typed value containers with conversion methods (`toRadians`, `toDegrees`, `toCNU`, `toWorldUnit`, `clone`). `CNU_SCALE` constant (fixed at development time). Conversion functions: `DegreesToRadians`, `RadiansToDegrees`, `CNUtoWorldUnit`, `WorldUnitToCNU`. Utility functions: `Clamp`, `Clamp01`, `Lerp`, `SmoothStep`, `ToNumber`.
- `Vector3.js` — 3D vector operations: `AddVector3`, `SubtractVector3`, `MultiplyVector3`, `DivideVector3`, `ScaleVector3`, `DotVector3`, `CrossVector3`, `LerpVector3`, `AbsoluteVector3`, `CloneVector3`, `ToVector3`, `Vector3Distance`, `Vector3Sq`, `ResolveVector3Axis`, `Vector3ChainMath`. Exports `WORLD_NORMALS` constant (canonical axis directions).
- `Matrix.js` — 4×4 matrix creation (`CreateIdentityMatrix`, `CreateModelMatrix`, `CreateRenderMatrix`) and transform composition helpers.
- `Collision.js` — Geometry math helpers: AABB overlap (`AabbOverlap`), sweep tests, ray-AABB intersection, projection calculations. No state, no engine dependencies.
- `Forces.js` — Pure force math: `ComputeGravity`, `ComputeResistance`, `ComputeBuoyancy`, `ComputeStepVelocity`, `ComputeSubmergence`. Operates on numeric inputs only; no entity state or config access.
- `Curves.js` — Bezier and curve utilities.

## Boundaries
**Called by:** Any engine module freely — no access restrictions.  
**Calls into:** `math/` modules may import each other (`Utilities.js` imports from `Vector3.js`).  
**Does not:** Hold mutable state, perform side effects, or import from handlers, physics, player, builder, or cutscene.

## Invariants
- All exports are pure functions or immutable constants, except `Unit`/`UnitVector3` which are value-holding class instances.
- `Unit` and `UnitVector3` are the canonical typed-value containers for all measurement values in the engine. They are instanced exactly once per value at a system entry point; downstream code operates on existing instances.
- `CNU_SCALE` is fixed at development time and does not change at runtime.
- `math/Collision.js` is geometry math only — it has no entity state, physics state, or config dependencies.
- `math/Forces.js` is pure math only — force assembly with entity/config context lives in `physics/Forces.js`.
