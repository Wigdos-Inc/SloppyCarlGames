# math/ — Shared Math Layer

## Responsibility
Pure, stateless math utilities available to any engine module without restriction. Provides typed unit conversion primitives, 3D vector operations, matrix composition, geometry helpers, collision math, force math and curve utilities. Together with `core/`, this is the engine's global helper layer: anything may import from it.

## Files
- `Utilities.js` — The `Unit` and `UnitVector3` classes: typed value containers with conversion methods (`toRadians`, `toDegrees`, `toCNU`, `toWorldUnit`, `clone`), in-place writers (`set`, `add`, `min`, `max`, `scale`, `multiply`, `subtract` on `UnitVector3`) and `Unit.math(f, ...args)`, which sets the value to `f(value, ...args)`.
  - **Conversions:** `DegreesToRadians`, `RadiansToDegrees`, `CNUtoWorldUnit`, `WorldUnitToCNU`.
  - **Utilities:** `Clamp`, `Clamp01`, `Lerp`, `SmoothStep`, `ToNumber`.
  - **`BestMatchOf(array, condition, currentBest, storage)`** (the author's version) returns the item that wins a pairwise `condition(entry, best, storage)` comparison. `math/Collision.js`'s soup contact and `builder/NewEntity.js`'s face-to-axis alignment use it.
  - **Engine-only.** `Unit`/`UnitVector3` are engine-exclusive: games never receive them, and `math/` never calls their methods on inputs.
- `Vector3.js` — 3D vector operations on plain or Unit vectors.
  - **Arithmetic:** `AddVector3`, `SubtractVector3`, `MultiplyVector3`, `DivideVector3`, `ScaleVector3`, `AbsoluteVector3`, `ClampVector3`, `DotVector3`, `CrossVector3`, `LerpVector3`.
  - **Measures and comparisons:** `Vector3Sq`, `Vector3Length`, `Vector3Distance`, `Vector3SqDistanceToAabb` (0 inside), `ResolveVector3Axis`, `MinVector3`/`MaxVector3` (any number of vectors), `MinAxisVector3`, `CompareVector3(a, b, method)`.
  - **Cloning:** `CloneVector3`, and `CloneTransform`, which clones a transform's instanced fields as Unit vectors and copies plain ones.
  - **Velocity helpers:** `ProjectOntoPlane`, `ClampVelocity`.
  - **Rotation and arrays:** `RotateByEuler`, `ToVector3`, `Vector3ToArray`, `ArrayToVector3(array, index, multiplied)`, and the `WORLD_NORMALS` axis directions.
  - **Direction easing.** `RotateTowardVector3(from, to, maxStep)` is the shared unit-direction rate limiter. Every heading, reference-normal, model-pose and camera-roll ease in the engine turns on it. `AngleBetweenVector3(a, b)` is the radians between unit vectors.
  - **Carrying headings.** `TransportVector3(v, from, to)` applies the minimal rotation carrying unit `from` onto unit `to`. `AzimuthTurnVector3(from, to)` returns the yaw-only turn between two vectors' headings. It's zero past a quarter turn, and zero when either vector has no horizontal component.
- `Matrix.js` — 4×4 matrices.
  - **Creation:** `CreateIdentityMatrix`, `CreateModelMatrix`, `CreateRenderMatrix`, `MultiplyMatrix4`, `TransformPointByMatrix`, `InvertAffineMatrix`, `FrustumPlanes(matrix)` (six inward-facing walls, each `[x, y, z, offset]`).
  - **Euler rotations.** `ComposeEulerRotations(parent, local)` multiplies two Euler triples as rotation matrices and decomposes the product. `EulerFromBasis(right, up, forward, degenerateRoll)` gives the Euler triple for an orthonormal basis.
  - **Render matrix cache.** `CreateRenderMatrixCache(transform)` returns `{ matrix, position, pivot, rotation, scale }`: the render matrix plus a by-value snapshot of the four fields `CreateRenderMatrix` reads. `handlers/Render.js`'s `renderMatrixFor` is the sole reader.
- `Geometry.js` — Shape and box geometry.
  - **Triangles:** `TriangleNormal` (zero when degenerate), `TriangleArea`, `TriangleCentroid`, `TriangleAabb`.
  - **Mesh triangles.** `MeshTriangles(positions, indices, matrix)` places each corner once and shares it between triangles.
  - **Boxes:** `AabbCenter`, `AabbHalfExtents`, `PointsAabb` (the shared min/max fold), `BoxCorners(box)` (8 corners, x fastest, then y, then z).
  - **Colliders from boxes:** `SphereFromAabb(aabb, inscribed)`, `CapsuleFromAabb`, `ObbFromAabb`, `OffsetDetailedBounds(bounds, offset)`.
  - **Cutting and closest points:** `SplitPolygonByPlane(polygon, normal, offset)` returns `[front, back]`, or `null` when the plane doesn't cut. `ClosestPointOnSegment`, `ClosestPointOnTriangle`.
  - **Linked groups:** `MakeRoots`, `FindRoot`, `JoinRoots`, a union-find used by `builder/subProcesses/Chunks.js` and `Loops.js`.
- `Collision.js` — Collision math in labelled sections. No state, no engine-state dependencies, and no `config.js` import.
  - **Exports:** `AabbOverlap`, `AabbOutsideFrustum`, `TriangleDistanceSq`, `BuildTriangleGrid`, `TriangleGridCandidates`, `SoupBounds`, `PointInsideGrid`, `MeshesIntersect`, `SweptAABB`, `SweptSphereBounds`, `RayAABBIntersect`, `RayAABBDetailedBoundsIntersect`, `RayTriangleIntersect`, `RayDetailedBoundsIntersect`, `SegmentQueryBox`, `TriangleInQueryBox` and `NarrowphaseContact`.
  - **Narrowphase.** `NarrowphaseContact(boundsA, boundsB)` dispatches on the first two letters of each shape type to one private contact function per pair, reversing through `invertContact` for the mirrored order. A compound sphere keeps its deepest sphere's contact.
  - **Soups and grids.**
    - `SoupBounds(type, triangles)` builds `{ type, triangles, grid }`. `BuildTriangleGrid` sizes its cells to hold about two triangles each.
    - `TriangleGridCandidates(grid, aabb)` returns the triangle indices in the cells a box touches.
    - Soup and void-wall contacts loop those candidates through the private `deepestInBox`, filtered by `TriangleInQueryBox`.
    - `aabbTriangleSetContact` runs SAT of a box against the overlapping triangles, picking the facing triangle with `BestMatchOf`.
  - **Solid queries** (build-time predicates over closed meshes):
    - `PointInsideGrid(point, grid)` is ray parity along an off-axis direction, testing only the cells the ray passes.
    - `MeshesIntersect(solidA, solidB)` takes cutting solids. It checks containment through the other solid's grid, then edges against grid candidates.
  - **Boxes.** `AabbOverlap(a, b, strict)`. `AabbOutsideFrustum(planes, aabb, padding)` picks each axis of the tested corner from the sign of that axis of the wall's normal.
  - **Swept and ray tests.** `SweptAABB` and `SweptSphereBounds`, plus the ray tests above. The sphere, OBB, capsule and triangle-soup ray tests are private.

  **Ray-hit contract.** Every ray-hit result carries `{ hit, t, normal, inside }`. `inside` marks an exit hit, where the ray began within the volume. Triangles always report `false`.
- `Forces.js` — Pure force math: `ComputeGravity`, `ComputeResistance`, `ComputeBuoyancy`, `ComputeDeceleration`, `ComputeStepVelocity`, `ComputeSubmergence`.
  - It operates on numeric inputs plus `CONFIG.Physics` constants, with no entity state. Water levels are plain CNU numbers or null.
  - `ComputeStepVelocity.scalar(v, forces, dt, vertical)` applies whichever of gravity, buoyancy and resistance `forces` carries. A stage that's disabled in config is warn-logged instead. Optional floatiness smoothing follows.
- `Curves.js` — Curve and frame utilities backing the node-chain `tube` primitive.
  - `ApplyEasing(name, t)` resolves `linear`, `easeIn`, `easeOut` or `easeInOut`.
  - `SampleConnectorCenterline(startCenter, forward, endCenter, backward, smoothness, segments)` returns `segments + 1` centerline points spanning one tube connector: a cubic Bézier with forward-aligned handles, blended against a hard-corner hairpin by `smoothness`.
  - `ParallelTransportFrames(points, initialNormal)` returns a twist-free `{ tangent, normal, binormal }` per point by double reflection.

## Boundaries
**Called by:** any engine module freely, with no access restrictions.

**Calls into:** `math/` modules import each other; `core/meta.js` for `EPSILON`/`Log`; `core/config.js` (`Forces.js` only).

**Does not:** hold mutable state, perform side effects other than `Forces.js`'s disabled-stage warnings, or import from handlers, physics, player, builder, camera or cutscene.

## Invariants
- All exports are pure functions or immutable constants, except `Unit`/`UnitVector3`, which are value-holding class instances.
- `Unit` and `UnitVector3` are instanced exactly once per value at a system entry point. Downstream code operates on existing instances.
- `math/` never calls `Unit`/`UnitVector3` methods on its inputs. It works through the Vector3 helpers, so games can pass plain vectors.
- `math/Collision.js` and `math/Geometry.js` are geometry math only, with no entity or physics state.
- `math/Forces.js` is pure math only. Force assembly with entity context lives in `physics/Forces.js`.
- `RayAABBDetailedBoundsIntersect` passes the caller's `maxDistance` to the narrowphase, never the broad hit's `t`.
- `math/Curves.js` operates on plain `{x, y, z}` numeric vectors.
- The connector's smooth handle length is turn-angle aware but symmetric, so asymmetric corners still overshoot.
