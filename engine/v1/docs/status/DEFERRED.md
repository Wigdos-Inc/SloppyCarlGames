# Deferred Work

Explicitly deferred implementations or decisions — work that was started, considered,
or raised during a task and consciously postponed, along with who deferred it and why.

This is NOT the idea backlog (see `engine/v1/docs/todo` for that). Entries here should
only be things that came up mid-task and got pushed off, not general feature ideas.

Entries persist across weekly reports until resolved — remove or check off an item
once it's actually addressed.

## Entry format

`- [ ] [YYYY-MM-DD] Item — deferred by WHO, because REASON`

Example:

`- [ ] [2026-07-09] Camera.js CNU_SCALE calibration — deferred by ED, because it depends on render pipeline stabilizing first (see CNU_VS_WORLDUNITS.md Section 4)`

## Pending

- [ ] [2026-07-20] Reconcile the player's swept-solid physics-collision path with regular entities — deferred by user, because it needs its own investigation first. `DetectPhysicsCollisions` (`physics/Collision.js`, player branch) has no tight `AabbOverlap(entity.collision.aabb, candidate.aabb)` gate on solids — it culls only by the 24-padded `simRadiusAabb` then swept-sphere — whereas its sibling `DetectCurrentPhysicsOverlaps` does gate on the tight AABB. That asymmetry let an oversized collider register ground contact through a gap. The inscribed-sphere fix removed the observable symptom; the user wants to understand why the player has a different physics-collision path than entities before deciding how to unify the gating.
- [ ] [2026-07-20] Simulator app "player" vs "entity" mode split so authored characters emit `player/characters.json`-canonical data (not the entity schema) — deferred by user, because it is larger in scope than the current pass. Carl's shape discrepancy was fixed at the data level for now (generated-texture `color`→`secondary` rename); once the Simulator emits player-canonical output, per-character fixes like carl's become unnecessary.
- [ ] [2026-07-10] Carl tentacle rework from the capsule chain to the node-chain `tube` primitive — deferred by user, because the payoff is mainly animation quality and it requires tube-specific animation support that does not exist yet; redoing the geometry now would discard the just-tuned capsule geometry and decal work. Revisit when animation work begins.
- [ ] [2026-07-10] Angle-aware, asymmetric connector handle lengths in `SampleConnectorCenterline` — deferred by user, because the current constant symmetric fraction (`chord * 0.667`) is acceptable for now. The correct handle length for a circular arc depends on the turn angle, and an asymmetric corner wants a shorter handle on the end whose tangent sits far off the chord. This would suppress overshoot on asymmetric connectors, but cannot rescue an over-constrained connector whose two node tangents contradict its chord.
- [ ] [2026-07-10] `curved` / `smoothness` on a tube's final node are silently ignored — deferred by user, because it is not currently causing a visible problem. `buildTube` iterates `i < nodes.length - 1` and reads `nodes[i].curved`, so a node owns only the connector that departs it and the last node owns none; authoring `curved: false` on the last node therefore has no effect.
- [ ] [2026-07-10] Decouple the tube connector centerline sample count from the cross-section segment count — deferred by main agent, because it should only be pursued if faceting is actually observed. `buildTube` reuses `resolveCylinderSegments(complexity)` (16 at `high`) both for radial ring resolution and for the number of centerline samples, so a 180-degree U-turn connector is resolved by only ~17 points.
