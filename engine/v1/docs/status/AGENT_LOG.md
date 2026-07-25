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

- [2026-07-25] ED: implemented Simulator obstacle/terrain support + AABB-derived platform/camera framing across `core/normalize.js`, `handlers/game/Level.js`, `handlers/game/Camera.js`, `handlers/game/Simulator.js`, `builder/NewObstacle.js` — shipped; all `node --check` passed. One documented deviation: the disc platform is sized after the object spawns (footprint needs the built AABB) rather than before — a present-but-resized disc, functionally equivalent for grounding.
- [2026-07-25] ERA: audited the feature diff (read-only) — 2 findings: (1) exported `mergeAabb` not renamed to UpperCamelCase on promotion (CASING); (2) `DespawnFromScene` dispatched on `Array.isArray(target)` instead of the `objectType` discriminator, root-caused to `Simulator.Start()` storing `platformMesh` as a single mesh while `spawnPlatform` stored an array. Also surfaced (not filed) that non-exported `FULL_CAPS` constants exist codebase-wide.
- [2026-07-25] DRYAD: audited the feature diff (read-only) — 2 duplication findings in `Level.js`: (1) the 3-line post-spawn tail repeated across 4 `SpawnIntoScene` branches (suggested a `finalizeSpawn` helper); (2) the same `DespawnFromScene` dispatch inconsistency ERA found. Confirmed `mergeAabb` reuse, terrain AABB union, and `spawnPlatform` normalize path clean. Low-priority note: platform respawns unconditionally each non-terrain `Load`.
- [2026-07-25] ED: fix pass — applied all audit findings: renamed `mergeAabb`→`MergeAabb`; `Start()` now stores `platformMesh` as an array and `DespawnFromScene` dispatches on `objectType`; extracted `finalizeSpawn` (`Level.js` −14 lines); renamed the three new non-exported Simulator constants (`PLATFORM_PAD_FACTOR`/`FRAMING_FACTOR`/`HEIGHT_FRACTION`) to lowerCamelCase. All `node --check` passed.
- [2026-07-25] Main agent: implemented the App-side (`carlGames/simulator/main.js`) four-mode/per-type-store rework directly; and fixed four pre-existing non-exported `FULL_CAPS` casing violations flagged during the audit — `AIR_DRAG_COEFFICIENT`/`WATER_DRAG_COEFFICIENT` in `math/Forces.js` and `KNOCKBACK_FORCE`/`INVULNERABILITY_DURATION` in `handlers/game/Enemy.js` — renamed to lowerCamelCase, `node --check` passed, full engine scan confirmed no residual non-exported `FULL_CAPS` constants remain.

