# Entity Runtime Shape: Scope

0.35.9 (todo: "Refactor Parts & Models Shapes"; moved there from 0.37.1 on 2026-10-27), written 2026-10-25. This is a scope only, and building any of it needs a separate go-ahead.

It covers the runtime entity object that [`BuildEntity`](../../../builder/NewEntity.js) returns, and the player fields [`createDefaultPlayerState`](../../../player/Master.js#L49) adds.

Entity AI (0.38) follows later, so the shape should leave room for AI state. See section 5.

Section 6 lists the decisions still open.

---

## 1. What exists today

**One build site.** Every entity, the player and particles included, comes from `BuildEntity`. The player is then extended in place by `createDefaultPlayerState` (`Object.assign`).

**Already grouped:** `transform`, `collision`, `performance`, `state`, `physicsRuntime`, the player's `boost` and `invulnerable`.

**Loose at the top level**, with the modules that read them:

| Field | Read in |
|---|---|
| `submergence` | physics/Master, physics/Forces, math/Forces |
| `underwater` | physics/*, player/*, camera/*, Animation |
| `buoyancyForce` | physics/Master, physics/Correction, camera/Modes |
| `grounded`, `launched` | physics/*, player/*, camera/*, Enemy |
| `contactGrace`, `gripDemand` | physics/*, player/Master |
| `surfaceContact`, `surfaceNormal`, `referenceNormal` | physics/*, player/* |
| `alignedUp` | physics/*, player/*, camera/* |
| `gravityScale`, `dragFree`, `staticFriction` | player/Movement writes, physics/Forces and physics/Master read, camera/Modes reads `gravityScale` |
| `facing` | player/*, physics/Correction, camera/Modes |
| `modelTurnRate` | Animation, player/Master |
| `hitboxActive` | physics/Collision, player/Master |

**Dead:** `state.lastJumpMs` and `state.activeAnimation` have no readers.

**Player overlap:** the player re-sets `hitboxActive: false` and replaces `modelTurnRate` on top of the base entity's values ([Master.js:56](../../../player/Master.js#L56), [Master.js:69](../../../player/Master.js#L69)). It also adds loose jump fields (`jumpStartY`, `jumpApexY`, `jumpWindow`).

**Game-facing:** no game reads these fields. `PLAYER_GROUNDED_CHANGE` copies `grounded` into its own payload ([physics/Master.js:275](../../../physics/Master.js#L275)), and that payload key stays as it is.

---

## 2. Proposed shape (author, 2026-10-25)

```js
physics: {
	runtime   : { ... },  // Today's physicsRuntime, unchanged inside.
	correction: { grounded, launched, contactGrace, gripDemand, surfaceContact, surfaceNormal, referenceNormal },
	collision : { ... },  // See D1.
	forces    : { submergence, underwater, buoyancyForce, gravityScale, dragFree, staticFriction },
},
movement: { ..., progress, direction },  // Today's state. See D2.
```

**Why `correction`:** every contact field is written or consumed by surface correction. "Contact" was the first proposal, and the author renamed it.

**Why water goes under `forces`:** submergence and buoyancy only feed force assembly. The movement-set modifiers (`gravityScale`, `dragFree`, `staticFriction`) are hooks physics/Forces applies.

---

## 3. The player follows the same build

The player is an entity at its core, so it uses the base groups. It doesn't redefine base fields.
- `hitboxActive` and `modelTurnRate` stop being re-set on top of the base values. See D4.
- Player-only fields get grouped the same way. For example, `jump: { startY, apexY, window: { buffer, coyote } }`.
- Single player-only flags (`stoppingActive`, `primaryOppositeHeld`, `previousAction`, `attackFlag`) can stay loose. See D5.

---

## 4. Work involved

- **Readers:** about 140 references across roughly 10 files: physics/Master, Correction, Collision and Forces; player/Master and Movement; camera/Master and Modes; Render; Animation; Level; Enemy.
- **Not a blind rename:** `facing`, `underwater` and `direction` also exist on camera state, render effects and loop data. Each match has to be checked to confirm it's the entity's field.
- **Size:** close to line-neutral. Each field gains a group prefix.
- **Docs:** the system_map entries for physics, player and builder, and the `gravityScale`/`buoyancyForce` example in ENGINE_SEMANTICS.

---

## 5. Entity AI preparation (0.38)

These items from the 0.38 todo touch the same object, so the shape should have room for them:
- `velocity` becomes `velocity.start` plus `velocity.max`. The player loses `maxSpeed`.
- SimRadius becomes a calculation from `velocity.max`, so `collision.simRadiusPadding` and the player's override of it go away.
- AI decision state (targets, aggro, pathing) needs a home. It shouldn't land loose at the top level. A dedicated group, like `ai`, fits the pattern above.

---

## 6. Open decisions

- **D1. `physics.collision`.** Today's `collision` holds physics bounds (`aabb`, `simRadiusAabb`, `physics`, `rest`), and also the combat `hurtbox` and `hitbox`. It is null when no part adds to bounds. The entity's full box (`fullAabb`, every part) sits outside it. Its inner `physics` is the solid layer from the 0.13 physics/hurtbox/hitbox split. The todo plans to rename it (e.g. `solid`), which also removes the `physics.collision.physics` problem below.
  - Does the whole group move under `physics`? Its inner `physics` field would then read `physics.collision.physics`.
  - Or do only the physics bounds move, with hurtbox, hitbox and `hitboxActive` in a combat group?
- **D2. `state` → `movement`.** The entity already has a `movement` field: the authored path (`start`, `end`, `speed`, `jump`).
  - **Option A:** merge `progress` and `direction` into that `movement`, next to the authored values.
  - **Option B:** keep them in a separate group under another name.
  - **Recommendation:** A. Both fields only exist for that path.
- **D3. `alignedUp`, `facing`, `modelTurnRate`.** Not placed yet.
  - `alignedUp` is written from the surface each physics step ([physics/Master.js:68](../../../physics/Master.js#L68)), so it fits `physics.correction`.
  - `facing` is written by player Movement and physics/Correction.
  - `modelTurnRate` is an air/water rate pair that Animation applies.
- **D4. Player `modelTurnRate`.** The player scales the water rate by `underwaterAirControl`.
  - Should this happen where the base value is built, or stay a player-side override?
- **D5. Loose player flags.** Do they stay loose, or go into a group?
