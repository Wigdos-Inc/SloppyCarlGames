# Game-Authored Templates: Scope

0.35.6, written 2026-10-26. This is a scope only, and building any of it needs a separate go-ahead.

**Origin.** 0.35.5 added sprite particles. The only way to make one was a `shape` particle override. That broke a standing decision: a particle's `part` is template-owned ([system_map/builder.md](../../system_map/builder.md)), because shape is part of its core definition.

Particles were never game-authorable because each generator would have to repeat the full definition. Game-side templates solve that repetition for every template type, not only particles.

Section 4 carries over two particle items that wait on this. Section 6 lists the decisions still open.

---

## 1. Proposal (author, 2026-10-26)

- **A `templates` object.** Level payloads get an optional `templates` object. It accepts the same collections the engine ships with, except `levels`, which stays engine-only (Simulator-only today).
- **Templates go first.** `templates` is validated and normalized before the rest of the payload.
  - It is especially failure-prone, because the rest of the payload may depend on it being correct.
  - How strict that failure is remains open (D2).
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
- At boot, [`InstanceEngineTemplates`](../../../builder/templates/Instance.js#L185) instances that imported data in place, so every importer sees the instanced objects.
- `ENGINE.Blueprints` exposes raw clones of them.

**Engine templates bypass the payload boundary.** They are authored already compliant, and only Instance.js converts their units. Game templates are payload data, so they must go through validate.js and normalize.js. They must come out in exactly the same shape Instance.js produces, so nothing downstream can tell the two apart.

**Payload schemas.**
- Collections built from parts (terrain, obstacles, characters, enemies, projectiles, particle `part`) can reuse the existing `levelPart`/`levelObject`/blueprint schemas.
- Textures, scatter types, player characters and the particle template's own tuning fields have no payload schema today.

**Overlap with `entityBlueprints`.** A level's `entityBlueprints` buckets are already game-authored, reusable entity definitions, and `level.entities` references them by `blueprintId`. That covers most of what Characters, Enemies and Projectiles templates would do. See D5.

---

## 3. Work involved

- **One lookup path.** Every module that reads a template collection goes through a single lookup: game templates first, then engine templates. That touches the ten import sites above, plus the id sets normalize builds from `templateCollections` ([normalize.js:784](../../../core/normalize.js#L784)). Where the registry lives is D6.
- **Normalizing templates.** Each collection needs a normalize path that produces Instance.js's output: unit instancing, decal and sprite image loads, scatter quality tiers. Collections without a schema get one.
- **Order.** In `LevelPayload`, `templates` normalizes and registers first. The rest of the payload's id checks (the table's last column) then see the game ids.
- **Lifetime.** Registration and its clearing are tied to CreateLevel/ClearLevel. See D4.
- **Docs.** The builder and core system_map entries, plus MODULE_GROUPS if the registry changes who imports `builder/templates/`.

---

## 4. Carried over from 0.35.5

These wait on game-authored particle templates. (The `shape` particle override was already removed in the 0.35.5 plane rework.)
- **Give the testGame hole sprite smoke.** Level 1 stage 2's `scale-wall-right` generator emits the engine's 3D `smoke`. It would reference a game particle template whose part is a sprite plane.
- **Attach generators like decals.** Today a generator's `position` is an offset from the carrier's center.
  - It would instead pick a `side`, with `position` moving it along that face.
  - It would gain an `area` (like a decal's `scale`) so particles start anywhere on a patch of the face, not from one point.
  - It should use face-relative axes from the start. Decal `position` axes still change with `side`; that fix is in DEFERRED.

---

## 5. Out of scope

- Session-wide registration through the ENGINE API, i.e. templates registered once and shared by every level. Only relevant if D4 picks per-level.
- Sprite ENGINE API (todo, Level API "Sprites").

---

## 6. Open decisions

- **D1. Which collections.**
  - The author's list was player characters, textures, scatter, npcs, projectiles, terrain and obstacles. That leaves out **Enemies** and **Particles**, though particles are the reason this exists.
  - "npcs" maps to the engine's **Characters** collection. Is the payload key `npcs`, `characters`, or both?
- **D2. How strict template failures are.**
  - **(a)** Any invalid template rejects the whole level payload.
  - **(b)** An invalid template is dropped. Each reference to it then falls back the way an unknown id does today: warn, then drop or substitute (section 2 table).
  - **(c)** As (b), but every reference to a dropped template is also dropped, even where a fallback exists today (e.g. textures).
  - Also: do fields inside a template get per-field fallbacks like the rest of the payload, or must a template be complete to count as valid?
- **D3. Id collisions with engine templates.** Does a game id replace the engine template of the same id, fail validation, or live under a namespace?
- **D4. Lifetime.** Are templates registered per level, so ClearLevel drops them? Or do they persist for the session, so a later level can reference an earlier level's templates?
- **D5. `entityBlueprints`.** Keep both mechanisms, or should `entityBlueprints` become entity templates?
- **D6. Where the registry lives.** No new modules unless requested. Candidates:
  - [NewTemplate.js](../../../builder/NewTemplate.js) already resolves templates at build;
  - normalize.js holds the id sets.
  - core/ importing builder/ is an approved exception today, limited to template data.
- **D7. Generator attachment.**
  - Is `side` required, or does it default?
  - Is `area` a box on the face, or a disc?
  - Should the template's velocity be read relative to the face, so "out of the wall" survives any carrier rotation?
- **D8. `ENGINE.Blueprints`.** Does it show registered game templates, or stay engine-only?
