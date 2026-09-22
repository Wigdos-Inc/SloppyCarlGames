# Entity AI — Feature Scope

This document defines the intended behavior of the Entity AI feature. It is a scope specification, not an implementation plan — it describes what the system should do and why, not how it should be built against the current codebase. One item remains explicitly open (marked below); everything else is settled.

---

## 1. Applicability

Entity AI applies to all entities except the player. The player is input-controlled and has no AI decision-making layer.

The following entity types are explicitly **out of scope** for this feature, each for a distinct reason:

- **Collectibles** — only participate in physics/collision; no behavioral AI needed.
- **Projectiles** — no behavioral AI; created on-demand with optional physics, mandatory collision, optional homing. Delegated to the future Combat Rework, since projectiles are tied to attack mechanics that don't exist yet.
- **Particles** — no behavioral AI; created by an authored generator, physics-optional.
- **Boss** — likely deserves its own entity type eventually, but undefined until Combat exists. Not designed here.

---

## 2. Entity Types and Relationships

There is a **single underlying entity type** covering what might otherwise be imagined as "Ally," "NPC," and "Enemy." Those are not separate types — they are **relationships**, derived from authored data, not dispatch-level distinctions. (Particle, Projectile, and the future Boss type remain genuinely separate entity types — see Section 1 — because they have real behavioral/dispatch differences. This collapse applies only to the Ally/NPC/Enemy space.)

### 2.1 Relationship model

- Each entity may optionally author `allies` and/or `enemies` arrays (listing other entity ids and/or faction ids — see Section 3.3).
- **Absence of any authored relation implicitly means Neutral.** There is no separate "neutral" list to author.
- Whether one entity can even attempt to attack another is governed entirely by the **targeting system's authored eligibility** (Section 3), not by relationship type. A game may author ally-vs-ally or ally-vs-player attack eligibility if it wants to (e.g. sparring) — this is a deliberate design freedom.

### 2.2 Ally-relationship mirroring

Authoring an ally relationship from one side is sufficient — the engine mirrors it onto the other side **at normalization time** (the same category of mechanism as faction-id prefixing, Section 3.3). This is unconditional for all ally relationships, entity-to-entity and entity-to-player alike, with no special-casing required per pair.

Rationale: requiring both sides to independently author the relationship creates a silent failure mode (one side believes protection exists; it doesn't, because the other side was never authored). Mirroring removes this without weakening authoring freedom elsewhere.

### 2.3 Conflicting relationship claims

If a contradiction arises — one side authors "ally," the other authors "enemy" toward the same pair, or a single entity's own list contains the same id in both `allies` and `enemies` — the engine resolves this to **Neutral** (all relevant entries removed on both sides) and emits a **warning log**. This is never a hard validation error (see Section 7.2).

### 2.4 Kill-immunity

Entities in a mutual ally relationship **cannot reduce each other's health to 0**, even if attack-eligibility between them is authored (e.g. sparring). This is enforced via **clamping** (`Math.max`), not by voiding the damage instance — partial damage still applies and accumulates normally; only the portion that would cross the floor is absorbed. The floor value (0 vs. 1) is a simple authored/ternary choice.

Hitting this limit emits a warning log, so a developer isn't confused by e.g. a health value that won't reach zero.

This check is performed by a **centralized damage function** (see Section 7.3), not scattered across individual damage sources.

### 2.5 Unkillable flag

Separate from ally relationships: entities may carry a standalone `unkillable` flag, independent of any relationship, toggleable at runtime via the Engine API. This covers narrative cases like "these two NPCs must never finish each other off" without forcing an ally relationship (and its targeting/faction implications) onto them.

### 2.6 Runtime relationship changes

Changing an entity's relationship at runtime (e.g. a captured enemy becoming an ally) is **not** a built-in rules system — it's exposed as an **API capability only**. Reasons for switching vary too much per game to standardize.

**One built-in exception:** an entity being damaged by the player can, if authored/opted-in, automatically flip to an enemy-of-player relationship. This specific case is common enough across games to warrant a standard, optional, engine-owned mechanism.

---

## 3. Targeting System

### 3.1 When targeting runs

Targeting only runs for an entity while its **active behavioral state** has an authored targeting-flavored trigger listening for it. It is not a continuously-running background process for every entity — this is an efficiency requirement, not an incidental detail.

### 3.2 Sensing vs. Seeing

Two built-in trigger types drive target acquisition:

- **`sensing`** — detects candidates within the entity's sense range, ignoring obstructions (goes through walls).
- **`seeing`** — same sense range, but requires line-of-sight (blocked by walls).

Both read from **one shared sense configuration, authored once on the entity's own definition** — not repeated per trigger. This avoids re-specifying the same radius/config on every trigger that wants to use targeting.

### 3.3 Faction

An entity may optionally author a faction id as part of its own definition. At normalization time, the engine prefixes it with `faction_` to guarantee it can never collide with an entity id/name.

### 3.4 Eligibility filter (`targets`)

Each targeting trigger instance authors its own `targets` field, structured as:

```
targets: {
  entities: [ ... ],
  factions: [ ... ]
}
```

Two separate sub-arrays — entity ids and faction ids are never mixed into one array.

### 3.5 Selection algorithm

1. Collect candidates satisfying both the trigger's `targets` eligibility and the entity's sense range/obstruction rule.
2. If none qualify: no target is acquired, nothing fires.
3. If multiple qualify: a **selection mode** picks exactly one. Default is nearest; an authored override is available for other selection logic.

**There is no hardcoded default favoring the player.** Not every entity needs to care about the player — if the player isn't an eligible/detected candidate for a given trigger, it simply isn't a factor.

### 3.6 Trigger shape and terminology

A trigger (targeting or otherwise — see Section 5) has the shape:

```
{ type, <authored parameters specific to type>, action, priority }
```

- `type` selects the built-in check (or `"custom"` — see Section 5.4).
- `action` names the destination behavioral state to transition to (or is omitted, meaning "stay in the current state and just react/recompute internally").
- **`target` is a reserved term meaning the acquired entity** (the result of targeting) — it is never used as the field name for the destination state. This distinction matters: `action` is what a trigger does; `target` is who a trigger found.

A successful `sensing`/`seeing` trigger can transition state via `action`, exactly like any other trigger (e.g. an NPC's `seeing` trigger might lead to an "Approach" state; an aggressive entity's might lead to "Chase").

### 3.7 Chase duration / giving up

No general "how long does pursuit last" mechanism is needed. Three things already bound this without any new system: the simDistance cutoff (complex AI stops running outside simDistance), chunk-locking (an entity can already be authored to never leave a terrain/chunk), and death.

The one real, specific gap — how long an entity keeps chasing after losing sight of its target before giving up — is solved with a **single authored numeric parameter (duration in seconds)** on the existing `targetLost` trigger type. The trigger's condition only evaluates true once sight has been *continuously* lost for at least that duration; reacquiring sight before then resets it with no effect.

(An entity-level "patience" field, a per-state drain-rate modifier, and a dedicated "outOfPatience" trigger type were considered and explicitly rejected as unnecessary complexity for what this one narrow case actually needs.)

---

## 4. Behavioral States

### 4.1 Mutual exclusivity

Behavioral states are **mutually exclusive** — an entity is in exactly one behavioral state at a time (a single active state machine), never a layered/concurrent set.

### 4.2 State list

- **Idle** — no movement/pathfinding, optional idle animation. Default/fallback state.
- **Wander** — goal is a random point within an authored wander radius (home point + radius authored). Movement to that goal uses the entity's own authored pathfinding type (see Section 6) — Wander does not hardcode a specific pathfinding type.
- **Patrol** — ordered, authored waypoints. Checks direct line-of-sight between consecutive points first; falls back to node-based pathfinding if blocked (see Section 6).
- **Guard** — stands at an authored position. The only thing distinguishing it from Idle is an authored, separate "guard" idle animation variant. Detection-reactivity and any "return to post" behavior are general trigger-system concerns (Section 5), not owned by Guard itself.
- **Chase** — triggered by sight/sense (Section 3). While the target remains within direct sight/sense range, movement is forced to Direct (straight line), overriding the entity's authored pathfinding type. When the target is out of that direct range but still being pursued (e.g. around a corner), falls back to the entity's authored pathfinding type. Exits into Search or Attack/Combat via authored triggers.
- **Search** — the less-direct counterpart to Chase; investigates a target's last-known position when lost.
- **Fleeing** — goal is a point away from the perceived threat, reached via the entity's authored pathfinding type.
- **Follow** *(Ally-specific)* — target is always the player. Requires: an authorable offset (position relative to the player, so they don't occupy the same space), rubber-banding back toward the target when separated by any cause, and collision enabled (no floating or clipping through geometry).
- **Attack** — see Section 4.3.
- **Combat** — see Section 4.4. Reserved state name only; full design is out of scope for this feature.

> **OPEN ITEM:** Whether Ally needs anything beyond the Follow state (listed above) was not exhaustively re-confirmed after the entity-type collapse (Section 2). Worth a final explicit check before implementation locks this in.

### 4.3 Attack

Attack is a real, distinct behavioral state, coexisting with Combat (not folded into it, not a stepping-stone toward it). It represents the lightweight, common case — e.g. a bump/lunge/hazard-style interaction.

Per the core architectural principle (Section 7.1), Attack's mechanic is **fully engine-owned**, driven by authored payload data (exact field shape — damage, range, windup, cooldown, etc. — is an implementation decision, not specified here). Any events fired alongside are optional and non-blocking for game reactivity; nothing about the mechanic itself depends on the game responding.

### 4.4 Combat (explicitly out of scope — see Section 8)

Combat is a real, tracked behavioral state — a trigger's `action` may validly reference `"Combat"` as a destination — but its internal design (phases, patterns, damage, timing) is **not part of this feature**. It belongs to a separate future "Combat Rework," because it depends on attack/projectile registration systems that don't yet exist mechanically.

Combat is core scope for the flagship game via boss encounters specifically (platformers, including Sonic-style ones, have boss fights) — it is not merely a nice-to-have for other titles. But designing it now would mean designing against unknowns.

---

## 5. Behavior Triggers

### 5.1 Architecture

- All states live as entries in an object, keyed by state name.
- Each state entry contains a `triggers` array — **multiple trigger instances are allowed per state**, each independently evaluated every tick.
- A state entry may also carry other keys acting as authored **modifiers** — tuning values that change how the state's built-in mechanic runs without changing the mechanic itself (e.g. a `speed` modifier making Search feel like a slow prowl rather than a normal-speed investigation).

### 5.2 Trigger evaluation and conflict resolution

Every trigger in a state's array is evaluated every tick, regardless of earlier matches (no short-circuiting). Every trigger that evaluates true is collected into a temporary "met" set.

Each trigger carries a `priority` integer field (authored, expected but not required; defaults to 0). The met trigger with the **highest priority** wins. Ties are broken by authored array order (first wins).

### 5.3 States with no triggers

If a state has no triggers authored at all, it can never be entered automatically by the trigger system. The only way in is a manual API call — a deliberate design choice for purely scripted-only states (e.g. cutscene-driven poses).

### 5.4 Custom triggers

`"custom"` is a legal value for `trigger.type`. When used, the engine expects a `trigger.handler` function attached to that specific trigger instance, and runs it in place of the built-in check. This is per-trigger-instance — a single state's triggers array can freely mix built-in-typed and custom-typed triggers.

**Handler-based, not event-based, is the general norm for any custom alternative to built-in Entity AI functionality** (custom pathfinding, custom triggers, and any future custom behavior mechanism), because the engine needs a concrete return value to act on the same tick — events in this engine are one-way notifications and getting real data back out of one requires a fragile mutate-and-hope pattern.

---

## 6. Pathfinding

Pathfinding is a large, self-contained sub-system. Full detail is provided as a companion document (see file list). Summary:

- Terrain generates pathfinding nodes on its own surface at **build time**, maintaining a clearance distance from obstructions (falling back to placement at the midpoint between obstruction pairs when clearance can't be met, producing layered generation in tight spaces).
- Node adjacency is visibility-check based, computed once at build time.
- Terrain pieces that are walkable between each other are grouped into **walkable chunks**; nodes are generated/linked per chunk.
- Gaps between chunks may carry gap-distance metadata; an entity's own jump capability determines whether that edge exists in its personal traversal graph.
- Tight corridors collapse into a single cheap edge between two "parent" nodes, only unpacked into their full subnode chain when actually used as part of a path. This applies both to auto-detected tight spaces and to explicitly authored custom paths on terrain pieces.
- Node values are a heuristic (distance-from-direct-line + distance-to-destination), not a cost-accumulation shortest-path model — deliberately biased toward natural-looking routes over provably optimal ones.
- Entities declare a pathfinding type: **Direct** (straight line, no graph), **Simple** (highest-value chain), **Dynamic** (random pick among top 3 chains), **Random** (built live, node-by-node, with an anti-backtrack rule), or **Custom** (handler-based, per Section 5.4).
- Chase specifically forces Direct movement while the target is within direct sight/sense range (Section 4.2), falling back to the entity's authored type otherwise.
- Re-path triggers (for node-based pathfinding types only) fire on a deviation threshold (target moved beyond a distance from where the path was aimed) or an obstruction (the current chain became physically blocked) — not on a timer.
- simDistance gates full pathfinding; entities outside it fall back to Direct, Random, or standing still.
- Sloped/inclined surfaces that qualify as walkable (per the existing slope-eligibility tiers) are valid node placement surfaces, not just flat ground.

---

## 7. Cross-Cutting Principles

These are standing rules for this feature, not one-off decisions.

### 7.1 Engine-owned, payload-driven

Built-in functionality must be **fully engine-owned**, driven by authored payload data — never dependent on a game-supplied handler or event firing in order to function. Events may exist alongside as optional, non-blocking, fire-and-forget reactive hooks (sound, camera shake, UI, etc.), but nothing core/vital may block on or require the game responding "in time" at an unpredictable frame.

The only legitimate exception is `"custom"` variants (Section 5.4), where the game is explicitly *replacing* engine logic with its own — there, a handler with a real return value is correct.

### 7.2 Error severity

Hard validation errors (payload/entity rejection) must **never** be used for something that does not actively prevent the level from running. A single mis-authored entity does not justify rejecting the whole payload. Prefer graceful degradation (resolve to a safe default, emit a warning log) over rejection wherever the level can still run correctly.

### 7.3 Centralized damage function

Damage should be applied through one centralized function accepting the target entity, the damage source, and the damage amount — not scattered ad-hoc subtraction across individual systems (physics being the only current path; the API and other future sources will also need to apply damage). This is also where ally kill-immunity (Section 2.4) is checked before finalizing any damage instance.

---

## 8. Explicitly Out of Scope

- **Combat's internal design** (phases, patterns, damage, timing) — separate future feature ("Combat Rework"), blocked on attack/projectile registration systems that don't yet exist. Combat exists as a reserved, recognized state name only (Section 4.4).
- **Attack's actual mechanical execution** (real damage/hit registration) — the behavioral placement and trigger integration are fully specified here (Section 4.3), but the underlying attack/projectile registration systems are stubs, same dependency as Combat.
- **Projectiles** — no behavioral AI, delegated to Combat Rework (Section 1).
- **Boss as a distinct entity type** — future discussion, undefined until Combat exists (Section 1).
