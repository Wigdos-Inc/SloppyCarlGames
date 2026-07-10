# math/ — Shared Math Layer

## Responsibility
Pure, stateless math utilities available to any engine module without restriction. Provides typed unit conversion primitives, 3D vector operations, matrix composition, physics force math, collision geometry helpers, and curve utilities. Together with `core/`, this is the engine's global helper layer — anything may import from it.

## Files
- `Utilities.js` — `Unit` and `UnitVector3` classes: typed value containers with conversion methods (`toRadians`, `toDegrees`, `toCNU`, `toWorldUnit`, `clone`). `CNU_SCALE` constant (fixed at development time). Conversion functions: `DegreesToRadians`, `RadiansToDegrees`. Utility functions: `Clamp`, `Clamp01`, `Lerp`, `SmoothStep`, `ToNumber`.
- `Vector3.js` — 3D vector operations: `AddVector3`, `SubtractVector3`, `MultiplyVector3`, `DivideVector3`, `ScaleVector3`, `DotVector3`, `CrossVector3`, `LerpVector3`, `AbsoluteVector3`, `CloneVector3`, `ToVector3`, `Vector3Distance`, `Vector3Sq`, `ResolveVector3Axis`, `Vector3ChainMath`. Exports `WORLD_NORMALS` constant (canonical axis directions).
- `Matrix.js` — 4×4 matrix creation (`CreateIdentityMatrix`, `CreateModelMatrix`, `CreateRenderMatrix`) and transform composition helpers. Exports `MultiplyMatrix4`, the shared 4×4 multiply used internally to compose translation/rotation/scale and by external callers (e.g. `handlers/Render.js`'s decal placement matrix) that need to compose matrices outside the transform-composition helpers.
- `Collision.js` — Geometry math helpers: AABB overlap (`AabbOverlap`), sweep tests, ray-AABB intersection, projection calculations. No state, no engine dependencies.
- `Forces.js` — Pure force math: `ComputeGravity`, `ComputeResistance`, `ComputeBuoyancy`, `ComputeStepVelocity`, `ComputeSubmergence`. Operates on numeric inputs only; no entity state or config access.
- `Curves.js` — Curve and frame utilities backing the node-chain `tube` primitive. `ApplyEasing(name, t)` resolves one of four named easings (`linear`, `easeIn`, `easeOut`, `easeInOut`). `SampleConnectorCenterline(startCenter, forward, endCenter, backward, smoothness, segments)` returns `segments + 1` centerline points `{x,y,z}` spanning one tube connector, with `points[0]` equal to `startCenter` and `points[segments]` equal to `endCenter`. It builds a **cubic Bezier with forward-aligned handles** — `p1 = startCenter + forward·d`, `p2 = endCenter + backward·d`, where `d = chord · 0.667` — so the curve departs along `forward` and arrives along `-backward`, pinning both end tangents for any corner angle including a 180° reversal. Each sample is `lerp(sharp, smooth, smoothness)`, blending the cubic against a single-center-corner hairpin through `cornerM = (p1 + p2) / 2`: `smoothness = 1` yields an even arc, `smoothness = 0` a hard corner at `t = 0.5`, and collinear input degenerates to a straight line. `ParallelTransportFrames(points, initialNormal)` returns a twist-free `{ tangent, normal, binormal }` per point via branch-free double reflection (Wang et al. 2008).

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
- `math/Curves.js` operates on plain `{x,y,z}` numeric vectors, not `Unit`/`UnitVector3`. Its tube callers extract centers and axes as raw numbers from composed frame matrices, so no instancing or de-instancing happens at this boundary.
- `SampleConnectorCenterline` needs no zero-length guard: the handle length multiplies the chord rather than dividing by it, so a zero chord degenerates to `p1 = startCenter`, `p2 = endCenter` without a divide-by-zero.
- The connector handle length is a single constant, symmetric fraction of the chord (`0.667`). It is not turn-angle aware, so asymmetric corners — where one node tangent lies near the chord and the other far off it — overshoot. See `docs/status/DEFERRED.md`.
