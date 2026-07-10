# Agent Log

Running log of custom-agent activity (ERA, DRYAD, ARGUS, RIGOR, ED, SAGE). SAGE is
responsible for appending an entry here after any agent run that produces a
meaningful finding or change. The weekly status task reads this file and then
empties it (back to this header) after summarizing — so entries only need to
cover "since the last weekly report."

## Entry format

`- [YYYY-MM-DD] AGENT: task — outcome (authorized actions taken, if any)`

Example:

`- [2026-07-09] DRYAD: reviewed NewObject.js tube refactor — found 1 duplicated matrix-multiply, flagged only (no fix authorized)`

## Log

- [2026-07-10] RIGOR: Carl tentacles, cylinder → capsule — converted all 27 segments, pulled each child into its parent by its own cap radius (`dimensions.z/2`) and embedded all 9 roots into the body along each root's own axis; hemispherical caps now merge into joints that stay gap-free under rotation. All 27 verified post-transform, 0 problems (edits authorized, `carlGames/simulator/entities.json` only)
- [2026-07-10] RIGOR: Carl tentacle lighter-square decals — raised `scale.y` 0.25 → 0.42 on all 27 segments. A flat decal quad sized to the bounding-box half-height under-covers a capsule cap (the radial projection compresses near the cap and the hemisphere adds arc length the quad never accounts for), leaving an uncovered ring at every joint; overshooting the length makes adjacent segments' decals overlap into one continuous band. Suckers image decals deliberately untouched
- [2026-07-10] RIGOR: Carl eyebrows — added `browLeft`/`browRight` as node-chain `tube` parts parented to the head, made solid by setting `thickness` high enough to collapse the inner ring. A first planar attempt buried the inner/upper sections, since the head is an ellipsoid whose front surface varies across the brow span; fixed by giving each node a `localPosition.z` tracking the surface. `browRight` generated as an exact mirror of the user's hand-tuned `browLeft` and verified field-by-field
- [2026-07-10] RIGOR: bone-chain mirror rule (reusable finding) — reflecting a tube node chain across the YZ plane conjugates each rotation by `diag(-1,1,1)`, so `localPosition.x` negates and `localRotation.y`/`.z` negate, but `localRotation.x` is **preserved** (it turns in the YZ plane, which the mirror leaves alone); dimensions/thickness/curved/smoothness are unchanged
- [2026-07-10] RIGOR: entity attachment mechanics (read-only findings, no engine edit) — `anchorPoint`/`attachmentPoint` resolve to **bounding-box** face centers via `getFaceCenterOffset`, not geometry, so a capsule's `top`/`bottom` is its tip and flush chaining makes two caps meet at a point; `localPosition` is added un-rotated in the parent's frame (`localPosition + (attachOffset - rotatedAnchorOffset)`); `buildCapsule` centers its origin, with `capRadius = dimensions.z/2` and `cylinderHalf = dimensions.y/2 - capRadius`
- [2026-07-10] ED: tube connector curve refactor per `docs/TUBE_CURVE_ARC_REFACTOR.md` — rewrote `SampleConnectorCenterline` from a quadratic perp-foot construction into a cubic Bezier with forward-aligned handles blended against a center-corner hairpin. A quadratic has one control point and cannot pin both end tangents, and it collapsed to the chord midpoint on ~180-degree joins (zero arc height + inverted ring winding = dropped geometry). Signature, export and return contract preserved; the `buildTube` call site left untouched as specified (implementation authorized, `math/Curves.js` only)
- [2026-07-10] ERA: audited the `SampleConnectorCenterline` rewrite — clean, no violations against FORBIDDEN_DEFENSIVE_CHECKS, UNIT_INSTANCING, CASING or MODULE_GROUPS. Confirmed the zero-chord case is handled structurally (the handle length multiplies the chord rather than dividing by it) so no guard is required, and that no import went dead (fixes not authorized; none needed)
- [2026-07-10] DRYAD: reviewed the `SampleConnectorCenterline` rewrite — no action warranted; the per-sample vector allocation is build-time only and trivial (≤17 iterations), and no existing cubic-Bezier or polyline-lerp helper in `math/` was reimplemented. Flagged one pre-existing inefficiency: `ParallelTransportFrames` computes the same `SubtractVector3` twice per edge, once inside `tangentAt` and again as `v1` — immaterial and predates this change (flagged only, no fix authorized)
- [2026-07-10] Main agent (not a custom-agent run, recorded for the reusable finding): traced browLeft's residual tube kinks to **part definition, not the engine**. A tube node's `localRotation` sets the tangent **at** that node — shared by the connector arriving into it and the one departing it — not the heading of the next segment. A connector reads clean when both tangents are symmetric about its chord (browLeft's 180-degree U-turn is 90°/90°) and hooks when one tangent lies near the chord while the other is far off it (browLeft's root→node1 is 3.8°/80.0°, forcing a lateral excursion of ~0.7 tube radii peaking at t=2/3). No engine change made
