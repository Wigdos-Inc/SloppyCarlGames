# Game-Authored Templates: Scope

0.35.6, written 2026-10-26, decisions settled 2026-10-28. This is a scope only, and building any of it needs a separate go-ahead.

**Origin.** 0.35.5 added sprite particles. The only way to make one was a `shape` particle override. That broke a standing decision: a particle's `part` is template-owned ([system_map/builder.md](../../system_map/builder.md)), because shape is part of its core definition.

Particles were never game-authorable because each generator would have to repeat the full definition. Game-side templates solve that repetition for every template type, not only particles.

Section 4 carries over two particle items that wait on this. Section 6 records the decisions.

---

## 1. Proposal (author, 2026-10-26)

- **A `templates` object.** Level payloads get an optional `templates` object. It accepts the same collections the engine ships with, except `levels`, which stays engine-only (Simulator-only today).
- **Templates go first.** `templates` is validated and normalized before the rest of the payload.
  - It is especially failure-prone, because the rest of the payload may depend on it being correct.
  - An invalid template rejects the level (D2).
- **Registered like engine templates.** Valid templates are registered in the engine. The payload then references them exactly the way it references engine-owned templates.

---

## 2. What exists today

**Engine template collections:**

| Collection | Source | Referenced from a payload by | Unknown id today |
|---|---|---|---|
| PlayerCharacters | [player/characters.json](../../../player/characters.json) | `player.character` | Warns, uses the first character |
| Terrain | [terrain.json](../../../builder/templates/terrain.json) | terrain object with `shape: "template"` | Warns, drops the entry |
| Obstacles | [obstacles.json](../../../builder/templates/obstacles.json) | obstacle with `shape: "template"` | Warns, drops the entry |
| Characters | [characters.json](../../../builder/templates/characters.json) | `entityBlueprints` ref, `type: "character"` | Warns, drops the entry |
| Enemies | [enemies.json](../../../builder/templates/enemies.json) | `entityBlueprints` ref, `type: "enemy"` | Warns, drops the entry |
| Projectiles | [projectiles.json](../../../builder/templates/projectiles.json) | `entityBlueprints` ref, `type: "projectile"` | Warns, drops the entry |
| Particles | [particles.json](../../../builder/templates/particles.json) | `particle.id`, `SpawnParticles` `id` | Warns, drops the generator |
| Textures | [textures.json](../../../builder/templates/textures.json) `.textures` | `texture.generated.id`, decal texture ids | Warns, uses a fallback texture |
| Scatter | [textures.json](../../../builder/templates/textures.json) `.scatterTypes` | `detail.scatter[].typeID` | Warns, drops the entry |
| Levels | [levels.json](../../../builder/templates/levels.json) | Simulator only | Stays engine-only |

**There is no single registry.**
- About ten modules import the template JSON directly: normalize, NewTemplate, NewObject, NewTexture, NewScatter, NewVoid, NewParticles, Simulator, player/Master and player/Model.
- At boot, [`InstanceEngineTemplates`](../../../builder/templates/Instance.js#L181) instances that imported data in place, so every importer sees the instanced objects.
- `ENGINE.Blueprints` exposes raw clones of them.

**Engine templates bypass the payload boundary.** They are authored already compliant, and only Instance.js converts their units. Game templates are payload data, so they must go through validate.js and normalize.js. They must come out in exactly the same shape Instance.js produces, so nothing downstream can tell the two apart.

**Payload schemas.**
- Collections built from parts (terrain, obstacles, characters, enemies, projectiles, particle `part`) can reuse the existing `levelPart`/`levelObject`/blueprint schemas.
- Textures, scatter types, player characters and the particle template's own tuning fields have no payload schema today.

**Template ref `type` does two jobs.** On an `entityBlueprints` ref it picks the collection and sets the collision default (`character` → `"entity"`, `enemy` → `"enemy"`, [normalize.js:809](../../../core/normalize.js#L809)).

**Generators today.** A generator's `position` is an offset from the carrier's center that rotates with the carrier. Its velocity is world-space and does not rotate ([NewParticles.js:233](../../../builder/NewParticles.js#L233), [:418](../../../builder/NewParticles.js#L418)). That is why the hole smoke needs a velocity override to point out of the wall.

---

## 3. Work involved

- **Validation first.** validate.js validates `templates` before the rest of the level payload. Any error in it rejects the level (D2).
- **Normalizing templates.** Each collection needs a normalize path that produces Instance.js's output: unit instancing, decal and sprite image loads, scatter quality tiers. Collections without a schema get one. Optional fields get their normal payload fallbacks.
- **Dependency order.** Templates can reference each other: a game terrain template can use a game texture, a scatter type or a game particle generator. They normalize and register in order: textures, scatter, particles, then the part-built collections and player characters.
- **Registration in place (D6).** Instance.js gets a register and a clear function.
  - Register writes normalized game templates into the instanced collection objects every importer already holds, so none of the ten import sites change.
  - Where a game id matches an engine id, register stashes the engine entry and the game one replaces it (D3). Clear removes game entries and restores the stashed engine ones.
  - normalize's id sets ([normalize.js:805-806](../../../core/normalize.js#L805-L806)) are built once at load today. They become live lookups, including the runtime `SpawnParticles` path.
- **npcs (D1).** `templates.npcs` is one collection. Its entries register into both the Characters and Enemies collections, so a blueprint ref of either `type` finds them. The ref's `type` keeps setting the collision default until 0.38.
- **Lifetime (D4).** Register at CreateLevel, after `templates` normalizes and before the rest of the payload's id checks. Clear at ClearLevel.
- **Generator attachment (D7).** See section 4. Existing generators migrate: testGame's torch (`entities.json`, `levels.json`) and hole, and LSM's `furniture.js`.
- **Docs.** The builder and core system_map entries, plus MODULE_GROUPS if normalize starts importing Instance.js.

---

## 4. Carried over from 0.35.5

These wait on game-authored particle templates. (The `shape` particle override was already removed in the 0.35.5 plane rework.)
- **Give the testGame hole sprite smoke.** Level 1 stage 2's `scale-wall-right` generator emits the engine's 3D `smoke`. It would reference a game particle template whose part is a sprite plane.
- **Attach generators by face.**
  - **`side`** picks a face of the carrier: `top`, `bottom`, `front`, `back`, `left`, `right`. It is required in the engine, expected from games, and falls back to `top`. Center emission goes away.
  - **Placed like child parts.** `side` works like a part's `attachmentPoint`, and everything else uses the carrier's own axes, which rotate with it ([NewEntity.js:178-183](../../../builder/NewEntity.js#L178-L183)). There is no per-face frame.
  - **`position`** offsets the generator from that face's center, like a part's `localPosition`.
  - **`area`** is a box `{x, y, z}` centered on the generator, like a part's dimensions. Particles spawn uniformly inside it. A zero axis is flat along that axis, so a patch on the `left` face is `{ x: 0, y: 0.4, z: 0.6 }`. A zero box is a single point.
  - **Velocity** rotates with the carrier. A template authored with +Y velocity rises on every face, and the hole points its smoke out of the wall with a velocity override (−x on `scale-wall-right`), which now turns with the wall.
  - **Runtime generators.** A `SpawnParticles` request with a `target` takes the same `side`, `position` and `area` in place of its center `offset`.

---

## 5. Out of scope

- Session-wide registration through the ENGINE API, i.e. templates registered once and shared by every level.
- Merging the engine's Characters and Enemies collections into one, and replacing the ref `type` collision default. Both belong to 0.38 Entity AI.
- Sprite ENGINE API (todo, Level API "Sprites").

---

## 6. Decisions (author, 2026-10-28)

- **D1. Collections.** Every engine collection except `levels`. Characters and enemies merge into one game-side collection, `npcs`, with no per-type behaviour. The engine keeps its own Characters/Enemies split until 0.38.
- **D2. Failures.** An invalid template rejects the whole level payload. "Invalid" means the same validate.js rules as the rest of the payload (required fields, types, structure). A template does not need to spell out every optional field.
- **D3. Id collisions.** A game template overrides the engine template with the same id for the level, including fallback ids such as texture `none`.
- **D4. Lifetime.** Per level. ClearLevel drops them, and a game reuses templates across levels by passing the same object in each payload.
- **D5. `entityBlueprints`.** Kept. Blueprints can reference game `npcs` and `projectiles` the same way they reference engine templates.
- **D6. Registry.** Merged in place into the instanced collections by Instance.js (section 3).
- **D7. Generator attachment.** `side` required (games: expected, fallback `top`), `area` is a `{x, y, z}` box, and `position`, `area` and velocity all use the carrier's axes, consistent with child parts. Runtime generators with a `target` place the same way (section 4).
- **D8. `ENGINE.Blueprints`.** Engine-only. Its raw clones are separate objects, so the in-place merge never reaches them.
