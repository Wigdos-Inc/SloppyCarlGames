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

- [2026-07-20] ED: implemented the player-on-entity-pipeline refactor (rewrote `player/Model.js` as assembler, slimmed `player/Master.js` to orchestrator, deleted the bespoke `collision.profile` system, added `carl`) — returned clean; caught and prevented a `simRadiusPadding` 24→8 regression that `BuildEntity` would have introduced, and removed a redundant `rebuildBounds` passthrough wrapper. Then applied the approved post-audit fix pass.
- [2026-07-20] ERA: audited the refactor — found `loadDecalBitmaps` mutating the shared `characterData` template in place (high; a transient decal-load failure would drop a decal for the session), a `buildPart` `dimensions` non-clone (medium latent aliasing), and 3 casing misses (`ComputeCapsuleFromAabb`, `playerSurfaceId`, `CharacterData`); confirmed layering, no-defensive-checks, and single-instancing all held. Flag-only (no edits); all flagged issues addressed in the follow-up fix pass.
- [2026-07-20] DRYAD: reviewed the refactor — confirmed the dedup landed with no leftover duplicated math or dead code; flagged the AABB capsule recomputed per-frame by two physics consumers and the full 43-part model refresh at 6 physics sync points (recommended profiling, not a speculative change). Flag-only, no edits.
- [2026-07-20] ARGUS: runtime-tested the refactor in testGame — found 2 blocking bugs preventing player init for both characters (single-pass part index requiring parent-first order; carl generated-texture missing `secondary`); neither a physics regression (the `collision.profile` removal could not be exercised). Both fixed directly by the main agent afterward; runtime re-verification left to the user.
