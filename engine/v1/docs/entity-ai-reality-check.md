# Entity AI — Scope vs. Engine Reality (TEMPORARY)

Working document. Compares `entity-ai-scope.md` and `entity-ai-pathfinding-detail.md` against the
engine as it exists at commit `d79384c` (v0.31.5). Delete once the update is scoped and logged.

Sections A–C are **findings** — verified against source, with references.
Section D is a **proposal** — pass breakdown, pending author consensus.
Section E lists the **open decisions** that block sizing.

---

## A. Foundations the scope assumes but the engine does not have

### A1. There is no entity behaviour layer of any kind

[`handlers/game/Enemy.js`](engine/v1/handlers/game/Enemy.js) is 164 lines and contains no AI. It
handles exactly one thing: player↔enemy combat overlap resolution and the damage that follows
([Enemy.js:29-115](engine/v1/handlers/game/Enemy.js#L29-L115)). There is no per-entity decision
tick, no state, no targeting, no perception.

`entity.action` is written once, to `"Idle"`, at build time
([NewEntity.js:746](engine/v1/builder/NewEntity.js#L746)), and never again. The player's equivalent
has a central authority (`SetPlayerAction`, [player/Master.js:167-180](engine/v1/player/Master.js#L167-L180))
and a resolver (`ResolvePlayerState`). Entities have neither.

**Consequence:** every section of the scope from §3 onward sits on a layer that must be built first.

### A2. Entity locomotion is a position lerp, not movement

`updateEntityMovement` ([Level.js:88-107](engine/v1/handlers/game/Level.js#L88-L107)) interpolates
`transform.position` along a fixed authored `movement.start`→`movement.end` segment, with
`backAndForth` / `repeat`. It writes position directly. There is no velocity, acceleration, turn
rate, facing, or goal-seeking for entities anywhere.

Every state in §4.2 that moves — Wander, Patrol, Chase, Search, Fleeing, Follow — needs
goal-directed steering. The substrate exists (the physics pipeline consumes `entity.velocity` at
[Master.js:244](engine/v1/physics/Master.js#L244), and `applyCorrection` is flag-driven rather than
player-only, [Master.js:129-164](engine/v1/physics/Master.js#L129-L164)), but nothing writes
horizontal velocity for a non-player entity today.

### A3. Non-player entities are never animated inside a level

`ResolveEntityAnimation` is entity-generic, but the level loop calls it for the player only
([Level.js:406](engine/v1/handlers/game/Level.js#L406)). The only other caller is the Simulator
([Simulator.js:403](engine/v1/handlers/game/Simulator.js#L403)).

§4.2's "optional idle animation", Guard's separate guard-idle variant, and Search's authored
`speed` modifier "slow prowl" all presuppose an entity animation drive that is not wired.

Related: [`Animation.js:354`](engine/v1/handlers/game/Animation.js#L354) logs on channel
`"Animation"`, which is **not** in `CONFIG.DEBUG.LOGGING.Channel`
([config.js:68-85](engine/v1/core/config.js#L68-L85)) — that warning is silently dropped today.
Entity AI will want its own channel(s) added there regardless.

### A4. There is no Level entity API to attach runtime control to

`ENGINE.Level` exposes level lifecycle plus `Player` only
([ini.js:57](engine/v1/core/ini.js#L57)). §2.5 (runtime-toggleable `unkillable`) and §2.6
(relationship changes "exposed as an API capability only") have no surface to hang off.

[`docs/todo`](engine/v1/docs/todo) already carries the full `Level.Entities` namespace
(`Get`, `SetState`, `DamageEntity`, `Kill`, `Heal`, …) as unbuilt backlog. Entity AI needs a subset
of it as a hard prerequisite.

### A5. No centralized damage function — and the player has no `hp`

The only two damage sites in the engine are `entity.hp--`
([Enemy.js:54](engine/v1/handlers/game/Enemy.js#L54)) and `applyPlayerDamage`
([Enemy.js:117-160](engine/v1/handlers/game/Enemy.js#L117-L160)). Both hardcode an amount of 1.

The player has **no `hp` field at all**. Player damage drops all collectibles, and death is
"damaged while holding zero" → `TriggerPlayerRespawnSequence`. §7.3's single function taking
`(target, source, amount)` therefore spans two unrelated damage models.

Note also: §7.3 says "physics being the only current path". That is not accurate — the overlap
*detection* is `DetectCombatOverlaps` in `physics/Collision.js`, but the damage application lives
in the `Enemy.js` handler.

---

## B. Premises in the scope documents that source contradicts

### B1. "Walkability is a real, queryable build-time classification" — it is not

`entity-ai-pathfinding-detail.md` ("Node generation", 4th bullet) treats build-time walkability as
existing. It does not.

Walkability today is a **runtime, per-contact** classification: `classifySurfaceContact`
([Correction.js:57-70](engine/v1/physics/Correction.js#L57-L70)) labels a *contact normal* as
`"walkable" | "sliding" | "wall"` against `CONFIG.PHYSICS.Correction.MaxAngleDelta`
([config.js:125-128](engine/v1/core/config.js#L125-L128)), with `Recover` hysteresis while sliding.
It needs a live contact and a reference normal.

There are no slope tiers, no per-face surface tagging, and no build-time surface classification of
terrain anywhere. Classifying walkable surface from triangle data at build time is new work, and it
is the *input* to everything else in the pathfinding document.

### B2. "Walkable chunks" have no basis in the terrain builder

`BuildTerrain` ([NewTerrain.js:58-73](engine/v1/builder/NewTerrain.js#L58-L73)) returns a flat array
of meshes, split only into `terrain` / `voidTerrain`. There is no adjacency, grouping, or
"pieces walkable between each other" concept at any stage.

Chunk grouping is the input to node generation, to gap detection, and to the pathfinding
document's explicit "chunk-scoped gathering" requirement. All of it is new.

### B3. No spatial acceleration structure to build the graph against

`BroadphaseCollectCandidates` ([Collision.js:319-420](engine/v1/physics/Collision.js#L319-L420)) is
a linear AABB scan over every terrain mesh, obstacle, void wall and entity, re-run per query.

The ray primitives needed for visibility-based adjacency do exist and are solid
(`RayTriangleSoupIntersect`, `RayDetailedBoundsIntersect`, `RayAABBDetailedBoundsIntersect` in
`math/Collision.js`), so line-of-sight is feasible. But node adjacency is pairwise-visibility over
N nodes, and each ray currently pays a full-scene linear scan. There is no structure to lean on.

Precedent worth weighing: [`DEFERRED.md`](engine/v1/docs/status/DEFERRED.md) already records that
void classification is the dominant build cost (~2.5 s on lvl2) and that `PointInsideMesh`'s linear
triangle scan is its hot spot. Build-time node generation lands in the same cost class.

### B4. Custom handlers have no payload delivery path

**Not a rule conflict.** `ENGINE_GAME_COMMUNICATION.md` §1's "never call game functions directly"
governs the engine importing from game files. A payload-supplied handler is the game *supplying an
alternative*, not the engine reaching into game code. Author's ruling, 2026-09-19. No rule amendment
is needed.

What is real is the mechanical gap. There is no channel to deliver a function through:
- `canonSchemas.json` supports `number | string | boolean | object | array | vector3`. There is no
  `function` dataType, so `normalizePayloadSchema` would fallback-strip one
  ([normalize.js:101-140](engine/v1/core/normalize.js#L101-L140)).
- The one function-shaped field in the engine, `sceneGraph.effects.underwater.particleHook`, is
  hardcoded `null` ([NewLevel.js:412](engine/v1/builder/NewLevel.js#L412)) and no game path sets it,
  so it is not a working precedent.

A handler passthrough in validate/normalize is therefore in scope, landing in the trigger pass and
reused by the custom pathfinding type.

### B5. §4.1 contradicted `docs/todo` — resolved

The scope says behavioural states are mutually exclusive (§4.1, single active state machine).
[`docs/todo`](engine/v1/docs/todo) recorded Entity AI default behaviours as *"not mutually
exclusive"*. **§4.1 is authoritative** (author, 2026-09-19); the todo line is stale and needs
correcting.

---

## C. Existing entity data that is dead, broken, or already compatible

### C1. Vestigial AI fields already in the movement schema

`chase`, `jumpOnSight`, `jumpInterval`, `disappear`
([canonSchemas.json:1806-1809](engine/v1/core/canonSchemas.json#L1806-L1809)) are authorable,
validated, normalized, and **read by nothing**. They are a first-draft AI sketch.

Their fate is decided by pass 0 (§D): each is resolved against the drafted built-in trigger
catalogue — absorbed by a real trigger type, or deleted. Leaving them inert is a trap for an author.

### C2. `attacks` is carried but unread, and its normalizer is broken

`attacks` is validated, normalized, merged through overrides, and written onto the built entity
([NewEntity.js:731](engine/v1/builder/NewEntity.js#L731)) — and consumed by nothing.

`normalizeAttacks` ([normalize.js:961-965](engine/v1/core/normalize.js#L961-L965)) has a `.map`
callback with no `return`, so every entity's `attacks` is an array of `undefined`. Already recorded
on [`docs/todo`](engine/v1/docs/todo) under COMBAT REWORK.

### C3. The §2 entity-type collapse needs no migration

`"npc"` is a legal `type` ([canonSchemas.json:1864](engine/v1/core/canonSchemas.json#L1864)) and is
in `ENTITY_TYPES` ([meta.js:322](engine/v1/core/meta.js#L322)), but **nothing dispatches on it**.
The only type dispatch in the entity path is `entity.type !== "enemy"` inside the combat damage
branches ([Enemy.js:52](engine/v1/handlers/game/Enemy.js#L52), [:98](engine/v1/handlers/game/Enemy.js#L98)),
and `type === "player"` / `"particle"` skips.

So §2's "Ally/NPC/Enemy are relationships, not types" already matches reality. The only requirement
is that the new work does not *introduce* type dispatch. The two `!== "enemy"` checks in `Enemy.js`
become wrong under §2 and need replacing with a relationship/eligibility test.

### C4. Test content available for verification

`testGame/levels/entities.json` authors: 1 `enemy` (`enemy.scout-drone`), 1 `npc` (`npc.engineer`),
1 `collectible`, 1 `projectile` blueprint, 3 generic `entity` blueprints. There are **no** patrol
routes, factions, entity groups, or multi-entity encounters. Anything to be ARGUS-verified needs
test content authored first — that is its own small pass at the end.

---

## D. Decisions taken (author, 2026-09-19)

| # | Decision |
|---|---|
| D1 | **Pathfinding stays in this update**, sequenced last. |
| D2 | **The player gets `hp`, and is decoupled from collectibles entirely.** The collectible-as-life-buffer model was an agent-added Sonic pastiche from ~6 months ago and is due a full overhaul anyway; collectibles are practically non-functional today, so no gameplay regression is possible. |
| D3 | **Payload-supplied handlers are in scope and are not a rule violation** (see B4). What is needed is a validate/normalize passthrough for function-typed fields. |
| D4 | **File layout:** rename `handlers/game/Enemy.js` → `handlers/game/Combat.js`; create `handlers/game/Entity.js`. **No pathfinding file.** Build-time graph generation belongs to the terrain system — it goes in `builder/NewTerrain.js` and the graph lands on the `sceneGraph`. Runtime path selection is entity-specific and goes in `Entity.js`. |
| D5 | **§4.1 is authoritative** — states are mutually exclusive. The `docs/todo` line saying otherwise is stale and needs correcting. |
| D6 | **The vestigial movement fields (C1) are resolved by pass 0**, against the drafted trigger catalogue. |

### Consequences worth noting

- `NewTerrain.js` is 75 lines today and does nothing but mesh construction. The graph build will
  dominate it. That is architecturally correct per `MODULE_GROUPS.md` (builders construct scene
  data; handlers orchestrate), but it makes the file a major module rather than a thin one.
- Decoupling the player from collectibles is contained: `Collectible.js` keeps incrementing
  `playerState.collectibles` and firing `COLLECTIBLE_PICKED_UP`; only the damage path stops reading
  it. The counter becomes pure score.
- Renaming `Enemy.js` → `Combat.js` touches 3 importers
  ([Level.js:30](engine/v1/handlers/game/Level.js#L30) and the two symbols it re-exports) plus
  `MODULE_GROUPS.md` §4 and `system_map/handlers.md`.

---

## E. Pass breakdown

Sized in ED passes. Each significant pass carries ERA + DRYAD after it per `CLAUDE.md`.

| # | Pass | Depends on | Notes |
|---|---|---|---|
| 0 | **Trigger catalogue & state table** — walk every behavioural state/action in §4.2 and draft its built-in trigger list. Design only, no code. | — | Resolves D6 and the scope's own open item (§4.2, Ally beyond Follow). **This is the next step.** |
| 1 | **Entity runtime foundation** — create `Entity.js`; entity action authority (the `SetPlayerAction` equivalent), wire `ResolveEntityAnimation` into the entity loop, add the missing `Animation` log channel plus an Entity/AI channel, velocity-driven goal steering with facing + turn rate, absorbing the `start→end` lerp | 0 | No AI yet. Makes an entity able to *go somewhere and animate*. Directly testable. |
| 2 | **Level.Entities API subset** — `Get`/`GetAll`/`SetState`/`SetTransform`, plus the hooks §2.5/§2.6 need | 1 | Small. Could fold into 1. |
| 3 | **Behavioural state machine + triggers** (§4, §5) — state table, single active state, trigger arrays, priority/met-set resolution, state modifiers, handler passthrough (D3); Idle, Guard, Wander, Flee, Follow, Search, Chase in Direct form; schema + validate + normalize | 0, 1, 2 | The structural core. Large. |
| 4 | **Relationships, factions, targeting** (§2, §3) — `allies`/`enemies` + normalize-time mirroring, contradiction→Neutral + warn, `faction_` prefixing, shared sense config, `sensing`/`seeing` triggers, `targets:{entities,factions}`, selection mode, `targetLost` duration | 3 | Shares trigger plumbing with 3; sequential is safer. |
| 5 | **`Combat.js` rename + player health model** — rename, decouple the player from collectibles, give the player `hp`, rework death to hp-zero | 1 | Per D2. Reaches into respawn and invulnerability; kept separate from the damage function so the blast radius stays legible. |
| 6 | **Centralized damage + immunity** (§2.4, §2.5, §7.3) — one damage function `(target, source, amount)`, ally kill-immunity clamp, `unkillable`, player-damage-flip opt-in; replaces the two `!== "enemy"` dispatches (C3) | 4, 5 | |
| 7 | **Pathfinding graph — build** (`NewTerrain.js` → sceneGraph) — build-time walkable-surface classification (B1), walkable chunk grouping (B2), node generation with clearance + midpoint fallback + `maxEntitySize`, visibility adjacency | 1 | Independent of 3–6. **Highest-risk pass**; see B1–B3. |
| 8 | **Pathfinding graph — corridors & gaps** — parent/subnode corridor collapsing, authored custom paths on terrain pieces, gap nodes + per-entity jump feasibility | 7 | |
| 9 | **Pathfinding consumption** (`Entity.js`) — Direct/Simple/Dynamic/Random/Custom types, value heuristic, chunk-scoped gathering, re-path triggers, Chase's Direct override, Patrol's LOS-first rule, simDistance fallback tiers, the Patrol state itself | 3, 8 | |
| 10 | **Attack state** (§4.3) — Attack as a real state with an authored payload; fix `normalizeAttacks` (C2); optional non-blocking events | 3, 6 | Mechanical hit registration stays out per §8. |
| 11 | **Test content + ARGUS verification** — author patrol routes, a faction pair, an ally, a chase encounter in testGame | all | Not an ED pass — testGame is out of ED/ERA/DRYAD scope. |

**Estimate: 10 ED passes, plus a design pass (0) and a content/verification pass (11).**

Passes 7–9 are where the estimate is least trustworthy. They rest entirely on systems that do not
exist (B1, B2) and carry a known build-cost hazard (B3) — the engine has already been bitten twice
by build-time linear scans over triangle data, both still open in `DEFERRED.md`. Expect that
estimate to move once pass 7 is scoped in detail.

---

## F. Still open

- **§4.2's own open item** — whether Ally needs anything beyond the Follow state. Handled by pass 0.
- **Damage-amount authoring shape** — §4.3 explicitly leaves Attack's payload fields
  (damage/range/windup/cooldown) as an implementation decision. Settled in pass 10, not before.
- **Cross-entity path caching** — the pathfinding doc flags "many entities sharing one A/B pair" as
  a possible future consideration, explicitly not a requirement. Out unless it surfaces in pass 9.
